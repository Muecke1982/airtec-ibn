import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { sheets, sheetValues, writeCells, clearCache } from "../../lib/google.js";
import { isoWeek, mondayOf, findSheet, parseWeek } from "../../lib/wochenplan.js";

// Einträge im Wochenplan ändern (nur mit Schreibrecht).
// POST { aenderungen: [{ datum:"2026-11-10", name:"Nick Pauls", wert:"Krank", notiz?: "vorher: Bochum" }] }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    if (!me.schreiben) return json(403, { error: "Keine Schreibberechtigung" });
    const b = await request.json().catch(() => ({}));
    const list = Array.isArray(b.aenderungen) ? b.aenderungen : [];
    if (!list.length || list.length > 60) return json(400, { error: "Keine oder zu viele Änderungen" });

    clearCache();
    const all = await users(env);
    const known = all.map(u => u.plan);
    const meta = await sheets(env);
    const byWeek = new Map();
    const cells = [], fehler = [];
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
      const c = { sheetId: W.sh.id, row, col, value: String(a.wert ?? "").trim() };
      if (a.notiz !== undefined) c.note = String(a.notiz);
      cells.push(c);
    }
    if (fehler.length && !b.teilweise) return json(409, { error: fehler.join("; "), fehler });
    await writeCells(env, cells);
    return json(200, { ok: true, geschrieben: cells.length, fehler, von: me.name });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}
