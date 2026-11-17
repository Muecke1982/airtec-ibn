// Test: Autos (Pflege, Rechte, TÜV-/Leasing-Hinweise, „TÜV erledigt“) und Suche
// Aufruf im Repo-Ordner:  node test/autos.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, all, heute } from "../lib/db.js";
import { liste, speichern, loeschen, tuevErledigt, pruefen } from "../lib/autos.js";
import { liste as nachrichten, aktion } from "../lib/austausch.js";
import { suche } from "../lib/suche.js";
import { resetUsers } from "../lib/auth.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x" };
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin, telefon) VALUES ('Sebastian Stern', '', 1, '0171 9876543')");
await run(env, "INSERT INTO mitarbeiter (name, rechte, telefon) VALUES ('Nick Pauls', 'protokolle,autos', '+49 170 1234567')");
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Christina Schatz', 'hinweise,autos,autos_verwalten')");
resetUsers();
const seb = { name: "Sebastian Stern", admin: true, rechte: [] };
const nick = { name: "Nick Pauls", rechte: ["protokolle", "autos"] };
const chr = { name: "Christina Schatz", rechte: ["hinweise", "autos", "autos_verwalten"] };
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);
const p2 = n => String(n).padStart(2, "0");
const ym = n => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; };
const isoLokal = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const nickId = (await all(env, "SELECT id FROM mitarbeiter WHERE name='Nick Pauls'"))[0].id;

// Rechte
await rejects(speichern(env, nick, { kennzeichen: "BOR-X 1" }), /Recht/);
await rejects(liste(env, { name: "Gast", rechte: ["protokolle"] }), /Kein Zugriff/);

// anlegen: TÜV in 3 Monaten (noch nichts), TÜV im nächsten Monat (fällig-Hinweis), Leasing endet in 2 Monaten (Erinnerung 3)
let l = await speichern(env, chr, { kennzeichen: "bor-at 123", marke: "VW", modell: "Crafter", kaufdatum: "2024-03-15", tuevIntervall: 2, tuevNaechster: ym(3), mitarbeiterId: nickId });
assert.equal(l.autos[0].kennzeichen, "BOR-AT 123");
await rejects(speichern(env, chr, { kennzeichen: "BORAT123" }), /gibt es schon/);
const lkw = new Date(); lkw.setMonth(lkw.getMonth() + 2);
const kauf = new Date(lkw); kauf.setMonth(kauf.getMonth() - 36);
l = await speichern(env, chr, { kennzeichen: "BOR-AT 200", marke: "Ford", modell: "Transit", kaufdatum: isoLokal(kauf), leasingMonate: 36, leasingErinnerung: 3,
  tuevIntervall: 2, tuevNaechster: ym(1), mitarbeiterId: nickId });
l = await speichern(env, chr, { kennzeichen: "BOR-AH 7", art: "anhaenger", marke: "Humbaur", tuevIntervall: 2, tuevNaechster: ym(-1) });   // überfällig, ohne Fahrer
const A = k => l.autos.find(a => a.kennzeichen === k);
assert.equal(A("BOR-AT 123").tuev, "ok"); assert.equal(A("BOR-AT 200").tuev, "bald"); assert.equal(A("BOR-AH 7").tuev, "ueberfaellig");
assert.equal(A("BOR-AT 200").leasing, "bald");
assert.equal(A("BOR-AT 123").fahrer, "Nick Pauls");
assert.ok(A("BOR-AT 123").tuevText.match(/\d{4}$/));

// Prüfung (lief schon beim Laden der Liste): Nick bekommt angepinnten TÜV-Hinweis für BOR-AT 200, Büro 2× TÜV + 1× Leasing
let nN = await nachrichten(env, nick);
const tuevNick = nN.nachrichten.filter(m => m.typ === "auto");
assert.equal(tuevNick.length, 1); assert.ok(tuevNick[0].pin && tuevNick[0].text.includes("BOR-AT 200") && tuevNick[0].erinnerung === 2);
assert.ok(nN.erinnern.includes(tuevNick[0].id), "Erinnerung fällig");
const bN = (await nachrichten(env, chr)).nachrichten.filter(m => m.typ === "auto").map(m => m.text);
assert.equal(bN.length, 3, "Büro: 2 TÜV + 1 Leasing");
assert.ok(bN.some(t => t.includes("BOR-AH 7") && t.includes("keinem Mitarbeiter")));
assert.ok(bN.some(t => t.startsWith("📄 Leasing") && t.includes("BOR-AT 200")));
assert.ok((await nachrichten(env, seb)).nachrichten.some(m => m.typ === "auto"), "Admin gehört zum Büro");
// erneute Prüfung: keine doppelten Hinweise
assert.equal(await pruefen(env), 0);
// Nick hakt ab → verschwindet (angepinnter Auto-Hinweis nur bis zum Abhaken)
await aktion(env, nick, { aktion: "erledigt", id: tuevNick[0].id });
assert.ok(!(await nachrichten(env, nick)).nachrichten.some(m => m.typ === "auto"));

// TÜV erledigt → +2 Jahre; neuer Fälligkeitszeitpunkt würde später wieder gemeldet
l = await tuevErledigt(env, chr, { id: A("BOR-AT 200").id });
assert.equal(l.autos.find(a => a.kennzeichen === "BOR-AT 200").tuevNaechster, ym(25));
await rejects(tuevErledigt(env, nick, { id: A("BOR-AT 200").id }), /Recht/);

// meine Autos (für „Autoinfo an Büro“)
assert.deepEqual(nN.meineAutos.map(a => a.kennzeichen).sort(), ["BOR-AT 123", "BOR-AT 200"]);
assert.equal((await nachrichten(env, chr)).meineAutos.length, 0);

// Suche: Kennzeichen ohne Leerzeichen/Bindestrich, Telefon in anderer Schreibweise, Name
let s = await suche(env, "borat12");
assert.equal(s.autos[0].kennzeichen, "BOR-AT 123"); assert.equal(s.autos[0].fahrer, "Nick Pauls"); assert.equal(s.autos[0].fahrerTel, "+49 170 1234567");
s = await suche(env, "0170 123");
assert.equal(s.personen[0].name, "Nick Pauls");
assert.ok(s.personen[0].autos.includes("BOR-AT 123"));
s = await suche(env, "+491701234");
assert.equal(s.personen[0].name, "Nick Pauls", "+49 wird wie 0 behandelt");
s = await suche(env, "christ");
assert.equal(s.personen[0].name, "Christina Schatz");
assert.ok(!("adresse" in s.personen[0]), "keine Adresse in der Suche");
s = await suche(env, "crafter"); assert.equal(s.autos.length, 1);
assert.deepEqual(await suche(env, "x"), { personen: [], autos: [] });

// löschen
l = await loeschen(env, chr, { id: A("BOR-AH 7").id });
assert.equal(l.autos.length, 2);
console.log("Autos und Suche: alle Prüfungen bestanden.");
