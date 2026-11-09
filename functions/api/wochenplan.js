import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { sheets, sheetValues } from "../../lib/google.js";
import { isoWeek, mondayOf, isoDate, findSheet, parseWeek, matchName } from "../../lib/wochenplan.js";

// Wochenplan einer Kalenderwoche: /api/wochenplan?datum=2026-11-09  oder  ?jahr=2026&kw=46
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    const q = new URL(request.url).searchParams;
    let year = +q.get("jahr"), week = +q.get("kw");
    if (!year || !week) {
      const d = q.get("datum") ? new Date(q.get("datum") + "T12:00:00Z") : new Date();
      if (isNaN(d)) return json(400, { error: "Datum ungültig" });
      ({ year, week } = isoWeek(d));
    }
    const monday = mondayOf(year, week);
    const list = await sheets(env);
    const sh = findSheet(list, year, week);
    if (!sh) return json(200, { jahr: year, kw: week, montag: isoDate(monday), fehlt: true, spalten: [], tage: [] });
    const all = await users(env);
    const plan = parseWeek(await sheetValues(env, sh), all.map(u => u.plan), monday);
    const ich = me.legacy ? "" : matchName(me, plan.spalten);
    const { zellen, ...rest } = plan;
    return json(200, { jahr: year, kw: week, montag: isoDate(monday), blatt: sh.title, ich, ...rest, stand: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}
