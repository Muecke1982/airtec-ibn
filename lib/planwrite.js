// Einträge in den Wochenplan (Google-Tabelle) schreiben – genutzt von /api/plan (Änderungen) und /api/urlaub.
// list: [{ datum:"2026-11-10", name:"Nick Pauls", wert:"Krank", notiz?: "…" }]
// Rückgabe: { cells, fehler, vorher: { "name|datum": alterWert } } – geschrieben wird nur, wenn keine Fehler
// auftreten oder teilweise=true ist.
import { users } from "./auth.js";
import { sheets, sheetValues, writeCells, clearCache } from "./google.js";
import { isoWeek, mondayOf, findSheet, parseWeek } from "./wochenplan.js";

export async function writePlan(env, list, teilweise = false) {
  clearCache();
  const known = (await users(env)).map(u => u.plan);
  const meta = await sheets(env);
  const byWeek = new Map();
  const cells = [], fehler = [], vorher = {};
  for (const a of list) {
    const d = new Date(String(a.datum) + "T12:00:00Z");
    if (isNaN(d)) { fehler.push(`${a.datum}: Datum ungültig`); continue; }
    const { year, week } = isoWeek(d);
    const key = year + "-" + week;
    if (!byWeek.has(key)) {
      const sh = findSheet(meta, year, week);
      byWeek.set(key, sh ? { sh, plan: parseWeek(await sheetValues(env, sh), known, mondayOf(year, week)) } : null);
    }
    const W = byWeek.get(key);
    if (!W) { fehler.push(`KW ${week}: kein Blatt in der Tabelle`); continue; }
    const wd = (d.getUTCDay() + 6) % 7;
    const pos = W.plan.zellen[a.name] && W.plan.zellen[a.name][wd];
    if (!pos) { fehler.push(`${a.name} am ${a.datum}: Zelle nicht gefunden`); continue; }
    const [row, col] = pos;
    const m = (W.sh.merges || []).find(x => row >= x.startRowIndex && row < x.endRowIndex && col >= x.startColumnIndex && col < x.endColumnIndex
      && (x.endRowIndex - x.startRowIndex > 1 || x.endColumnIndex - x.startColumnIndex > 1));
    if (m) { fehler.push(`${a.name} am ${a.datum}: Zelle ist mit anderen verbunden – bitte in der Tabelle ändern`); continue; }
    const t = (W.plan.tage || []).find(x => x.datum === a.datum);
    vorher[a.name + "|" + a.datum] = (t && t.e && t.e[a.name]) || "";
    const c = { sheetId: W.sh.id, row, col, value: String(a.wert ?? "").trim() };
    if (typeof a.notiz === "function") c.note = String(a.notiz(vorher[a.name + "|" + a.datum]));
    else if (a.notiz !== undefined) c.note = String(a.notiz);
    cells.push(c);
  }
  if (fehler.length && !teilweise) return { cells: [], fehler, vorher, abgebrochen: true };
  if (cells.length) await writeCells(env, cells);
  return { cells, fehler, vorher };
}
