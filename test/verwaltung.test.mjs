// Test Stufe 2: Anmeldung aus der Datenbank, Stammdaten aus der Datenbank, Verwaltung.
// Aufruf im Repo-Ordner:  node test/verwaltung.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { importiere } from "../lib/import.js";
import { users, login, auth, resetUsers } from "../lib/auth.js";
import { stammAusDb } from "../lib/stamm.js";
import * as V from "../lib/verwaltung.js";
import { darf } from "../lib/rechte.js";

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

// ---------- Admin + Rechte ----------
let ma = await V.mitarbeiterListe(env);
const id = n => ma.find(m => m.name === n).id;
const sebi = ma.find(m => m.name === "Sebastian");
assert.ok(sebi && sebi.admin, "Sebastian ist nach dem Import Admin");
assert.equal(ma.filter(m => m.admin).length, 1, "genau ein Admin");
assert.deepEqual(ma.find(m => m.name === "Nick").rechte, ["wochenplan", "protokolle", "maschinen", "lager", "autos"], "ohne Schreibrecht = Monteur-Rechte");
const stefan = ma.find(m => m.name === "Stefan Wermers");
assert.ok(stefan.rechte.includes("mitarbeiter") && !stefan.admin, "Excel-Schreibrecht = alle Rechte, aber kein Admin");

// Passwörter setzen (der Admin darf alles)
const admin = { name: "Sebastian", admin: true, rechte: [] };
await V.mitarbeiterPasswort(env, admin, { id: sebi.id, passwort: "admin-pw-1" });
await V.mitarbeiterPasswort(env, admin, { id: stefan.id, passwort: "stefan-pw-1" });
const sA = await login(env, "Sebastian", "admin-pw-1");
const meA = await auth(env, req(sA.token));
assert.equal(meA.admin, true); assert.equal(meA.rechte.length, 13, "Admin bekommt alle Rechte");
const sS = await login(env, "Stefan Wermers", "stefan-pw-1");
const meS = await auth(env, req(sS.token));
assert.equal(meS.admin, false); assert.ok(darf(meS, "mitarbeiter"));
assert.equal(await login(env, "Sebastian", "falsch"), null, "falsches Passwort abgelehnt");

// Passwort ändern → alte Anmeldung ungültig
await V.mitarbeiterPasswort(env, meA, { id: stefan.id, passwort: "stefan-pw-2" });
assert.equal(await auth(env, req(sS.token)), null, "alte Sitzung nach Passwortwechsel ungültig");
const meS2 = await auth(env, req((await login(env, "Stefan Wermers", "stefan-pw-2")).token));

// Admin schützen: Stefan (Mitarbeiter verwalten, kein Admin) darf den Admin nicht ändern/löschen/Passwort setzen
await rejects(V.mitarbeiterSpeichern(env, meS2, { id: sebi.id, name: "Sebastian", rechte: [], aktiv: true }), /nur der Admin selbst/);
await rejects(V.mitarbeiterPasswort(env, meS2, { id: sebi.id, passwort: "gekapert" }), /nur der Admin selbst/);
await rejects(V.mitarbeiterLoeschen(env, meS2, { id: sebi.id }), /nicht gelöscht/);
await rejects(V.mitarbeiterLoeschen(env, meA, { id: sebi.id }), /nicht gelöscht/);
// Admin behält immer alle Rechte, auch wenn er sich selbst Häkchen wegnimmt
ma = await V.mitarbeiterSpeichern(env, meA, { id: sebi.id, name: "Sebastian", rechte: ["protokolle"], aktiv: false });
assert.ok(ma.find(m => m.id === sebi.id).aktiv && ma.find(m => m.id === sebi.id).rechte.length === 13, "Admin bleibt aktiv mit allen Rechten");

// „Mitarbeiter verwalten“ vergibt/entzieht nur der Admin
ma = await V.mitarbeiterSpeichern(env, meS2, { name: "Testa Monteur", mail: "t@example.com", geb: "24.3", passwort: "abcdef", rechte: ["protokolle", "hinweise"] });
const neu = ma.find(m => m.name === "Testa Monteur");
// neue Felder: Telefon, Adresse, Schlüssel, Alarmanlage – speichern und ändern
ma = await V.mitarbeiterSpeichern(env, meA, { id: neu.id, name: "Testa Monteur", rechte: neu.rechte, geb: "24.03.",
  telefon: "0170 1234567", adresse: "Max-Planck-Str. 2\n48599 Gronau", schluessel: "S-12", alarm: "A-3" });
