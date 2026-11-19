// Test: Datenbank-Stand von vor den Rechten (nur Migration 1, „Sebastian Stern“ ohne Admin) wird korrekt hochgezogen.
// Aufruf im Repo-Ordner:  node test/migration.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";

const D = fakeD1();
// Stand nach Stufe 2: Tabelle mitarbeiter ohne rechte/admin, Schema-Version 1
D._sql.exec(`CREATE TABLE _schema (version INTEGER NOT NULL); INSERT INTO _schema VALUES (1);
  CREATE TABLE mitarbeiter (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, mail TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL DEFAULT '', plan TEXT NOT NULL DEFAULT '', schreiben INTEGER NOT NULL DEFAULT 0, geb_tag INTEGER, geb_monat INTEGER,
    aktiv INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0);
  INSERT INTO mitarbeiter (name, schreiben) VALUES ('Sebastian Stern', 1), ('Stefan Wermers', 1), ('Nick Pauls', 0);
  CREATE TABLE hinweise (id INTEGER PRIMARY KEY AUTOINCREMENT, an TEXT NOT NULL, text TEXT NOT NULL, von TEXT NOT NULL DEFAULT '',
    erstellt TEXT NOT NULL, ab TEXT NOT NULL DEFAULT '', bis TEXT NOT NULL DEFAULT '', pin INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hinweise_erledigt (hinweis_id INTEGER NOT NULL, wer TEXT NOT NULL COLLATE NOCASE, am TEXT NOT NULL DEFAULT '', PRIMARY KEY (hinweis_id, wer));
  CREATE TABLE logbuch_dummy (x INTEGER);
  INSERT INTO hinweise (an, text, von, erstellt, pin, bis) VALUES ('Alle', 'Grillen', 'Christina Schatz', '2026-11-10 08:00', 1, '2026-12-01'),
    ('Büro', 'Bohrmaschine defekt', 'Nick Pauls', '2026-11-12 16:30', 0, ''), ('Nick', 'Unterlagen liegen bereit', 'Christina Schatz', '2026-11-12 09:00', 0, '');
  INSERT INTO hinweise_erledigt VALUES (1, 'Nick Pauls', '2026-11-10 09:00');`);

const { all } = await import("../lib/db.js");
const env = { DB: D };
const rows = await all(env, "SELECT name, admin, rechte FROM mitarbeiter ORDER BY id");
assert.equal(rows[0].admin, 1, "Sebastian Stern wird Admin");
assert.equal(rows.filter(r => r.admin).length, 1);
assert.ok(rows[1].rechte.includes("mitarbeiter") && !rows[1].admin, "früheres Büro = alle Rechte");
assert.equal(rows[2].rechte, "wochenplan,protokolle,maschinen,lager,autos", "Monteur = Bereiche (inkl. Autos ab Migration 7)");
assert.ok(rows[1].rechte.includes("autos_verwalten"), "Büro bekommt Autos verwalten");
console.log(rows.map(r => `${r.name}: ${r.admin ? "Admin" : r.rechte}`).join("\n"));
// Migration 6: alte Hinweise im Austausch
const na = await all(env, "SELECT n.id, n.text, n.pin, a.empfaenger FROM nachrichten n JOIN nachricht_an a ON a.nachricht_id = n.id ORDER BY n.id");
assert.deepEqual(na.map(x => x.empfaenger), ["*alle", "*buero", "Nick"]);
assert.equal(na[0].pin, 1);
// Migration 11: bei angepinnten wird „zur Kenntnis genommen“ zu „bestätigt“ (Chat bleibt offen)
assert.equal((await all(env, "SELECT * FROM nachricht_status WHERE bestaetigt <> '' AND erledigt = ''")).length, 1);
// alter Hinweis „An: Nick“ (nur Vorname) erreicht Nick Pauls
const { liste } = await import("../lib/austausch.js");
const l = await liste(env, { name: "Nick Pauls", plan: "", rechte: ["protokolle"] });
assert.ok(l.nachrichten.some(m => m.text === "Unterlagen liegen bereit"), "Vorname-Empfänger wird zugeordnet");
console.log("\nMigration: OK");
