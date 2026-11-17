// Test: Logbuch über den echten Worker-Einstieg (Anmeldungen, Änderungen, nur Admin sieht es, Aufräumen nach 90 Tagen).
// Aufruf im Repo-Ordner:  node test/logbuch.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import worker from "../worker/index.js";
import { run, all, one } from "../lib/db.js";
import { hashPasswort } from "../lib/passwort.js";
import { beschreibe, aufraeumen } from "../lib/logbuch.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x", SESSION_SECRET: "y" };
const ALLE = "wochenplan,protokolle,maschinen,lager,plan_aendern,hinweise,urlaub,maschinen_buero,lager_bestellen,stammdaten,mitarbeiter";
await run(env, "INSERT INTO mitarbeiter (name, pw_hash, rechte, admin, schreiben) VALUES ('Sebastian Stern', ?, ?, 1, 1)", await hashPasswort("admin-123"), ALLE);
await run(env, "INSERT INTO mitarbeiter (name, pw_hash, rechte, schreiben) VALUES ('Stefan Wermers', ?, ?, 1)", await hashPasswort("stefan-123"), ALLE);
await run(env, "INSERT INTO mitarbeiter (name, pw_hash, rechte) VALUES ('Nick Pauls', ?, 'protokolle')", await hashPasswort("nick-1234"));

const warten = [];
const ctx = { waitUntil: p => warten.push(p) };
async function call(method, path, body, token) {
  const r = await worker.fetch(new Request("https://x" + path, { method, headers: { "Content-Type": "application/json", ...(token ? { "x-app-code": token } : {}) },
    body: body ? JSON.stringify(body) : undefined }), env, ctx);
  await Promise.all(warten.splice(0));
  return r;
}
const login = async (name, pw) => (await (await call("POST", "/api/login", { name, passwort: pw })).json()).token;

const tA = await login("Sebastian Stern", "admin-123");
const tS = await login("Stefan Wermers", "stefan-123");
await call("POST", "/api/login", { name: "Nick Pauls", passwort: "falsch" });
const idNick = (await one(env, "SELECT id FROM mitarbeiter WHERE name = 'Nick Pauls'")).id;
// Änderung durch Stefan: Passwort von Nick neu setzen (Passwort darf NICHT im Logbuch stehen)
let r = await call("POST", "/api/admin", { aktion: "ma_passwort", id: idNick, passwort: "geheimes-neues-pw" }, tS);
assert.equal(r.status, 200);
// abgelehnte Aktion (Stefan darf den Admin nicht ändern) wird nicht als Änderung aufgezeichnet
r = await call("POST", "/api/admin", { aktion: "ma_passwort", id: 1, passwort: "xxxxxxxx" }, tS);
assert.equal(r.status, 403);

const rows = await all(env, "SELECT wer, bereich, aktion, details FROM logbuch ORDER BY id");
console.log(rows.map(x => `${x.wer} | ${x.bereich} | ${x.aktion} | ${x.details}`).join("\n"));
assert.equal(rows.filter(x => x.aktion === "Angemeldet").length, 2);
assert.ok(rows.some(x => x.wer === "Nick Pauls" && x.aktion === "Anmeldung fehlgeschlagen"));
const pw = rows.find(x => x.aktion === "Passwort neu gesetzt");
assert.ok(pw && pw.wer === "Stefan Wermers" && pw.details.includes("Nick Pauls"), "wer + für wen");
assert.ok(!rows.some(x => /geheim|xxxxxxxx/.test(x.details)), "Passwörter nie im Logbuch");
assert.equal(rows.length, 4, "abgelehnte Aktion nicht aufgezeichnet");

// nur der Admin sieht das Logbuch
assert.equal((await call("GET", "/api/admin?teil=logbuch&tage=7", null, tS)).status, 403);
const lb = await (await call("GET", "/api/admin?teil=logbuch&tage=7", null, tA)).json();
assert.equal(lb.eintraege.length, 4); assert.ok(lb.personen.includes("Nick Pauls"));
const nurNick = await (await call("GET", "/api/admin?teil=logbuch&tage=7&wer=" + encodeURIComponent("Nick Pauls"), null, tA)).json();
assert.equal(nurNick.eintraege.length, 1);

// Beschreibungen einzelner Bereiche
assert.equal(beschreibe("/api/maschinen", { aktion: "nehmen", id: "M-07" }).aktion, "Maschine mitgenommen");
assert.match(beschreibe("/api/maschinen", { aktion: "verleihen", id: "M-07", an: "Trogo", tage: 5 }).details, /Nr\.: M-07 · An: Trogo · Tage: 5/);
assert.equal(beschreibe("/api/lager", { aktion: "vorschau", datei: "…" }), null, "Vorschau ist keine Änderung");
assert.match(beschreibe("/api/upload", {}, new URLSearchParams({ name: "IBN_Split_4711.pdf", projekt: "4711" })).details, /IBN_Split_4711\.pdf · Projekt 4711/);
assert.match(beschreibe("/api/plan", { aenderungen: [{ name: "Nick Pauls", datum: "2026-11-18", wert: "Krank" }] }).details, /Nick Pauls 18\.11: Krank/);
assert.ok(!beschreibe("/api/admin", { aktion: "tabelle_speichern", tabelle: "gwp", zeilen: [{ a: 1 }] }).details.includes("zeilen"));

// Aufräumen: Einträge älter als 90 Tage weg
await run(env, "INSERT INTO logbuch (zeit, wer, bereich, aktion) VALUES ('2020-01-01 08:00', 'Alt', 'Anmeldung', 'Angemeldet')");
await aufraeumen(env);
assert.equal((await one(env, "SELECT COUNT(*) n FROM logbuch WHERE wer = 'Alt'")).n, 0);
assert.equal((await one(env, "SELECT COUNT(*) n FROM logbuch")).n, 4);
console.log("\nAlle Prüfungen bestanden.");