const nf = ma.find(m => m.id === neu.id);
assert.deepEqual([nf.telefon, nf.adresse, nf.schluessel, nf.alarm], ["0170 1234567", "Max-Planck-Str. 2\n48599 Gronau", "S-12", "A-3"]);
assert.deepEqual(neu.rechte, ["protokolle", "hinweise"]); assert.equal(neu.geb, "24.03."); assert.equal(neu.hatPw, true);
await rejects(V.mitarbeiterSpeichern(env, meS2, { id: neu.id, name: "Testa Monteur", rechte: ["protokolle", "mitarbeiter"] }), /Nur der Admin/);
await rejects(V.mitarbeiterSpeichern(env, meS2, { name: "Neu2", rechte: ["mitarbeiter"] }), /Nur der Admin/);
await rejects(V.mitarbeiterSpeichern(env, meS2, { id: id("Marius Schöler"), name: "Marius Schöler", rechte: ["protokolle"], aktiv: true }), /Nur der Admin/);
await rejects(V.mitarbeiterLoeschen(env, meS2, { id: id("Marius Schöler") }), /Nur der Admin/);
ma = await V.mitarbeiterSpeichern(env, meA, { id: neu.id, name: "Testa Monteur", rechte: ["protokolle", "mitarbeiter"] });
assert.ok(ma.find(m => m.id === neu.id).rechte.includes("mitarbeiter"), "Admin darf es vergeben");
ma = await V.mitarbeiterSpeichern(env, meA, { id: neu.id, name: "Testa Monteur", rechte: ["protokolle", "lager"] });

// Rechte wirken bei der Anmeldung
const meT = await auth(env, req((await login(env, "Testa Monteur", "abcdef")).token));
assert.deepEqual(meT.rechte, ["protokolle", "lager"]);
assert.ok(darf(meT, "lager") && !darf(meT, "hinweise") && !darf(meT, "maschinen"));
assert.equal(meT.schreiben, false, "ohne Zusatzrecht kein „Büro“");

// sonstiges: Doppelname, Geburtstag, kurzes Passwort, inaktiv, sich selbst
await rejects(V.mitarbeiterSpeichern(env, meA, { name: "testa monteur" }), /gibt es schon/);
await rejects(V.mitarbeiterSpeichern(env, meA, { name: "X", geb: "99.99." }), /Geburtstag/);
await rejects(V.mitarbeiterPasswort(env, meA, { id: neu.id, passwort: "123" }), /mindestens 6/);
await rejects(V.mitarbeiterSpeichern(env, meS2, { id: stefan.id, name: "Stefan Wermers", rechte: stefan.rechte, aktiv: false }), /selbst nicht deaktivieren|Nur der Admin/);
await rejects(V.mitarbeiterLoeschen(env, meS2, { id: stefan.id }), /selbst/);
await V.mitarbeiterSpeichern(env, meA, { id: neu.id, name: "Testa Monteur", rechte: ["protokolle"], aktiv: false });
resetUsers();
assert.equal(await login(env, "Testa Monteur", "abcdef"), null, "inaktive Person kann sich nicht anmelden");

// Admin weitergeben: nur der Admin; danach ist der alte Admin normaler Mitarbeiter mit allen Rechten
await rejects(V.adminUebergeben(env, meS2, { id: stefan.id }), /Nur der Admin/);
await rejects(V.adminUebergeben(env, meA, { id: neu.id }), /aktiv sein/);
ma = await V.adminUebergeben(env, meA, { id: stefan.id });
assert.ok(ma.find(m => m.id === stefan.id).admin && !ma.find(m => m.id === sebi.id).admin);
assert.equal(ma.filter(m => m.admin).length, 1);
ma = await V.adminUebergeben(env, { ...meS2, admin: true }, { id: sebi.id });   // zurück an Sebastian

// erneuter Mitarbeiter-Import: Admin bleibt erhalten
await importiere(env, meA, { bereich: "mitarbeiter", datei: readFileSync(new URL("../vorlagen/Airtec_Zugaenge.xlsx", import.meta.url)).toString("base64") });
ma = await V.mitarbeiterListe(env);
assert.equal(ma.find(m => m.admin).name, "Sebastian", "Admin nach Re-Import erhalten");
const me = meA;
console.log("Rechte, Admin, Anmeldung und Mitarbeiter-Verwaltung: OK");

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
assert.ok(app.monteure.some(m => m.name === "Sebastian"), "Monteur-Liste aus den Mitarbeitern");
await V.listeLoeschen(env, { name: "Hersteller Außengerät" });
assert.ok(!(await stammAusDb(env)).lists["Hersteller Außengerät"]);
console.log("Stammdaten-Verwaltung: OK");
console.log("\nAlle Prüfungen bestanden.");
