// Anmeldung mit Name + Passwort.
// Die Zugänge stehen in einer eigenen Excel-Datei in SharePoint (Standard: Airtec_Zugaenge.xlsx neben der
// Stammdaten-Datei). Diese Datei liest nur der Server – Passwörter gelangen nie aufs Handy.
//
// Spalten (Überschrift in Zeile 1, Reihenfolge egal):
//   Name | E-Mail | Passwort | Name im Wochenplan | Schreibrecht (x / ja)
import { cfg, excelRows } from "./graph.js";
import { hasDb, all } from "./db.js";
import { pruefePasswort } from "./passwort.js";
import { ALLE, MONTEUR, rechteAus, istBuero } from "./rechte.js";

const ENC = new TextEncoder();
const CACHE_MS = 30 * 1000;
const SESSION_DAYS = 365;
let usersCache = { at: 0, list: null };

export function zugangPath(env) {
  const p = cfg(env, "SP_ZUGANG_PATH", false);
  if (p) return p;
  const stamm = cfg(env, "SP_STAMM_PATH");
  return stamm.replace(/[^/]*$/, "") + "Airtec_Zugaenge.xlsx";
}

const yes = v => /^(x|ja|j|1|true|wahr|yes|✓|✔)$/i.test(String(v ?? "").trim());

// Geburtstag als { t: Tag, m: Monat } – akzeptiert „12.03.“, „12.03.1985“ oder ein echtes Excel-Datum
function birthday(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\.(\d{1,2})\.?/);
  if (m) return { t: +m[1], m: +m[2] };
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { t: +m[3], m: +m[2] };
  const n = +s;
  if (n > 1000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return { t: d.getUTCDate(), m: d.getUTCMonth() + 1 }; }
  return null;
}

export function parseUsers(rows) {
  if (!rows.length) return [];
  const head = rows[0].map(h => String(h).toLowerCase().trim());
  const col = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
  let cName = head.findIndex(h => h === "name" || h === "monteur" || h === "mitarbeiter");
  if (cName < 0) cName = head.findIndex(h => h.includes("name") && !h.includes("plan") && !h.includes("tabelle"));
  const cMail = col("mail");
  const cPw = col("passwort", "kennwort", "password");
  const cPlan = col("wochenplan", "plan", "tabelle");
  const cWrite = col("schreib", "bearbeit", "büro", "buero");
  const cBirth = col("geburt");
  if (cName < 0 || cPw < 0) throw new Error("Zugangsliste: Spalten „Name“ und „Passwort“ werden benötigt");
  return rows.slice(1).map(r => {
    const write = cWrite >= 0 && yes(r[cWrite]);
    return {
      name: String(r[cName] ?? "").trim(),
      mail: cMail >= 0 ? String(r[cMail] ?? "").trim() : "",
      pw: String(r[cPw] ?? "").trim(),
      plan: (cPlan >= 0 && String(r[cPlan] ?? "").trim()) || String(r[cName] ?? "").trim(),
      write, rechte: write ? [...ALLE] : [...MONTEUR], admin: false,   // Excel kennt nur „Schreibrecht“
      geb: cBirth >= 0 ? birthday(r[cBirth]) : null,
    };
  }).filter(u => u.name);
}

// Mitarbeiter aus der Datenbank. Leer (noch nichts importiert) → null, dann gilt weiter die Excel-Zugangsliste.
async function dbUsers(env) {
  if (!hasDb(env)) return null;
  const rows = await all(env, "SELECT id, name, mail, pw_hash, pw_neu, plan, rechte, admin, geb_tag, geb_monat, aktiv FROM mitarbeiter ORDER BY pos, name");
  if (!rows.length) return null;
  return rows.filter(r => r.aktiv).map(r => {
    const u = { id: r.id, name: r.name, mail: r.mail, pwHash: r.pw_hash, pwNeu: !!r.pw_neu, plan: r.plan || r.name, rechte: rechteAus(r.rechte), admin: !!r.admin,
      geb: r.geb_tag && r.geb_monat ? { t: r.geb_tag, m: r.geb_monat } : null };
    u.write = istBuero(u);
    return u;
  });
}

