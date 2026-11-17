// Test Stufe 2: Anmeldung aus der Datenbank, Stammdaten aus der Datenbank, Verwaltung.
// Aufruf im Repo-Ordner:  node test/verwaltung.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { importiere } from "../lib/import.js";
import { users, login, auth, resetUsers } from "../lib/auth.js";
import { stammAusDb } from "../lib/stamm.js";
import * as V from "../lib/verwaltung.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "test", SESSION_SECRET: "test-secret" };
const req = token => new Request("https://x/api/login", { headers: { "x-app-code": token } });
const rejects = async (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);

// leere Datenbank → Stammdaten noch aus Excel (null)
assert.equal(await stammAusDb(env), null);

await importiere(env, { name: "Test" }, { bereich: "mitarbeiter", datei: readFileSync(new URL("../vorlagen/Airtec_Zugaenge.xlsx", import.meta.url)).toString("base64") });
resetUsers();
let list = await users(env);
assert.ok(list.length > 0 && list.every(u => u.pwHash !== undefined), "Mitarbeiter kommen aus der Datenbank");
console.log("Mitarbeiter:", list.map(u => u.name + (u.write ? " (Büro)" : "")).join(", "));

// Büro-Person mit bekanntem Passwort anlegen und anmelden
const buero = list.find(u => u.write) || list[0];
let ma = await V.mitarbeiterListe(env);
await V.mitarbeiterSpeichern(env, { name: "Andere" }, { id: ma.find(m => m.name === buero.name).id, name: buero.name, schreiben: true, aktiv: true });
await V.mitarbeiterPasswort(env, { id: ma.find(m => m.name === buero.name).id, passwort: "geheim123" });
const s = await login(env, buero.name, "geheim123");
assert.ok(s && s.token.startsWith("s1."), "Anmeldung mit neuem Passwort");
assert.equal(await login(env, buero.name, "falsch"), null, "falsches Passwort abgelehnt");
const me = await auth(env, req(s.token));
assert.equal(me.name, buero.name); assert.equal(me.schreiben, true);

// Passwort ändern → alte Anmeldung ungültig
await V.mitarbeiterPasswort(env, { id: ma.find(m => m.name === buero.name).id, passwort: "neues-pw-456" });
assert.equal(await auth(env, req(s.token)), null, "alte Sitzung nach Passwortwechsel ungültig");
const s2 = await login(env, buero.name, "neues-pw-456"); assert.ok(s2);

// neuen Mitarbeiter anlegen, Doppelname abgelehnt, Geburtstag geprüft
ma = await V.mitarbeiterSpeichern(env, me, { name: "Testa Monteur", mail: "t@example.com", geb: "24.3", passwort: "abcdef" });
const neu = ma.find(m => m.name === "Testa Monteur");
assert.equal(neu.geb, "24.03."); assert.equal(neu.hatPw, true); assert.equal(neu.schreiben, false);
await rejects(V.mitarbeiterSpeichern(env, me, { name: "testa monteur" }), /gibt es schon/);
await rejects(V.mitarbeiterSpeichern(env, me, { name: "X", geb: "99.99." }), /Geburtstag/);
await rejects(V.mitarbeiterPasswort(env, { id: neu.id, passwort: "123" }), /mindestens 6/);
assert.ok(await login(env, "Testa Monteur", "abcdef"));

// inaktiv → keine Anmeldung mehr
await V.mitarbeiterSpeichern(env, me, { id: neu.id, name: "Testa Monteur", aktiv: false });
resetUsers();
assert.equal(await login(env, "Testa Monteur", "abcdef"), null, "inaktive Person kann sich nicht anmelden");

