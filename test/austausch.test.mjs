// Test: Austausch (Nachrichten, Büro, Anpinnen + Erinnerung, Antworten, Abstimmungen, Geburtstage, Übernahme alter Hinweise)
// Aufruf im Repo-Ordner:  node test/austausch.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one, heute } from "../lib/db.js";
import { liste, aktion } from "../lib/austausch.js";
import { resetUsers } from "../lib/auth.js";

const env = { DB: fakeD1(), CLIENT_SECRET: "x" };
const ALLE = "wochenplan,protokolle,maschinen,lager,plan_aendern,hinweise,urlaub,maschinen_buero,lager_bestellen,stammdaten,mitarbeiter";
const h = new Date(); const gebHeute = [h.getDate(), h.getMonth() + 1];
const istWerktag = ![0, 6].includes(new Date().getDay());
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin, schreiben) VALUES ('Sebastian Stern', ?, 1, 1)", ALLE);
await run(env, "INSERT INTO mitarbeiter (name, rechte, schreiben) VALUES ('Christina Schatz', 'hinweise,protokolle', 1)");
await run(env, "INSERT INTO mitarbeiter (name, rechte, geb_tag, geb_monat) VALUES ('Nick Pauls', 'protokolle', ?, ?)", ...gebHeute);
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Elvin Morawez', 'protokolle')");
resetUsers();
const U = n => ({ name: n, rechte: n === "Sebastian Stern" ? ALLE.split(",") : n === "Christina Schatz" ? ["hinweise", "protokolle"] : ["protokolle"], admin: n === "Sebastian Stern" });
const seb = U("Sebastian Stern"), chr = U("Christina Schatz"), nick = U("Nick Pauls"), elv = U("Elvin Morawez");
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);
const finde = (l, text) => l.nachrichten.find(m => m.text === text);
const morgen = heute(new Date(Date.now() + 864e5)), gestern = heute(new Date(Date.now() - 864e5));   // deutsche Zeit wie in der App

// Monteur → Kollege, Priorität
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Hast du die Vakuumpumpe?", prio: "wichtig" });
let lE = await liste(env, elv);
let m = finde(lE, "Hast du die Vakuumpumpe?");
assert.ok(m && m.neu && m.prio === "wichtig" && m.von === "Nick Pauls");
assert.equal(lE.ungelesen, 1);
assert.ok(!finde(await liste(env, chr), "Hast du die Vakuumpumpe?"), "Büro sieht private Nachrichten unter Monteuren nicht");
// Monteur darf nicht an alle, nicht anpinnen, keine Abstimmung
await rejects(aktion(env, nick, { aktion: "senden", an: ["*alle"], text: "x" }), /nur das Büro/);
await rejects(aktion(env, nick, { aktion: "umfrage", an: ["*alle"], text: "?", optionen: ["a", "b"] }), /nur das Büro/);
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Pin-Versuch", pin: true, bis: morgen });
assert.equal(finde(await liste(env, elv), "Pin-Versuch").pin, false, "Monteur kann nicht anpinnen");

// gelesen → nicht mehr neu; Antwort → für den Absender neu; erledigt → weg; neue Antwort → wieder da
await aktion(env, elv, { aktion: "gelesen", ids: [m.id] });
assert.equal(finde(await liste(env, elv), "Hast du die Vakuumpumpe?").neu, false);
await aktion(env, elv, { aktion: "antworten", id: m.id, text: "Ja, bringe sie morgen mit" });
let lN = await liste(env, nick);
assert.ok(finde(lN, "Hast du die Vakuumpumpe?").neu, "Antwort macht die Nachricht für den Absender neu");
assert.equal(finde(lN, "Hast du die Vakuumpumpe?").antworten[0].text, "Ja, bringe sie morgen mit");
await aktion(env, elv, { aktion: "erledigt", id: m.id });
assert.ok(!finde(await liste(env, elv), "Hast du die Vakuumpumpe?"), "abgehakt verschwindet");
await new Promise(r => setTimeout(r, 1100));
await aktion(env, nick, { aktion: "antworten", id: m.id, text: "Danke!" });
assert.ok(finde(await liste(env, elv), "Hast du die Vakuumpumpe?").neu, "neue Antwort holt sie zurück");
const sN = finde(await liste(env, nick), "Hast du die Vakuumpumpe?").empfaenger;
assert.ok(sN[0].wer === "Elvin Morawez" && sN[0].erledigt, "Absender sieht den Erledigt-Status");

// ans Büro: alle mit Büro-Recht sehen sie; eine Person hakt ab → für das ganze Büro erledigt
await aktion(env, elv, { aktion: "senden", an: ["*buero"], text: "Firmenwagen Warnleuchte", prio: "dringend" });
const bm = finde(await liste(env, seb), "Firmenwagen Warnleuchte");
assert.ok(bm && finde(await liste(env, chr), "Firmenwagen Warnleuchte"));
assert.ok(!finde(await liste(env, nick), "Firmenwagen Warnleuchte"));
await aktion(env, chr, { aktion: "erledigt", id: bm.id });
assert.ok(!finde(await liste(env, seb), "Firmenwagen Warnleuchte"), "von Christina erledigt → auch für Sebastian weg");
assert.ok(finde(await liste(env, elv), "Firmenwagen Warnleuchte"), "Absender sieht sie weiter mit Status");

