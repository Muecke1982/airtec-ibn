import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, act, birthdays } from "../../lib/hinweise.js";

const names = async env => (await users(env)).map(u => u.name);
const geb = async env => birthdays(await users(env));

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const out = await list(env, me, await names(env));
    out.geburtstage = (await geb(env)).map(g => ({ name: g.name, wann: g.wann, ich: g.name.toLowerCase() === me.name.toLowerCase() }));
    return json(200, out);
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
    b.geburtstage = await geb(env);
    const out = await act(env, me, await names(env), b);
    out.geburtstage = b.geburtstage.map(g => ({ name: g.name, wann: g.wann, ich: g.name.toLowerCase() === me.name.toLowerCase() }));
    return json(200, out);
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
