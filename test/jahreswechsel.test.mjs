// Test: Wochenplan über den Jahreswechsel (Blätter vorab anlegen, neues Jahr beginnen) – Google nachgebildet
// Aufruf:  node test/jahreswechsel.test.mjs
import assert from "node:assert/strict";
import { fakeD1 } from "./d1-fake.mjs";
import { run, one } from "../lib/db.js";
import { feiertage, wochenImJahr, textUmschreiben, umschreiben,vorbereiten, neuesJahr, taeglich, planJahr, status } from "../lib/jahreswechsel.js";
import { mondayOf, isoDate, findSheet, zellText, norm } from "../lib/wochenplan.js";
import { writePlan } from "../lib/planwrite.js";
import { zelle, anwenden } from "../lib/einsaetze.js";

// Feiertage
const f27 = feiertage(2027);
assert.equal(f27.get("2027-03-26"), "Karfreitag");
assert.equal(f27.get("2027-03-29"), "Ostermontag");
assert.equal(f27.get("2027-05-06"), "Christi Himmelfahrt");
assert.equal(f27.get("2027-05-17"), "Pfingstmontag");
assert.equal(f27.size, 9);
assert.equal(wochenImJahr(2026), 53); assert.equal(wochenImJahr(2027), 52);
const mA = mondayOf(2026, 46).getTime(), mB = mondayOf(2027, 46).getTime();
assert.equal(textUmschreiben("KW 46 / 2026: 09.11. – 13.11.2026", mA, mB, 2026, 2027), "KW 46 / 2027: 15.11. – 19.11.2027");
assert.equal(textUmschreiben("PLZ 44866, 1.5.", mA, mB, 2026, 2027), "PLZ 44866, 1.5.", "fremde Daten bleiben");

// Aufbau „Wochentage nebeneinander, Namen untereinander“
{
  const z = v => ({ userEnteredValue: { stringValue: v }, formattedValue: v });
  const g = { title: "KW 46", merges: [], rows: [[z(""), z("Mo"), z("Di"), z("Mi"), z("Do"), z("Fr")], [z(""), z("09.11."), z("10.11."), z("11.11."), z("12.11."), z("13.11.")],
    [z("Peter"), z("Bochum"), z("Bochum"), z("Urlaub"), z(""), z("")], [z("Sebastian"), z("Essen"), z(""), z(""), z(""), z("")]] };
  const u = umschreiben(g, { year: 2026, week: 46 }, { year: 2027, week: 46 }, ["Peter", "Sebastian"], 7);
  const rows = u.requests.at(-1).updateCells.rows.map(r => r.values.map(x => (x.userEnteredValue || {}).stringValue || ""));
  assert.deepEqual(rows[1], ["", "15.11.", "16.11.", "17.11.", "18.11.", "19.11."]);
  assert.deepEqual(rows[2], ["Peter", "", "", "", "", ""]);
  assert.deepEqual(rows[0], ["", "Mo", "Di", "Mi", "Do", "Fr"]);
  assert.equal(u.geleert, 4);
}

