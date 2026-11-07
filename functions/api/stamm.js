import { cfg, checkCode, download, json } from "../../lib/graph.js";

// Stammdaten-Excel aus SharePoint liefern
export async function onRequestGet({ request, env }) {
  try {
    if (!checkCode(env, request)) return json(401, { error: "Firmen-Code falsch" });
    const bytes = await download(env, cfg(env, "SP_STAMM_PATH"));
    return new Response(bytes, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" } });
  } catch (e) {
    return json(e.status === 404 ? 404 : 500, { error: e.status === 404 ? "Stammdaten-Datei in SharePoint nicht gefunden" : e.message });
  }
}
