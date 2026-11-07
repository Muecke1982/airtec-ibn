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

export async function upload(env, folder, filename, bytes) {
  const { driveId } = await drive(env);
  const s = await (await g(env, `/drives/${driveId}/root:/${enc(folder + "/" + filename)}:/createUploadSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }),
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
    if (!res.ok && res.status !== 202) throw new Error("Upload abgebrochen: " + res.status);
  }
  const item = await res.json();
  return { name: item.name, webUrl: item.webUrl };
}

export async function download(env, path) {
  const { driveId } = await drive(env);
  const r = await g(env, `/drives/${driveId}/root:/${enc(path)}:/content`);
  return new Uint8Array(await r.arrayBuffer());
}

export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
