import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, act } from "../../lib/hinweise.js";

const names = async env => (await users(env)).map(u => u.name);

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    return json(200, await list(env, me, await names(env)));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// POST { aktion: "erledigt", id } | { aktion: "neu", an, text, ab? } | { aktion: "loeschen", id }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const b = await request.json().catch(() => ({}));
    return json(200, await act(env, me, await names(env), b));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
