// Test: Handy-Mitteilungen (lib/push.js) – Verschlüsselung (RFC 8291) rückwärts entschlüsselt, VAPID-Signatur,
// Abos, Arten je Mitarbeiter, Auslöser in den Nachrichten (lib/austausch.js). Kein echter Push-Dienst nötig.
// Aufruf:  node test/push.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one, all } from "../lib/db.js";
import { verschluesseln, vapid, status, abonnieren, abmelden, senden, b64u, unb64u, geraete } from "../lib/push.js";
import { aktion } from "../lib/austausch.js";
import { resetUsers } from "../lib/auth.js";
import { mitarbeiterListe, mitarbeiterSpeichern } from "../lib/verwaltung.js";

const env = { DB: fakeD1() };
const S = crypto.subtle;
const enc = s => new TextEncoder().encode(s);

// ---------- Empfänger-Seite (wie das Handy): Schlüssel + Entschlüsseln ----------
async function handy() {
  const kp = await S.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await S.exportKey("raw", kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { kp, pub, auth, keys: { p256dh: b64u(pub), auth: b64u(auth) } };
}
async function hkdf(salt, ikm, info, n) {
  const k = await S.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await S.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, n * 8));
}
async function entschluesseln(h, body) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20];
  const asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asKey = await S.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await S.deriveBits({ name: "ECDH", public: asKey }, h.kp.privateKey, 256));
  const info = new Uint8Array([...enc("WebPush: info\0"), ...h.pub, ...asPub]);
  const ikm = await hkdf(h.auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc("Content-Encoding: nonce\0"), 12);
  const k = await S.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const klar = new Uint8Array(await S.decrypt({ name: "AES-GCM", iv: nonce }, k, ct));
  assert.equal(klar[klar.length - 1], 2, "Endmarke 0x02");
  return new TextDecoder().decode(klar.slice(0, -1));
}

// Verschlüsselung → Entschlüsselung
const h1 = await handy();
const body = await verschluesseln(h1.keys.p256dh, h1.keys.auth, JSON.stringify({ titel: "Hallo Ä", text: "Test" }));
assert.deepEqual(JSON.parse(await entschluesseln(h1, body)), { titel: "Hallo Ä", text: "Test" });

