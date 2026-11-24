// Art des Mitarbeiters (Meister, Azubi …): speichern, Standard „Monteur“, Weitergabe an den Wochenplan.
// Aufruf im Repo-Ordner:  node test/art.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { importiere } from "../lib/import.js";
import { users, resetUsers } from "../lib/auth.js";
import * as V from "../lib/verwaltung.js";
import { matchName } from "../lib/wochenplan.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "test", SESSION_SECRET: "test-secret" };
await importiere(env, { name: "Test" }, { bereich: "mitarbeiter", datei: readFileSync(new URL("../vorlagen/Airtec_Zugaenge.xlsx", import.meta.url)).toString("base64") });
resetUsers();

let ma = await V.mitarbeiterListe(env);
assert.ok(ma.every(m => m.art === "Monteur"), "nach dem Import sind alle Monteur");
const admin = ma.find(m => m.admin), meA = { name: admin.name, admin: true, rechte: [] };
const x = ma.find(m => !m.admin);

ma = await V.mitarbeiterSpeichern(env, meA, { id: x.id, name: x.name, rechte: x.rechte, art: "azubi" });
assert.equal(ma.find(m => m.id === x.id).art, "Azubi", "Art wird gespeichert (Groß/klein egal)");
ma = await V.mitarbeiterSpeichern(env, meA, { id: x.id, name: x.name, rechte: x.rechte });
assert.equal(ma.find(m => m.id === x.id).art, "Azubi", "ohne Angabe bleibt die Art");
ma = await V.mitarbeiterSpeichern(env, meA, { id: admin.id, name: admin.name, art: "Unsinn" });
assert.equal(ma.find(m => m.admin).art, "Monteur", "unbekannte Art = Monteur");
ma = await V.mitarbeiterSpeichern(env, meA, { name: "Neu Praktikant", art: "Praktikant", rechte: ["wochenplan"] });
assert.equal(ma.find(m => m.name === "Neu Praktikant").art, "Praktikant", "neuer Mitarbeiter mit Art");

resetUsers();
const u = (await users(env)).find(v => v.name === x.name);
assert.equal(u.art, "Azubi", "Anmelde-Liste kennt die Art");
assert.equal(matchName(u, [u.plan]), u.plan, "Spalte im Plan wird gefunden");
console.log("✓ Art des Mitarbeiters");
