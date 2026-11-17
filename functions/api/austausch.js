import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, aktion } from "../../lib/austausch.js";

// Austausch: Nachrichten, angepinnte Mitteilungen, Antworten, Abstimmungen, Geburtstage
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

export async function onRequestGet({ request, env }) {
  try { return json(200, await liste(env, await wer(env, request))); } catch (e) { return fehler(e); }
}

// POST { aktion: senden | umfrage | antworten | gelesen | erledigt | erinnert | reaktion | abstimmen | loeschen | gratulieren, … }
export async function onRequestPost({ request, env }) {
  try {
    const me = await wer(env, request);
    return json(200, await aktion(env, me, await request.json().catch(() => ({}))));
  } catch (e) { return fehler(e); }
}
