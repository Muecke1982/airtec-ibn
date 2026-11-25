// Test: Nachrichten (Chats, Prioritäten normal/wichtig/anpinnen, bestätigen, schließen → Verlauf, wiederherstellen,
// Papierkorb, Fotos, Büro, Erinnerung, Abstimmungen, Geburtstage)
// Aufruf im Repo-Ordner:  node test/austausch.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one, heute } from "../lib/db.js";
import { liste, aktion, bild, aufraeumen } from "../lib/austausch.js";
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
const offen = (l, text) => { const m = finde(l, text); return m && m.ordner === "offen" ? m : null; };
const warte = () => new Promise(r => setTimeout(r, 1100));
const morgen = heute(new Date(Date.now() + 864e5)), gestern = heute(new Date(Date.now() - 864e5));   // deutsche Zeit wie in der App
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Monteur → Kollege, wichtig: oben, muss bestätigt werden, Reiter-Zähler
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Normale Frage" });
await warte();
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Hast du die Vakuumpumpe?", prio: "wichtig" });
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Noch eine normale" });
let lE = await liste(env, elv);
let m = finde(lE, "Hast du die Vakuumpumpe?");
assert.ok(m && m.neu && m.prio === "wichtig" && m.von === "Nick Pauls" && m.brauchtOk && !m.bestaetigt);
assert.equal(lE.nachrichten[0].id, m.id, "wichtig steht ganz oben");
assert.deepEqual(lE.nachrichten.slice(1).map(x => x.text), ["Noch eine normale", "Normale Frage"], "normal: neueste oben");
assert.equal(lE.offen, 3); assert.equal(lE.ungelesen, 3); assert.equal(lE.wichtigOffen, 1);
assert.ok(!finde(await liste(env, chr), "Hast du die Vakuumpumpe?"), "Büro sieht private Nachrichten unter Monteuren nicht");
await aktion(env, elv, { aktion: "bestaetigen", id: m.id });
lE = await liste(env, elv);
assert.equal(lE.wichtigOffen, 0); assert.ok(finde(lE, "Hast du die Vakuumpumpe?").bestaetigt);
assert.equal(finde(await liste(env, nick), "Hast du die Vakuumpumpe?").empfaenger[0].bestaetigt !== "", true, "Absender sieht die Bestätigung");
// Monteur darf nicht an alle, nicht anpinnen, keine Abstimmung
await rejects(aktion(env, nick, { aktion: "senden", an: ["*alle"], text: "x" }), /nur das Büro/);
await rejects(aktion(env, nick, { aktion: "umfrage", an: ["*alle"], text: "?", optionen: ["a", "b"] }), /nur das Büro/);
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Pin-Versuch", prio: "pin", bis: morgen });
assert.equal(finde(await liste(env, elv), "Pin-Versuch").pin, false, "Monteur kann nicht anpinnen");

// Chat: antworten → für den Absender neu; schließen → Verlauf; neue Antwort → wieder offen; wiederherstellen
await aktion(env, elv, { aktion: "gelesen", ids: [m.id] });
assert.equal(finde(await liste(env, elv), "Hast du die Vakuumpumpe?").neu, false);
await aktion(env, elv, { aktion: "antworten", id: m.id, text: "Ja, bringe sie morgen mit", bilder: [{ klein: PNG, gross: PNG }] });
let lN = await liste(env, nick);
m = finde(lN, "Hast du die Vakuumpumpe?");
assert.ok(m.neu, "Antwort macht den Chat für den Absender neu");
assert.equal(m.antworten[0].text, "Ja, bringe sie morgen mit");
assert.equal(m.antworten[0].bilder.length, 1, "Foto an der Antwort");
const b = await bild(env, nick, m.antworten[0].bilder[0], false);
assert.equal(b.typ, "image/png"); assert.ok(b.bytes.length > 50);
await rejects(bild(env, chr, m.antworten[0].bilder[0], true), /nicht gefunden/);
await rejects(aktion(env, nick, { aktion: "antworten", id: m.id, bilder: [{ klein: "data:text/html;base64,AAAA", gross: PNG }] }), /Foto/);
await aktion(env, elv, { aktion: "schliessen", id: m.id });
lE = await liste(env, elv);
assert.ok(!offen(lE, "Hast du die Vakuumpumpe?") && finde(lE, "Hast du die Vakuumpumpe?").ordner === "verlauf", "geschlossen → Verlauf");
assert.ok(finde(lE, "Hast du die Vakuumpumpe?").beteiligt.includes("Nick Pauls"), "Personen-Filter kennt die Beteiligten");
assert.ok(offen(await liste(env, nick), "Hast du die Vakuumpumpe?"), "für den Absender bleibt der Chat offen");
await warte();
await aktion(env, nick, { aktion: "antworten", id: m.id, text: "Danke!" });
assert.ok(offen(await liste(env, elv), "Hast du die Vakuumpumpe?").neu, "neue Antwort holt den Chat zurück");
await aktion(env, elv, { aktion: "schliessen", id: m.id });
await aktion(env, elv, { aktion: "wiederherstellen", id: m.id });
assert.ok(offen(await liste(env, elv), "Hast du die Vakuumpumpe?"), "wiederhergestellt");

