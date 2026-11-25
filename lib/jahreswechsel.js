// Wochenplan über den Jahreswechsel (Google-Tabelle, ein Blatt je KW, der Link der Tabelle bleibt immer gleich).
//  • Ab November legt die App die ersten Wochen des nächsten Jahres als eigene Blätter an („KW 1 2027“ … „KW 4 2027“,
//    Kopie des Blatts „KW 1“ usw.: Aufbau und Namen bleiben, Einträge leer, Datum + bundesweite Feiertage neu).
//    So kann schon Urlaub für Anfang des nächsten Jahres eingetragen werden. Fehlt im alten Jahr „KW 53“, wird sie ergänzt.
//  • „Neues Jahr beginnen“ (Admin, ab 1. Januar): Sicherung der ganzen Tabelle nach SharePoint, dann werden alle
//    Wochenblätter ohne Jahreszahl auf das neue Jahr umgeschrieben (Datum, Feiertage, Einträge leer). Für die Wochen,
//    die schon als „KW n 2027“ existieren, wird das alte Blatt gelöscht und das neue übernimmt dessen Namen und Platz.
//  • Einstellung „wochenplan_jahr“: Jahr, für das die Blätter ohne Jahreszahl gelten.
import { one, run } from "./db.js";
import { users } from "./auth.js";
import { upload } from "./graph.js";
import { ordner } from "./sicherung.js";
import { sheets, gridData, batchUpdate, exportXlsx, clearCache, fuellen } from "./google.js";
import { isoWeek, mondayOf, isoDate, findSheet, hatJahr, parseWeek } from "./wochenplan.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const heuteBerlin = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
const TAG = 864e5;
export const VORLAUF_KW = 4;          // so viele Wochen des nächsten Jahres werden vorab angelegt
export const AB_MONAT = 11;           // ab November

/* ---------- Jahr der Blätter ohne Jahreszahl ---------- */
export async function planJahr(env) {
  try {
    const r = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'wochenplan_jahr'");
    if (r && /^\d{4}$/.test(r.wert)) return +r.wert;
  } catch { /* ohne Datenbank: aktuelles Jahr */ }
  return +heuteBerlin().slice(0, 4);
}
async function setzeWert(env, k, v) {
  await run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES (?, ?)", k, String(v));
}
async function leseJson(env, k) {
  const r = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = ?", k);
  try { return JSON.parse((r && r.wert) || "null"); } catch { return null; }
}

/* ---------- Feiertage (bundesweit) ---------- */
function ostersonntag(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mon = Math.floor((h + l - 7 * m + 114) / 31), tag = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, mon - 1, tag);
}
export function feiertage(y) {
  const o = ostersonntag(y), f = new Map();
  const add = (ms, n) => f.set(isoDate(new Date(ms)), n);
  add(Date.UTC(y, 0, 1), "Neujahr");
  add(o - 2 * TAG, "Karfreitag");
  add(o + 1 * TAG, "Ostermontag");
  add(Date.UTC(y, 4, 1), "Tag der Arbeit");
  add(o + 39 * TAG, "Christi Himmelfahrt");
  add(o + 50 * TAG, "Pfingstmontag");
  add(Date.UTC(y, 9, 3), "Tag der Deutschen Einheit");
  add(Date.UTC(y, 11, 25), "1. Weihnachtstag");
  add(Date.UTC(y, 11, 26), "2. Weihnachtstag");
  return f;
}
export const wochenImJahr = y => isoWeek(new Date(Date.UTC(y, 11, 28))).week;

/* ---------- ein Blatt auf eine andere Woche umschreiben ---------- */
const istDatumsformat = z => {
  const t = ((z.userEnteredFormat && z.userEnteredFormat.numberFormat) || (z.effectiveFormat && z.effectiveFormat.numberFormat) || {}).type;
  return t === "DATE" || t === "DATE_TIME" || /^\s*\d{1,2}\.\d{1,2}\./.test(z.formattedValue || "");
};
const SERIAL0 = Date.UTC(1899, 11, 30);
const pad = (n, len) => String(n).padStart(len, "0");

