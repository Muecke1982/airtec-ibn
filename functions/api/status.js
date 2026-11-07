import { cfg, checkCode, drive, download, json } from "../../lib/graph.js";

// Einrichtungs-Test: /api/status?code=FIRMENCODE
export async function onRequestGet({ request, env }) {
  try { if (!checkCode(env, request, true)) return json(401, { error: "Firmen-Code falsch" }); }
  catch (e) { return json(500, { error: e.message }); }
  const out = {};
  try {
    const d = await drive(env);
    out.sharepoint = `OK – Website „${d.siteName}“, Bibliothek „${d.driveName}“`;
  } catch (e) { out.sharepoint = "FEHLER: " + e.message; return json(200, out); }
  out.ordner = cfg(env, "SP_FOLDER", false) || "FEHLER: SP_FOLDER fehlt";
  try { await download(env, cfg(env, "SP_STAMM_PATH")); out.stammdaten = "OK"; } catch (e) { out.stammdaten = "FEHLER: " + e.message; }
  return json(200, out);
}
