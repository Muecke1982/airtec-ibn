// Test: Urlaub aus dem Wochenplan laden (Google nachgebildet, ein Abruf je 30 Blätter),
// Urlaub eintragen und Infomail ans Büro
// Aufruf:  node test/urlaubladen.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run } from "../lib/db.js";
import { liste, laden, eintragen, cacheLeeren, blattFuer } from "../lib/urlaubplan.js";
import { abgleich, mailText, speichereEmpfaenger, einstellung } from "../lib/urlaubinfo.js";

const k = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
const pem = "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64") + "\n-----END PRIVATE KEY-----";
const env = { GOOGLE_SA_JSON: JSON.stringify({ client_email: "test@x", private_key: pem }), GSHEET_ID: "T", DB: fakeD1(),
  CLIENT_ID: "c", CLIENT_SECRET: "s", TENANT_ID: "t" };

// Blätter „KW 1“ … „KW 52“ (ohne Jahr) + „KW 2 2027“; in KW 46 Peter Mi–Fr Urlaub, in KW 2 Sebastian Mo
const titel = [...Array.from({ length: 52 }, (_, i) => `KW ${i + 1}`), "KW 2 2027"];
const blatt = {};
const zeilen = t => {
  if (!blatt[t]) {
    const r = [["", "Peter", "Sebastian"], ["Mo", "", ""], ["Di", "", ""], ["Mi", "", ""], ["Do", "", ""], ["Fr", "", ""]];
    if (t === "KW 46") { r[3][1] = "Urlaub"; r[4][1] = "Urlaub"; r[5][1] = "Urlaub"; }
    if (t === "KW 2") r[1][2] = "Urlaub";
    if (t === "KW 2 2027") r[2][1] = "Urlaub";
    if (t === "KW 52") r[4][1] = "Feiertag";
    blatt[t] = r;
  }
  return blatt[t];
};
let abrufe = 0; const mails = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const ok = j => ({ ok: true, status: 200, json: async () => j });
  if (url.includes("oauth2") || url.includes("login.microsoftonline")) return ok({ access_token: "a", expires_in: 3600 });
  if (url.includes("sendMail")) { mails.push({ from: decodeURIComponent(url.split("/users/")[1].split("/")[0]), ...JSON.parse(opt.body).message }); return ok({}); }
  if (url.includes(":batchUpdate")) {
    for (const rq of JSON.parse(opt.body).requests) {
      const u = rq.updateCells; const t = titel[u.range.sheetId];
      zeilen(t)[u.range.startRowIndex][u.range.startColumnIndex] = u.rows[0].values[0].userEnteredValue.stringValue;
    }
    return ok({});
  }
  if (url.includes("values:batchGet")) {
    abrufe++;
    const ranges = new URL(url).searchParams.getAll("ranges").map(r => r.match(/^'(.*)'!/)[1]);
    return ok({ valueRanges: ranges.map(t => ({ values: zeilen(t).map(r => [...r]) })) });
  }
  if (url.includes("/values/")) {
    const t = decodeURIComponent(url.split("/values/")[1]).match(/^'?(.*?)'?!/)[1];
    return ok({ values: zeilen(t).map(r => [...r]) });
  }
  return ok({ sheets: titel.map((t, i) => ({ properties: { title: t, sheetId: i } })) });
};

const people = [{ name: "Peter Muster", plan: "Peter" }, { name: "Sebastian Stern", plan: "Sebastian" }];

// Blätter ohne Jahr gelten nur fürs Basisjahr
const meta = titel.map((t, i) => ({ title: t, id: i }));
assert.equal(blattFuer(meta, 2027, 3, 2026), null, "KW 3 ohne Jahr ist nicht 2027");
assert.equal(blattFuer(meta, 2027, 2, 2026).title, "KW 2 2027");

// Jahr laden: 52 Blätter in 2 Abrufen
const j = await laden(env, people, "2026");
assert.equal(abrufe, 2, "52 Blätter in 2 Abrufen");
assert.deepEqual(j.personen["Sebastian Stern"], [{ von: "2026-01-05", bis: "2026-01-05", tage: 1 }]);

// Ab heute ein Jahr voraus: KW 46/2026 und KW 2/2027 (nur das Blatt mit Jahr)
const r = await liste(env, { name: "Peter Muster", plan: "Peter" }, people, { buero: true, heute: "2026-11-01" });
assert.deepEqual(r.meine, [{ von: "2026-11-11", bis: "2026-11-13", tage: 3 }, { von: "2027-01-12", bis: "2027-01-12", tage: 1 }]);
assert.equal(r.planBis, "2027-01-17", "Wochenplan reicht bis Ende KW 2/2027");
assert.equal(r.alle.length, 2);
const s = await liste(env, { name: "Sebastian Stern", plan: "Sebastian" }, people, { heute: "2026-11-01" });
assert.deepEqual(s.meine, [], "Januar 2026 liegt in der Vergangenheit");
assert.equal(s.alle, undefined, "Monteur sieht nur eigenen Urlaub");