// eigene Nachricht an alle: der Absender sieht sie auch (Büro)
await aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Info an alle", bilder: [{ klein: PNG, gross: PNG }] });
const ia = offen(await liste(env, chr), "Info an alle");
assert.ok(ia && ia.eigene && ia.anMich && ia.bilder.length === 1);
assert.ok(offen(await liste(env, nick), "Info an alle").bilder.length === 1);

// ans Büro: eine Person schließt/bestätigt → für das ganze Büro
await aktion(env, elv, { aktion: "senden", an: ["*buero"], text: "Firmenwagen Warnleuchte", prio: "dringend" });
const bm = finde(await liste(env, seb), "Firmenwagen Warnleuchte");
assert.equal(bm.prio, "wichtig", "alt „dringend“ = wichtig");
assert.ok(offen(await liste(env, chr), "Firmenwagen Warnleuchte"));
assert.ok(!finde(await liste(env, nick), "Firmenwagen Warnleuchte"));
await aktion(env, chr, { aktion: "bestaetigen", id: bm.id });
assert.ok(finde(await liste(env, seb), "Firmenwagen Warnleuchte").bestaetigt, "von Christina bestätigt → für das Büro bestätigt");
await aktion(env, chr, { aktion: "schliessen", id: bm.id });
assert.ok(!offen(await liste(env, seb), "Firmenwagen Warnleuchte"), "von Christina geschlossen → auch für Sebastian im Verlauf");
assert.ok(offen(await liste(env, elv), "Firmenwagen Warnleuchte"), "Absender hat den Chat noch offen");
await aktion(env, seb, { aktion: "wiederherstellen", id: bm.id });
assert.ok(offen(await liste(env, chr), "Firmenwagen Warnleuchte"), "Wiederherstellen öffnet ihn für das ganze Büro");