// Text: Datumsangaben der alten Woche („09.11.“, „9.11.2026“) → neue Woche, Jahreszahl alt → neu
export function textUmschreiben(s, monA, monB, yA, yB) {
  const jahreA = [new Date(monA).getUTCFullYear(), new Date(monA + 6 * TAG).getUTCFullYear()];
  return String(s).replace(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?|(^|[^\d.])(\d{4})(?![\d])/g, (m, d, mo, y, vor, jahr) => {
    if (jahr) return +jahr === yA ? vor + yB : m;
    const kand = y ? [y.length === 2 ? 2000 + +y : +y] : jahreA;
    for (const yy of kand) {
      const t = Date.UTC(yy, mo - 1, d);
      const dt = new Date(t);
      if (dt.getUTCDate() !== +d || dt.getUTCMonth() !== mo - 1) continue;
      const diff = Math.round((t - monA) / TAG);
      if (diff < -7 || diff > 13) continue;
      const n = new Date(monB + diff * TAG);
      const jj = y ? (y.length === 2 ? pad(n.getUTCFullYear() % 100, 2) : n.getUTCFullYear()) : "";
      return `${pad(n.getUTCDate(), d.length)}.${pad(n.getUTCMonth() + 1, mo.length)}.${jj}`;
    }
    return m;
  });
}

/* ---------- Hintergrundfarben der Tage ---------- */
// Von Hand gesetzte Füllfarbe (bedingte Formatierung passt sich selbst an den Inhalt an und bleibt unberührt)
const farbe = z => {
  const f = (z && z.userEnteredFormat) || {};
  if (!f.backgroundColor && !f.backgroundColorStyle) return { key: "", stil: {} };
  const c = (f.backgroundColorStyle && f.backgroundColorStyle.rgbColor) || f.backgroundColor || {};
  const key = f.backgroundColorStyle && f.backgroundColorStyle.themeColor ? "t:" + f.backgroundColorStyle.themeColor
    : [c.red, c.green, c.blue].map(x => Math.round((x ?? 0) * 255)).join(",");
  const stil = {};
  if (f.backgroundColor) stil.backgroundColor = f.backgroundColor;
  if (f.backgroundColorStyle) stil.backgroundColorStyle = f.backgroundColorStyle;
  return { key: key === "255,255,255" ? "" : key, stil: key === "255,255,255" ? {} : stil };
};
const haeufigste = liste => {
  const n = new Map();
  for (const f of liste) { const e = n.get(f.key) || { f, z: 0 }; e.z++; n.set(f.key, e); }
  return [...n.values()].sort((a, b) => b.z - a.z)[0]?.f || { key: "", stil: {} };
};
// Zellen eines Wochentags: Zeilen-Aufbau = ganze Zeile(n) des Tages, Spalten-Aufbau = Spalte des Tages ab der Tageszeile
function tagZellen(tb, wd, maxR, maxC) {
  const out = [];
  for (const t of tb.tage.filter(t => t.wd === wd)) {
    if (tb.art === "zeilen") { for (let r = t.von; r < t.bis; r++) for (let c = 0; c < maxC; c++) out.push({ r, c, key: c + "|" + (r - t.von) }); }
    else for (let r = tb.ab; r < maxR; r++) out.push({ r, c: t.c, key: String(r) });
  }
  return out;
}
const feiertagWd = mon => {
  const ft = new Map([...feiertage(mon.getUTCFullYear()), ...feiertage(new Date(mon.getTime() + 4 * TAG).getUTCFullYear())]);
  const out = new Map();
  for (let wd = 0; wd < 5; wd++) { const d = isoDate(new Date(mon.getTime() + wd * TAG)); if (ft.has(d)) out.set(wd, { datum: d, name: ft.get(d) }); }
  return out;
};
function lesen(blatt, von, known) {
  const text = fuellen(blatt.rows.map(r => r.map(z => (z && z.formattedValue) || "")), blatt.merges);
  try { return parseWeek(text, known, mondayOf(von.year, von.week)); }
  catch (e) { throw fail(`Blatt „${blatt.title}“: ${e.message}`); }
}
// Farbe, mit der das Büro Feiertage markiert (aus einem Blatt, in dessen Woche ein Feiertag liegt) – sonst null
export function feiertagsFarbe(blatt, von, known) {
  let plan; try { plan = lesen(blatt, von, known); } catch { return null; }
  const ftw = feiertagWd(mondayOf(von.year, von.week));
  if (!ftw.size) return null;
  const eintrag = new Set(plan.eintraege.map(([r, c]) => r + "|" + c));
  const zelle = (r, c) => (blatt.rows[r] || [])[c];
  const maxR = blatt.rows.length, maxC = Math.max(0, ...blatt.rows.map(r => r.length));
  const sammeln = frei => plan.tagBereich.tage.filter(t => ftw.has(t.wd) === frei)
    .flatMap(t => tagZellen(plan.tagBereich, t.wd, maxR, maxC)).filter(x => eintrag.has(x.r + "|" + x.c)).map(x => farbe(zelle(x.r, x.c)));
  const fei = haeufigste(sammeln(true)), normal = haeufigste(sammeln(false));
  return fei.key && fei.key !== normal.key ? fei : null;
}
export function farbeAus(grids, wocheVon, known) {
  for (const g of grids) { const f = feiertagsFarbe(g, wocheVon(g), known); if (f) return f; }
  return null;
}

