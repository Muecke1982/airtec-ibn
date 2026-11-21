// Handy-Mitteilungen (Web Push) – ohne fremde Bibliothek, nur mit WebCrypto (läuft in Cloudflare Workers und Node).
//
//  • Schlüsselpaar (VAPID) wird beim ersten Gebrauch erzeugt und in „einstellungen“ (push_vapid) gespeichert.
//  • Jedes Handy, das Mitteilungen erlaubt, meldet sein Abo (endpoint + Schlüssel) → Tabelle push_abos.
//  • Welche Arten eine Person bekommt, legt das Büro in der Verwaltung fest (mitarbeiter.mitteilungen_aus = ausgeschaltete Arten).
//  • Inhalt wird nach RFC 8291 (aes128gcm) verschlüsselt, Absender nach RFC 8292 (VAPID, ES256) ausgewiesen.
import { all, one, run, jetzt } from "./db.js";

export const ARTEN = [
  ["direkt", "Direkte Nachrichten und Antworten"],
  ["hinweis", "Neue Hinweise und angepinnte Nachrichten (Startseite)"],
  ["alle", "Nachrichten an alle und Abstimmungen"],
  ["buero", "Nachrichten ans Büro (nur mit Recht „Büro“)"],
];
const ART_KEYS = ARTEN.map(a => a[0]);
const KONTAKT = "https://www.airtec-kaeltetechnik.de";   // „sub“ im VAPID-Token (Pflichtangabe für die Push-Dienste)
const fail = (m, status = 400) => Object.assign(new Error(m), { status });
const lc = s => String(s || "").toLowerCase().trim();

// ---------- Base64url ----------
export const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = s => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), c => c.charCodeAt(0));
const text = s => new TextEncoder().encode(s);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };

// ---------- Schlüssel ----------
let vapidCache = null;
export async function vapid(env) {
  if (vapidCache) return vapidCache;
  const row = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'push_vapid'");
  let v = row && JSON.parse(row.wert || "null");
  if (!v || !v.pub || !v.jwk) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    v = { pub: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), jwk: await crypto.subtle.exportKey("jwk", kp.privateKey) };
    await run(env, "INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES ('push_vapid', ?)", JSON.stringify(v));
    v = JSON.parse((await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'push_vapid'")).wert);   // falls zwei gleichzeitig erzeugt haben
  }
  vapidCache = { pub: v.pub, key: await crypto.subtle.importKey("jwk", v.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]) };
  return vapidCache;
}
export const _reset = () => { vapidCache = null; };

async function vapidHeader(env, endpoint) {
  const v = await vapid(env);
  const head = b64u(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(text(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: KONTAKT })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, text(head + "." + body));   // WebCrypto liefert r||s (64 Byte) = JWT-Format
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

// ---------- Verschlüsselung (RFC 8291, aes128gcm) ----------
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
export async function verschluesseln(p256dh, authSecret, nutzdaten, test = {}) {
  const uaPub = typeof p256dh === "string" ? unb64u(p256dh) : p256dh;
  const auth = typeof authSecret === "string" ? unb64u(authSecret) : authSecret;
  const as = test.as || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, secret, concat(text("WebPush: info\0"), uaPub, asPub), 32);
  const salt = test.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const klar = concat(typeof nutzdaten === "string" ? text(nutzdaten) : nutzdaten, new Uint8Array([2]));   // 0x02 = letzter Datensatz
  const geheim = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, klar));
  const kopf = new Uint8Array(21 + asPub.length);
  kopf.set(salt, 0); new DataView(kopf.buffer).setUint32(16, 4096); kopf[20] = asPub.length; kopf.set(asPub, 21);
  return concat(kopf, geheim);
}

// ---------- Abos ----------
export async function status(env, me) {
  const v = await vapid(env);
  const m = await one(env, "SELECT mitteilungen_aus FROM mitarbeiter WHERE name = ? COLLATE NOCASE", me.name);
  const aus = String((m && m.mitteilungen_aus) || "").split(",").filter(Boolean);
  return { schluessel: v.pub, arten: ARTEN.filter(([k]) => !aus.includes(k)).map(([k, l]) => ({ k, l })) };
}

export async function abonnieren(env, me, b) {
  const s = b && b.abo;
  const endpoint = String((s && s.endpoint) || "");
  const p256dh = String((s && s.keys && s.keys.p256dh) || ""), auth = String((s && s.keys && s.keys.auth) || "");
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw fail("Ungültiges Abo");
  if (unb64u(p256dh).length !== 65 || unb64u(auth).length < 16) throw fail("Ungültiges Abo");
  await run(env, `INSERT INTO push_abos (endpoint, wer, p256dh, auth, geraet, erstellt, fehler) VALUES (?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET wer = excluded.wer, p256dh = excluded.p256dh, auth = excluded.auth, geraet = excluded.geraet, fehler = 0`,
    endpoint, me.name, p256dh, auth, String(b.geraet || "").slice(0, 80), jetzt());
  return status(env, me);
}

export async function abmelden(env, me, b) {
  await run(env, "DELETE FROM push_abos WHERE endpoint = ? AND wer = ? COLLATE NOCASE", String((b && b.endpoint) || ""), me.name);
  return { ok: true };
}

// Anzahl angemeldeter Geräte je Person (für die Verwaltung)
export async function geraete(env) {
  const rows = await all(env, "SELECT wer, COUNT(*) AS n FROM push_abos GROUP BY lower(wer)");
  return Object.fromEntries(rows.map(r => [lc(r.wer), r.n]));
}

// ---------- Senden ----------
// an: Namen; art: direkt | hinweis | alle | buero; m: { titel, text, ziel, tag }
export async function senden(env, an, art, m, opts = {}) {
  const namen = [...new Set((an || []).map(lc).filter(Boolean))];
  if (!namen.length || !ART_KEYS.includes(art)) return { gesendet: 0 };
  const leute = await all(env, "SELECT name, mitteilungen_aus FROM mitarbeiter WHERE aktiv = 1");
  const ok = new Set(leute.filter(p => namen.includes(lc(p.name)) && !String(p.mitteilungen_aus || "").split(",").includes(art)).map(p => lc(p.name)));
  if (!ok.size) return { gesendet: 0 };
  const abos = (await all(env, "SELECT * FROM push_abos")).filter(a => ok.has(lc(a.wer)));
  const daten = JSON.stringify({ titel: String(m.titel || "Airtec KApp").slice(0, 80), text: String(m.text || "").slice(0, 180), ziel: m.ziel || "", tag: m.tag || "" });
  const holen = opts.fetch || fetch;
  let gesendet = 0;
  await Promise.all(abos.map(async a => {
    try {
      const body = await verschluesseln(a.p256dh, a.auth, daten);
      const r = await holen(a.endpoint, { method: "POST", body, headers: {
        Authorization: await vapidHeader(env, a.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
        TTL: "86400", Urgency: art === "direkt" || art === "hinweis" ? "high" : "normal", ...(m.tag ? { Topic: String(m.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}) } });
      if (r.status === 404 || r.status === 410) await run(env, "DELETE FROM push_abos WHERE endpoint = ?", a.endpoint);   // Handy hat das Abo beendet
      else if (!r.ok) { console.error("Push", r.status, await r.text().catch(() => "")); await run(env, "UPDATE push_abos SET fehler = fehler + 1 WHERE endpoint = ?", a.endpoint); }
      else gesendet++;
    } catch (e) { console.error("Push:", e.message); }
  }));
  await run(env, "DELETE FROM push_abos WHERE fehler >= 20");
  return { gesendet };
}
