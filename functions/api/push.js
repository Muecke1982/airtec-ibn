import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { status, abonnieren, abmelden } from "../../lib/push.js";

// Handy-Mitteilungen: GET → öffentlicher Schlüssel + eigene Arten; POST { aktion: abonnieren | abmelden }
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

export async function onRequestGet({ request, env }) {
  try { return json(200, await status(env, await wer(env, request))); } catch (e) { return fehler(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    const me = await wer(env, request);
    const b = await request.json().catch(() => ({}));
    if (b.aktion === "abonnieren") return json(200, await abonnieren(env, me, b));
    if (b.aktion === "abmelden") return json(200, await abmelden(env, me, b));
    return json(400, { error: "Unbekannte Aktion" });
  } catch (e) { return fehler(e); }
}
