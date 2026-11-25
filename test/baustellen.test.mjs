// Baustellen: Vorschlagsliste aus dem Wochenplan und Baustellen-Mappen (Einträge, Reminder, Dokumente, Abschluss).
// Aufruf im Repo-Ordner:  node test/baustellen.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { sammeln, keineBaustelle, teile, uebersicht, mappe, aktion, dokumentMerken } from "../lib/baustellen.js";

/* ---------- Vorschlagsliste ---------- */
assert.ok(keineBaustelle("Krank") && keineBaustelle("Urlaub") && keineBaustelle("frei") && keineBaustelle("Berufsschule") && keineBaustelle("Büro"));
assert.ok(!keineBaustelle("Bochum DRV") && !keineBaustelle("Freiburg Klinik"), "„Freiburg“ ist kein „frei“");
assert.deepEqual(teile("Bochum / Münster · Essen"), ["Bochum", "Münster", "Essen"]);

const tag = "2026-11-24", ab = "2026-06-24";
const wochen = [
  { tage: [{ datum: "2026-05-04", e: { A: "Uralt" } }, { datum: "2026-07-01", e: { A: "Dortmund Halle", B: "Krank" } }] },
  { tage: [{ datum: "2026-11-20", e: { A: "Essen", B: "Urlaub" } }, { datum: "2026-11-23", e: { A: "dortmund halle", B: "Frei" } }] },
  { tage: [{ datum: "2026-11-24", e: { A: "Bochum / Münster", B: "Bochum", C: "Büro" } }, { datum: "2026-12-01", e: { A: "Köln Neubau", B: "Essen" } }] },
];
const L = sammeln(wochen, tag, ab);
const namen = L.map(x => x.name);
assert.ok(!namen.includes("Uralt"), "älter als 5 Monate fällt raus");
assert.ok(!namen.some(n => /krank|urlaub|frei|buro|büro/i.test(n)), "keine Abwesenheiten");
assert.equal(namen[0], "Bochum", "heute eingeplant steht oben (2 Einträge)");
assert.ok(namen.indexOf("Münster") < namen.indexOf("Dortmund Halle"), "heute vor gestern");
assert.ok(namen.indexOf("Köln Neubau") < namen.indexOf("Dortmund Halle"), "kommende Baustelle gilt als aktuell");
assert.ok(namen.indexOf("Essen") < namen.indexOf("Dortmund Halle"), "Essen ist wieder eingeplant");
assert.equal(L.filter(x => x.name.toLowerCase() === "dortmund halle").length, 1, "gleiche Baustelle anders geschrieben = eine");
assert.equal(L.find(x => x.name === "Dortmund Halle").zuletzt, "2026-11-23");
assert.deepEqual(L.find(x => x.name === "Bochum").heute.sort(), ["A", "B"]);
assert.equal(L.find(x => x.name === "Essen").naechster, "2026-12-01");

// Einsatz-Angaben: „nur Info“ ist keine Baustelle, Nummer/Info/Kundendienst kommen an den Vorschlag
const wochen2 = [{ tage: [{ datum: "2026-11-24", e: { A: "TÜV", B: "Müller KD", C: "Essen" } }, { datum: "2026-11-26", e: { C: "Essen" } }] }];
const meta = {
  "2026-11-23": { essen: { art: "baustelle", nummer: "4711", info: "alt", fix: false } },
  "2026-11-24": { tuv: { art: "info" }, "muller kd": { art: "kd", nummer: "KD-17", info: "", fix: false } },
  "2026-11-26": { essen: { art: "baustelle", nummer: "", info: "Krantermin 7 Uhr", fix: true } },
};
const L2 = sammeln(wochen2, tag, ab, meta);
assert.ok(!L2.some(x => x.name === "TÜV"), "Art „Info“ ist keine Baustelle");
assert.equal(L2.find(x => x.name === "Müller KD").art, "kd");
assert.equal(L2.find(x => x.name === "Müller KD").nummer, "KD-17");
const E = L2.find(x => x.name === "Essen");
assert.equal(E.nummer, "4711", "Projektnummer bleibt aus dem früheren Eintrag");
assert.equal(E.info, "Krantermin 7 Uhr", "Info vom nächsten Einsatz");
assert.equal(E.fix, "2026-11-26");

/* ---------- Mappen ---------- */
const env = { DB: fakeD1() };

