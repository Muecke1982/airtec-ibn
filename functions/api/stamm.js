import { auth } from "../../lib/auth.js";
import { cfg, download, json } from "../../lib/graph.js";
import { stammAusDb } from "../../lib/stamm.js";

// Stammdaten liefern: aus der Datenbank als JSON – solange dort noch nichts ist (oder mit ?quelle=excel)
// die Excel-Datei aus SharePoint, die die App selbst ausliest.
export async function onRequestGet({ request, env }) {
  try {
    if (!(await auth(env, request))) return json(401, { error: "Nicht angemeldet" });
    if (new URL(request.url).searchParams.get("quelle") !== "excel") {
      const st = await stammAusDb(env);
      if (st) return json(200, { quelle: "datenbank", stamm: st });
    }
    const bytes = await download(env, cfg(env, "SP_STAMM_PATH"));
    return new Response(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" } });
  } catch (e) {
    return json(e.status === 404 ? 404 : 500, { error: e.status === 404 ? "Stammdaten-Datei in SharePoint nicht gefunden" : e.message });
  }
}
