// Restmüll: „Restmüll leeren“ auf der Startseite schickt eine Mail an den Entsorger.
// Daten in der Hinweise-Excel (Airtec_Hinweise.xlsx):
//   Blatt „Müll Einstellungen“: Feld | Wert   (Empfänger, Kopie (CC), Absender, Betreff, Text – Platzhalter {name}, {datum})
//   Blatt „Müll“: Angefordert am | Angefordert von | Gesendet an
// Senden über Microsoft 365 (App-Recht „Mail.Send“ nötig).
import { downloadTagged, overwrite, sendMail } from "./graph.js";
import { openWorkbook } from "./xlsx.js";
import { path } from "./hinweise.js";
import { parseDate } from "./maschinen.js";

const SET = "Müll Einstellungen", LOG = "Müll";
const SPERRE_STD = 24;   // so lange nach einer Anforderung wird nachgefragt („trotzdem?“)
const DEF = [
  ["Empfänger", "stern@airtec-kaeltetechnik.de"],
  ["Kopie (CC)", ""],
  ["Absender", "info@airtec-kaeltetechnik.de"],
  ["Betreff", "Leerung Restmüllbehälter – Airtec Kältetechnik GmbH"],
  ["Text", "Sehr geehrte Damen und Herren,\n\nbitte leeren Sie unseren Restmüllbehälter am Standort:\n\nAirtec Kältetechnik GmbH\nMax-Planck-Str. 2\n48599 Gronau\n\nVielen Dank und freundliche Grüße\n{name}\nAirtec Kältetechnik GmbH"],
];
let queue = Promise.resolve();
const fmt = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

async function load(env) {
  const f = await downloadTagged(env, path(env));
  const wb = await openWorkbook(f.bytes);
  const sr = await wb.rows(SET), lr = await wb.rows(LOG);
  const get = key => { const r = (sr || []).slice(1).find(r => norm(r[0]).startsWith(norm(key))); return r ? String(r[1] ?? "").trim() : null; };
  const s = Object.fromEntries(DEF.map(([k, d]) => [k, get(k) ?? d]));
  const log = (lr || []).slice(1).map(r => [0, 1, 2].map(i => String((r || [])[i] ?? "").trim())).filter(r => r[0]);
  return { f, wb, s, log, hasSet: !!sr, hasLog: !!lr };
}

const info = d => ({ letzte: d.log[0] ? { am: d.log[0][0], von: d.log[0][1] } : null, anzahl: d.log.length, bereit: !!d.s["Empfänger"] && !!d.s["Absender"] });

export async function status(env) { return info(await load(env)); }

// b: { trotzdem?: true }
export function anfordern(env, me, b = {}) {
  const run = async () => {
    let d = await load(env);
    const last = d.log[0] && parseDate(d.log[0][0]);
    if (last && Date.now() - last.getTime() < SPERRE_STD * 3600e3 && !b.trotzdem)
      throw Object.assign(new Error(`Die Leerung wurde schon am ${d.log[0][0].slice(0, 16)} von ${d.log[0][1]} angefordert.`), { status: 409, schon: true });
    const s = d.s, now = new Date();
    if (!s["Empfänger"]) throw Object.assign(new Error("Keine Empfänger-Adresse im Blatt „Müll Einstellungen“"), { status: 400 });
    if (!s["Absender"]) throw Object.assign(new Error("Kein Absender im Blatt „Müll Einstellungen“"), { status: 400 });
    const fill = t => String(t).replace(/\{name\}/g, me.name).replace(/\{datum\}/g, fmt(now).slice(0, 10)).replace(/\\n/g, "\n");
    try {
      await sendMail(env, s["Absender"], { to: s["Empfänger"].split(/[;,]\s*/), cc: s["Kopie (CC)"].split(/[;,]\s*/), subject: fill(s["Betreff"]), text: fill(s["Text"]) });
    } catch (e) {
      if (e.status === 403 || /access|denied|authoriz/i.test(e.message)) e.message = "Mail konnte nicht gesendet werden – das Recht „Mail.Send“ fehlt noch in der Azure-App-Registrierung";
      else if (e.status === 404) e.message = `Absender-Postfach „${s["Absender"]}“ nicht gefunden`;
      throw e;
    }
    const entry = [fmt(now), me.name, s["Empfänger"]];
    // Protokoll speichern (bei Konflikt neu laden und nochmal)
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) d = await load(env);
      const rows = [entry, ...d.log].slice(0, 200);
      if (d.hasLog) await d.wb.setBody(LOG, rows); else await d.wb.addSheet(LOG, [["Angefordert am", "Angefordert von", "Gesendet an"], ...rows], [18, 22, 34]);
      if (!d.hasSet) await d.wb.addSheet(SET, [["Feld", "Wert"], ...DEF.map(([k, v]) => [k, v])], [16, 90]);
      try { await overwrite(env, d.f.id, await d.wb.toBytes(), d.f.etag); return { ...info({ ...d, log: rows }), gesendet: true }; }
      catch (e) { if (e.status === 412 && attempt < 2) continue; e.message = "Mail wurde gesendet, aber nicht in der Excel vermerkt: " + e.message; throw e; }
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