// Einsätze speichern/laden
{
  const { speichern, laden } = await import("../lib/einsaetze.js");
  const env0 = env;
  await speichern(env0,"Bea", [{ datum: "2026-11-24", titel: "Bochum DRV", info: "Krantermin", fix: true }, { datum: "2026-11-24", titel: "Essen" },
    { datum: "2026-11-25", titel: "Bochum DRV", nummer: "4711" }]);
  let M0 = await laden(env0, "2026-11-23", "2026-11-29");
  assert.deepEqual(Object.keys(M0["2026-11-24"]), ["bochum drv"], "ohne Angaben wird nichts gespeichert");
  assert.equal(M0["2026-11-24"]["bochum drv"].fix, true);
  await speichern(env0, "Bea", [{ datum: "2026-11-24", titel: "Schule", art: "info" }], ["2026-11-24"]);
  M0 = await laden(env0, "2026-11-23", "2026-11-29");
  assert.deepEqual(Object.keys(M0["2026-11-24"]), ["schule"], "ersetzen löscht die übrigen des Tages");
  assert.equal(M0["2026-11-25"]["bochum drv"].nummer, "4711", "andere Tage bleiben");
  await speichern(env0, "Bea", [{ datum: "2026-11-25", titel: "bochum  DRV" }]);
  M0 = await laden(env0, "2026-11-23", "2026-11-29");
  assert.equal(M0["2026-11-25"], undefined, "ohne Angaben wieder gespeichert → gelöscht");
}

const max = { name: "Max Monteur", rechte: ["wochenplan", "protokolle"] };
const tom = { name: "Tom Techniker", rechte: ["wochenplan", "protokolle"] };
const buero = { name: "Bea Büro", rechte: ["wochenplan", "plan_aendern"] };

let m = await aktion(env, max, { aktion: "eintrag", baustelle: "Bochum DRV", text: "Schlüssel beim Hausmeister", reminder: true });
assert.equal(m.name, "Bochum DRV");
assert.equal(m.eintraege.length, 1);
assert.equal(m.eintraege[0].reminder, true);
const m2 = await aktion(env, tom, { aktion: "eintrag", baustelle: "bochum  drv", text: "Kernbohrung 2. OG fehlt" });
assert.equal(m2.id, m.id, "gleiche Baustelle anders geschrieben → gleiche Mappe");

let U = await uebersicht(env);
assert.equal(U.length, 1);
assert.equal(U[0].offen, 2);
assert.equal(U[0].reminder.length, 1, "nur der Reminder-Eintrag");
assert.equal(U[0].reminder[0].von, "Max Monteur");

await assert.rejects(aktion(env, tom, { aktion: "loeschen", eintrag: m.eintraege[0].id }), e => e.status === 403, "fremden Eintrag nicht löschen");
m = await aktion(env, tom, { aktion: "erledigt", eintrag: U[0].reminder[0].id });
assert.equal(m.eintraege.find(e => e.reminder).erledigt.von, "Tom Techniker", "abhaken darf jeder");
U = await uebersicht(env);
assert.equal(U[0].reminder.length, 0, "erledigter Reminder verschwindet");
m = await aktion(env, tom, { aktion: "erledigt", eintrag: m.eintraege.find(e => e.reminder).id, ja: false });
assert.equal(m.eintraege.find(e => e.reminder).erledigt, null, "wieder öffnen");
m = await aktion(env, buero, { aktion: "loeschen", eintrag: m.eintraege.find(e => e.reminder).id });
assert.equal(m.eintraege.length, 1, "Büro darf löschen");

// Dokumente: Upload eines Protokolls ordnet es der Mappe zu (neue Baustelle → neue Mappe)
await dokumentMerken(env, "Max Monteur", { baustelle: "BOCHUM DRV", art: "Aufmaß", name: "Aufmass_1.pdf", ordner: "Protokolle/4711/Aufmaß", url: "https://x/1", projekt: "4711" });
await dokumentMerken(env, "Max Monteur", { baustelle: "Essen", art: "IBN-Protokoll", name: "IBN.pdf", ordner: "Protokolle/Inbetriebnahmeprotokolle" });
assert.equal(await dokumentMerken(env, "Max", { baustelle: "  ", art: "Aufmaß", name: "x.pdf" }), null, "ohne Baustelle nichts");
m = await mappe(env, m.id);
assert.equal(m.dokumente.length, 1);
assert.equal(m.projekt, "4711", "Projektnummer aus dem Dokument");
assert.equal((await uebersicht(env)).length, 2);

// Schließen und wieder öffnen
await assert.rejects(aktion(env, max, { aktion: "eintrag", baustelle: "Bochum DRV", text: "" }), e => e.status === 400);
m = await aktion(env, max, { aktion: "schliessen", id: m.id, ordner: "Protokolle/4711/Baustellenmappe/x.pdf", url: "https://x/m" });
assert.equal(m.status, "geschlossen");
assert.equal(m.geschlossen.von, "Max Monteur");
await assert.rejects(aktion(env, max, { aktion: "eintrag", id: m.id, text: "noch was" }), e => e.status === 409, "geschlossene Mappe bleibt zu");
assert.equal((await uebersicht(env)).length, 1, "geschlossene Mappe nicht mehr in der Liste");
assert.equal((await uebersicht(env, { geschlossen: true }))[0].name, "Bochum DRV");
const neu = await aktion(env, max, { aktion: "eintrag", baustelle: "Bochum DRV", text: "Nacharbeit" });
assert.notEqual(neu.id, m.id, "nach dem Schließen gibt es eine neue Mappe");
await assert.rejects(aktion(env, max, { aktion: "oeffnen", id: m.id }), e => e.status === 409, "zwei offene Mappen derselben Baustelle gibt es nicht");

console.log("✓ Baustellen");
