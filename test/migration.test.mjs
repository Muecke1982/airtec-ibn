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
  INSERT INTO mitarbeiter (name, schreiben) VALUES ('Sebastian Stern', 1), ('Stefan Wermers', 1), ('Nick Pauls', 0);`);

const { all } = await import("../lib/db.js");
const env = { DB: D };
const rows = await all(env, "SELECT name, admin, rechte FROM mitarbeiter ORDER BY id");
assert.equal(rows[0].admin, 1, "Sebastian Stern wird Admin");
assert.equal(rows.filter(r => r.admin).length, 1);
assert.ok(rows[1].rechte.includes("mitarbeiter") && !rows[1].admin, "früheres Büro = alle Rechte");
assert.equal(rows[2].rechte, "wochenplan,protokolle,maschinen,lager", "Monteur = Bereiche");
console.log(rows.map(r => `${r.name}: ${r.admin ? "Admin" : r.rechte}`).join("\n"));
console.log("\nMigration: OK");
