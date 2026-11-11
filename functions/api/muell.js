import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { status, anfordern } from "../../lib/muell.js";

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    return json(200, await status(env));
  } catch (e) { console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); }
}

// POST { trotzdem?: true }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    return json(200, await anfordern(env, me, await request.json().catch(() => ({}))));
  } catch (e) { console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message, schon: !!e.schon }); }
}