// Infomail: ohne Absender aus
await run(env, "INSERT INTO mitarbeiter (name, mail, rechte) VALUES ('Christina Schatz', 'schatz@example.org', 'urlaub'), ('Peter Muster', '', ''), ('Sebastian Stern', '', '')");
assert.equal((await einstellung(env)).an, "schatz@example.org", "vorbelegt mit Frau Schatz");
assert.ok((await abgleich(env, people, { heute: "2026-11-01" })).aus);
env.MAIL_FROM = "kapp@example.org";
// erster Lauf: nur merken
assert.deepEqual(await abgleich(env, people, { heute: "2026-11-01" }), { gesendet: false, start: true });
assert.equal(mails.length, 0);
assert.equal((await abgleich(env, people, { heute: "2026-11-01" })).gesendet, false, "nichts Neues");

// Monteur trägt eigenen Urlaub ein (Mo–Fr KW 50, Wochenende wird übersprungen)
const peter = { name: "Peter Muster", plan: "Peter", rechte: [] };
await assert.rejects(eintragen(env, peter, { name: "Sebastian Stern", von: "2026-12-07", bis: "2026-12-07" }, people, { heute: "2026-11-01" }), /eigenen Urlaub/);
await assert.rejects(eintragen(env, peter, { von: "2026-10-01", bis: "2026-10-02" }, people, { heute: "2026-11-01" }), /ab heute/);
blatt["KW 50"] = null; zeilen("KW 50")[2][1] = "Baustelle Bochum";
const e = await eintragen(env, peter, { von: "2026-12-07", bis: "2026-12-13" }, people, { heute: "2026-11-01" });
assert.equal(e.eingetragen, 5);
assert.deepEqual(e.ueberschrieben, [{ datum: "2026-12-08", vorher: "Baustelle Bochum" }]);
assert.deepEqual(zeilen("KW 50").slice(1).map(r => r[1]), ["Urlaub", "Urlaub", "Urlaub", "Urlaub", "Urlaub"]);
// Feiertag bleibt, schon eingetragener Urlaub wird übersprungen
const f = await eintragen(env, peter, { von: "2026-12-21", bis: "2026-12-25" }, people, { heute: "2026-11-01" });
assert.equal(f.eingetragen, 3, "21.–23.12."); assert.equal(f.uebersprungen, 1, "24.12. steht in der Tabelle als Feiertag; 25.12. ist gesetzlicher Feiertag und zählt gar nicht");
assert.equal(zeilen("KW 52")[4][1], "Feiertag");
// Ins Jahr 2027 nur, wenn es ein Blatt mit Jahreszahl gibt
const g = await eintragen(env, peter, { von: "2027-01-18", bis: "2027-01-18" }, people, { heute: "2026-11-01" });
assert.equal(g.eingetragen, 0); assert.match(g.fehler[0], /KW 3\/2027/);

// Abgleich → eine Mail mit beiden Zeiträumen
cacheLeeren();
const a = await abgleich(env, people, { heute: "2026-11-01", wer: "Peter Muster" });
assert.equal(a.gesendet, true); assert.equal(a.neu, 8);
assert.equal(mails.length, 1);
assert.equal(mails[0].from, "kapp@example.org");
assert.deepEqual(mails[0].toRecipients, [{ emailAddress: { address: "schatz@example.org" } }]);
assert.match(mails[0].body.content, /Peter Muster: Mo 07\.12\.2026 – Fr 11\.12\.2026 \(5 Arbeitstage\)/);
assert.match(mails[0].body.content, /Peter Muster: Mo 21\.12\.2026 – Mi 23\.12\.2026 \(3 Arbeitstage\)/, "Feiertag Do bleibt frei");
assert.doesNotMatch(mails[0].body.content, /25\.12\.2026/, "1. Weihnachtstag ist kein Urlaubstag");
assert.equal((await abgleich(env, people, { heute: "2026-11-01" })).gesendet, false, "nicht doppelt");

// Urlaub direkt in der Tabelle gestrichen → Mail „gestrichen“
zeilen("KW 50")[5][1] = "Bochum"; cacheLeeren();
const w = await abgleich(env, people, { heute: "2026-11-01" });
assert.equal(w.weg, 1);
assert.match(mails[1].subject, /Urlaub gestrichen: Peter Muster, Fr 11\.12\.2026/);

// Mail fehlgeschlagen → nächster Lauf versucht es noch einmal
zeilen("KW 50")[5][1] = "Urlaub ½"; cacheLeeren();
const echt = globalThis.fetch;
globalThis.fetch = async (url, opt) => String(url).includes("sendMail") ? { ok: false, status: 403, json: async () => ({ error: { message: "Access denied" } }) } : echt(url, opt);
await assert.rejects(abgleich(env, people, { heute: "2026-11-01" }), /Access denied/);
globalThis.fetch = echt;
const n = await abgleich(env, people, { heute: "2026-11-01" });
assert.equal(n.gesendet, true); assert.match(mails[2].body.content, /halber Tag/);

// Empfänger ändern
await assert.rejects(speichereEmpfaenger(env, "quatsch"), /keine gültige/);
await speichereEmpfaenger(env, "a@example.org; b@example.org");
assert.equal((await einstellung(env)).an, "a@example.org, b@example.org");
assert.match(mailText({ X: new Map([["2026-12-07", "ganz"]]) }, {}, "").subject, /Urlaub in Label eintragen: X, Mo 07\.12\.2026/);
console.log("Urlaub laden/eintragen/Infomail: alle Prüfungen bestanden.");
