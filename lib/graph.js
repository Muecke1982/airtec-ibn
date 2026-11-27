import { readFirstSheet } from "./xlsx.js";
// Zugriff auf SharePoint über Microsoft Graph mit dem zentralen Airtec-Zugang (App-Registrierung).
// Variante für Cloudflare Pages Functions. Zugangsdaten kommen aus den Umgebungsvariablen (env).
const GRAPH = "https://graph.microsoft.com/v1.0";
let tokenCache = { value: null, exp: 0 };
let driveCache = null;

export function cfg(env, name, required = true) {
  const v = String(env[name] || "").trim();
  if (!v && required) throw new Error(`Einstellung ${name} fehlt in Cloudflare`);
  return v;
}

export function checkCode(env, request, allowQuery = false) {
  const expected = cfg(env, "APP_CODE");
  const url = new URL(request.url);
  const given = (request.headers.get("x-app-code") || (allowQuery && url.searchParams.get("code")) || "").trim();
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function token(env) {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: cfg(env, "CLIENT_ID"),
    client_secret: cfg(env, "CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg(env, "TENANT_ID")}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error("Anmeldung bei Microsoft fehlgeschlagen: " + (j.error_description || j.error || r.status));
  tokenCache = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.value;
}

async function g(env, path, opts = {}) {
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + (await token(env)), ...(opts.headers || {}) },
  });
  if (!r.ok) {
    let msg = String(r.status);
    try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r;
}

// Einfacher GET auf Microsoft Graph (z. B. Postfach lesen) – liefert JSON
export async function graphGet(env, path, headers = {}) {
  return (await g(env, path, { headers })).json();
}

// „Antworten an“: ausdrücklich angegeben, sonst bei einem No-Reply-Absender (noreply@…) automatisch
// MAIL_REPLY_TO (Cloudflare) bzw. info@ derselben Domain – damit Antworten von Entsorger/Lieferanten ankommen
export function antwortAn(env, from, replyTo) {
  const liste = v => (Array.isArray(v) ? v : String(v || "").split(/[;,]\s*/)).map(s => String(s).trim()).filter(Boolean);
  if (liste(replyTo).length) return liste(replyTo);
  const m = String(from || "").trim().match(/^(no-?reply|do-?not-?reply|keine-?antwort)@(.+)$/i);
  if (!m) return [];
  const std = liste(env && env.MAIL_REPLY_TO);
  return std.length ? std : ["info@" + m[2]];
}

