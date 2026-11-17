import { darf } from "../../lib/rechte.js";
import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, act, canSend } from "../../lib/lager.js";

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    if (!darf(me, "lager") && !darf(me, "lager_bestellen")) return json(403, { error: "Kein Zugriff auf das Lager" });
    const out = await list(env, me);
    if (darf(me, "lager_bestellen")) out.direktSenden = canSend(env);
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
    if (!darf(me, "lager") && !darf(me, "lager_bestellen")) return json(403, { error: "Kein Zugriff auf das Lager" });
    const out = await act(env, me, await request.json().catch(() => ({})));
    if (darf(me, "lager_bestellen")) out.direktSenden = canSend(env);
    return json(200, out);
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
