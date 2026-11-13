import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { writePlan } from "../../lib/planwrite.js";

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
    const r = await writePlan(env, list, !!b.teilweise);
    if (r.abgebrochen) return json(409, { error: r.fehler.join("; "), fehler: r.fehler });
    return json(200, { ok: true, geschrieben: r.cells.length, fehler: r.fehler, von: me.name });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}
