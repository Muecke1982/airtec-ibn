import { darf } from "../../lib/rechte.js";
import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste } from "../../lib/urlaubplan.js";

// Urlaub aus dem Wochenplan (Google-Tabelle).
// GET [?neu=1] → { heute, jahr, meine:[{von,bis,tage}], alle?:[{name,von,bis,tage}] (Büro), stand }
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const buero = darf(me, "urlaub");
    const neu = buero && new URL(request.url).searchParams.get("neu") === "1";
    return json(200, await liste(env, me, await users(env), { neu, buero }));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