export async function users(env, fresh = false) {
  if (!fresh && usersCache.list && Date.now() - usersCache.at < CACHE_MS) return usersCache.list;
  const list = (await dbUsers(env)) || parseUsers(await excelRows(env, zugangPath(env)));
  usersCache = { at: Date.now(), list };
  return list;
}
export const resetUsers = () => { usersCache = { at: 0, list: null }; };
export const hatPasswort = u => !!(u.pwHash || u.pw);

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = s => b64u(ENC.encode(s));
const fromB64u = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

async function hmac(env, data) {
  const secret = cfg(env, "SESSION_SECRET", false) || "airtec-session|" + cfg(env, "CLIENT_SECRET");
  const key = await crypto.subtle.importKey("raw", ENC.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, ENC.encode(data)));
}
// Kurzer Fingerabdruck des Passworts: Ändert das Büro ein Passwort, wird die alte Anmeldung ungültig.
async function pwTag(pw) { return b64u(await crypto.subtle.digest("SHA-256", ENC.encode("pw|" + pw))).slice(0, 10); }

function same(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

export async function login(env, name, pw) {
  const list = await users(env, true);
  const u = list.find(x => x.name.toLowerCase() === String(name || "").trim().toLowerCase());
  if (!u || !hatPasswort(u)) return null;
  const ok = u.pwHash ? await pruefePasswort(String(pw || ""), u.pwHash) : same(u.pw, String(pw || ""));
  if (!ok) return null;
  return sitzung(env, u);
}

// neue Sitzung (Token) für einen Benutzer – auch nach „eigenes Passwort ändern“, weil das alte Token dann ungültig ist
export async function sitzung(env, u) {
  if (typeof u === "string") u = (await users(env, true)).find(x => x.name === u);
  if (!u) return null;
  const payload = b64uText(JSON.stringify({ n: u.name, t: await pwTag(u.pwHash || u.pw), e: Date.now() + SESSION_DAYS * 864e5 }));
  const token = "s1." + payload + "." + await hmac(env, payload);
  return { token, user: publicUser(u) };
}

// an die App: Rechte-Liste (Admin = alle) + „schreiben“ = mindestens ein Zusatzrecht (für ältere Programmteile)
// pwNeu: Startpasswort vom Büro → App verlangt zuerst ein eigenes Passwort
export const publicUser = u => ({ name: u.name, mail: u.mail, plan: u.plan, rechte: u.admin ? [...ALLE] : u.rechte || [], admin: !!u.admin, schreiben: !!u.write, pwNeu: !!u.pwNeu });

// Prüft die Anfrage. Gibt den angemeldeten Benutzer zurück (oder null).
// Übergangsweise wird auch noch der alte Firmen-Code akzeptiert, damit bereits eingerichtete Handys weiterlaufen.
export async function auth(env, request, allowQuery = false) {
  const url = new URL(request.url);
  const given = (request.headers.get("x-app-code") || (allowQuery && url.searchParams.get("code")) || "").trim();
  if (!given) return null;
  if (given.startsWith("s1.")) {
    const [, payload, sig] = given.split(".");
    if (!payload || !sig || !same(sig, await hmac(env, payload))) return null;
    let p; try { p = JSON.parse(fromB64u(payload)); } catch { return null; }
    if (!p.e || Date.now() > p.e) return null;
    const passt = async list => { const u = list.find(x => x.name === p.n); return u && hatPasswort(u) && same(p.t, await pwTag(u.pwHash || u.pw)) ? u : null; };
    // passt nicht zur zwischengespeicherten Liste → frisch nachsehen (z. B. Passwort gerade auf einem anderen Server geändert)
    const u = (await passt(await users(env))) || (await passt(await users(env, true)));
    return u ? publicUser(u) : null;
  }
  const code = cfg(env, "APP_CODE", false);
  if (code && same(given, code)) return { name: "", mail: "", plan: "", rechte: ["protokolle"], admin: false, schreiben: false, legacy: true };
  return null;
}
