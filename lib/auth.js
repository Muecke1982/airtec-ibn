// Anmeldung mit Name + Passwort.
// Die Zugänge stehen in einer eigenen Excel-Datei in SharePoint (Standard: Airtec_Zugaenge.xlsx neben der
// Stammdaten-Datei). Diese Datei liest nur der Server – Passwörter gelangen nie aufs Handy.
//
// Spalten (Überschrift in Zeile 1, Reihenfolge egal):
//   Name | E-Mail | Passwort | Name im Wochenplan | Schreibrecht (x / ja)
import { cfg, excelRows } from "./graph.js";

const ENC = new TextEncoder();
const CACHE_MS = 5 * 60 * 1000;
const SESSION_DAYS = 365;
let usersCache = { at: 0, list: null };

export function zugangPath(env) {
  const p = cfg(env, "SP_ZUGANG_PATH", false);
  if (p) return p;
  const stamm = cfg(env, "SP_STAMM_PATH");
  return stamm.replace(/[^/]*$/, "") + "Airtec_Zugaenge.xlsx";
}

const yes = v => /^(x|ja|j|1|true|wahr|yes|✓|✔)$/i.test(String(v ?? "").trim());

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
  if (cName < 0 || cPw < 0) throw new Error("Zugangsliste: Spalten „Name“ und „Passwort“ werden benötigt");
  return rows.slice(1).map(r => ({
    name: String(r[cName] ?? "").trim(),
    mail: cMail >= 0 ? String(r[cMail] ?? "").trim() : "",
    pw: String(r[cPw] ?? "").trim(),
    plan: (cPlan >= 0 && String(r[cPlan] ?? "").trim()) || String(r[cName] ?? "").trim(),
    write: cWrite >= 0 && yes(r[cWrite]),
  })).filter(u => u.name);
}

export async function users(env, fresh = false) {
  if (!fresh && usersCache.list && Date.now() - usersCache.at < CACHE_MS) return usersCache.list;
  const list = parseUsers(await excelRows(env, zugangPath(env)));
  usersCache = { at: Date.now(), list };
  return list;
}

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
  if (!u || !u.pw || !same(u.pw, String(pw || ""))) return null;
  const payload = b64uText(JSON.stringify({ n: u.name, t: await pwTag(u.pw), e: Date.now() + SESSION_DAYS * 864e5 }));
  const token = "s1." + payload + "." + await hmac(env, payload);
  return { token, user: publicUser(u) };
}

export const publicUser = u => ({ name: u.name, mail: u.mail, plan: u.plan, schreiben: u.write });

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
    const u = (await users(env)).find(x => x.name === p.n);
    if (!u || !same(p.t, await pwTag(u.pw))) return null;
    return publicUser(u);
  }
  const code = cfg(env, "APP_CODE", false);
  if (code && same(given, code)) return { name: "", mail: "", plan: "", schreiben: false, legacy: true };
  return null;
}
