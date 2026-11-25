// Einträge in den Wochenplan (Google-Tabelle) schreiben – genutzt von /api/plan (Änderungen) und /api/urlaub.
// list: [{ datum:"2026-11-10", name:"Nick Pauls", wert:"Krank", notiz?: "…" }]
// Rückgabe: { cells, fehler, vorher: { "name|datum": alterWert } } – geschrieben wird nur, wenn keine Fehler
// auftreten oder teilweise=true ist.
import { users } from "./auth.js";
import { sheets, sheetValues, writeCells, clearCache } from "./google.js";
import { isoWeek, mondayOf, findSheet, parseWeek } from "./wochenplan.js";
import { planJahr } from "./jahreswechsel.js";

// opt.basis: Jahr, für das Blätter ohne Jahreszahl im Namen gelten (sonst würde ins alte Blatt geschrieben)
// opt.format(datum, wert): Zellinhalt zum Eintrag (z. B. Überschrift + Projekt-Nr. + Info untereinander)
// opt.auffrischen: Tage, an denen auch alle übrigen Zellen neu formatiert werden (z. B. nach geänderten Angaben)
// opt.betroffen(datum, wert): nur diese übrigen Zellen anfassen (z. B. nur Überschriften mit Angaben in der App)
// a.skip(alterWert) → true: Zelle nicht anfassen (zählt als „übersprungen“)
export async function writePlan(env, list, teilweise = false, opt = {}) {
  clearCache();
  const basis = opt.basis || await planJahr(env);
  const known = (await users(env)).map(u => u.plan);
  const meta = await sheets(env);
  const format = typeof opt.format === "function" ? opt.format : (d, w) => w;
  const byWeek = new Map();
  const cells = [], fehler = [], vorher = {}, erledigt = new Set();
  let uebersprungen = 0;
  async function woche(d) {
    const { year, week } = isoWeek(d);
    const key = year + "-" + week;
    if (!byWeek.has(key)) {
      const sh = findSheet(meta, year, week, basis);
      const rows = sh ? await sheetValues(env, sh) : null;
      byWeek.set(key, sh ? { sh, rows, plan: parseWeek(rows, known, mondayOf(year, week)) } : null);
    }
    return { W: byWeek.get(key), year, week };
  }
  const verbunden = (W, row, col) => (W.sh.merges || []).some(x => row >= x.startRowIndex && row < x.endRowIndex && col >= x.startColumnIndex && col < x.endColumnIndex
    && (x.endRowIndex - x.startRowIndex > 1 || x.endColumnIndex - x.startColumnIndex > 1));
  for (const a of list) {
    const d = new Date(String(a.datum) + "T12:00:00Z");
    if (isNaN(d)) { fehler.push(`${a.datum}: Datum ungültig`); continue; }
    const { W, year, week } = await woche(d);
    if (!W) { fehler.push(`KW ${week}${year !== basis ? "/" + year : ""}: kein Blatt in der Tabelle`); continue; }
    const wd = (d.getUTCDay() + 6) % 7;
    const pos = W.plan.zellen[a.name] && W.plan.zellen[a.name][wd];
    if (!pos) { fehler.push(`${a.name} am ${a.datum}: Zelle nicht gefunden`); continue; }
    const [row, col] = pos;
    if (verbunden(W, row, col)) { fehler.push(`${a.name} am ${a.datum}: Zelle ist mit anderen verbunden – bitte in der Tabelle ändern`); continue; }
    const t = (W.plan.tage || []).find(x => x.datum === a.datum);
    vorher[a.name + "|" + a.datum] = (t && t.e && t.e[a.name]) || "";
    erledigt.add(a.name + "|" + a.datum);
    if (typeof a.skip === "function" && a.skip(vorher[a.name + "|" + a.datum])) { uebersprungen++; continue; }
    const c = { sheetId: W.sh.id, row, col, value: format(a.datum, String(a.wert ?? "").trim()), datum: a.datum };
    if (typeof a.notiz === "function") c.note = String(a.notiz(vorher[a.name + "|" + a.datum]));
    else if (a.notiz !== undefined) c.note = String(a.notiz);
    cells.push(c);
  }
  // übrige Zellen der Tage neu formatieren (nur einfache Einträge, deren Inhalt sich dadurch ändert)
  for (const datum of opt.auffrischen || []) {
    const d = new Date(String(datum) + "T12:00:00Z");
    if (isNaN(d)) continue;
    const { W } = await woche(d);
    if (!W) continue;
    const wd = (d.getUTCDay() + 6) % 7;
    const t = (W.plan.tage || []).find(x => x.datum === datum);
    for (const [name, z] of Object.entries(W.plan.zellen)) {
      const cur = (t && t.e && t.e[name]) || "", pos = z[wd];
      if (!cur || !pos || cur.includes(" · ") || erledigt.has(name + "|" + datum)) continue;
      if (typeof opt.betroffen === "function" && !opt.betroffen(datum, cur)) continue;   // keine Angaben in der App → Zelle so lassen
      const [row, col] = pos, soll = format(datum, cur);
      if (String((W.rows[row] || [])[col] || "").trim() === soll || verbunden(W, row, col)) continue;
      cells.push({ sheetId: W.sh.id, row, col, value: soll, datum });
    }
  }
  if (fehler.length && !teilweise) return { cells: [], fehler, vorher, abgebrochen: true };
  if (cells.length) await writeCells(env, cells);
  return { cells, fehler, vorher, uebersprungen };
}
