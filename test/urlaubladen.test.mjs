// Test: Urlaub aus allen Wochenblättern eines Jahres laden (Google nachgebildet, ein Abruf je 30 Blätter)
// Aufruf:  node test/urlaubladen.test.mjs
import assert from "node:assert/strict";
import { liste } from "../lib/urlaubplan.js";

const k = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64") + "\n-----END PRIVATE KEY-----";
const env = { GOOGLE_SA_JSON: JSON.stringify({ client_email: "test@x", private_key: pem }), GSHEET_ID: "T" };

// Blätter „KW 1“ … „KW 52“, in KW 46 Peter (= Peter Muster) Mi–Fr Urlaub, in KW 2 Sebastian Mo
const titel = Array.from({ length: 52 }, (_, i) => `KW ${i + 1}`);
const zeilen = t => {
  const r = [["", "Peter", "Sebastian"], ["Mo", "", ""], ["Di", "", ""], ["Mi", "", ""], ["Do", "", ""], ["Fr", "", ""]];
  if (t === "KW 46") { r[3][1] = "Urlaub"; r[4][1] = "Urlaub"; r[5][1] = "Urlaub"; }
  if (t === "KW 2") r[1][2] = "Urlaub";
  return r;
};
let abrufe = 0;
globalThis.fetch = async (url) => {
  url = String(url);
  const ok = j => ({ ok: true, status: 200, json: async () => j });
  if (url.includes("oauth2")) return ok({ access_token: "a", expires_in: 3600 });
  if (url.includes("values:batchGet")) {
    abrufe++;
    const ranges = new URL(url).searchParams.getAll("ranges").map(r => r.match(/^'(.*)'!/)[1]);
    return ok({ valueRanges: ranges.map(t => ({ values: zeilen(t) })) });
  }
  return ok({ sheets: titel.map((t, i) => ({ properties: { title: t, sheetId: i } })) });
};

const people = [{ name: "Peter Muster", plan: "Peter" }, { name: "Sebastian Stern", plan: "Sebastian" }];
const r = await liste(env, { name: "Peter Muster", plan: "Peter" }, people, { buero: true, heute: "2026-11-01" });
assert.equal(abrufe, 2, "52 Blätter in 2 Abrufen");
assert.deepEqual(r.meine, [{ von: "2026-11-11", bis: "2026-11-13", tage: 3 }]);
assert.deepEqual(r.alle, [{ name: "Peter Muster", von: "2026-11-11", bis: "2026-11-13", tage: 3 }], "Büro: nur anstehende");
const s = await liste(env, { name: "Sebastian Stern", plan: "Sebastian" }, people, { heute: "2026-11-01" });
assert.deepEqual(s.meine, [{ von: "2026-01-05", bis: "2026-01-05", tage: 1 }]);
assert.equal(s.alle, undefined, "Monteur sieht nur eigenen Urlaub");
assert.equal(abrufe, 2, "zweiter Aufruf aus dem Zwischenspeicher");
console.log("Urlaub laden: alle Prüfungen bestanden.");
