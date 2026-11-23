// Test: Startpasswort, eigenes Passwort ändern, Sperre nach Fehlversuchen
// Aufruf im Repo-Ordner:  node test/anmeldung.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one } from "../lib/db.js";
import { hashPasswort } from "../lib/passwort.js";
import { auth, resetUsers } from "../lib/auth.js";
import { onRequestPost as loginPost, onRequestGet as loginGet } from "../functions/api/login.js";
import { gesperrt, fehlversuch, fehlerAufraeumen, NAME_MAX, IP_MAX, SPERRE } from "../lib/anmeldung.js";
import { mitarbeiterPasswort, mitarbeiterSpeichern, mitarbeiterListe } from "../lib/verwaltung.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x" };
await one(env, "SELECT 1");   // Tabellen anlegen
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin, pw_hash, pw_neu) VALUES ('Sebastian Stern', '', 1, ?, 0), ('Nick Neu', 'wochenplan', 0, ?, 1), ('Olaf Alt', 'wochenplan', 0, ?, 0)",
  await hashPasswort("admin-geheim"), await hashPasswort("start123"), await hashPasswort("olafs-pw-1"));
resetUsers();
const admin = { name: "Sebastian Stern", admin: true, rechte: [] };

let ipNr = 1;
const post = async (body, { token, ip } = {}) => {
  const h = { "content-type": "application/json", "cf-connecting-ip": ip || "10.0.0." + ipNr };
  if (token) h["x-app-code"] = token;
  const r = await loginPost({ request: new Request("https://x/api/login", { method: "POST", headers: h, body: JSON.stringify(body) }), env });
  return { status: r.status, d: await r.json() };
};
const req = token => new Request("https://x/api/login", { headers: { "x-app-code": token } });

// Startpasswort → Anmeldung klappt, App bekommt pwNeu
let r = await post({ name: "Nick Neu", passwort: "start123" });
assert.equal(r.status, 200); assert.equal(r.d.user.pwNeu, true);
let tok = r.d.token;
assert.equal((await auth(env, req(tok))).pwNeu, true);

// eigenes Passwort ändern: Regeln
const aendern = (alt, neu, t = tok) => post({ aktion: "passwort", alt, neu }, { token: t });
assert.equal((await aendern("start123", "kurz")).status, 400);
assert.match((await aendern("start123", "start123")).d.error, /anders/);
assert.match((await aendern("start123", "nick-ist-toll")).d.error, /erraten/);
assert.match((await aendern("start123", "12345678")).d.error, /erraten/);
assert.equal((await post({ aktion: "passwort", alt: "start123", neu: "Sommer-Baustelle-7" })).status, 401, "ohne Anmeldung nicht");
r = await aendern("falsch", "Sommer-Baustelle-7");
assert.equal(r.status, 403); assert.match(r.d.error, /bisherige Passwort stimmt nicht/);

r = await aendern("start123", "Sommer-Baustelle-7");
assert.equal(r.status, 200); assert.equal(r.d.user.pwNeu, false);
assert.equal(await auth(env, req(tok)), null, "altes Token ungültig");
assert.equal((await auth(env, req(r.d.token))).name, "Nick Neu", "neues Token gilt");
assert.equal((await one(env, "SELECT pw_neu FROM mitarbeiter WHERE name = 'Nick Neu'")).pw_neu, 0);
assert.equal((await post({ name: "Nick Neu", passwort: "start123" })).status, 401);
assert.equal((await post({ name: "nick neu", passwort: "Sommer-Baustelle-7" })).status, 200);

// Sperre je Name: 5 Fehlversuche → gesperrt, auch das richtige Passwort hilft dann nicht
ipNr = 2;
for (let i = 1; i < NAME_MAX; i++) {
  r = await post({ name: "Olaf Alt", passwort: "falsch" + i });
  assert.equal(r.status, 401);
  if (NAME_MAX - i <= 2) assert.match(r.d.error, /noch \d Versuch/);
}
r = await post({ name: "Olaf Alt", passwort: "falsch" });
assert.equal(r.status, 429); assert.match(r.d.error, /15 Minuten gesperrt/);
ipNr = 3;   // anderer Anschluss – Name bleibt gesperrt
assert.equal((await post({ name: "Olaf Alt", passwort: "olafs-pw-1" })).status, 429);
assert.equal((await post({ name: "Nick Neu", passwort: "Sommer-Baustelle-7" })).status, 200, "andere Namen nicht betroffen");
assert.equal((await mitarbeiterListe(env)).find(m => m.name === "Olaf Alt").gesperrt, true);
// Sperre läuft ab
assert.ok(await gesperrt(env, "Olaf Alt", "") > 0);
assert.equal(await gesperrt(env, "Olaf Alt", "", Date.now() + SPERRE + 1000), 0);

// Büro setzt neues Passwort → Sperre weg, Startpasswort-Pflicht, Admin setzt eigenes → keine Pflicht
const liste = await mitarbeiterPasswort(env, admin, { id: (await one(env, "SELECT id FROM mitarbeiter WHERE name = 'Olaf Alt'")).id, passwort: "neu-vom-buero" });
const olaf = liste.find(m => m.name === "Olaf Alt");
assert.equal(olaf.gesperrt, false); assert.equal(olaf.pwNeu, true);
r = await post({ name: "Olaf Alt", passwort: "neu-vom-buero" });
assert.equal(r.status, 200); assert.equal(r.d.user.pwNeu, true);
await mitarbeiterPasswort(env, admin, { id: 1, passwort: "admin-neu-99" });
assert.equal((await one(env, "SELECT pw_neu FROM mitarbeiter WHERE id = 1")).pw_neu, 0);

// neuer Mitarbeiter mit Passwort = Startpasswort
await mitarbeiterSpeichern(env, admin, { name: "Paula Plan", passwort: "anfang1" });
assert.equal((await one(env, "SELECT pw_neu FROM mitarbeiter WHERE name = 'Paula Plan'")).pw_neu, 1);

// Sperre je Anschluss: viele Namen von einer IP durchprobieren
const t0 = Date.now();
let f;
for (let i = 0; i < IP_MAX; i++) f = await fehlversuch(env, "Unbekannt " + i, "9.9.9.9", t0);
assert.ok(f.sperre > 0);
assert.ok(await gesperrt(env, "Nick Neu", "9.9.9.9", t0) > 0, "IP gesperrt");
assert.equal(await gesperrt(env, "Nick Neu", "8.8.8.8", t0), 0);

// Zähler beginnt nach 15 Minuten neu
await fehlversuch(env, "Zeit Test", "", t0);
f = await fehlversuch(env, "Zeit Test", "", t0 + 16 * 60000);
assert.equal(f.rest, NAME_MAX - 1);

// Aufräumen
await fehlerAufraeumen(env, t0 + 2 * 24 * 3600e3);
assert.equal((await one(env, "SELECT COUNT(*) AS n FROM login_fehler")).n, 0);

// Namensliste unverändert erreichbar
const g = await loginGet({ request: new Request("https://x/api/login?liste=1"), env });
assert.equal((await g.json()).namen.length, 4);

console.log("anmeldung.test OK");
