// Restmüll: „Restmüll leeren“ auf der Startseite schickt eine Mail an den Entsorger.
//   Adressen, Betreff, Text: Verwaltung → E-Mail-Adressen (lib/mailcfg.js, Bereich „muell“; Platzhalter {name}, {datum})
//   Protokoll: Tabelle „muell“ (am, von, an)
// Übergang: Solange in der App noch nichts gespeichert ist, werden Einstellungen und letzte Anforderungen einmalig
// aus der alten Airtec_Hinweise.xlsx (Blätter „Müll Einstellungen“, „Müll“) übernommen – danach braucht es die Datei nicht mehr.
import { all, one, run, batch, jetzt, isoZeit } from "./db.js";
import { cfg, download, sendMail } from "./graph.js";
import { openWorkbook } from "./xlsx.js";
import { mailEinstellung, istGespeichert, speichern as mailSpeichern } from "./mailcfg.js";

const SPERRE_STD = 72;   // 3 Tage nach einer Anforderung wird nachgefragt („trotzdem?“) – falls die Abholung sich verspätet
const de = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}${iso.length > 10 ? " " + iso.slice(11, 16) : ""}` : "";
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

export const altePfad = env => cfg(env, "SP_HINWEISE_PATH", false) || String(cfg(env, "SP_STAMM_PATH", false) || "").replace(/[^/]*$/, "") + "Airtec_Hinweise.xlsx";

// einmalig: Einstellungen + Protokoll aus der alten Hinweise-Excel. bytes: Datei direkt (Test), sonst SharePoint.
export async function ausExcelUebernehmen(env, bytes) {
  if (await istGespeichert(env, "muell")) return false;
  const merken = () => run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('muell_excel_geprueft', ?)", jetzt());
  if (!bytes && await one(env, "SELECT 1 AS x FROM einstellungen WHERE schluessel = 'muell_excel_geprueft'")) return false;
  let wb;
  try { wb = await openWorkbook(bytes || await download(env, altePfad(env))); }
  catch (e) { if (e.status === 404) await merken(); return false; }   // Datei gibt es nicht (mehr) → Standardwerte, nicht jedes Mal neu suchen
  const sr = (await wb.rows("Müll Einstellungen")) || [];
  const get = key => { const r = sr.slice(1).find(r => norm(r[0]).startsWith(norm(key))); return r ? String(r[1] ?? "").trim() : undefined; };
  const s = { von: get("Absender"), an: get("Empfänger"), cc: get("Kopie"), antwort: get("Antworten an"), betreff: get("Betreff"), text: get("Text") };
  if (s.text) s.text = s.text.replace(/\\n/g, "\n");
  const std = await mailEinstellung(env, "muell");
  try { await mailSpeichern(env, "muell", Object.fromEntries(Object.entries(std).map(([k, v]) => [k, s[k] ?? v]))); }
  catch (e) { console.error("Müll-Einstellungen übernehmen:", e.message); await merken(); return false; }   // z. B. ungültige Adresse → in der App eintragen
  if (!(await one(env, "SELECT 1 AS x FROM muell LIMIT 1"))) {
    const lr = ((await wb.rows("Müll")) || []).slice(1).map(r => [isoZeit(r[0]), String(r[1] ?? "").trim(), String(r[2] ?? "").trim()]).filter(r => r[0]);
    if (lr.length) await batch(env, lr.slice(0, 200).reverse().map(r => ["INSERT INTO muell (am, von, an) VALUES (?, ?, ?)", ...r]));
  }
  await merken();
  return true;
}

async function letzte(env) { return one(env, "SELECT am, von, an FROM muell ORDER BY am DESC, id DESC LIMIT 1"); }

export async function status(env) {
  await ausExcelUebernehmen(env).catch(() => false);
  const l = await letzte(env), m = await mailEinstellung(env, "muell");
  const n = (await one(env, "SELECT COUNT(*) AS n FROM muell")).n;
  return { letzte: l ? { am: de(l.am), von: l.von } : null, anzahl: n, bereit: !!m.an && !!m.von };
}

// b: { trotzdem?: true }
let queue = Promise.resolve();
export function anfordern(env, me, b = {}) {
  const lauf = async () => {
    await ausExcelUebernehmen(env).catch(() => false);
    const l = await letzte(env);
    const last = l && new Date(l.am.replace(" ", "T") + ":00+01:00");
    if (last && !isNaN(last) && Date.now() - last.getTime() < SPERRE_STD * 3600e3 && !b.trotzdem)
      throw Object.assign(new Error(`Die Leerung wurde schon am ${de(l.am)} von ${l.von} angefordert.`), { status: 409, schon: true });
    const s = await mailEinstellung(env, "muell"), now = jetzt();
    if (!s.an) throw Object.assign(new Error("Keine Adresse des Entsorgers eingetragen (Verwaltung → E-Mail-Adressen)"), { status: 400 });
    if (!s.von) throw Object.assign(new Error("Kein Absender eingetragen (Verwaltung → E-Mail-Adressen)"), { status: 400 });
    const fill = t => String(t).replace(/\{name\}/g, me.name).replace(/\{datum\}/g, de(now).slice(0, 10));
    try {
      await sendMail(env, s.von, { to: s.an.split(/[;,]\s*/), cc: s.cc.split(/[;,]\s*/), subject: fill(s.betreff), text: fill(s.text), replyTo: s.antwort });
    } catch (e) {
      if (e.status === 403 || /access|denied|authoriz/i.test(e.message)) e.message = `Mail konnte nicht gesendet werden – die App darf (noch) nicht aus „${s.von}“ senden`;
      else if (e.status === 404) e.message = `Absender-Postfach „${s.von}“ nicht gefunden`;
      throw e;
    }
    await run(env, "INSERT INTO muell (am, von, an) VALUES (?, ?, ?)", now, me.name, s.an);
    return { ...(await status(env)), gesendet: true };
  };
  const p = queue.then(lauf, lauf);
  queue = p.catch(() => {});
  return p;
}

// für die Verwaltung: letzte Anforderungen
export const protokoll = env => all(env, "SELECT am, von, an FROM muell ORDER BY am DESC, id DESC LIMIT 20");
