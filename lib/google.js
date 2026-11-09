// Zugriff auf die Google-Tabelle (Wochenplan) über ein Google-Dienstkonto.
// Einstellungen: GOOGLE_SA_JSON (kompletter Inhalt der Schlüsseldatei des Dienstkontos), GSHEET_ID (ID der Tabelle).
import { cfg } from "./graph.js";

const ENC = new TextEncoder();
const API = "https://sheets.googleapis.com/v4/spreadsheets/";
const toks = {};
let metaCache = { at: 0, id: "", sheets: null };
const valCache = new Map();
const CACHE_MS = 60 * 1000;

function sa(env) {
  let j;
  try { j = JSON.parse(cfg(env, "GOOGLE_SA_JSON")); } catch (e) {
    throw new Error(e.message.includes("fehlt") ? e.message : "GOOGLE_SA_JSON ist kein gültiger Schlüssel (JSON)");
  }
  if (!j.client_email || !j.private_key) throw new Error("GOOGLE_SA_JSON: client_email oder private_key fehlt");
  return j;
}
export const saEmail = env => sa(env).client_email;

const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function token(env, write = false) {
  const tok = toks[write ? "w" : "r"];
  if (tok && Date.now() < tok.exp - 60000) return tok.value;
  const s = sa(env);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(ENC.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64u(ENC.encode(JSON.stringify({
    iss: s.client_email,
    scope: write ? "https://www.googleapis.com/auth/spreadsheets" : "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })));
  const pem = s.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, ENC.encode(head + "." + claim)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + sig }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google-Anmeldung fehlgeschlagen: " + (j.error_description || j.error || r.status));
  toks[write ? "w" : "r"] = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function gget(env, path) {
  const r = await fetch(API + path, { headers: { Authorization: "Bearer " + await token(env) } });
  if (!r.ok) {
    let m = String(r.status); try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch {}
    if (r.status === 403 || r.status === 404) m += ` – ist die Tabelle für ${saEmail(env)} freigegeben?`;
    const e = new Error("Google-Tabelle: " + m); e.status = r.status; throw e;
  }
  return r.json();
}

// Alle Blätter (Titel + verbundene Zellen)
export async function sheets(env) {
  const id = cfg(env, "GSHEET_ID");
  if (metaCache.sheets && metaCache.id === id && Date.now() - metaCache.at < CACHE_MS) return metaCache.sheets;
  const j = await gget(env, `${encodeURIComponent(id)}?fields=properties.title,sheets(properties(title,sheetId),merges)`);
  const list = (j.sheets || []).map(s => ({ title: s.properties.title, id: s.properties.sheetId, merges: s.merges || [] }));
  metaCache = { at: Date.now(), id, sheets: list };
  return list;
}

// Werte eines Blatts; verbundene Zellen werden in alle Teilzellen aufgefüllt
export async function sheetValues(env, sheet) {
  const id = cfg(env, "GSHEET_ID");
  const k = id + "|" + sheet.title;
  const c = valCache.get(k);
  if (c && Date.now() - c.at < CACHE_MS) return c.rows;
  const range = encodeURIComponent(`'${sheet.title.replace(/'/g, "''")}'!A1:AZ80`);
  const j = await gget(env, `${encodeURIComponent(id)}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
  const rows = (j.values || []).map(r => r.map(v => String(v ?? "")));
  for (const m of sheet.merges) {
    const v = (rows[m.startRowIndex] || [])[m.startColumnIndex] || "";
    if (!v) continue;
    for (let r = m.startRowIndex; r < m.endRowIndex; r++) {
      rows[r] = rows[r] || [];
      for (let col = m.startColumnIndex; col < m.endColumnIndex; col++) if (!rows[r][col]) rows[r][col] = v;
    }
  }
  valCache.set(k, { at: Date.now(), rows });
  return rows;
}

// Zellen schreiben: list = [{ sheetId, row, col, value, note? }] – Formatierung der Zellen bleibt erhalten
export async function writeCells(env, list) {
  if (!list.length) return;
  const id = cfg(env, "GSHEET_ID");
  const requests = list.map(x => ({
    updateCells: {
      range: { sheetId: x.sheetId, startRowIndex: x.row, endRowIndex: x.row + 1, startColumnIndex: x.col, endColumnIndex: x.col + 1 },
      rows: [{ values: [Object.assign({ userEnteredValue: { stringValue: x.value } }, x.note !== undefined ? { note: x.note } : {})] }],
      fields: x.note !== undefined ? "userEnteredValue,note" : "userEnteredValue",
    },
  }));
  const r = await fetch(API + encodeURIComponent(id) + ":batchUpdate", {
    method: "POST",
    headers: { Authorization: "Bearer " + await token(env, true), "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!r.ok) {
    let m = String(r.status); try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch {}
    if (r.status === 403) m += ` – ist die Tabelle für ${saEmail(env)} als „Bearbeiter“ freigegeben?`;
    throw new Error("Google-Tabelle schreiben: " + m);
  }
  clearCache();
}

export function clearCache() { metaCache = { at: 0, id: "", sheets: null }; valCache.clear(); }
