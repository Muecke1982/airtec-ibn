// Test: QR-Codes zuordnen (lib/qr.js) und Typenschild-Auswertung (lib/typenschild.js, ohne echte KI)
// Aufruf:  node test/qr.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { codeAus, suchen, liste, aktion } from "../lib/qr.js";
import { erkennen, bereinigen, MODELL } from "../lib/typenschild.js";
import { beschreibe } from "../lib/logbuch.js";

const env = { DB: fakeD1() };
const chef = { name: "Chef", admin: true, rechte: [] };
const bea = { name: "Bea Buero", rechte: ["qr"] };
const peter = { name: "Peter Muster", rechte: ["maschinen"] };
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);

// Code aus dem QR-Inhalt
assert.equal(codeAus("  ABC123 "), "ABC123");
assert.equal(codeAus("https://airtec-kapp.example/q/M-0042"), "M-0042");
assert.equal(codeAus("https://airtec-kapp.example/?qr=AT%2F7&x=1"), "AT/7");
assert.equal(codeAus("https://andere-seite.de/produkt/123"), "https://andere-seite.de/produkt/123", "fremde Links bleiben ganz");

// nicht zugeordnet
let r = await suchen(env, "https://x.de/q/M-1");
assert.deepEqual(r, { code: "M-1", zuordnung: null });
await rejects(suchen(env, "  "), /Kein Code/);

// Rechte: Monteur darf nicht zuordnen
await rejects(aktion(env, peter, { aktion: "zuordnen", code: "M-1", art: "maschine", ziel: "42", bezeichnung: "Bohrhammer" }), /Recht/);
assert.equal((await liste(env, peter)).darf, false);

// zuordnen
let l = await aktion(env, bea, { aktion: "zuordnen", code: "M-1", art: "maschine", ziel: "42", bezeichnung: "Bohrhammer (42)" });
assert.equal(l.codes.length, 1);
r = await suchen(env, "M-1");
assert.equal(r.zuordnung.art, "maschine"); assert.equal(r.zuordnung.ziel, "42"); assert.equal(r.zuordnung.von, "Bea Buero");

// Code gehört schon woanders hin → Rückfrage, mit ersetzen umhängen
await rejects(aktion(env, bea, { aktion: "zuordnen", code: "M-1", art: "maschine", ziel: "43", bezeichnung: "Flex" }), /schon zu „Bohrhammer/);
await aktion(env, chef, { aktion: "zuordnen", code: "M-1", art: "maschine", ziel: "43", bezeichnung: "Flex", ersetzen: true });
assert.equal((await suchen(env, "M-1")).zuordnung.ziel, "43");
// gleiche Zuordnung nochmal: kein Konflikt
await aktion(env, bea, { aktion: "zuordnen", code: "M-1", art: "maschine", ziel: "43", bezeichnung: "Flex" });

// je Maschine nur ein Aufkleber: neuer Code ersetzt den alten
await aktion(env, bea, { aktion: "zuordnen", code: "M-2", art: "maschine", ziel: "43", bezeichnung: "Flex" });
assert.equal((await suchen(env, "M-1")).zuordnung, null);
assert.equal((await suchen(env, "M-2")).zuordnung.ziel, "43");

// Anlage und Sonstiges
await rejects(aktion(env, bea, { aktion: "zuordnen", code: "A-1", art: "anlage", ziel: "", bezeichnung: "x" }), /auswählen/);
await aktion(env, bea, { aktion: "zuordnen", code: "A-1", art: "anlage", ziel: "4711", bezeichnung: "Müller, Bochum – VRF Dach" });
await rejects(aktion(env, bea, { aktion: "zuordnen", code: "S-1", art: "sonstiges", bezeichnung: " " }), /Bezeichnung/);
await aktion(env, bea, { aktion: "zuordnen", code: "S-1", art: "sonstiges", ziel: "egal", bezeichnung: "Regal 3" });
assert.equal((await suchen(env, "S-1")).zuordnung.ziel, "", "Sonstiges ohne Ziel");
await rejects(aktion(env, bea, { aktion: "zuordnen", code: "X", art: "auto", ziel: "1" }), /Unbekannte Art/);
assert.equal((await liste(env, bea)).codes.length, 3);

// lösen
l = await aktion(env, bea, { aktion: "loesen", code: "A-1" });
assert.equal(l.codes.length, 2);
assert.equal((await suchen(env, "A-1")).zuordnung, null);

// Logbuch-Eintrag
const lb = beschreibe("/api/qr", { aktion: "zuordnen", code: "M-2", art: "maschine", ziel: "43", bezeichnung: "Flex" });
assert.equal(lb.bereich, "QR-Codes"); assert.equal(lb.aktion, "QR-Code zugeordnet");
assert.match(lb.details, /Code: M-2/); assert.match(lb.details, /Bezeichnung: Flex/);

/* ---------- Typenschild ---------- */
assert.deepEqual(bereinigen({ hersteller: " Daikin ", modell: "RXM35R5V1B", seriennummer: "S/N: E001234", kaeltemittel: "r 32", fuellmenge_kg: "1,15 kg", stromaufnahme_a: "ca. 6.4", geraet: "aussen", hinweis: "" }),
  { hersteller: "Daikin", modell: "RXM35R5V1B", seriennummer: "E001234", kaeltemittel: "R32", fuellmenge_kg: "1.15", stromaufnahme_a: "6.4", geraet: "aussen", hinweis: "" });
assert.equal(bereinigen({ kaeltemittel: "410A", geraet: "?" }).kaeltemittel, "R410A");
assert.equal(bereinigen({ geraet: "?" }).geraet, "unbekannt");

const BILD = "data:image/jpeg;base64,/9j/AAAA";
let gesendet = null;
const fake = antwort => ({ beta: { messages: { create: async p => { gesendet = p; return antwort; } } } });
const json = { hersteller: "Mitsubishi Electric", modell: "PUZ-ZM100YKA", seriennummer: "93U01234", kaeltemittel: "R32", fuellmenge_kg: "4", stromaufnahme_a: "8.1", geraet: "aussen", hinweis: "" };
const d = await erkennen({}, BILD, { client: fake({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(json) }] }) });
assert.equal(d.modell, "PUZ-ZM100YKA"); assert.equal(d.fuellmenge_kg, "4");
assert.equal(gesendet.model, MODELL);
assert.equal(gesendet.messages[0].content[0].type, "image");
assert.equal(gesendet.messages[0].content[0].source.data, "/9j/AAAA");
assert.equal(gesendet.output_config.format.type, "json_schema");
assert.equal(gesendet.fallbacks, "default");

await rejects(erkennen({}, "kein bild", { client: fake({}) }), /Foto/);
await rejects(erkennen({}, BILD), /noch nicht eingerichtet/);
await rejects(erkennen({}, BILD, { client: fake({ stop_reason: "refusal", content: [] }) }), /nicht auswerten/);
await rejects(erkennen({}, BILD, { client: fake({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"hersteller":"Dai' }] }) }), /unvollständig/);
await rejects(erkennen({}, BILD, { client: { beta: { messages: { create: async () => { throw Object.assign(new Error("x"), { status: 429 }); } } } } }), /ausgelastet/);

console.log("qr.test OK");
