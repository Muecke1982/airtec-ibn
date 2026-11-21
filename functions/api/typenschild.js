import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { erkennen } from "../../lib/typenschild.js";

// POST { bild: "data:image/jpeg;base64,…" } → erkannte Angaben vom Typenschild
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    const b = await request.json().catch(() => ({}));
    return json(200, await erkennen(env, b.bild));
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return json(e.status || 500, { error: e.message });
  }
}
