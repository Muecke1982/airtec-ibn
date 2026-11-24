import { darf } from "../../lib/rechte.js";
import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { vorschlaege, uebersicht, mappe, aktion } from "../../lib/baustellen.js";

// Baustellen sehen alle mit Wochenplan, Protokollen oder Planänderung
const zugang = me => darf(me, "wochenplan") || darf(me, "protokolle") || darf(me, "plan_aendern") || darf(me, "maschinen");

// GET ?vorschlaege=1 → Baustellen aus dem Wochenplan (letzte 5 Monate) · ?id=N → eine Mappe · sonst offene Mappen (?geschlossen=1)
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    if (!zugang(me)) return json(403, { error: "Kein Zugriff auf die Baustellen" });
    const q = new URL(request.url).searchParams;
    if (q.get("vorschlaege")) {
      let list = [], fehler = "";
      try { list = await vorschlaege(env, { frisch: q.get("frisch") === "1" }); } catch (e) { console.error(e); fehler = e.message; }
      return json(200, { vorschlaege: list, fehler });
    }
    if (q.get("id")) return json(200, { mappe: await mappe(env, q.get("id")) });
    return json(200, { mappen: await uebersicht(env, { geschlossen: q.get("geschlossen") === "1" }) });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// POST { aktion: "eintrag", baustelle | id, text, reminder } | { aktion: "erledigt", eintrag, ja } | { aktion: "loeschen", eintrag }
//      { aktion: "reminder", eintrag, ja } | { aktion: "schliessen", id, ordner, url } | { aktion: "oeffnen", id } | { aktion: "umbenennen", id, name }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    if (!zugang(me)) return json(403, { error: "Kein Zugriff auf die Baustellen" });
    return json(200, { mappe: await aktion(env, me, await request.json().catch(() => ({}))) });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