// blatt: { rows:[[zelle]], merges } (aus gridData); von/nach: { year, week }; zielId: Blatt, das geschrieben wird.
// opt.ftFarbe: Füllfarbe für Feiertage (aus feiertagsFarbe), falls im Blatt selbst kein Feiertag als Muster steht.
// Ergebnis: { requests, feiertage:[{datum,name}], geleert } – Formeln, Formatierung und Namen bleiben unverändert;
// die Füllfarben der Tage werden auf das normale Muster zurückgesetzt, Feiertage bekommen die Feiertagsfarbe.
export function umschreiben(blatt, von, nach, known, zielId, opt = {}) {
  const monAD = mondayOf(von.year, von.week), monBD = mondayOf(nach.year, nach.week);
  const plan = lesen(blatt, von, known);
  const monA = monAD.getTime(), monB = monBD.getTime();
  const eintrag = new Set(plan.eintraege.map(([r, c]) => r + "|" + c));
  // Feiertage der neuen Woche (Mo–Fr) → „Feiertag“ in die erste Zeile jedes Tages
  const ft = new Map([...feiertage(monBD.getUTCFullYear()), ...feiertage(new Date(monB + 4 * TAG).getUTCFullYear())]);
  const ftNeu = new Map(), liste = [];
  for (let wd = 0; wd < 5; wd++) {
    const d = isoDate(new Date(monB + wd * TAG));
    if (!ft.has(d)) continue;
    liste.push({ datum: d, name: ft.get(d) });
    for (const pos of Object.values(plan.zellen)) if (pos[wd]) ftNeu.set(pos[wd][0] + "|" + pos[wd][1], "Feiertag");
  }
  const maxC = Math.max(0, ...blatt.rows.map(r => r.length));
  let geleert = 0;
  const rows = blatt.rows.map((r, ri) => ({
    values: Array.from({ length: maxC }, (_, ci) => {
      const z = r[ci] || {};
      const k = ri + "|" + ci;
      if (eintrag.has(k)) {
        if (String(z.formattedValue || "").trim()) geleert++;
        return ftNeu.has(k) ? { userEnteredValue: { stringValue: ftNeu.get(k) } } : {};
      }
      const out = {};
      if (z.note) out.note = z.note;
      const u = z.userEnteredValue;
      if (!u) return out;
      if (u.formulaValue !== undefined) out.userEnteredValue = { formulaValue: u.formulaValue };
      else if (u.numberValue !== undefined && istDatumsformat(z)) {
        const t = SERIAL0 + Math.round(u.numberValue * TAG);
        const tag = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
        const diff = Math.round((tag - monA) / TAG);
        out.userEnteredValue = (diff >= -7 && diff <= 13)
          ? { numberValue: (monB + diff * TAG - SERIAL0) / TAG + (u.numberValue % 1) } : { numberValue: u.numberValue };
      } else if (u.stringValue !== undefined) out.userEnteredValue = { stringValue: textUmschreiben(u.stringValue, monA, monB, von.year, nach.year) };
      else if (u.numberValue !== undefined) out.userEnteredValue = { numberValue: u.numberValue };
      else if (u.boolValue !== undefined) out.userEnteredValue = { boolValue: u.boolValue };
      return out;
    }),
  }));
  const requests = [];
  // verbundene Zellen im Eintragsbereich (Teams) lösen – im neuen Jahr gibt es andere Teams
  for (const m of blatt.merges || []) {
    let drin = true;
    for (let r = m.startRowIndex; r < m.endRowIndex && drin; r++)
      for (let c = m.startColumnIndex; c < m.endColumnIndex; c++) if (!eintrag.has(r + "|" + c)) { drin = false; break; }
    if (drin) requests.push({ unmergeCells: { range: { ...m, sheetId: zielId } } });
  }
  if (rows.length && maxC) requests.push({ updateCells: {
    range: { sheetId: zielId, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: maxC },
    rows, fields: "userEnteredValue,note",
  } });
  // Füllfarben: normale Tage → häufigste Farbe an dieser Stelle (an Tagen ohne Feiertag), neue Feiertage → Feiertagsmuster
  const tb = plan.tagBereich, maxR = blatt.rows.length;
  const ftAlt = feiertagWd(monAD), ftNeuWd = new Set(liste.map(f => Math.round((Date.parse(f.datum + "T00:00:00Z") - monB) / TAG)));
  const zelle = (r, c) => (blatt.rows[r] || [])[c];
  const normal = new Map(), muster = new Map();
  for (const t of tb.tage) for (const x of tagZellen(tb, t.wd, maxR, maxC)) {
    const ziel = ftAlt.has(t.wd) ? muster : normal;
    (ziel.get(x.key) || ziel.set(x.key, []).get(x.key)).push(farbe(zelle(x.r, x.c)));
  }
  for (const t of tb.tage) for (const x of tagZellen(tb, t.wd, maxR, maxC)) {
    const n = haeufigste(normal.get(x.key) || muster.get(x.key) || []);
    let soll = n;
    if (ftNeuWd.has(t.wd)) {
      if (muster.has(x.key)) soll = haeufigste(muster.get(x.key));
      else if (opt.ftFarbe && eintrag.has(x.r + "|" + x.c)) soll = opt.ftFarbe;
    }
    if (soll.key === farbe(zelle(x.r, x.c)).key) continue;
    requests.push({ updateCells: {
      range: { sheetId: zielId, startRowIndex: x.r, endRowIndex: x.r + 1, startColumnIndex: x.c, endColumnIndex: x.c + 1 },
      rows: [{ values: [{ userEnteredFormat: soll.stil }] }],
      fields: "userEnteredFormat.backgroundColor,userEnteredFormat.backgroundColorStyle",
    } });
  }
  return { requests, feiertage: liste, geleert };
}

