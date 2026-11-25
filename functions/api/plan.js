import { darf } from "../../lib/rechte.js";
import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { writePlan } from "../../lib/planwrite.js";
import { speichern as einsaetzeSpeichern, laden as einsaetzeLaden, anwenden, zelleTag } from "../../lib/einsaetze.js";
import { norm } from "../../lib/wochenplan.js";
import { teile } from "../../lib/baustellen.js";
import { resetVorschlaege } from "../../lib/baustellen.js";

// Einträge im Wochenplan ändern (nur mit Schreibrecht).
// POST { aenderungen: [{ datum:"2026-11-10", name:"Nick Pauls", wert:"Krank", notiz?: "vorher: Bochum" }],
//        einsaetze?: [{ datum, titel, art, nummer, info, fix }], ersetzen?: ["2026-11-10"] }
// einsaetze = Zusatzangaben je Tag und Überschrift (lib/einsaetze.js); ersetzen = Tage, deren übrige Angaben wegfallen.
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    if (!darf(me, "plan_aendern")) return json(403, { error: "Keine Schreibberechtigung" });
    const b = await request.json().catch(() => ({}));
    const list = Array.isArray(b.aenderungen) ? b.aenderungen : [];
    const ein = Array.isArray(b.einsaetze) ? b.einsaetze : [], ers = Array.isArray(b.ersetzen) ? b.ersetzen : [];
    if ((!list.length && !ein.length && !ers.length) || list.length > 80 || ein.length > 200) return json(400, { error: "Keine oder zu viele Änderungen" });
    // Zellen: Überschrift, darunter Projekt-/KD-Nr. und Info (zur Nachverfolgung in der Tabelle)
    const tage = [...new Set([...list.map(a => a && a.datum), ...ein.map(e => e && e.datum), ...ers])]
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))).sort();
    let meta = {}, alt = {};
    if (tage.length) { alt = await einsaetzeLaden(env, tage[0], tage[tage.length - 1]); meta = anwenden(alt, ein, ers); }
    const format = (d, w) => zelleTag(w, meta[d] || {});
    // übrige Zellen nur neu schreiben, wenn es zu dieser Überschrift Angaben in der App gibt oder gab –
    // sonst bleiben z. B. von Hand in die Tabelle geschriebene Projekt-Nummern stehen
    const betroffen = (d, w) => [w, ...teile(w)].some(t => (alt[d] || {})[norm(t)] || (meta[d] || {})[norm(t)]);
    let r = { cells: [], fehler: [] };
    if (list.length || tage.length) {
      r = await writePlan(env, list, !!b.teilweise, { format, auffrischen: tage, betroffen });
      if (r.abgebrochen) return json(409, { error: r.fehler.join("; "), fehler: r.fehler });
    }
    if (ein.length || ers.length) await einsaetzeSpeichern(env, me.name, ein, ers);
    resetVorschlaege();
    return json(200, { ok: true, geschrieben: r.cells.length, fehler: r.fehler, von: me.name });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}
