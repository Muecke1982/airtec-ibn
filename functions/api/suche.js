import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { suche } from "../../lib/suche.js";

// Suche: GET ?q=…  →  { personen, autos }
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    return json(200, await suche(env, new URL(request.url).searchParams.get("q")));
  } catch (e) { console.error(e); return json(500, { error: e.message }); }
}
