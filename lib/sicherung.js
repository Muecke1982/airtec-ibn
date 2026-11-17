// Datensicherung: alle Tabellen der Datenbank als JSON-Datei nach SharePoint.
//  • Ordner: „Datensicherung“ neben dem Stammdaten-Ordner (oder Einstellung SP_SICHERUNG_ORDNER)
//  • Dateiname: KApp_Sicherung_JJJJ-MM-TT.json (mehrmals am Tag = überschreiben); vor einem Zurückspielen
//    zusätzlich KApp_Sicherung_JJJJ-MM-TT_vor-Wiederherstellung_HHMM.json
//  • Aufbewahrung: die letzten 30 Tage alle, danach je Monat die erste Sicherung für 12 Monate, älteres wird gelöscht
//  • täglich automatisch (Zeitplan), außerdem „Jetzt sichern“ in der Verwaltung (nur Admin)
//  • Zurückspielen je Bereich; vorher wird automatisch der aktuelle Stand gesichert
import { all, one, run, batch, jetzt, heute, schemaVersion } from "./db.js";
import { cfg, upload, ordnerInhalt, loeschenItem, downloadItem } from "./graph.js";
import { resetUsers } from "./auth.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

export function ordner(env) {
  const o = cfg(env, "SP_SICHERUNG_ORDNER", false);
  if (o) return o.replace(/^\/+|\/+$/g, "");
  // Stammdaten liegen z. B. in „Inbetriebnahmeprotokolle/Stammdaten/…xlsx“ → „Inbetriebnahmeprotokolle/Datensicherung“
  const teile = cfg(env, "SP_STAMM_PATH").split("/").filter(Boolean);
  return [...teile.slice(0, -2), "Datensicherung"].join("/");
}

// SharePoint-Zugriff (im Test austauschbar)
const SP = env => ({
  speichern: (name, bytes) => upload(env, ordner(env), name, bytes, "replace"),
  liste: () => ordnerInhalt(env, ordner(env)),
  loeschen: id => loeschenItem(env, id),
  laden: id => downloadItem(env, id),
});

// Bereiche zum Zurückspielen (Tabellen, die zusammengehören)
export const BEREICHE = {
  mitarbeiter: { titel: "Mitarbeiter und Rechte", tabellen: ["mitarbeiter"] },
  stammdaten: { titel: "Stammdaten (Protokoll)", tabellen: ["listen", "listen_werte", "nachfuell", "gwp", "dokumente"] },
  nachrichten: { titel: "Nachrichten und Abstimmungen", tabellen: ["nachrichten", "nachricht_an", "nachricht_status", "antworten", "umfrage_optionen", "stimmen", "hinweise", "hinweise_erledigt"] },
  autos: { titel: "Autos und Anhänger", tabellen: ["autos", "auto_meldungen"] },
  maschinen: { titel: "Maschinen", tabellen: ["maschinen", "ausleihen", "reservierungen", "verleih_empfaenger"] },
  lager: { titel: "Lager", tabellen: ["kategorien", "unterkategorien", "lieferanten", "artikel", "meldungen", "bestellungen"] },
  urlaub: { titel: "Urlaub und Restmüll", tabellen: ["urlaub", "muell"] },
  einstellungen: { titel: "Einstellungen", tabellen: ["einstellungen", "importe"] },
  logbuch: { titel: "Logbuch", tabellen: ["logbuch"] },
};

