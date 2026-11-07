// Zugriff auf SharePoint über Microsoft Graph mit dem zentralen Airtec-Zugang (App-Registrierung).
// Alle Zugangsdaten kommen aus den Anwendungseinstellungen der Azure Static Web App.
const crypto = require("crypto");

const GRAPH = "https://graph.microsoft.com/v1.0";
let tokenCache = { value: null, exp: 0 };
let driveCache = null;

function cfg(name, required = true) {
  const v = (process.env[name] || "").trim();
  if (!v && required) throw new Error(`Einstellung ${name} fehlt in Azure`);
  return v;
}

function checkCode(req, allowQuery = false) {
  const expected = cfg("APP_CODE");
  const given = (req.headers.get("x-app-code") || (allowQuery && req.query.get("code")) || "").trim();
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function token() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const body = new URLSearchParams({
    client_id: cfg("CLIENT_ID"),
    client_secret: cfg("CLIENT_SECRET"),
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${cfg("TENANT_ID")}/oauth2/v2.0/token`, { method: "POST", body });
  const j = await r.json();
  if (!r.ok) throw new Error("Anmeldung bei Microsoft fehlgeschlagen: " + (j.error_description || j.error || r.status));
  tokenCache = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.value;
}

async function g(path, opts = {}) {
  const r = await fetch(path.startsWith("http") ? path : GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + (await token()), ...(opts.headers || {}) },
  });
  if (!r.ok) {
    let msg = r.status + "";
    try { const j = await r.json(); msg = j.error?.message || msg; } catch {}
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return r;
}

// SharePoint-Website und Dokumentbibliothek ermitteln
async function drive() {
  if (driveCache) return driveCache;
  const u = new URL(cfg("SP_SITE_URL"));
  const sitePath = u.pathname.replace(/\/+$/, "");
  const site = await (await g(`/sites/${u.hostname}${sitePath ? ":" + sitePath : ""}`)).json();
  const lib = cfg("SP_LIBRARY", false);
  let d;
  if (lib) {
    const list = await (await g(`/sites/${site.id}/drives`)).json();
    d = list.value.find(x => x.name.toLowerCase() === lib.toLowerCase());
    if (!d) throw new Error(`Dokumentbibliothek „${lib}“ nicht gefunden. Vorhanden: ${list.value.map(x => x.name).join(", ")}`);
  } else {
    d = await (await g(`/sites/${site.id}/drive`)).json();
  }
  driveCache = { siteName: site.displayName, driveId: d.id, driveName: d.name };
  return driveCache;
}

const enc = p => p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
const cleanName = s => String(s || "").replace(/[\\/:*?"<>|#%~&{}]+/g, "").replace(/\s+/g, " ").trim().slice(0, 120);

// Datei hochladen (Upload-Sitzung, funktioniert auch für große PDFs mit Fotos)
async function upload(folder, filename, buf) {
  const { driveId } = await drive();
  const path = enc(folder + "/" + filename);
  const s = await (await g(`/drives/${driveId}/root:/${path}:/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
  })).json();
  const CHUNK = 320 * 1024 * 12; // 3,75 MB, Vielfaches von 320 KiB
  let res;
  for (let start = 0; start < buf.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, buf.length);
    res = await fetch(s.uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(end - start), "Content-Range": `bytes ${start}-${end - 1}/${buf.length}` },
      body: buf.subarray(start, end),
    });
    if (!res.ok && res.status !== 202) throw new Error("Upload abgebrochen: " + res.status);
  }
  const item = await res.json();
  return { name: item.name, webUrl: item.webUrl };
}

async function download(path) {
  const { driveId } = await drive();
  const r = await g(`/drives/${driveId}/root:/${enc(path)}:/content`);
  return Buffer.from(await r.arrayBuffer());
}

module.exports = { cfg, checkCode, drive, upload, download, cleanName };
