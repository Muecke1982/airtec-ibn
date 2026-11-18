import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, aktion } from "../../lib/personal.js";

// Allgemeines → Mitarbeiter (Führerschein, Urlaubstage, Notizen)
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

export async function onRequestGet({ request, env }) {
  try { return json(200, await liste(env, await wer(env, request), await users(env))); } catch (e) { return fehler(e); }
}

// POST { aktion: fuehrerschein {id, datum} | fs_loeschen {pid} | speichern {id, anspruch, vorjahr, notiz} }
export async function onRequestPost({ request, env }) {
  try {
    const me = await wer(env, request);
    const b = await request.json().catch(() => ({}));
    return json(200, await aktion(env, me, b, await users(env)));
  } catch (e) { return fehler(e); }
}