async function tabellen(env) {
  return (await all(env, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> '_schema' ORDER BY name"))
    .map(r => r.name);
}

async function merken(env, wert) {
  await run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('sicherung_letzte', ?)", JSON.stringify(wert));
}

// Sicherung erstellen. zusatz: Namensteil (z. B. "vor-Wiederherstellung_0915")
export async function sichern(env, wer = "Zeitplan", zusatz = "", sp = SP(env)) {
  const daten = { app: "airtec-kapp", version: await schemaVersion(env), erstellt: jetzt(), von: wer, tabellen: {} };
  let zeilen = 0;
  for (const t of await tabellen(env)) {
    const rows = await all(env, `SELECT * FROM "${t}"`);
    daten.tabellen[t] = rows; zeilen += rows.length;
  }
  const name = `KApp_Sicherung_${heute()}${zusatz ? "_" + zusatz : ""}.json`;
  const bytes = new TextEncoder().encode(JSON.stringify(daten));
  try {
    await sp.speichern(name, bytes);
  } catch (e) {
    await merken(env, { am: jetzt(), fehler: e.message, von: wer }).catch(() => {});
    throw fail("Sicherung konnte nicht gespeichert werden: " + e.message, 500);
  }
  const info = { am: jetzt(), datei: name, groesse: bytes.length, zeilen, tabellen: Object.keys(daten.tabellen).length, von: wer };
  await merken(env, info);
  const geloescht = await aufraeumen(env, sp).catch(e => { console.error("Sicherungen aufräumen:", e.message); return 0; });
  return { ...info, geloescht };
}

// Aufbewahrung: 30 Tage alles; danach je Monat die älteste Datei des Monats für 12 Monate
export async function aufraeumen(env, sp = SP(env)) {
  const dateien = (await sp.liste()).map(f => ({ ...f, tag: (f.name.match(/^KApp_Sicherung_(\d{4}-\d{2}-\d{2})/) || [])[1] })).filter(f => f.tag)
    .sort((a, b) => a.name.localeCompare(b.name));
  const h = heute(), grenze30 = heute(new Date(Date.now() - 30 * 864e5)), grenze12 = heute(new Date(Date.now() - 366 * 864e5));
  const monatErste = new Set();
  const weg = [];
  for (const f of dateien) {
    if (f.tag >= grenze30 || f.tag > h) continue;
    const mon = f.tag.slice(0, 7);
    if (f.tag >= grenze12 && !monatErste.has(mon) && !f.name.includes("vor-Wiederherstellung")) { monatErste.add(mon); continue; }
    weg.push(f);
  }
  for (const f of weg) await sp.loeschen(f.id);
  return weg.length;
}

// täglich einmal (vom Zeitplan aufgerufen)
export async function taeglich(env) {
  const s = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'sicherung_letzte'");
  let letzte = {}; try { letzte = JSON.parse((s && s.wert) || "{}"); } catch {}
  if (letzte.datei && !letzte.fehler && String(letzte.am).slice(0, 10) === heute()) return null;
  return sichern(env, "Zeitplan");
}

export async function status(env, sp = SP(env)) {
  const s = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'sicherung_letzte'");
  let letzte = null; try { letzte = JSON.parse((s && s.wert) || "null"); } catch {}
  let dateien = [], fehler = "";
  try { dateien = (await sp.liste()).filter(f => /^KApp_Sicherung_/.test(f.name)).sort((a, b) => b.name.localeCompare(a.name)); }
  catch (e) { fehler = e.message; }
  let pfad = ""; try { pfad = ordner(env); } catch {}
  return { letzte, dateien: dateien.map(f => ({ id: f.id, name: f.name, groesse: f.size })), ordner: pfad, fehler,
    bereiche: Object.entries(BEREICHE).map(([id, b]) => ({ id, titel: b.titel })) };
}

// Zurückspielen: datei = SharePoint-ID, bereiche = ["autos", …]
export async function zurueckspielen(env, wer, b, sp = SP(env)) {
  const ids = (b.bereiche || []).filter(x => BEREICHE[x]);
  if (!ids.length) throw fail("Bitte mindestens einen Bereich wählen");
  if (!b.datei) throw fail("Bitte eine Sicherung wählen");
  let daten;
  try { daten = JSON.parse(new TextDecoder().decode(await sp.laden(b.datei))); } catch (e) { throw fail("Sicherungsdatei konnte nicht gelesen werden: " + e.message); }
  if (daten.app !== "airtec-kapp" || !daten.tabellen) throw fail("Das ist keine Sicherung der KApp");
  if (daten.version > await schemaVersion(env)) throw fail("Die Sicherung stammt von einer neueren App-Version");
  // vorher den aktuellen Stand sichern
  const vorher = await sichern(env, wer, "vor-Wiederherstellung_" + jetzt().slice(11, 16).replace(":", ""), sp);
  const vorhanden = new Set(await tabellen(env));
  const sql = [], zahlen = {};
  for (const id of ids) for (const t of BEREICHE[id].tabellen) {
    if (!vorhanden.has(t)) continue;
    const rows = daten.tabellen[t] || [];
    const spalten = (await all(env, `PRAGMA table_info("${t}")`)).map(c => c.name);
    const cols = spalten.filter(c => rows.some(r => c in r));
    sql.push([`DELETE FROM "${t}"`]);
    const per = Math.max(1, Math.floor(100 / Math.max(1, cols.length)));
    for (let i = 0; i < rows.length; i += per) {
      const part = rows.slice(i, i + per);
      sql.push([`INSERT INTO "${t}" (${cols.map(c => `"${c}"`).join(", ")}) VALUES ` + part.map(() => "(" + cols.map(() => "?").join(", ") + ")").join(", "),
        ...part.flatMap(r => cols.map(c => r[c] === undefined ? null : r[c]))]);
    }
    zahlen[t] = rows.length;
  }
  // in Paketen schreiben (sehr große Sicherungen); die Sicherheitskopie von eben liegt bereit
  for (let i = 0; i < sql.length; i += 400) await batch(env, sql.slice(i, i + 400));
  if (ids.includes("mitarbeiter")) resetUsers();
  return { zurueckgespielt: ids.map(id => BEREICHE[id].titel), zahlen, aus: daten.erstellt, sicherheitskopie: vorher.datei };
}
