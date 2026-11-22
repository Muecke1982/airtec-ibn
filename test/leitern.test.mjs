// Test: Leiter-Prüfbuch (Rechte, Prüfung, Status, Sperre, Aussondern, Monatsmeldung ans Büro)
// Aufruf im Repo-Ordner:  node test/leitern.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, all, heute } from "../lib/db.js";
import { liste, aktion, pruefen, status } from "../lib/leitern.js";
import { beschreibe } from "../lib/logbuch.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x" };
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Nick', 'wochenplan'), ('Christina', 'hinweise,autos')");
const nick = { name: "Nick", rechte: ["wochenplan"] };
const chr = { name: "Christina", rechte: ["hinweise", "leitern"] };
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);
const h = heute();
const minus = (iso, mon, tage = 0) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - mon); d.setUTCDate(d.getUTCDate() - tage); return d.toISOString().slice(0, 10); };


// ansehen ja, pflegen nein
let d = await liste(env, nick);
assert.equal(d.pflegen, false); assert.equal(d.leitern.length, 0); assert.ok(d.punkte.length >= 8);
await rejects(aktion(env, nick, { aktion: "speichern", nr: "L-01" }), /Recht/);

// anlegen
d = await aktion(env, chr, { aktion: "speichern", nr: "L-01", art: "steh", material: "Aluminium", groesse: "6 Stufen", standort: "Lager" });
await rejects(aktion(env, chr, { aktion: "speichern", nr: "l-01" }), /gibt es schon/);
await rejects(aktion(env, chr, { aktion: "speichern", nr: "" }), /Leiter-Nr/);
d = await aktion(env, chr, { aktion: "speichern", nr: "L-02", art: "anlege", standort: "Auto BOR-AT 123" });
const id1 = d.leitern.find(l => l.nr === "L-01").id, id2 = d.leitern.find(l => l.nr === "L-02").id;
assert.equal(d.leitern[0].status, "leer");

// Prüfung ok → 12 Monate gültig
d = await aktion(env, chr, { aktion: "pruefung", id: id1, datum: h, maengel: [], ergebnis: "ok" });
let l1 = d.leitern.find(l => l.id === id1);
assert.equal(l1.status, "ok"); assert.equal(l1.pruefungen[0].pruefer, "Christina"); assert.equal(l1.naechste.slice(0, 4), String(+h.slice(0, 4) + 1));
await rejects(aktion(env, chr, { aktion: "pruefung", id: id1, datum: "2999-01-01" }), /Zukunft/);
await rejects(aktion(env, chr, { aktion: "pruefung", id: id1, datum: h, maengel: ["holme"], ergebnis: "ok" }), /Mängel/);
await rejects(aktion(env, chr, { aktion: "pruefung", id: id1, datum: h, maengel: [], ergebnis: "maengel" }), /Mangel/);

// Status-Rechnung
assert.equal(status({}, { datum: minus(h, 12, 1), ergebnis: "ok" }, h).status, "faellig");
assert.equal(status({}, { datum: minus(h, 11, 20), ergebnis: "ok" }, h).status, "bald");
assert.equal(status({}, { datum: minus(h, 6), ergebnis: "ok" }, h).status, "ok");

// Mängel → gesperrt; Nachprüfung ok → wieder frei
d = await aktion(env, chr, { aktion: "pruefung", id: id2, datum: h, maengel: ["fuesse", "unbekannt"], ergebnis: "maengel", pruefer: "Prüfdienst Müller" });
let l2 = d.leitern.find(l => l.id === id2);
assert.equal(l2.status, "gesperrt"); assert.deepEqual(l2.pruefungen[0].maengel, ["fuesse"]); assert.equal(l2.pruefungen[0].pruefer, "Prüfdienst Müller");

// Monatsmeldung ans Büro: L-02 gesperrt → eine Nachricht, im selben Monat nicht nochmal
assert.equal((await all(env, "SELECT COUNT(*) AS n FROM nachrichten WHERE von = 'Leiterprüfung'"))[0].n, 0, "nie geprüfte Leitern: keine Meldung");
assert.equal(await pruefen(env, "2030-05-02"), 1);
assert.equal(await pruefen(env, "2030-05-20"), 0);
const n = await all(env, "SELECT n.text, a.empfaenger FROM nachrichten n JOIN nachricht_an a ON a.nachricht_id = n.id WHERE n.von = 'Leiterprüfung'");
assert.equal(n.length, 1); assert.equal(n[0].empfaenger, "*buero"); assert.match(n[0].text, /L-02 \(Auto BOR-AT 123\) – gesperrt/);
assert.match(n[0].text, /L-01 \(Lager\) – überfällig/, "2030 ist L-01 überfällig");

d = await aktion(env, chr, { aktion: "pruefung", id: id2, datum: h, maengel: [], ergebnis: "ok", bem: "Fußkappen erneuert" });
assert.equal(d.leitern.find(l => l.id === id2).status, "ok");

// aussondern; Löschen der Aussonderungs-Prüfung holt sie zurück
d = await aktion(env, chr, { aktion: "pruefung", id: id1, datum: h, maengel: ["holme"], ergebnis: "aussondern" });
l1 = d.leitern.find(l => l.id === id1);
assert.equal(l1.status, "aus"); assert.equal(l1.ausgesondert, h);
await rejects(aktion(env, chr, { aktion: "pruefung", id: id1, datum: h, ergebnis: "ok" }), /ausgesondert/);
d = await aktion(env, chr, { aktion: "pruefung_loeschen", pid: l1.pruefungen[0].id });
assert.equal(d.leitern.find(l => l.id === id1).status, "ok");

// löschen
d = await aktion(env, chr, { aktion: "loeschen", id: id1 });
assert.equal(d.leitern.length, 1);
assert.equal((await all(env, "SELECT COUNT(*) AS n FROM leiter_pruefungen WHERE leiter_id = ?", id1))[0].n, 0);

// Logbuch-Text
assert.deepEqual(beschreibe("/api/leitern", { aktion: "pruefung", leiter: "L-02", ergebnis: "ok", datum: h }).aktion, "Leiterprüfung eingetragen");
assert.match(beschreibe("/api/leitern", { aktion: "pruefung", leiter: "L-02", ergebnis: "ok" }).details, /Leiter: L-02/);

console.log("leitern.test OK");
