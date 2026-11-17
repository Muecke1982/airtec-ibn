// Test: Datensicherung (alle Tabellen, Aufbewahrung, täglich einmal, Zurückspielen je Bereich mit Sicherheitskopie)
// SharePoint wird durch einen Speicher im Arbeitsspeicher ersetzt.  Aufruf:  node test/sicherung.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, all, one, heute } from "../lib/db.js";
import { sichern, aufraeumen, zurueckspielen, status, ordner, taeglich } from "../lib/sicherung.js";

const env = { DB: fakeD1(), SP_STAMM_PATH: "Inbetriebnahmeprotokolle/Stammdaten/Airtec_Stammdaten.xlsx" };
const ablage = new Map();   // name → { id, bytes }
let nr = 0;
const sp = {
  speichern: async (name, bytes) => { const alt = ablage.get(name); ablage.set(name, { id: alt ? alt.id : "id" + (++nr), bytes }); },
  liste: async () => [...ablage].map(([name, f]) => ({ id: f.id, name, size: f.bytes.length })),
  loeschen: async id => { for (const [k, f] of ablage) if (f.id === id) ablage.delete(k); },
  laden: async id => [...ablage.values()].find(f => f.id === id).bytes,
};
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);

assert.equal(ordner(env), "Inbetriebnahmeprotokolle/Datensicherung", "Ordner neben Stammdaten");
assert.equal(ordner({ ...env, SP_SICHERUNG_ORDNER: "/Backup/KApp/" }), "Backup/KApp");

// Testdaten
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin, telefon) VALUES ('Sebastian Stern', '', 1, '0171 1')");
await run(env, "INSERT INTO autos (kennzeichen, marke, tuev_naechster) VALUES ('BOR-AT 123', 'VW', '2027-03'), ('BOR-AH 7', 'Humbaur', '2027-08')");
await run(env, "INSERT INTO nachrichten (von, text, erstellt, zuletzt) VALUES ('Sebastian Stern', 'Hallo', '2026-11-18 08:00', '2026-11-18 08:00')");

// Sicherung
const s1 = await sichern(env, "Test", "", sp);
assert.equal(s1.datei, `KApp_Sicherung_${heute()}.json`);
assert.ok(s1.tabellen > 30 && s1.zeilen >= 4);
const inhalt = JSON.parse(new TextDecoder().decode(ablage.get(s1.datei).bytes));
assert.equal(inhalt.app, "airtec-kapp");
assert.equal(inhalt.tabellen.autos.length, 2);
assert.ok(!("_schema" in inhalt.tabellen));
// zweimal am selben Tag → überschrieben, keine zweite Datei
await sichern(env, "Test", "", sp);
assert.equal(ablage.size, 1);
// täglich: heute schon gesichert → nichts
assert.equal(await taeglich(env), null);
const st = await status(env, sp);
assert.equal(st.letzte.datei, s1.datei); assert.equal(st.dateien.length, 1); assert.equal(st.ordner, "Inbetriebnahmeprotokolle/Datensicherung");

// Aufbewahrung: 30 Tage alles, danach je Monat die erste für 12 Monate, Rest weg
const tag = n => heute(new Date(Date.now() - n * 864e5));
const alt = [5, 20, 29, 35, 36, 50, 70, 71, 200, 380, 400].map(tag);
for (const t of alt) ablage.set(`KApp_Sicherung_${t}.json`, { id: "x" + t, bytes: new Uint8Array(1) });
ablage.set(`KApp_Sicherung_${tag(40)}_vor-Wiederherstellung_0900.json`, { id: "vw", bytes: new Uint8Array(1) });
ablage.set("andere-Datei.xlsx", { id: "fremd", bytes: new Uint8Array(1) });
await aufraeumen(env, sp);
const bleibt = [...ablage.keys()];
for (const t of [5, 20, 29].map(tag)) assert.ok(bleibt.includes(`KApp_Sicherung_${t}.json`), "jünger als 30 Tage bleibt: " + t);
assert.ok(!bleibt.some(n => n.includes(tag(380))) && !bleibt.some(n => n.includes(tag(400))), "älter als 12 Monate weg");
assert.ok(!bleibt.some(n => n.includes("vor-Wiederherstellung")), "alte Sicherheitskopien weg");
assert.ok(bleibt.includes("andere-Datei.xlsx"), "fremde Dateien bleiben unberührt");
const monate = bleibt.filter(n => /^KApp_Sicherung_\d/.test(n)).map(n => n.slice(15, 25)).filter(t => t < tag(30)).map(t => t.slice(0, 7));
assert.equal(new Set(monate).size, monate.length, "älter als 30 Tage: höchstens eine je Monat");
console.log("Aufbewahrung behält:", bleibt.filter(n => n.startsWith("KApp")).map(n => n.slice(15, 25)).sort().join(", "));

// Zurückspielen: Autos geändert/gelöscht → aus Sicherung wiederherstellen, Nachrichten bleiben unberührt
await run(env, "DELETE FROM autos WHERE kennzeichen = 'BOR-AH 7'");
await run(env, "UPDATE autos SET marke = 'Falsch' WHERE kennzeichen = 'BOR-AT 123'");
await run(env, "INSERT INTO nachrichten (von, text, erstellt, zuletzt) VALUES ('Sebastian Stern', 'Neu nach Sicherung', '2026-11-18 09:00', '2026-11-18 09:00')");
const id = ablage.get(s1.datei).id;
await rejects(zurueckspielen(env, "Sebastian Stern", { datei: id, bereiche: [] }, sp), /Bereich/);
const r = await zurueckspielen(env, "Sebastian Stern", { datei: id, bereiche: ["autos"] }, sp);
assert.deepEqual((await all(env, "SELECT kennzeichen, marke FROM autos ORDER BY kennzeichen")).map(a => a.kennzeichen + " " + a.marke), ["BOR-AH 7 Humbaur", "BOR-AT 123 VW"]);
assert.equal((await one(env, "SELECT COUNT(*) n FROM nachrichten")).n, 2, "andere Bereiche unverändert");
assert.match(r.sicherheitskopie, /vor-Wiederherstellung/);
assert.ok(ablage.has(r.sicherheitskopie), "vorher automatisch gesichert");
// Sicherheitskopie enthält den Stand VOR dem Zurückspielen (1 Auto, Marke „Falsch“)
const vorher = JSON.parse(new TextDecoder().decode(ablage.get(r.sicherheitskopie).bytes));
assert.deepEqual(vorher.tabellen.autos.map(a => a.marke), ["Falsch"]);
// fremde/falsche Datei
ablage.set("kaputt.json", { id: "k", bytes: new TextEncoder().encode('{"app":"anders"}') });
await rejects(zurueckspielen(env, "S", { datei: "k", bereiche: ["autos"] }, sp), /keine Sicherung/);
console.log("Datensicherung: alle Prüfungen bestanden.");
