// Anmeldung mit Name + Passwort. Mitarbeiter, Passwörter (verschlüsselt) und Rechte stehen in der Datenbank
// und werden in der App verwaltet. Passwörter gelangen nie aufs Handy.
import { cfg } from "./graph.js";
import { hasDb, all } from "./db.js";
import { pruefePasswort } from "./passwort.js";
import { ALLE, rechteAus, istBuero } from "./rechte.js";

const ENC = new TextEncoder();
const CACHE_MS = 30 * 1000;
const SESSION_DAYS = 365;
let usersCache = { at: 0, list: null };

// Mitarbeiter aus der Datenbank (verwaltet in der App unter Verwaltung → Mitarbeiter).
async function dbUsers(env) {
  if (!hasDb(env)) return null;
  const rows = await all(env, "SELECT id, name, mail, pw_hash, pw_neu, plan, rechte, admin, geb_tag, geb_monat, aktiv, art, im_plan FROM mitarbeiter ORDER BY pos, name");
  if (!rows.length) return null;
  return rows.filter(r => r.aktiv).map(r => {
    const u = { id: r.id, name: r.name, mail: r.mail, pwHash: r.pw_hash, pwNeu: !!r.pw_neu, plan: r.plan || r.name, rechte: rechteAus(r.rechte), admin: !!r.admin, art: r.art || "Monteur", imPlan: r.im_plan !== 0,
      geb: r.geb_tag && r.geb_monat ? { t: r.geb_tag, m: r.geb_monat } : null };
    u.write = istBuero(u);
    return u;
  });
}

export async function users(env, fresh = false) {
  if (!fresh && usersCache.list && Date.now() - usersCache.at < CACHE_MS) return usersCache.list;
  const list = (await dbUsers(env)) || [];
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