// Büro: anpinnen braucht Ablaufdatum; Erinnerung; „zur Kenntnis“ stoppt Erinnerung, Nachricht bleibt oben
await rejects(aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Pin ohne Datum", pin: true }), /Ablaufdatum/);
await rejects(aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Alt", bis: gestern }), /Vergangenheit/);
await aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Sicherheitsunterweisung Freitag", pin: true, bis: morgen, erinnerung: 1, prio: "dringend" });
lN = await liste(env, nick);
const pm = finde(lN, "Sicherheitsunterweisung Freitag");
assert.ok(pm.pin && lN.nachrichten[0].id === pm.id, "angepinnt steht ganz oben");
assert.ok(lN.erinnern.includes(pm.id), "Erinnerung fällig beim ersten Öffnen");
await aktion(env, nick, { aktion: "erinnert", ids: [pm.id] });
assert.ok(!(await liste(env, nick)).erinnern.includes(pm.id), "nach dem Erinnern erst wieder nach 1 Tag");
await run(env, "UPDATE nachricht_status SET erinnert = '2020-01-01 08:00' WHERE nachricht_id = ? AND wer = 'Nick Pauls'", pm.id);
assert.ok((await liste(env, nick)).erinnern.includes(pm.id), "nach Ablauf des Abstands wieder fällig");
await aktion(env, nick, { aktion: "erledigt", id: pm.id });
lN = await liste(env, nick);
assert.ok(finde(lN, "Sicherheitsunterweisung Freitag") && !lN.erinnern.includes(pm.id), "zur Kenntnis: bleibt angepinnt, keine Erinnerung mehr");

// nur für einen Mitarbeiter mit „sichtbar ab“ (Zukunft) → noch nicht sichtbar
await aktion(env, chr, { aktion: "senden", an: ["Elvin Morawez"], text: "Ab morgen sichtbar", ab: morgen, bis: morgen });
assert.ok(!finde(await liste(env, elv), "Ab morgen sichtbar"));
assert.ok(finde(await liste(env, chr), "Ab morgen sichtbar"), "Absender sieht sie schon");
// abgelaufen → weg
const altId = (await one(env, "SELECT id FROM nachrichten WHERE text = 'Sicherheitsunterweisung Freitag'")).id;
await run(env, "UPDATE nachrichten SET bis = ? WHERE id = ?", gestern, altId);
assert.ok(!finde(await liste(env, nick), "Sicherheitsunterweisung Freitag"), "nach Ablaufdatum verschwunden");

// Abstimmung
await aktion(env, seb, { aktion: "umfrage", an: ["*alle"], text: "Weihnachtsfeier?", optionen: ["12.12.", "19.12.", "12.12."], bis: morgen });
let um = finde(await liste(env, nick), "Weihnachtsfeier?");
assert.equal(um.umfrage.optionen.length, 2, "doppelte Optionen entfernt");
await aktion(env, nick, { aktion: "abstimmen", id: um.id, nrs: [1, 2] });   // nur eine Stimme erlaubt
await aktion(env, elv, { aktion: "abstimmen", id: um.id, nrs: [2] });
await aktion(env, elv, { aktion: "abstimmen", id: um.id, nrs: [1] });       // Stimme ändern
um = finde(await liste(env, nick), "Weihnachtsfeier?");
assert.deepEqual(um.umfrage.optionen.map(o => o.stimmen), [2, 0]);
assert.deepEqual(um.umfrage.meine, [1]);
assert.equal(um.umfrage.optionen[0].namen, undefined, "Monteure sehen keine Namen");
assert.deepEqual(finde(await liste(env, seb), "Weihnachtsfeier?").umfrage.optionen[0].namen.sort(), ["Elvin Morawez", "Nick Pauls"]);

// Reaktion, Löschen
await aktion(env, elv, { aktion: "reaktion", id: um.id, r: "👍" });
assert.deepEqual(finde(await liste(env, seb), "Weihnachtsfeier?").reaktionen, [{ wer: "Elvin Morawez", r: "👍" }]);
await aktion(env, elv, { aktion: "reaktion", id: um.id, r: "👍" });   // nochmal = zurücknehmen
assert.equal(finde(await liste(env, seb), "Weihnachtsfeier?").reaktionen.length, 0);
await rejects(aktion(env, nick, { aktion: "loeschen", id: um.id }), /Absender oder das Büro/);
await aktion(env, chr, { aktion: "loeschen", id: um.id });
assert.ok(!finde(await liste(env, nick), "Weihnachtsfeier?"));

// Geburtstag (nur Mo–Fr): Nick hat heute Geburtstag
if (istWerktag) {
  const lS = await liste(env, seb);
  assert.ok(lS.geburtstage.some(g => g.name === "Nick Pauls" && !g.ich));
  assert.ok((await liste(env, nick)).geburtstage.some(g => g.ich));
  await rejects(aktion(env, nick, { aktion: "gratulieren", an: "Nick Pauls" }), /selbst/);
  await aktion(env, seb, { aktion: "gratulieren", an: "Nick Pauls" });
  await aktion(env, seb, { aktion: "gratulieren", an: "Nick Pauls" });   // doppelt → nur einmal
  const g = (await liste(env, nick)).nachrichten.filter(x => x.typ === "gruss");
  assert.equal(g.length, 1); assert.equal(g[0].von, "Sebastian Stern");
  await rejects(aktion(env, seb, { aktion: "gratulieren", an: "Elvin Morawez" }), /keinen Geburtstag/);
}
console.log("Austausch: alle Prüfungen bestanden.");