// VAPID: Schlüssel bleibt gleich, Signatur prüfbar
const v1 = await vapid(env);
assert.equal(unb64u(v1.pub).length, 65);
assert.equal(JSON.parse((await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'push_vapid'")).wert).pub, v1.pub);

// ---------- Mitarbeiter, Abos ----------
const R = "wochenplan,protokolle,maschinen,lager,plan_aendern,hinweise,urlaub,maschinen_buero,lager_bestellen,stammdaten,mitarbeiter";
await run(env, "INSERT INTO mitarbeiter (name, rechte, admin, schreiben) VALUES ('Sebastian Stern', ?, 1, 1)", R);
await run(env, "INSERT INTO mitarbeiter (name, rechte, schreiben) VALUES ('Christina Schatz', 'hinweise,protokolle', 1)");
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Nick Pauls', 'protokolle')");
await run(env, "INSERT INTO mitarbeiter (name, rechte) VALUES ('Elvin Morawez', 'protokolle')");
resetUsers();
const U = n => ({ name: n, rechte: n === "Sebastian Stern" ? R.split(",") : n === "Christina Schatz" ? ["hinweise", "protokolle"] : ["protokolle"], admin: n === "Sebastian Stern" });
const seb = U("Sebastian Stern"), chr = U("Christina Schatz"), nick = U("Nick Pauls"), elv = U("Elvin Morawez");

const handys = {};
for (const n of ["Sebastian Stern", "Christina Schatz", "Nick Pauls", "Elvin Morawez"]) {
  handys[n] = await handy();
  await abonnieren(env, U(n), { abo: { endpoint: "https://push.example/" + n.split(" ")[0], keys: handys[n].keys }, geraet: "Android" });
}
await assert.rejects(abonnieren(env, nick, { abo: { endpoint: "http://x", keys: handys.x || {} } }), /Ungültiges/);
assert.equal((await geraete(env))["nick pauls"], 1);
const st = await status(env, nick);
assert.equal(st.schluessel, v1.pub); assert.equal(st.arten.length, 4);

// ---------- Senden mit Arten-Filter ----------
const gesendet = [];
const fakeFetch = async (url, o) => {
  const wer = Object.keys(handys).find(n => url.endsWith("/" + n.split(" ")[0]));
  assert.match(o.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.equal(o.headers["Content-Encoding"], "aes128gcm");
  // VAPID-Signatur prüfen
  const [, jwt] = o.headers.Authorization.match(/t=([^,]+)/);
  const [kopf, inhalt, sig] = jwt.split(".");
  const pk = await S.importKey("raw", unb64u(v1.pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await S.verify({ name: "ECDSA", hash: "SHA-256" }, pk, unb64u(sig), enc(kopf + "." + inhalt)), "VAPID-Signatur gültig");
  assert.equal(JSON.parse(new TextDecoder().decode(unb64u(inhalt))).aud, "https://push.example");
  gesendet.push({ wer, daten: JSON.parse(await entschluesseln(handys[wer], new Uint8Array(o.body))) });
  return new Response(null, { status: wer === "Elvin Morawez" && fakeFetch.weg ? 410 : 201 });
};
globalThis.fetch = fakeFetch;

let r = await senden(env, ["Nick Pauls", "Elvin Morawez"], "direkt", { titel: "T", text: "x", ziel: "austausch" });
assert.equal(r.gesendet, 2);
await run(env, "UPDATE mitarbeiter SET mitteilungen_aus = 'direkt' WHERE name = 'Elvin Morawez'");
gesendet.length = 0;
r = await senden(env, ["Nick Pauls", "Elvin Morawez"], "direkt", { titel: "T", text: "x" });
assert.deepEqual(gesendet.map(g => g.wer), ["Nick Pauls"], "Elvin hat „direkt“ ausgeschaltet");
r = await senden(env, ["Elvin Morawez"], "hinweis", { titel: "T", text: "x" });
assert.equal(r.gesendet, 1, "Hinweise bekommt Elvin weiterhin");
await run(env, "UPDATE mitarbeiter SET mitteilungen_aus = '' WHERE name = 'Elvin Morawez'");
// abgelaufenes Abo (410) wird gelöscht
fakeFetch.weg = true;
await senden(env, ["Elvin Morawez"], "direkt", { titel: "T" });
assert.equal((await all(env, "SELECT * FROM push_abos WHERE wer = 'Elvin Morawez'")).length, 0);
fakeFetch.weg = false;
await abonnieren(env, elv, { abo: { endpoint: "https://push.example/Elvin", keys: handys["Elvin Morawez"].keys } });

// ---------- Auslöser in den Nachrichten ----------
const warten = [];
const hinten = p => { warten.push(p); };
const runde = async f => { gesendet.length = 0; warten.length = 0; await f(); await Promise.all(warten); return gesendet.map(g => g.wer).sort(); };

// direkte Nachricht Nick → Elvin
let an = await runde(() => aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Hast du die Vakuumpumpe?" }, hinten));
assert.deepEqual(an, ["Elvin Morawez"]);
assert.equal(gesendet[0].daten.titel, "Nachricht von Nick");
assert.equal(gesendet[0].daten.text, "Hast du die Vakuumpumpe?");
assert.equal(gesendet[0].daten.ziel, "austausch");
const nid = (await one(env, "SELECT MAX(id) AS id FROM nachrichten")).id;

// Antwort Elvin → an Nick (nicht an sich selbst)
an = await runde(() => aktion(env, elv, { aktion: "antworten", id: nid, text: "Ja, im Auto" }, hinten));
assert.deepEqual(an, ["Nick Pauls"]);
assert.equal(gesendet[0].daten.titel, "💬 Antwort von Elvin");

// Hinweis vom Büro an alle → alle außer Christina, Art „hinweis“, Ziel Startseite
an = await runde(() => aktion(env, chr, { aktion: "hinweis", text: "Freitag Betriebsversammlung" }, hinten));
assert.deepEqual(an, ["Elvin Morawez", "Nick Pauls", "Sebastian Stern"]);
assert.equal(gesendet[0].daten.titel, "📢 Neuer Hinweis"); assert.equal(gesendet[0].daten.ziel, "start");

// Hinweise ausgeschaltet → nichts
await run(env, "UPDATE mitarbeiter SET mitteilungen_aus = 'hinweis' WHERE name = 'Nick Pauls'");
an = await runde(() => aktion(env, chr, { aktion: "hinweis", text: "Zweiter Hinweis" }, hinten));
assert.deepEqual(an, ["Elvin Morawez", "Sebastian Stern"]);
await run(env, "UPDATE mitarbeiter SET mitteilungen_aus = '' WHERE name = 'Nick Pauls'");

// Nachricht ans Büro → Büro-Leute (Art „buero“), wichtig
an = await runde(() => aktion(env, nick, { aktion: "senden", an: ["*buero"], text: "Warnleuchte im Auto", prio: "wichtig" }, hinten));
assert.deepEqual(an, ["Christina Schatz", "Sebastian Stern"]);
assert.equal(gesendet[0].daten.titel, "❗ An das Büro von Nick");

// „sichtbar ab“ in der Zukunft → (noch) keine Mitteilung
an = await runde(() => aktion(env, chr, { aktion: "senden", an: ["*alle"], text: "Später", ab: "2099-01-01", bis: "2099-01-02" }, hinten));
assert.deepEqual(an, []);

// Foto ohne Text
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
an = await runde(() => aktion(env, elv, { aktion: "senden", an: ["Nick Pauls"], text: "", bilder: [{ klein: PNG, gross: PNG }] }, hinten));
assert.equal(gesendet[0].daten.text, "📷 Foto");

// ohne „hinten“ (Pages ohne waitUntil): wird direkt mitgesendet
gesendet.length = 0;
await aktion(env, nick, { aktion: "senden", an: ["Elvin Morawez"], text: "Direkt" });
assert.deepEqual(gesendet.map(g => g.wer), ["Elvin Morawez"]);

// ---------- Verwaltung: Arten speichern ----------
let ma = (await mitarbeiterListe(env)).find(m => m.name === "Nick Pauls");
assert.deepEqual(ma.mitteilungenAus, []); assert.equal(ma.handys, 1);
await mitarbeiterSpeichern(env, seb, { id: ma.id, name: "Nick Pauls", rechte: ["protokolle"], mitteilungenAus: ["alle", "quatsch"] });
ma = (await mitarbeiterListe(env)).find(m => m.name === "Nick Pauls");
assert.deepEqual(ma.mitteilungenAus, ["alle"]);
assert.deepEqual((await status(env, nick)).arten.map(a => a.k), ["direkt", "hinweis", "buero"]);

// abmelden
await abmelden(env, nick, { endpoint: "https://push.example/Nick" });
assert.equal((await geraete(env))["nick pauls"], undefined);

console.log("push.test: alles ok");