// Anpinnen (Büro): Ablaufdatum nötig, Erinnerung bis bestätigt, zählt nicht im Reiter
await rejects(aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Pin ohne Datum", prio: "pin" }), /Ablaufdatum/);
await rejects(aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Alt", bis: gestern }), /Vergangenheit/);
await aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Sicherheitsunterweisung Freitag", prio: "pin", bis: morgen, erinnerung: 1 });
lN = await liste(env, nick);
const pm = finde(lN, "Sicherheitsunterweisung Freitag");
assert.ok(pm.pin && lN.nachrichten[0].id === pm.id, "angepinnt steht ganz oben");
assert.equal(lN.pinsOffen, 1);
const vorher = lN.offen;
assert.ok(lN.erinnern.includes(pm.id), "Erinnerung fällig beim ersten Öffnen");
await aktion(env, nick, { aktion: "erinnert", ids: [pm.id] });
assert.ok(!(await liste(env, nick)).erinnern.includes(pm.id), "nach dem Erinnern erst wieder nach 1 Tag");
await run(env, "UPDATE nachricht_status SET erinnert = '2020-01-01 08:00' WHERE nachricht_id = ? AND wer = 'Nick Pauls'", pm.id);
assert.ok((await liste(env, nick)).erinnern.includes(pm.id), "nach Ablauf des Abstands wieder fällig");
await aktion(env, nick, { aktion: "bestaetigen", id: pm.id });
lN = await liste(env, nick);
assert.ok(offen(lN, "Sicherheitsunterweisung Freitag") && !lN.erinnern.includes(pm.id), "bestätigt: bleibt angepinnt, keine Erinnerung mehr");
assert.equal(lN.offen, vorher, "angepinnte zählen nicht im Reiter „Nachrichten“");
await aktion(env, nick, { aktion: "antworten", id: pm.id, text: "Bin dabei" });
assert.ok(finde(await liste(env, chr), "Sicherheitsunterweisung Freitag").neu, "Antworten auf angepinnte Nachrichten");

// „sichtbar ab“ (Zukunft) → noch nicht sichtbar
await aktion(env, chr, { aktion: "senden", an: ["Elvin Morawez"], text: "Ab morgen sichtbar", ab: morgen, bis: morgen });
assert.ok(!finde(await liste(env, elv), "Ab morgen sichtbar"));
assert.ok(finde(await liste(env, chr), "Ab morgen sichtbar"), "Absender sieht sie schon");
// abgelaufen → Verlauf; Absender kann sie wieder öffnen (ohne Ablaufdatum)
await run(env, "UPDATE nachrichten SET bis = ? WHERE id = ?", gestern, pm.id);
assert.equal(finde(await liste(env, nick), "Sicherheitsunterweisung Freitag").ordner, "verlauf", "nach Ablaufdatum im Verlauf");
await rejects(aktion(env, nick, { aktion: "wiederherstellen", id: pm.id }), /abgelaufen/);
await aktion(env, chr, { aktion: "wiederherstellen", id: pm.id });
assert.ok(offen(await liste(env, nick), "Sicherheitsunterweisung Freitag"), "vom Büro wieder geöffnet");

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

// Reaktion; Löschen → Papierkorb (nur Absender/Büro sehen ihn) → wiederherstellen; nach 30 Tagen endgültig weg
await aktion(env, elv, { aktion: "reaktion", id: um.id, r: "👍" });
assert.deepEqual(finde(await liste(env, seb), "Weihnachtsfeier?").reaktionen, [{ wer: "Elvin Morawez", r: "👍" }]);
await aktion(env, elv, { aktion: "reaktion", id: um.id, r: "👍" });   // nochmal = zurücknehmen
assert.equal(finde(await liste(env, seb), "Weihnachtsfeier?").reaktionen.length, 0);
await rejects(aktion(env, nick, { aktion: "loeschen", id: um.id }), /nur das Büro/);
await aktion(env, chr, { aktion: "loeschen", id: um.id });
assert.ok(!finde(await liste(env, nick), "Weihnachtsfeier?"), "Monteur sieht gelöschte nicht");
const gel = finde(await liste(env, seb), "Weihnachtsfeier?");
assert.ok(gel.ordner === "geloescht" && gel.geloescht.von === "Christina Schatz");
await rejects(aktion(env, seb, { aktion: "antworten", id: um.id, text: "x" }), /gelöscht/);
await aktion(env, seb, { aktion: "wiederherstellen", id: um.id });
assert.ok(offen(await liste(env, nick), "Weihnachtsfeier?"), "aus dem Papierkorb zurück");
await rejects(aktion(env, nick, { aktion: "loeschen", id: (finde(await liste(env, nick), "Normale Frage")).id }), /nur das Büro/, "eigenen Chat löschen: nur Büro");
assert.ok(!finde(await liste(env, nick), "Normale Frage").darfLoeschen);
await aktion(env, chr, { aktion: "loeschen", id: (finde(await liste(env, nick), "Normale Frage")).id });
assert.equal(finde(await liste(env, nick), "Normale Frage").ordner, "geloescht", "Absender sieht gelöschte im Papierkorb");
const idx = finde(await liste(env, nick), "Normale Frage").id;
await run(env, "UPDATE nachrichten SET geloescht_am = '2020-01-01 08:00' WHERE id = ?", idx);
await aufraeumen(env);
assert.ok(!(await one(env, "SELECT id FROM nachrichten WHERE id = ?", idx)), "Papierkorb nach 30 Tagen geleert");
assert.ok(await one(env, "SELECT id FROM nachricht_bilder"), "Fotos anderer Nachrichten bleiben");

// mehrere auf einmal in den Papierkorb (Verlauf aufräumen)
await aktion(env, seb, { aktion: "senden", an: ["Nick Pauls"], text: "Alt 1" });
await aktion(env, seb, { aktion: "senden", an: ["Nick Pauls"], text: "Alt 2" });
let lS2 = await liste(env, seb);
await aktion(env, seb, { aktion: "loeschen", ids: [finde(lS2, "Alt 1").id, finde(lS2, "Alt 2").id] });
lS2 = await liste(env, seb);
assert.ok(finde(lS2, "Alt 1").ordner === "geloescht" && finde(lS2, "Alt 2").ordner === "geloescht");
await rejects(aktion(env, nick, { aktion: "loeschen", ids: [finde(lS2, "Info an alle").id] }), /nur das Büro/);

// Abstimmung anpinnen
await aktion(env, chr, { aktion: "umfrage", an: ["*alle"], text: "Grillen?", optionen: ["ja", "nein"], prio: "pin", bis: morgen });
assert.ok(finde(await liste(env, nick), "Grillen?").pin, "Abstimmung angepinnt");

// Hinweis: für alle angepinnt, kein Chat, nur Verfasser oder Admin nimmt ihn zurück
await rejects(aktion(env, nick, { aktion: "hinweis", text: "x" }), /nur das Büro/);
await aktion(env, chr, { aktion: "hinweis", text: "Werkstatt am Freitag geschlossen" });
let hw = offen(await liste(env, nick), "Werkstatt am Freitag geschlossen");
assert.ok(hw && hw.typ === "hinweis" && hw.pin && !hw.brauchtOk && !hw.neu && !hw.darfLoeschen);
assert.ok(!(await liste(env, nick)).erinnern.includes(hw.id));
await rejects(aktion(env, nick, { aktion: "antworten", id: hw.id, text: "ok" }), /nicht antworten/);
await rejects(aktion(env, nick, { aktion: "schliessen", id: hw.id }), /Verfasser/);
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Bea Buero', 'hinweise')"); resetUsers();
await rejects(aktion(env, { name: "Bea Buero", rechte: ["hinweise"], admin: false }, { aktion: "loeschen", id: hw.id }), /Verfasser oder der Admin/);
assert.ok(finde(await liste(env, seb), "Werkstatt am Freitag geschlossen").darfLoeschen, "Admin darf zurücknehmen");
await aktion(env, chr, { aktion: "loeschen", id: hw.id });
assert.ok(!finde(await liste(env, nick), "Werkstatt am Freitag geschlossen"), "zurückgenommen");

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
console.log("Nachrichten: alle Prüfungen bestanden.");
