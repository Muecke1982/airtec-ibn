import { auth } from "../../lib/auth.js";
import { cfg, upload, cleanName, json } from "../../lib/graph.js";
const MAX = 60 * 1024 * 1024;

// PDF-Protokoll in SharePoint ablegen
export async function onRequestPost({ request, env }) {
  try {
    if (!(await auth(env, request))) return json(401, { error: "Nicht angemeldet" });
    const q = new URL(request.url).searchParams;
    let filename = cleanName(q.get("name"));
    if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF") return json(400, { error: "Keine gültige PDF-Datei" });
    if (bytes.length > MAX) return json(413, { error: "Datei zu groß" });
    let folder = cfg(env, "SP_FOLDER").replace(/^\/+|\/+$/g, "");
    const proj = cleanName(q.get("projekt"));
    if (cfg(env, "SP_PROJECT_SUBFOLDER", false).toLowerCase() === "ja" && proj) folder += "/" + proj;
    const item = await upload(env, folder, filename, bytes);
    console.log(`Protokoll gespeichert: ${folder}/${item.name} (${q.get("monteur") || "?"})`);
    return json(200, { ok: true, name: item.name, folder, webUrl: item.webUrl });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}
