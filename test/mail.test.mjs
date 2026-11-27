// Test: „Antworten an“ beim Mailversand (No-Reply-Absender → Antworten gehen an info@ bzw. MAIL_REPLY_TO)
// Aufruf:  node test/mail.test.mjs
import assert from "node:assert/strict";
import { antwortAn, sendMail } from "../lib/graph.js";

assert.deepEqual(antwortAn({}, "info@airtec.de"), [], "normaler Absender: nichts setzen");
assert.deepEqual(antwortAn({}, "noreply@airtec.de"), ["info@airtec.de"]);
assert.deepEqual(antwortAn({}, "No-Reply@airtec.de"), ["info@airtec.de"]);
assert.deepEqual(antwortAn({ MAIL_REPLY_TO: "buero@airtec.de" }, "noreply@airtec.de"), ["buero@airtec.de"]);
assert.deepEqual(antwortAn({}, "noreply@airtec.de", "a@x.de; b@x.de"), ["a@x.de", "b@x.de"], "ausdrücklich angegeben");
assert.deepEqual(antwortAn({}, "info@airtec.de", "buero@airtec.de"), ["buero@airtec.de"]);

const gesendet = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.includes("login.microsoftonline")) return { ok: true, status: 200, json: async () => ({ access_token: "a", expires_in: 3600 }) };
  if (url.includes("sendMail")) gesendet.push({ url, ...JSON.parse(opt.body).message });
  return { ok: true, status: 202, json: async () => ({}), text: async () => "" };
};
const env = { CLIENT_ID: "c", CLIENT_SECRET: "s", TENANT_ID: "t" };
await sendMail(env, "noreply@airtec.de", { to: ["entsorger@x.de"], subject: "Leerung", text: "Bitte leeren" });
assert.match(gesendet[0].url, /users\/noreply%40airtec\.de\/sendMail/);
assert.deepEqual(gesendet[0].replyTo, [{ emailAddress: { address: "info@airtec.de" } }]);
await sendMail(env, "info@airtec.de", { to: ["x@x.de"], subject: "s", text: "t" });
assert.equal(gesendet[1].replyTo, undefined, "ohne No-Reply kein Antworten-an");
console.log("Mail „Antworten an“: alle Prüfungen bestanden.");
