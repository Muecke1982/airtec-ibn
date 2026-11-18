// Test: Allgemeines → Mitarbeiter (Führerscheinprüfung, Urlaubstage, Rechte)
// Aufruf:  node test/personal.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one, heute } from "../lib/db.js";
import { liste, aktion, fsStatus, plusMonate } from "../lib/personal.js";

// Google nicht erreichbar → Urlaub-Fehler, Seite funktioniert trotzdem
const env = { DB: fakeD1() };
const people = [];
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin) VALUES ('Chef', '', 1), ('Peter Muster', 'wochenplan,autos', 0), ('Alt', 'wochenplan', 0)");
await run(env, "UPDATE mitarbeiter SET aktiv = 0 WHERE name = 'Alt'");
const chef = { name: "Chef", admin: true, rechte: [] };
const peter = { name: "Peter Muster", rechte: ["wochenplan", "autos"] };
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);

assert.equal(plusMonate("2026-08-31", 6), "2027-02-28");
assert.equal(fsStatus("", "2026-11-18").status, "leer");
assert.deepEqual(fsStatus("2026-06-10", "2026-11-18"), { status: "ok", naechste: "2026-12-10" });
assert.equal(fsStatus("2026-05-25", "2026-11-18").status, "bald");
assert.equal(fsStatus("2026-05-18", "2026-11-18").status, "faellig");

let l = await liste(env, chef, people);
assert.ok(l.pflegen);
assert.deepEqual(l.mitarbeiter.map(m => m.name), ["Chef", "Peter Muster"], "nur aktive");
assert.ok(l.urlaubFehler, "ohne Google: Hinweis statt Absturz");
const pid = l.mitarbeiter[1].id;

// Führerschein gesichtet
l = await aktion(env, chef, { aktion: "fuehrerschein", id: pid, datum: heute() }, people);
let p = l.mitarbeiter.find(m => m.id === pid);
assert.equal(p.fuehrerschein.letzte, heute()); assert.equal(p.fuehrerschein.von, "Chef"); assert.equal(p.fuehrerschein.status, "ok");
await rejects(aktion(env, chef, { aktion: "fuehrerschein", id: pid, datum: "2099-01-01" }, people), /Zukunft/);
await rejects(aktion(env, chef, { aktion: "fuehrerschein", id: pid, datum: "quatsch" }, people), /gültiges Datum/);
await aktion(env, chef, { aktion: "fuehrerschein", id: pid, datum: plusMonate(heute(), -7) }, people);
l = await liste(env, chef, people); p = l.mitarbeiter.find(m => m.id === pid);
assert.equal(p.fuehrerschein.historie.length, 2); assert.equal(p.fuehrerschein.letzte, heute(), "neueste Prüfung zählt");

// Urlaubsanspruch + Notiz
l = await aktion(env, chef, { aktion: "speichern", id: pid, anspruch: "30", vorjahr: "2,5", notiz: "Staplerschein" }, people);
p = l.mitarbeiter.find(m => m.id === pid);
assert.equal(p.urlaub.anspruch, 30); assert.equal(p.urlaub.vorjahr, 2.5); assert.equal(p.notiz, "Staplerschein");
await rejects(aktion(env, chef, { aktion: "speichern", id: pid, anspruch: "500" }, people), /zwischen 0 und 60/);

// Monteur: sieht nur sich selbst, ohne Notiz, darf nichts ändern
l = await liste(env, peter, people);
assert.equal(l.pflegen, false);
assert.deepEqual(l.mitarbeiter.map(m => m.name), ["Peter Muster"]);
assert.equal(l.mitarbeiter[0].notiz, undefined, "Notizen nur fürs Büro");
assert.equal(l.mitarbeiter[0].urlaub.anspruch, 30);
await rejects(aktion(env, peter, { aktion: "fuehrerschein", id: pid, datum: heute() }, people), /Nur für das Büro/);

// Eintrag löschen
const h = (await liste(env, chef, people)).mitarbeiter.find(m => m.id === pid).fuehrerschein.historie;
await aktion(env, chef, { aktion: "fs_loeschen", pid: h[0].id }, people);
assert.equal((await one(env, "SELECT COUNT(*) n FROM fs_pruefungen")).n, 1);

// Migration 8: wer „mitarbeiter“ hat, bekommt „personal“ – hier direkt prüfen, dass die Spalte/Tabelle existiert
assert.ok(await one(env, "SELECT urlaub_anspruch, urlaub_vorjahr, notiz FROM mitarbeiter LIMIT 1"));
console.log("Mitarbeiter-Infos: alle Prüfungen bestanden.");