// E-Mail über Microsoft 365 senden (App-Recht „Mail.Send“ nötig). from = Postfach, z. B. bestellung@firma.de
export async function sendMail(env, from, { to, cc = [], subject, text, replyTo }) {
  const rec = list => list.filter(Boolean).map(a => ({ emailAddress: { address: a } }));
  const message = { subject, body: { contentType: "Text", content: text }, toRecipients: rec(to), ccRecipients: rec(cc) };
  const ra = antwortAn(env, from, replyTo);
  if (ra.length) message.replyTo = rec(ra);
  await g(env, `/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
}

export async function drive(env) {
  if (driveCache) return driveCache;
  const u = new URL(cfg(env, "SP_SITE_URL"));
  const sitePath = u.pathname.replace(/\/+$/, "");
  const site = await (await g(env, `/sites/${u.hostname}${sitePath ? ":" + sitePath : ""}`)).json();
  const lib = cfg(env, "SP_LIBRARY", false);
  let d;
  if (lib) {
    const list = await (await g(env, `/sites/${site.id}/drives`)).json();
    const L = lib.toLowerCase();
    d = list.value.find(x => x.name.toLowerCase() === L || decodeURIComponent((x.webUrl || "").split("/").pop()).toLowerCase() === L);
    if (!d) throw new Error(`Dokumentbibliothek „${lib}“ nicht gefunden. Vorhanden: ${list.value.map(x => x.name).join(", ")}`);
  } else {
    d = await (await g(env, `/sites/${site.id}/drive`)).json();
  }
  driveCache = { siteName: site.displayName, driveId: d.id, driveName: d.name };
  return driveCache;
}

const enc = p => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
export const cleanName = s => String(s || "").replace(/[\\/:*?"<>|#%~&{}]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

// conflict: "rename" (Standard – vorhandene Datei bleibt, neue bekommt eine Nummer) oder "replace" (überschreiben)
// Fehlende Ordner legt SharePoint dabei selbst an.
export async function upload(env, folder, filename, bytes, conflict = "rename") {
  const { driveId } = await drive(env);
  const s = await (await g(env, `/drives/${driveId}/root:/${enc(folder + "/" + filename)}:/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": conflict } }),
  })).json();
  const CHUNK = 320 * 1024 * 12;
  let res;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    res = await fetch(s.uploadUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${start}-${end - 1}/${bytes.length}` },
      body: bytes.slice(start, end),
    });
    if (!res.ok && res.status !== 202) {
      let m = ""; try { const j = await res.json(); m = (j.error && j.error.message) || ""; } catch {}
      throw new Error("Upload abgebrochen (" + res.status + ")" + (m ? ": " + m : ""));
    }
  }
  const item = await res.json();
  return { name: item.name, webUrl: item.webUrl };
}

// Dateien eines Ordners (Name, ID, Größe, geändert) – fehlt der Ordner: leere Liste
export async function ordnerInhalt(env, folder) {
  const { driveId } = await drive(env);
  const out = [];
  let url = `/drives/${driveId}/root:/${enc(folder)}:/children?$select=id,name,size,lastModifiedDateTime,file&$top=200`;
  try {
    for (let i = 0; url && i < 10; i++) {
      const j = await (await g(env, url)).json();
      out.push(...(j.value || []).filter(x => x.file).map(x => ({ id: x.id, name: x.name, size: x.size, geaendert: x.lastModifiedDateTime })));
      url = j["@odata.nextLink"] || "";
    }
  } catch (e) { if (e.status === 404) return []; throw e; }
  return out;
}

export async function loeschenItem(env, id) {
  const { driveId } = await drive(env);
  await g(env, `/drives/${driveId}/items/${id}`, { method: "DELETE" });
}

export async function downloadItem(env, id) {
  const { driveId } = await drive(env);
  return new Uint8Array(await (await g(env, `/drives/${driveId}/items/${id}/content`)).arrayBuffer());
}

export async function download(env, path) {
  const { driveId } = await drive(env);
  const r = await g(env, `/drives/${driveId}/root:/${enc(path)}:/content`);
  return new Uint8Array(await r.arrayBuffer());
}

// Datei mit Versionskennung (eTag) laden – für sicheres Zurückschreiben
export async function downloadTagged(env, path) {
  const { driveId } = await drive(env);
  const meta = await (await g(env, `/drives/${driveId}/root:/${enc(path)}?$select=id,eTag`)).json();
  const r = await g(env, `/drives/${driveId}/items/${meta.id}/content`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), etag: meta.eTag, id: meta.id };
}

// Datei überschreiben, nur wenn sie seit dem Laden nicht verändert wurde (sonst Fehler 412 → neu laden)
export async function overwrite(env, id, bytes, etag) {
  const { driveId } = await drive(env);
  try {
    await g(env, `/drives/${driveId}/items/${id}/content`, {
      method: "PUT",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ...(etag ? { "If-Match": etag } : {}) },
      body: bytes,
    });
  } catch (e) {
    if (e.status === 423) e.message = "Die Excel-Datei ist gerade gesperrt (in Excel geöffnet?) – bitte gleich nochmal versuchen";
    throw e;
  }
}

// Werte des ersten Tabellenblatts einer Excel-Datei in SharePoint als Zeilen-Array lesen.
// Die Datei wird nur vom Server heruntergeladen und gelesen – nie aufs Handy.
export async function excelRows(env, path) {
  return readFirstSheet(await download(env, path));
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