// ---------- nachgebildete Google-Tabelle ----------
const SERIAL0 = Date.UTC(1899, 11, 30);
const serial = iso => (Date.parse(iso + "T00:00:00Z") - SERIAL0) / 864e5;
const fmtDate = s => { const d = new Date(SERIAL0 + s * 864e5); return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`; };
const str = v => ({ userEnteredValue: { stringValue: v } });
const datum = iso => ({ userEnteredValue: { numberValue: serial(iso) }, userEnteredFormat: { numberFormat: { type: "DATE" } } });
let sheets = [], nextIndex = 0;
function kwBlatt(title, year, week, id) {
  const mo = mondayOf(year, week);
  const tag = i => isoDate(new Date(mo.getTime() + i * 864e5));
  const rows = [
    [str(title), str(`Woche vom ${tag(0).split("-").reverse().join(".")}`)],
    [{}, {}, str("Peter"), str("Sebastian")],
    ...["Mo", "Di", "Mi", "Do", "Fr"].map((t, i) => [str(t), i === 4 ? { userEnteredValue: { formulaValue: "=B6+1" } } : datum(tag(i)), str(`Baustelle ${week}`), str(`Baustelle ${week}`)]),
  ];
  rows[3][2] = { ...str("Urlaub"), note: "alte Notiz" };
  return { id, title, index: nextIndex++, merges: [{ startRowIndex: 2, endRowIndex: 3, startColumnIndex: 2, endColumnIndex: 4 }], rows };
}
for (let w = 1; w <= 52; w++) sheets.push(kwBlatt(`KW ${w}`, 2026, w, 1000 + w));
// Füllfarben wie im Büro: Feiertage gelb (ganze Zeile), ein Urlaubstag grün
const GELB = { red: 1, green: 1, blue: 0 }, GRUEN = { red: 0, green: 1, blue: 0 };
const faerben = (z, c) => { z.userEnteredFormat = { ...(z.userEnteredFormat || {}), backgroundColor: c }; };
const zeileGelb = (t, r) => { const row = byTitle0(t).rows[r]; for (let c = 0; c < 4; c++) faerben(row[c] = row[c] || {}, GELB); };
const byTitle0 = t => sheets.find(s => s.title === t);
zeileGelb("KW 1", 5);    // Do 01.01.2026 Neujahr
zeileGelb("KW 52", 6);   // Fr 25.12.2026
faerben(byTitle0("KW 10").rows[3][2], GRUEN);
const bgKey = (t, r, c) => { const f = ((byTitle0(t).rows[r] || [])[c] || {}).userEnteredFormat || {}; const b = f.backgroundColor; return b ? [b.red, b.green, b.blue].join(",") : ""; };
sheets.push({ id: 5, title: "Info", index: nextIndex++, merges: [], rows: [[str("Telefonliste 2026")]] });
const shown = z => {
  const u = z.userEnteredValue || {};
  if (u.formulaValue) return "";
  if (u.numberValue !== undefined && z.userEnteredFormat) return fmtDate(u.numberValue);
  return u.stringValue ?? (u.numberValue !== undefined ? String(u.numberValue) : "");
};
const byTitle = t => sheets.find(s => s.title === t);
const byId = id => sheets.find(s => s.id === id);
const reindex = () => sheets.sort((a, b) => a.index - b.index).forEach((s, i) => { s.index = i; });
const clone = x => JSON.parse(JSON.stringify(x));
const uploads = [];
let driveOk = true, updates = 0;

globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  const ok = j => ({ ok: true, status: 200, json: async () => j, arrayBuffer: async () => new Uint8Array([80, 75]).buffer });
  if (url.includes("oauth2")) return ok({ access_token: "a", expires_in: 3600 });
  if (url.includes("/drive/v3/")) return driveOk ? ok({}) : { ok: false, status: 403, json: async () => ({ error: { message: "Google Drive API has not been used in project 1 before or it is disabled" } }) };
  if (url.includes(":batchUpdate")) {
    updates++;
    for (const rq of JSON.parse(opt.body).requests) {
      if (rq.duplicateSheet) {
        const d = rq.duplicateSheet, src = byId(d.sourceSheetId);
        for (const s of sheets) if (s.index >= d.insertSheetIndex) s.index++;
        sheets.push({ ...clone(src), id: d.newSheetId, title: d.newSheetName, index: d.insertSheetIndex });
        reindex();
      } else if (rq.deleteSheet) {
        sheets = sheets.filter(s => s.id !== rq.deleteSheet.sheetId); reindex();
      } else if (rq.updateSheetProperties) {
        const p = rq.updateSheetProperties.properties, s = byId(p.sheetId);
        if (p.title) { assert.ok(!sheets.some(x => x !== s && x.title === p.title), "Blattname doppelt: " + p.title); s.title = p.title; }
        if (p.index !== undefined) { s.index = p.index - 0.5; reindex(); }
      } else if (rq.unmergeCells) {
        const s = byId(rq.unmergeCells.range.sheetId);
        s.merges = s.merges.filter(m => m.startRowIndex !== rq.unmergeCells.range.startRowIndex || m.startColumnIndex !== rq.unmergeCells.range.startColumnIndex);
      } else if (rq.updateCells) {
        const u = rq.updateCells, s = byId(u.range.sheetId);
        u.rows.forEach((r, ri) => r.values.forEach((v, ci) => {
          const row = s.rows[u.range.startRowIndex + ri] = s.rows[u.range.startRowIndex + ri] || [];
          const alt = row[u.range.startColumnIndex + ci] || {};
          const neu = clone(alt);
          for (const f of u.fields.split(",")) {
            const [a, b] = f.split(".");
            if (!b) { if (v[a] === undefined) delete neu[a]; else neu[a] = v[a]; continue; }
            neu[a] = neu[a] || {};
            if (!v[a] || v[a][b] === undefined) delete neu[a][b]; else neu[a][b] = v[a][b];
          }
          row[u.range.startColumnIndex + ci] = neu;
        }));
      } else throw new Error("unbekannt: " + Object.keys(rq));
    }
    return ok({});
  }
  if (url.includes("includeGridData")) {
    const titel = new URL(url).searchParams.getAll("ranges").map(r => r.match(/^'(.*)'!/)[1].replace(/''/g, "'"));
    return ok({ sheets: titel.map(t => { const s = byTitle(t); return { properties: { sheetId: s.id, title: s.title, index: s.index }, merges: clone(s.merges),
      data: [{ rowData: s.rows.map(r => ({ values: r.map(z => ({ ...clone(z || {}), formattedValue: shown(z || {}) })) })) }] }; }) });
  }
  if (url.includes("/values/")) {
    const t = decodeURIComponent(url.split("/values/")[1]).match(/^'?(.*?)'?!/)[1];
    return ok({ values: byTitle(t).rows.map(r => r.map(z => shown(z || {}))) });
  }
  return ok({ sheets: [...sheets].sort((a, b) => a.index - b.index).map(s => ({ properties: { title: s.title, sheetId: s.id, index: s.index }, merges: clone(s.merges) })) });
};

const env = { GOOGLE_SA_JSON: "", GSHEET_ID: "T", DB: fakeD1(), CLIENT_ID: "c", CLIENT_SECRET: "s", TENANT_ID: "t", SP_STAMM_PATH: "A/Stammdaten/x.xlsx" };
const k = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign"]);
env.GOOGLE_SA_JSON = JSON.stringify({ client_email: "t@x", private_key: "-----BEGIN PRIVATE KEY-----\n" + Buffer.from(await crypto.subtle.exportKey("pkcs8", k.privateKey)).toString("base64") + "\n-----END PRIVATE KEY-----" });
await run(env, "INSERT INTO mitarbeiter (name, plan, rechte) VALUES ('Peter Muster', 'Peter', ''), ('Sebastian Stern', 'Sebastian', '')");
const sp = { speichern: async (name, bytes) => { uploads.push({ name, bytes }); } };
const wert = (t, r, c) => shown((byTitle(t).rows[r] || [])[c] || {});

// Oktober: Zeitplan macht noch nichts
assert.equal(await taeglich(env, { heute: "2026-10-31" }), null);

// November: KW 53 (2026 hat 53 Wochen) + KW 1–4 2027
const v = await taeglich(env, { heute: "2026-11-19" });
assert.deepEqual(v.angelegt, ["KW 53", "KW 1 2027", "KW 2 2027", "KW 3 2027", "KW 4 2027"]);
assert.equal((await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'wochenplan_jahr'")).wert, "2026");
assert.equal(byTitle("KW 53").index, byTitle("KW 52").index + 1, "KW 53 hinter KW 52");
assert.deepEqual([...sheets].sort((a, b) => a.index - b.index).slice(-6).map(s => s.title), ["KW 53", "KW 1 2027", "KW 2 2027", "KW 3 2027", "KW 4 2027", "Info"],
  "neue Blätter direkt hinter KW 53, andere Blätter bleiben hinten");
// KW 53/2026: 28.12.2026–01.01.2027, Neujahr (Fr) = Feiertag, Einträge leer, Datum neu
assert.equal(wert("KW 53", 0, 1), "Woche vom 28.12.2026");
assert.equal(wert("KW 53", 2, 1), "28.12.2026");
assert.equal(wert("KW 53", 2, 2), ""); assert.equal(wert("KW 53", 3, 2), "");
assert.equal(byTitle("KW 53").rows[3][2].note, undefined, "Notiz im Eintrag gelöscht");
assert.equal(wert("KW 53", 6, 2), "Feiertag"); assert.equal(wert("KW 53", 6, 3), "Feiertag");
assert.equal(byTitle("KW 53").rows[6][1].userEnteredValue.formulaValue, "=B6+1", "Formel bleibt");
assert.equal(byTitle("KW 53").merges.length, 0, "Team-Verbindung gelöst");
assert.equal(v.feiertage.find(x => x.datum === "2027-01-01").name, "Neujahr");
// KW 1 2027: 04.01.2027
assert.equal(wert("KW 1 2027", 0, 0), "KW 1"); assert.equal(wert("KW 1 2027", 2, 1), "04.01.2027");
assert.equal(wert("KW 1", 2, 2), "Baustelle 1", "altes Blatt unverändert");
// Farben: Neujahrs-Gelb aus KW 1/2026 nicht in KW 1/2027 (Do 07.01.), aber Neujahr 2027 (Fr) in KW 53 gelb
assert.equal(bgKey("KW 1", 5, 2), "1,1,0", "Vorlage unverändert");
for (let c = 0; c < 4; c++) assert.equal(bgKey("KW 1 2027", 5, c), "", "07.01.2027 nicht gelb");
for (let c = 0; c < 4; c++) assert.equal(bgKey("KW 53", 6, c), "1,1,0", "01.01.2027 gelb");
assert.equal(bgKey("KW 53", 5, 2), "");
assert.equal((await vorbereiten(env, { heute: "2026-11-20" })).angelegt.length, 0, "nicht doppelt");
// einmalige Farbkorrektur für Blätter, die eine ältere Version angelegt hat
faerben(byTitle("KW 2 2027").rows[5][2], GELB);
await run(env, "DELETE FROM einstellungen WHERE schluessel = 'wochenplan_farben_2027'");
assert.equal((await vorbereiten(env, { heute: "2026-11-20" })).farbenKorrigiert, 1);
assert.equal(bgKey("KW 2 2027", 5, 2), "");
const st = await status(env, { heute: "2026-11-19" });
assert.equal(st.erlaubt, false); assert.deepEqual(st.vorab, ["KW 1 2027", "KW 2 2027", "KW 3 2027", "KW 4 2027"]);

// Blätter finden: 2026 → ohne Jahr, 2027 → nur mit Jahr
const meta = sheets.map(s => ({ title: s.title }));
assert.equal(findSheet(meta, 2026, 3, 2026).title, "KW 3");
assert.equal(findSheet(meta, 2027, 3, 2026).title, "KW 3 2027");
assert.equal(findSheet(meta, 2027, 5, 2026), null, "KW 5/2027 gibt es noch nicht");

// Urlaub für Januar 2027 eintragen → landet im Blatt „KW 2 2027“
const w = await writePlan(env, [{ datum: "2027-01-12", name: "Peter", wert: "Urlaub" }]);
assert.deepEqual(w.fehler, []);
assert.equal(wert("KW 2 2027", 3, 2), "Urlaub");
assert.equal(wert("KW 2", 3, 2), "Urlaub", "altes Blatt KW 2 (2026) unverändert");
const x = await writePlan(env, [{ datum: "2027-02-02", name: "Peter", wert: "Urlaub" }], true);
assert.match(x.fehler[0], /KW 5\/2027: kein Blatt/);

// Einsatz-Angaben als Zusatzzeilen in der Zelle; gelesen wird nur die Überschrift
assert.equal(zelle("Halle 3", { art: "baustelle", nummer: "4711", info: "Kran" }), "Halle 3\nProjekt-Nr.: 4711\nInfo: Kran");
assert.equal(zelle("Müller", { art: "kd", nummer: "17", info: "" }), "Müller\nKD-Nr.: 17");
assert.equal(zelle("Bochum", null), "Bochum");
assert.equal(zellText("Halle 3\nProjekt-Nr.: 4711\nInfo: Kran"), "Halle 3");
assert.equal(zellText("Bochum\nKran ab 7"), "Bochum\nKran ab 7", "eigene Zeilen bleiben");
const am = anwenden({ "2027-01-13": { alt: { titel: "Alt", art: "baustelle", nummer: "1", info: "", fix: false } } },
  [{ datum: "2027-01-13", titel: "Halle 3", nummer: "4711" }], ["2027-01-13"]);
assert.deepEqual(Object.keys(am["2027-01-13"]), ["halle 3"], "ersetzen: alte Angaben des Tages fallen weg");
const fmt = (d, v) => zelle(v, am[d] && am[d][norm(v)]);
const y = await writePlan(env, [{ datum: "2027-01-13", name: "Peter", wert: "Halle 3" }], false, { format: fmt });
assert.deepEqual(y.fehler, []);
assert.equal(wert("KW 2 2027", 4, 2), "Halle 3\nProjekt-Nr.: 4711");
byTitle("KW 2 2027").rows[4][3] = str("Halle 3");   // jemand trägt in der Tabelle nur die Überschrift ein
const y2 = await writePlan(env, [], false, { format: fmt, auffrischen: ["2027-01-13"] });
assert.equal(y2.cells.length, 1, "nur die eine Zelle wird ergänzt");
assert.equal(wert("KW 2 2027", 4, 3), "Halle 3\nProjekt-Nr.: 4711");
const y3 = await writePlan(env, [{ datum: "2027-01-13", name: "Peter", wert: "Halle 3" }], false, { format: fmt, auffrischen: ["2027-01-13"] });
assert.equal(y3.vorher["Peter|2027-01-13"], "Halle 3", "beim Lesen ohne Zusatzzeilen");
assert.equal(y3.cells.length, 1, "keine doppelten Zellen");

// Neues Jahr: vor dem 1. Januar gesperrt
await assert.rejects(neuesJahr(env, "Chef", { heute: "2026-12-30", sp }), /ab dem 1\. Januar 2027/);
// Sicherung schlägt fehl → nichts geändert
const vorher = updates;
await assert.rejects(neuesJahr(env, "Chef", { heute: "2027-01-02", sp: { speichern: async () => { throw new Error("SharePoint weg"); } } }), /nichts geändert/);
assert.equal(updates, vorher);
await run(env, "DELETE FROM einstellungen WHERE schluessel = 'jahreswechsel_lauf'");

// Drive nicht freigeschaltet → Sicherung als Datendatei
driveOk = false;
const n = await neuesJahr(env, "Chef", { heute: "2027-01-02", sp });
assert.match(uploads[0].name, /^Wochenplan_2026_Sicherung_2027-01-02\.json$/);
assert.match(n.hinweis, /Drive API/);
assert.equal(JSON.parse(new TextDecoder().decode(uploads[0].bytes)).blaetter.length, 58, "alle Blätter in der Sicherung");
assert.deepEqual(n.uebernommen, ["KW 1", "KW 2", "KW 3", "KW 4"]);
assert.equal(n.umgeschrieben, 48);
assert.equal(await planJahr(env), 2027);
// KW 1–4: vorab angelegte Blätter mit Urlaub, an alter Stelle, ohne Jahreszahl
assert.equal(wert("KW 2", 3, 2), "Urlaub"); assert.equal(wert("KW 2", 2, 1), "11.01.2027");
assert.ok(!byTitle("KW 2 2027"));
assert.equal(byTitle("KW 1").index, 0); assert.equal(byTitle("KW 2").index, 1);
// KW 13/2027: Karfreitag 26.03., Ostermontag 29.03. ist KW 13 Mo
assert.equal(wert("KW 13", 2, 1), "29.03.2027"); assert.equal(wert("KW 13", 2, 2), "Feiertag");
assert.equal(wert("KW 12", 6, 2), "Feiertag", "Karfreitag in KW 12");
assert.equal(wert("KW 12", 4, 2), "", "Einträge geleert");
assert.equal(bgKey("KW 12", 6, 2), "1,1,0", "Karfreitag gelb (Farbe aus den anderen Feiertagen)");
assert.equal(bgKey("KW 12", 6, 0), "", "Beschriftung ohne Muster bleibt");
assert.equal(bgKey("KW 10", 3, 2), "", "Urlaubsfarbe entfernt");
assert.equal(bgKey("KW 1", 5, 2), "", "KW 1: Do 07.01.2027 nicht mehr gelb");
assert.equal(wert("KW 46", 0, 1), "Woche vom 15.11.2027");
// KW 53 gibt es 2027 nicht → bleibt als „KW 53 2026“ lesbar
assert.ok(byTitle("KW 53 2026")); assert.ok(!byTitle("KW 53"));
assert.equal(wert("Info", 0, 0), "Telefonliste 2026", "andere Blätter unberührt");
const st2 = await status(env, { heute: "2027-01-02" });
assert.equal(st2.planJahr, 2027); assert.equal(st2.letzter.sicherung, uploads[0].name); assert.equal(st2.angefangen, false);
// Urlaub im Februar 2027 geht jetzt
assert.deepEqual((await writePlan(env, [{ datum: "2027-02-02", name: "Peter", wert: "Urlaub" }])).fehler, []);
// Zweiter Lauf im selben Jahr: gesperrt (erst 2028)
await assert.rejects(neuesJahr(env, "Chef", { heute: "2027-01-03", sp }), /1\. Januar 2028/);
console.log("Wochenplan-Jahreswechsel: alle Prüfungen bestanden.");