// Aussperren verhindern: eigenes Büro-Recht / sich selbst löschen / letzte Büro-Person
const self = ma.find(m => m.name === buero.name);
await rejects(V.mitarbeiterSpeichern(env, me, { id: self.id, name: buero.name, schreiben: false, aktiv: true }), /eigene Büro-Recht/);
await rejects(V.mitarbeiterLoeschen(env, me, { id: self.id }), /selbst/);
const andereBueros = (await V.mitarbeiterListe(env)).filter(m => m.schreiben && m.aktiv && m.id !== self.id);
for (const o of andereBueros) await V.mitarbeiterSpeichern(env, me, { id: o.id, name: o.name, schreiben: false, aktiv: true });
await rejects(V.mitarbeiterLoeschen(env, { name: "jemand anderes" }, { id: self.id }), /niemanden mehr/);
assert.ok((await V.mitarbeiterListe(env)).some(m => m.id === self.id), "letzte Büro-Person bleibt erhalten");
await V.mitarbeiterLoeschen(env, me, { id: neu.id });
assert.ok(!(await V.mitarbeiterListe(env)).some(m => m.id === neu.id), "löschen klappt");
console.log("Mitarbeiter-Verwaltung und Anmeldung: OK");

// ---------- Stammdaten ----------
await rejects(V.listeSpeichern(env, { name: "Test", werte: ["a"] }), /zuerst die Stammdaten/);
await importiere(env, me, { bereich: "stammdaten", stamm: { lists: { "Kältemittel": ["R32"], "Hersteller": ["Daikin"] }, free: {}, nach: [], gwp: { R32: 675 }, docs: [] } });
let st = await V.listeSpeichern(env, { alt: "Kältemittel", name: "Kältemittel", frei: false, werte: ["R32", "R290", "r32", ""] });
assert.deepEqual(st.listen.find(l => l.name === "Kältemittel").werte, ["R32", "R290"], "Doppelte/leere Werte entfernt");
st = await V.listeSpeichern(env, { alt: "Hersteller", name: "Hersteller Außengerät", werte: ["Daikin", "Mitsubishi"] });
assert.ok(st.listen.some(l => l.name === "Hersteller Außengerät") && !st.listen.some(l => l.name === "Hersteller"), "umbenannt");
await rejects(V.listeSpeichern(env, { alt: "Kältemittel", name: "hersteller außengerät" }), /gibt es schon/);
st = await V.tabelleSpeichern(env, { tabelle: "gwp", zeilen: [{ kaeltemittel: "R32", wert: "675" }, { kaeltemittel: "R290", wert: "0,02" }] });
assert.equal(st.gwp.find(g => g.kaeltemittel === "R290").wert, 0.02);
await rejects(V.tabelleSpeichern(env, { tabelle: "gwp", zeilen: [{ kaeltemittel: "R1", wert: "abc" }] }), /keine Zahl/);
await rejects(V.tabelleSpeichern(env, { tabelle: "docs", zeilen: [{ hersteller: "Daikin", url: "kein-link" }] }), /Link/);
st = await V.tabelleSpeichern(env, { tabelle: "docs", zeilen: [{ hersteller: "Daikin", name: "Anleitung", url: "https://example.com/a.pdf" }] });
st = await V.tabelleSpeichern(env, { tabelle: "nach", zeilen: [{ geraet: "RXM25", km: "15", f6: "0,02", f10: "0,05" }, { geraet: "" }] });
assert.equal(st.nach.length, 1);
await V.tabelleSpeichern(env, { tabelle: "upload", wert: "https://example.sharepoint.com/x" });

const app = await stammAusDb(env);
assert.deepEqual(app.lists["Kältemittel"], ["R32", "R290"]);
assert.equal(app.free["Kältemittel"], false);
assert.equal(app.gwp.R32, 675);
assert.equal(app.nach[0].f[6], "0,02");
assert.equal(app.docs[0].url, "https://example.com/a.pdf");
assert.equal(app.upload, "https://example.sharepoint.com/x");
assert.ok(app.monteure.some(m => m.name === buero.name), "Monteur-Liste aus den Mitarbeitern");
await V.listeLoeschen(env, { name: "Hersteller Außengerät" });
assert.ok(!(await stammAusDb(env)).lists["Hersteller Außengerät"]);
console.log("Stammdaten-Verwaltung: OK");
console.log("\nAlle Prüfungen bestanden.");
