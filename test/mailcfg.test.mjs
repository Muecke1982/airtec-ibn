// Test: E-Mail-Adressen je Bereich (Verwaltung) und Restmüll ohne Hinweise-Excel
// Aufruf:  node test/mailcfg.test.mjs
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, all } from "../lib/db.js";
import { alle, speichern, mailEinstellung } from "../lib/mailcfg.js";
import { ausExcelUebernehmen, anfordern, status } from "../lib/muell.js";
import { einstellung } from "../lib/urlaubinfo.js";
import { openWorkbook } from "../lib/xlsx.js";

const env = { DB: fakeD1(), CLIENT_ID: "c", CLIENT_SECRET: "s", TENANT_ID: "t" };
const mails = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.includes("login.microsoftonline")) return { ok: true, status: 200, json: async () => ({ access_token: "a", expires_in: 3600 }) };
  if (url.includes("sendMail")) mails.push({ von: decodeURIComponent(url.split("/users/")[1].split("/")[0]), ...JSON.parse(opt.body).message });
  return { ok: true, status: 202, json: async () => ({}), text: async () => "" };
};
const rejects = (p, rx) => assert.rejects(p, e => rx.test(e.message), "erwartet: " + rx);

// Standardwerte: Absender sonst MAIL_FROM
assert.equal((await mailEinstellung(env, "lager")).von, "");
env.MAIL_FROM = "kapp@airtec.de";
assert.equal((await mailEinstellung(env, "lager")).von, "kapp@airtec.de");
assert.equal((await mailEinstellung(env, "muell")).antwort, "info@airtec-kaeltetechnik.de");

// Restmüll: einmalig aus der alten Hinweise-Excel übernehmen (Einstellungen + letzte Anforderung)
const hwb = await openWorkbook(readFileSync(new URL("../vorlagen/Airtec_Hinweise.xlsx", import.meta.url)));
await hwb.addSheet("Müll Einstellungen", [["Feld", "Wert"], ["Empfänger", "entsorger@example.com"], ["Kopie (CC)", ""], ["Absender", "info@airtec.de"], ["Betreff", "Leerung bitte"], ["Text", "Hallo,\\nbitte leeren.\\n{name}"]]);
await hwb.addSheet("Müll", [["Angefordert am", "Angefordert von", "Gesendet an"], ["13.11.2026 10:00", "Nick", "entsorger@example.com"]]);
assert.equal(await ausExcelUebernehmen(env, await hwb.toBytes()), true);
assert.equal(await ausExcelUebernehmen(env, await hwb.toBytes()), false, "nur einmal");
const m = await mailEinstellung(env, "muell");
assert.equal(m.an, "entsorger@example.com"); assert.equal(m.von, "info@airtec.de"); assert.equal(m.betreff, "Leerung bitte");
assert.equal(m.text, "Hallo,\nbitte leeren.\n{name}");
assert.equal((await status(env)).letzte.von, "Nick");
assert.equal((await status(env)).letzte.am, "13.11.2026 10:00");

// in der App auf noreply umstellen → Mail von noreply, Antworten an info@
await rejects(speichern(env, "muell", { ...m, von: "quatsch" }), /keine gültige/);
await rejects(speichern(env, "muell", { ...m, an: "" }), /Entsorgers/);
await speichern(env, "muell", { ...m, von: "noreply@airtec.de", antwort: "" });
const r = await anfordern(env, { name: "Peter Muster" });
assert.equal(r.gesendet, true);
assert.equal(mails[0].von, "noreply@airtec.de");
assert.deepEqual(mails[0].replyTo, [{ emailAddress: { address: "info@airtec.de" } }]);
assert.equal(mails[0].body.content, "Hallo,\nbitte leeren.\nPeter Muster");
assert.equal((await all(env, "SELECT von FROM muell ORDER BY id")).map(x => x.von).join(","), "Nick,Peter Muster");
await rejects(anfordern(env, { name: "Nick" }), /schon am/);
assert.equal((await anfordern(env, { name: "Nick" }, { trotzdem: true })).gesendet, true);

// Urlaub: Empfänger an einer Stelle (auch über die Urlaub-Seite), Absender aus der Verwaltung
await run(env, "INSERT INTO mitarbeiter (name, mail, rechte) VALUES ('Christina Schatz', 'schatz@example.org', 'urlaub')");
assert.equal((await einstellung(env)).an, "schatz@example.org");
await speichern(env, "urlaub", { von: "noreply@airtec.de", an: "buero@airtec.de; schatz@example.org", antwort: "buero@airtec.de" });
const u = await einstellung(env);
assert.deepEqual([u.von, u.an, u.antwort], ["noreply@airtec.de", "buero@airtec.de, schatz@example.org", "buero@airtec.de"]);

// Überblick für die Verwaltung
const a = await alle(env);
assert.deepEqual(Object.keys(a.bereiche), ["muell", "lager", "urlaub"]);
assert.equal(a.bereiche.lager.werte.von, "kapp@airtec.de");
// Lieferanten-Adressen: in die Lager-Excel (Blatt „Lieferanten“) – SharePoint nachgebildet
const { act, load } = await import("../lib/lager.js");
let datei = readFileSync(new URL("../vorlagen/Airtec_Lager.xlsx", import.meta.url));
env.SP_SITE_URL = "https://x.sharepoint.com/sites/a"; env.SP_STAMM_PATH = "Ordner/Stamm.xlsx";
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const ok = (j, extra = {}) => ({ ok: true, status: 200, json: async () => j, text: async () => "", arrayBuffer: async () => datei.buffer.slice(datei.byteOffset, datei.byteOffset + datei.byteLength), ...extra });
  if (url.includes("login.microsoftonline")) return ok({ access_token: "a", expires_in: 3600 });
  if (url.includes("/sites/")) return ok({ id: "s", displayName: "S", value: [{ id: "d", name: "Dokumente" }] });
  if (opt.method === "PUT") { datei = Buffer.from(opt.body); return ok({}); }
  if (url.includes("/content")) return ok({});
  if (url.includes("root:")) return ok({ id: "f1", eTag: "e1" });
  return ok({ id: "d", name: "Dokumente", value: [{ id: "d", name: "Dokumente" }] });
};
const buero = { name: "Büro", rechte: ["stammdaten"] };
const vorher = (await load(env)).lief;
await rejects(act(env, buero, { aktion: "lieferanten", liste: [{ name: "X", mail: "kaputt" }] }), /keine gültige/);
await act(env, buero, { aktion: "lieferanten", liste: [{ name: vorher[0].name, mail: "neu@lieferant.de", cc: "" }, { name: "Klimaprofi", mail: "order@klimaprofi.de", cc: "a@b.de" }] });
const nachher = (await load(env)).lief;
assert.equal(nachher.find(l => l.name === vorher[0].name).mail, "neu@lieferant.de");
assert.deepEqual(nachher.find(l => l.name === "Klimaprofi"), { name: "Klimaprofi", mail: "order@klimaprofi.de", cc: "a@b.de", kd: "", kontakt: "" });
assert.equal(nachher.length, vorher.length + 1);
await rejects(act(env, { name: "Monteur", rechte: ["lager"] }, { aktion: "lieferanten", liste: [] }), /Recht/);
console.log("E-Mail-Adressen, Restmüll und Lieferanten: alle Prüfungen bestanden.");
