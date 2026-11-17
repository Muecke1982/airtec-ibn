// Test: Einmal-Import der Vorlage-Excel-Dateien in eine lokale Datenbank.
// Aufruf im Repo-Ordner:  node test/import.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { importiere, status } from "../lib/import.js";
import { all, one } from "../lib/db.js";
import { pruefePasswort, hashPasswort } from "../lib/passwort.js";
import { VORLAGE } from "../lib/urlaub-vorlage.js";

const env = { DB: fakeD1() };
const me = { name: "Test Büro", schreiben: true };
const b64 = f => readFileSync(new URL("../vorlagen/" + f, import.meta.url)).toString("base64");

const res = {};
res.mitarbeiter = await importiere(env, me, { bereich: "mitarbeiter", datei: b64("Airtec_Zugaenge.xlsx") });
res.maschinen = await importiere(env, me, { bereich: "maschinen", datei: b64("Airtec_Maschinen.xlsx") });
res.lager = await importiere(env, me, { bereich: "lager", datei: b64("Airtec_Lager.xlsx") });
res.hinweise = await importiere(env, me, { bereich: "hinweise", datei: b64("Airtec_Hinweise.xlsx") });
res.urlaub = await importiere(env, me, { bereich: "urlaub", datei: VORLAGE });
res.stammdaten = await importiere(env, me, { bereich: "stammdaten", stamm: {
  lists: { "Kältemittel": ["R32", "R410A", "R32"], "Hersteller": ["Daikin"] }, free: { "Hersteller": false },
  nach: [{ h: "Daikin RXM", km: "15", f: { 6: 0.02, 10: 0.05, 12: "", 16: "" } }], gwp: { R32: 675, R410A: 2088 },
  docs: [{ h: "Daikin", kit: "", name: "Anleitung", url: "https://example.com/a.pdf" }], monteure: [{ name: "Max", mail: "" }], upload: "https://example.com/up" } });
for (const [k, v] of Object.entries(res)) console.log(k.padEnd(12), v.anzahl);

// zweiter Import desselben Bereichs ersetzt statt zu verdoppeln
const n1 = (await one(env, "SELECT COUNT(*) n FROM artikel")).n;
await importiere(env, me, { bereich: "lager", datei: b64("Airtec_Lager.xlsx") });
assert.equal((await one(env, "SELECT COUNT(*) n FROM artikel")).n, n1, "Re-Import darf nicht verdoppeln");
assert.ok(n1 > 0, "Lager-Vorlage sollte Artikel enthalten");

// Stammdaten: doppelte Werte entfernt, „frei“ übernommen
assert.deepEqual((await all(env, "SELECT wert FROM listen_werte WHERE liste='Kältemittel' ORDER BY pos")).map(r => r.wert), ["R32", "R410A"]);
assert.equal((await one(env, "SELECT frei FROM listen WHERE name='Hersteller'")).frei, 0);

// Passwörter nie im Klartext
const m = await all(env, "SELECT name, pw_hash FROM mitarbeiter");
for (const u of m) assert.ok(!u.pw_hash || u.pw_hash.startsWith("pbkdf2$"), "Passwort muss verschlüsselt sein");
console.log("Mitarbeiter:", m.map(u => u.name).join(", ") || "(Vorlage ohne Einträge)");