/* ---------- Blätter fürs nächste Jahr vorab anlegen ---------- */
const kwBlatt = (meta, week) => findSheet(meta.filter(s => !hatJahr(s)), 0, week);           // „KW n“ ohne Jahr
const jahrBlatt = (meta, year, week) => findSheet(meta.filter(s => s.title.includes(String(year))), year, week);
const neueId = () => 100000000 + Math.floor(Math.random() * 1900000000);

export async function status(env, { heute } = {}) {
  heute = heute || heuteBerlin();
  const basis = await planJahr(env);
  const meta = await sheets(env);
  const naechstes = basis + 1;
  const vorab = meta.filter(s => s.title.includes(String(naechstes))).map(s => s.title);
  const fortschritt = await leseJson(env, "jahreswechsel_lauf").catch(() => null);
  return { planJahr: basis, naechstes, vorab, erlaubt: +heute.slice(0, 4) > basis,
    wochen: meta.filter(s => !hatJahr(s) && /kw|woche/i.test(s.title)).length,
    angefangen: !!(fortschritt && fortschritt.nach === naechstes), letzter: await leseJson(env, "jahreswechsel_letzter").catch(() => null) };
}

// Legt fehlende Blätter an: KW 53 des laufenden Jahres (falls es sie gibt) und KW 1 … bisKw des nächsten Jahres.
export async function vorbereiten(env, { bisKw = VORLAUF_KW, heute } = {}) {
  heute = heute || heuteBerlin();
  const basis = await planJahr(env);
  await setzeWert(env, "wochenplan_jahr", basis);    // festhalten: im Januar gelten die alten Blätter noch für dieses Jahr
  clearCache();
  const meta = await sheets(env);
  const naechstes = basis + 1;
  const auftraege = [];   // { src, titel, von, nach, index }
  // neue Blätter direkt hinter das letzte Wochenblatt (KW 52/53), nicht hinter andere Blätter
  let hinten = Math.max(-1, ...meta.filter(s => /kw|woche/i.test(s.title)).map(s => s.index)) + 1;
  if (wochenImJahr(basis) === 53 && !findSheet(meta, basis, 53, basis)) {
    const src = kwBlatt(meta, 52);
    if (src) auftraege.push({ src, titel: /52/.test(src.title) ? src.title.replace(/52/, "53") : "KW 53", von: { year: basis, week: 52 }, nach: { year: basis, week: 53 }, index: src.index + 1 });
  }
  const fehler = [];
  for (let w = 1; w <= bisKw; w++) {
    if (jahrBlatt(meta, naechstes, w)) continue;
    const src = kwBlatt(meta, w);
    if (!src) { fehler.push(`KW ${w}: kein Vorlage-Blatt „KW ${w}“`); continue; }
    auftraege.push({ src, titel: `${src.title.trim()} ${naechstes}`, von: { year: basis, week: w }, nach: { year: naechstes, week: w }, index: null });
  }
  const known = (await users(env)).map(u => u.plan).filter(Boolean);
  // einmalig: Füllfarben in schon angelegten Blättern des nächsten Jahres richten (ältere Version kopierte z. B. das Neujahrs-Gelb mit)
  const flag = "wochenplan_farben_" + naechstes;
  let farbenKorrigiert = 0;
  if (!(await one(env, "SELECT 1 x FROM einstellungen WHERE schluessel = ?", flag))) {
    const da = [];
    for (let w = 1; w <= bisKw; w++) { const s = jahrBlatt(meta, naechstes, w); if (s) da.push({ s, w }); }
    if (da.length) {
      const gs = await gridData(env, da.map(d => d.s));
      const req = [];
      for (const d of da) {
        const g = gs.find(x => x.id === d.s.id);
        try {
          const r = umschreiben(g, { year: naechstes, week: d.w }, { year: naechstes, week: d.w }, known, g.id).requests
            .filter(q => q.updateCells && q.updateCells.fields.includes("backgroundColor"));
          req.push(...r); if (r.length) farbenKorrigiert++;
        } catch { /* Blatt ohne erkennbaren Aufbau: nichts tun */ }
      }
      await batchUpdate(env, req);
    }
    await setzeWert(env, flag, "1");
  }
  if (!auftraege.length) return { angelegt: [], fehler, planJahr: basis, farbenKorrigiert };
  const grids = await gridData(env, [...new Set(auftraege.map(a => a.src))]);
  const ftFarbe = farbeAus(grids, g => auftraege.find(a => a.src.id === g.id).von, known);
  const angelegt = [], feiertageAlle = [];
  let verschoben = 0;
  for (const a of auftraege) {
    const g = grids.find(x => x.id === a.src.id);
    const id = neueId();
    const idx = a.index !== null ? a.index : hinten + verschoben;
    const u = umschreiben(g, a.von, a.nach, known, id, { ftFarbe });
    await batchUpdate(env, [{ duplicateSheet: { sourceSheetId: a.src.id, insertSheetIndex: idx, newSheetId: id, newSheetName: a.titel } }, ...u.requests]);
    verschoben++;
    angelegt.push(a.titel);
    feiertageAlle.push(...u.feiertage);
  }
  return { angelegt, fehler, feiertage: feiertageAlle, planJahr: basis, farbenKorrigiert };
}

