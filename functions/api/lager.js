import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, act, canSend } from "../../lib/lager.js";

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const out = await list(env, me);
    if (me.schreiben) out.direktSenden = canSend(env);
    return json(200, out);
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// POST { aktion: "melden", nr, status } | { aktion: "zurueck", nr } | { aktion: "abhaken", nrs } |
//      { aktion: "bestellt", lieferant, nrs, mengen, senden?, an, cc, betreff, text }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const out = await act(env, me, await request.json().catch(() => ({})));
    if (me.schreiben) out.direktSenden = canSend(env);
    return json(200, out);
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