// Zeiten im Format JJJJ-MM-TT
for (const r of await all(env, "SELECT von FROM ausleihen")) assert.match(r.von, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
for (const r of await all(env, "SELECT am FROM meldungen")) assert.match(r.am, /^\d{4}-\d{2}-\d{2}/);

// ---------- mit Beispieldaten im Format, das die App bisher in die Excel schreibt ----------
const { openWorkbook } = await import("../lib/xlsx.js");
const P_HEAD = ["Nr", "Maschine", "Monteur", "Entnommen", "Zurückgelegt", "Zuletzt bestätigt", "Bemerkung", "Verliehen an", "Ansprechpartner", "Rückgabe bis", "Baustelle"];
const mwb = await openWorkbook(readFileSync(new URL("../vorlagen/Airtec_Maschinen.xlsx", import.meta.url)));
const mrows = await mwb.rows("Maschinen");
const m1 = String(mrows[1][0] || mrows[1][1]).trim(), m1name = String(mrows[1][1]).trim();
await mwb.setBody("Protokoll", [   // neueste zuerst, wie in der App
  [m1, m1name, "Nick", "12.11.2026 07:15", "", "", "", "", "", "", "Baustelle Meier"],
  [m1, m1name, "Elvi", "03.11.2026 06:50", "05.11.2026 16:10", "", "übergeben an Nick", "", "", "", ""],
], P_HEAD);
await mwb.setBody("Reservierungen", [[m1, m1name, "Trogo", "20.11.2026", "22.11.2026", "Halle 2", "Sebastian", "15.11.2026 09:00"]]);
await importiere(env, me, { bereich: "maschinen", datei: Buffer.from(await mwb.toBytes()).toString("base64") });
const aus = await all(env, "SELECT * FROM ausleihen ORDER BY id");
assert.equal(aus.length, 2);
assert.equal(aus[0].wer, "Elvi", "älteste Ausleihe zuerst (aufsteigende Nummer)");
assert.equal(aus[0].bis, "2026-11-05 16:10");
assert.equal(aus[1].baustelle, "Baustelle Meier");
assert.equal(aus[1].bis, "", "offene Ausleihe");
const rs = await all(env, "SELECT * FROM reservierungen");
assert.deepEqual([rs[0].fuer, rs[0].von, rs[0].bis], ["Trogo", "2026-11-20", "2026-11-22"]);

const lwb = await openWorkbook(readFileSync(new URL("../vorlagen/Airtec_Lager.xlsx", import.meta.url)));
const art1 = (await all(env, "SELECT nr, bez FROM artikel ORDER BY kategorie_id, pos LIMIT 1"))[0];
await lwb.setBody("Meldungen", [
  [art1.nr, art1.bez, "", "Leer", "Nick, Elvi", "14.11.2026 07:30", "", "", ""],
  ["NEU-ABC123", "Kabelbinder – 300 mm", "", "Benötigt", "Yannick", "13.11.2026 15:00", "14.11.2026 09:00", "Sebastian", "abgehakt (ohne Bestellung)"]]);
await lwb.setBody("Bestellungen", [
  ["14.11.2026 09:05", "Würth", "bestellung@example.com", "Sebastian", "5 × 123 Schrauben", "1"]]);
await importiere(env, me, { bereich: "lager", datei: Buffer.from(await lwb.toBytes()).toString("base64") });
const me2 = await all(env, "SELECT * FROM meldungen ORDER BY id");
assert.equal(me2.length, 2);
assert.equal(me2[0].nr, "NEU-ABC123", "ältere Meldung zuerst");
assert.equal(me2[1].bestellt_am, "", "offene Meldung");
assert.equal((await one(env, "SELECT COUNT(*) n FROM bestellungen")).n, 1);

const hwb = await openWorkbook(readFileSync(new URL("../vorlagen/Airtec_Hinweise.xlsx", import.meta.url)));
await hwb.setBody("Hinweise", [
  ["Alle", "Freitag Grillen 🎉", "Christina Schatz", "10.11.2026 08:00", "", "Nick 10.11.2026 09:00; Elvi 11.11.2026 07:00", "x", "30.11.2026"],
  ["Büro", "Bohrmaschine defekt", "Nick", "12.11.2026 16:30", "", "", "", ""],
]);
await hwb.addSheet("Müll", [["Angefordert am", "Angefordert von", "Gesendet an"], ["13.11.2026 10:00", "Nick", "entsorger@example.com"]]);
await importiere(env, me, { bereich: "hinweise", datei: Buffer.from(await hwb.toBytes()).toString("base64") });
const hw = await all(env, "SELECT * FROM hinweise ORDER BY id");
assert.equal(hw.length, 2);
assert.equal(hw[0].text, "Freitag Grillen 🎉");
assert.equal(hw[0].pin, 1);
assert.equal(hw[0].bis, "2026-11-30");
assert.deepEqual((await all(env, "SELECT wer FROM hinweise_erledigt WHERE hinweis_id=? ORDER BY wer", hw[0].id)).map(r => r.wer), ["Elvi", "Nick"]);
assert.equal((await one(env, "SELECT am FROM muell")).am, "2026-11-13 10:00");
assert.ok((await one(env, "SELECT wert FROM einstellungen WHERE schluessel='muell_empfaenger'")).wert.includes("@"));
console.log("Beispieldaten (Ausleihen, Reservierung, Meldungen, Bestellung, Hinweise, Müll) korrekt übernommen.");

const st = await status(env);
assert.equal(st.verbunden, true);
assert.equal(st.bereiche.filter(b => b.import).length, 6);
const h = await hashPasswort("geheim");
assert.ok(await pruefePasswort("geheim", h), "richtiges Passwort");
assert.ok(!(await pruefePasswort("falsch", h)), "falsches Passwort");
console.log("\nAlle Prüfungen bestanden.");