// Zeitplan (täglich): ab November die ersten Wochen des nächsten Jahres bereitstellen
export async function taeglich(env, { heute } = {}) {
  heute = heute || heuteBerlin();
  const basis = await planJahr(env);
  if (+heute.slice(0, 4) !== basis || +heute.slice(5, 7) < AB_MONAT) return null;
  return vorbereiten(env, { heute });
}

/* ---------- Neues Jahr beginnen ---------- */
// sp: SharePoint-Ablage (im Test austauschbar)
export async function neuesJahr(env, wer, { heute, sp } = {}) {
  heute = heute || heuteBerlin();
  const basis = await planJahr(env);
  const nach = basis + 1;
  if (+heute.slice(0, 4) <= basis) throw fail(`Das neue Jahr kann erst ab dem 1. Januar ${nach} begonnen werden`);
  sp = sp || { speichern: (name, bytes) => upload(env, ordner(env), name, bytes, "rename") };
  let lauf = await leseJson(env, "jahreswechsel_lauf");
  if (!lauf || lauf.nach !== nach) lauf = { nach, gesichert: "", erledigt: [], wer, start: heute };
  clearCache();
  let meta = await sheets(env);
  const known = (await users(env)).map(u => u.plan).filter(Boolean);
  const alte = meta.filter(s => !hatJahr(s) && /kw|woche|^\s*\d{1,2}\s*$/i.test(s.title));
  if (!alte.length && !lauf.erledigt.length) throw fail("Keine Wochenblätter (KW …) in der Tabelle gefunden");

  // 1. Sicherung (einmal je Jahreswechsel)
  if (!lauf.gesichert) {
    let name, bytes, hinweis = "";
    try {
      bytes = await exportXlsx(env);
      name = `Wochenplan_${basis}_Sicherung_${heute}.xlsx`;
    } catch (e) {
      // ohne Drive-Zugriff: alle Wochenblätter mit Inhalt, Formeln und Notizen als Datei
      const g = await gridData(env, meta);
      bytes = new TextEncoder().encode(JSON.stringify({ app: "airtec-kapp", wochenplan: basis, erstellt: heute, blaetter: g }));
      name = `Wochenplan_${basis}_Sicherung_${heute}.json`;
      hinweis = e.message;
    }
    try { await sp.speichern(name, bytes); }
    catch (e) { throw fail("Sicherung konnte nicht gespeichert werden – es wurde nichts geändert: " + e.message, 500); }
    lauf.gesichert = name; lauf.hinweis = hinweis;
    await setzeWert(env, "jahreswechsel_lauf", JSON.stringify(lauf));
  }

  // 2. Wochenblätter umschreiben
  const n = wochenImJahr(nach);
  const ergebnis = { umgeschrieben: 0, uebernommen: [], angelegt: [], feiertage: [], geleert: 0 };
  const offen = [];
  for (let w = 1; w <= Math.max(n, 53); w++) if (!lauf.erledigt.includes(w)) offen.push(w);
  const gridsNoetig = offen.map(w => kwBlatt(meta, w)).filter(Boolean);
  if (n === 53 && !kwBlatt(meta, 53)) { const s52 = kwBlatt(meta, 52); if (s52) gridsNoetig.push(s52); }
  const grids = await gridData(env, [...new Set(gridsNoetig)]);
  const wocheVonId = new Map();
  for (let w = 53; w >= 1; w--) { const s = kwBlatt(meta, w); if (s) wocheVonId.set(s.id, w); }
  const ftFarbe = farbeAus(grids, g => ({ year: basis, week: wocheVonId.get(g.id) || 1 }), known);
  const gridVon = s => grids.find(g => g.id === s.id);
  for (const w of offen) {
    // Wiederaufnahme: wurde diese Woche schon übernommen, aber der Fortschritt nicht mehr gespeichert?
    // (vorab angelegtes Blatt trägt dann schon den Namen ohne Jahreszahl – nicht noch einmal umschreiben/leeren)
    const ia = lauf.inArbeit;
    if (ia && ia.w === w && meta.some(s => s.id === ia.id && !s.title.includes(String(nach)))) {
      ergebnis.uebernommen.push(meta.find(s => s.id === ia.id).title);
      lauf.erledigt.push(w); delete lauf.inArbeit;
      await setzeWert(env, "jahreswechsel_lauf", JSON.stringify(lauf));
      continue;
    }
    const alt = kwBlatt(meta, w), neu = jahrBlatt(meta, nach, w);
    const req = [];
    if (w > n) {
      // z. B. KW 53 des alten Jahres, die es im neuen Jahr nicht gibt: Jahreszahl anhängen, Inhalt bleibt lesbar
      if (alt) req.push({ updateSheetProperties: { properties: { sheetId: alt.id, title: `${alt.title.trim()} ${basis}` }, fields: "title" } });
    } else if (neu) {
      // vorab angelegtes Blatt übernimmt Namen und Platz des alten
      const titel = alt ? alt.title : neu.title.replace(new RegExp("\\s*" + nach), "").trim();
      if (alt) req.push({ deleteSheet: { sheetId: alt.id } });
      req.push({ updateSheetProperties: { properties: { sheetId: neu.id, title: titel, ...(alt ? { index: alt.index } : {}) }, fields: alt ? "title,index" : "title" } });
      ergebnis.uebernommen.push(titel);
    } else if (alt) {
      const u = umschreiben(gridVon(alt), { year: basis, week: w }, { year: nach, week: w }, known, alt.id, { ftFarbe });
      req.push(...u.requests);
      ergebnis.umgeschrieben++; ergebnis.geleert += u.geleert; ergebnis.feiertage.push(...u.feiertage);
    } else {
      const src = kwBlatt(meta, 52);
      if (src && gridVon(src)) {
        const id = neueId(), titel = /52/.test(src.title) ? src.title.replace(/52/, "53") : `KW ${w}`;
        const u = umschreiben(gridVon(src), { year: basis, week: 52 }, { year: nach, week: w }, known, id, { ftFarbe });
        req.push({ duplicateSheet: { sourceSheetId: src.id, insertSheetIndex: src.index + 1, newSheetId: id, newSheetName: titel }, }, ...u.requests);
        ergebnis.angelegt.push(titel); ergebnis.feiertage.push(...u.feiertage);
      }
    }
    if (req.length) {
      if (neu && w <= n) { lauf.inArbeit = { w, id: neu.id }; await setzeWert(env, "jahreswechsel_lauf", JSON.stringify(lauf)); }
      try { await batchUpdate(env, req); }
      catch (e) {
        await setzeWert(env, "jahreswechsel_lauf", JSON.stringify(lauf));
        throw fail(`Abgebrochen bei KW ${w}: ${e.message}. Bereits umgestellte Wochen bleiben so – „Neues Jahr beginnen“ noch einmal tippen setzt hier fort.`, 502);
      }
      if (req.some(r => r.deleteSheet || r.updateSheetProperties)) { clearCache(); meta = await sheets(env); }
    }
    lauf.erledigt.push(w); delete lauf.inArbeit;
    await setzeWert(env, "jahreswechsel_lauf", JSON.stringify(lauf));   // nach jeder Woche – bei Abbruch geht es genau hier weiter
  }
  await setzeWert(env, "wochenplan_jahr", nach);
  const letzter = { von: basis, nach, am: heute, wer, sicherung: lauf.gesichert, hinweis: lauf.hinweis || "" };
  await setzeWert(env, "jahreswechsel_letzter", JSON.stringify(letzter));
  await run(env, "DELETE FROM einstellungen WHERE schluessel = 'jahreswechsel_lauf'");
  clearCache();
  return { ...ergebnis, ...letzter };
}
