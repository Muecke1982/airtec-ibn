import { auth } from "../../lib/auth.js";
import { users, zugangPath } from "../../lib/auth.js";
import { sheets, sheetValues, saEmail } from "../../lib/google.js";
import { isoWeek, mondayOf, findSheet, parseWeek, matchName } from "../../lib/wochenplan.js";
import { cfg, drive, download, upload, json } from "../../lib/graph.js";

// Einrichtungs-Test: /api/status?code=FIRMENCODE
export async function onRequestGet({ request, env }) {
  try { if (!(await auth(env, request, true))) return json(401, { error: "Nicht angemeldet / Code falsch" }); }
  catch (e) { return json(500, { error: e.message }); }
  const out = {};
  try {
    const d = await drive(env);
    out.sharepoint = `OK – Website „${d.siteName}“, Bibliothek „${d.driveName}“`;
  } catch (e) { out.sharepoint = "FEHLER: " + e.message; return json(200, out); }
  out.ordner = cfg(env, "SP_FOLDER", false) || "FEHLER: SP_FOLDER fehlt";
  try { await download(env, cfg(env, "SP_STAMM_PATH")); out.stammdaten = "OK"; } catch (e) { out.stammdaten = "FEHLER: " + e.message; }
  try {
    const u = await users(env, true);
    out.zugaenge = `OK – ${u.length} Personen, ${u.filter(x => x.write).length} mit Schreibrecht (${zugangPath(env)})`;
  } catch (e) { out.zugaenge = "FEHLER: " + e.message + " (" + zugangPath(env) + ")"; }
  try {
    const s = await sheets(env);
    out.wochenplan = `OK – ${s.length} Blätter in der Google-Tabelle`;
    out.blaetter = s.slice(0, 8).map(x => x.title).join(" | ") + (s.length > 8 ? " | …" : "");
    const { year, week } = isoWeek(new Date());
    const sh = findSheet(s, year, week);
    out.diese_woche = sh ? `KW ${week} → Blatt „${sh.title}“` : `KW ${week}: kein passendes Blatt gefunden`;
    if (sh) {
      const rows = await sheetValues(env, sh);
      out.blatt_anfang = rows.slice(0, 6).map(r => r.slice(0, 8).join(" ¦ ")).join("  //  ");
      try {
        const all = await users(env);
        const known = all.map(u => u.plan);
        const p = parseWeek(rows, known, mondayOf(year, week));
        out.spalten = p.spalten.join(", ");
        out.tage = p.tage.map(t => t.datum + ": " + Object.keys(t.e).length + " Einträge").join(", ");
        out.zuordnung = all.map(u => u.name + " → " + (matchName(u, p.spalten) || "NICHT GEFUNDEN")).join(", ");
        out.ohne_zugang = p.spalten.filter(n => !all.some(u => matchName(u, p.spalten) === n)).join(", ");
      } catch (e) { out.auslesen = "FEHLER: " + e.message; }
    }
  } catch (e) {
    let who = ""; try { who = " – Dienstkonto: " + saEmail(env); } catch {}
    out.wochenplan = "FEHLER: " + e.message + who;
  }
  try {
    const { list: lagerList, path: lagerPath } = await import("../../lib/lager.js");
    const L = await lagerList(env, { name: "Status", schreiben: true }, true);
    out.lager = `OK – ${L.kats.length} Kategorien, ${L.arts.length} Artikel, ${L.arts.filter(a => a.offen).length} offen gemeldet (${lagerPath(env)})`;
  } catch (e) { out.lager = "FEHLER: " + e.message; }
  if (new URL(request.url).searchParams.get("schreibtest") === "ja") {
    try {
      const pdf = new TextEncoder().encode("%PDF-1.4\n% Airtec IBN Schreibtest – Datei kann gelöscht werden\n" + " ".repeat(200) + "\n%%EOF");
      const r = await upload(env, cfg(env, "SP_FOLDER").replace(/^\/+|\/+$/g, ""), "_Schreibtest.pdf", pdf);
      out.schreibtest = "OK – Datei " + r.name + " angelegt (kann gelöscht werden)";
    } catch (e) { out.schreibtest = "FEHLER: " + e.message; }
  }
  return json(200, out);
}
