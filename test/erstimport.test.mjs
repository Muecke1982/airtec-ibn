// Test: Erster Mitarbeiter-Import ohne Admin (Anmeldung noch über die Excel-Zugangsliste) muss möglich sein,
// danach ist der Import dem Admin vorbehalten.  Aufruf:  node test/erstimport.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { onRequestPost } from "../functions/api/admin.js";
import * as auth from "../lib/auth.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x", SESSION_SECRET: "y" };
const datei = readFileSync(new URL("../vorlagen/Airtec_Zugaenge.xlsx", import.meta.url)).toString("base64");
const call = async (token, body) => onRequestPost({ env, request: new Request("https://x/api/admin", { method: "POST", headers: { "x-app-code": token, "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

// Excel-Fallback: users() liefert Excel → hier über eine leere DB nicht erreichbar, daher Token über login() mit DB-losem Weg:
// Wir legen kurz einen Nutzer in die DB, melden an, leeren die Tabelle wieder (Token bleibt gültig, solange der Nutzer gleich ist).
const { run } = await import("../lib/db.js");
const { hashPasswort } = await import("../lib/passwort.js");
await run(env, "INSERT INTO mitarbeiter (name, pw_hash, rechte, schreiben) VALUES ('Stefan Wermers', ?, 'mitarbeiter', 1)", await hashPasswort("pw-123456"));
auth.resetUsers();
const tok = (await auth.login(env, "Stefan Wermers", "pw-123456")).token;

// ohne Admin in der DB: Import erlaubt
let r = await call(tok, { aktion: "import", bereich: "mitarbeiter", datei });
assert.equal(r.status, 200, "Erstimport ohne Admin erlaubt: " + await r.clone().text());
const j = await r.json();
assert.equal(j.status.adminDa, true, "nach dem Import gibt es einen Admin");
console.log("Erstimport:", j.anzahl, "– Admin gesetzt:", j.status.adminDa);

// jetzt mit Admin: Stefan (kein Admin) darf nicht erneut importieren
auth.resetUsers();
await run(env, "UPDATE mitarbeiter SET pw_hash = ?, rechte = 'mitarbeiter' WHERE name = 'Stefan Wermers'", await hashPasswort("pw-123456"));
auth.resetUsers();
const tok2 = (await auth.login(env, "Stefan Wermers", "pw-123456")).token;
r = await call(tok2, { aktion: "import", bereich: "mitarbeiter", datei });
assert.equal(r.status, 403, "mit Admin: nur Admin darf importieren");
console.log("\nAlle Prüfungen bestanden.");
