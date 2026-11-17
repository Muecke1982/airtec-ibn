import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, speichern, loeschen, tuevErledigt } from "../../lib/autos.js";

// Autos und Anhänger
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

export async function onRequestGet({ request, env }) {
  try { return json(200, await liste(env, await wer(env, request))); } catch (e) { return fehler(e); }
}

// POST { aktion: speichern | loeschen | tuev, … }
export async function onRequestPost({ request, env }) {
  try {
    const me = await wer(env, request);
    const b = await request.json().catch(() => ({}));
    if (b.aktion === "speichern") return json(200, await speichern(env, me, b));
    if (b.aktion === "loeschen") return json(200, await loeschen(env, me, b));
    if (b.aktion === "tuev") return json(200, await tuevErledigt(env, me, b));
    return json(400, { error: "Unbekannte Aktion" });
  } catch (e) { return fehler(e); }
}
