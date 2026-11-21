import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, suchen, aktion } from "../../lib/qr.js";

// QR-Codes: GET ?code=… → Zuordnung eines gescannten Codes, GET ohne → alle Zuordnungen; POST zuordnen / loesen
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message, zuordnung: e.zuordnung }); };

export async function onRequestGet({ request, env }) {
  try {
    const me = await wer(env, request);
    const code = new URL(request.url).searchParams.get("code");
    return json(200, code !== null ? await suchen(env, code) : await liste(env, me));
  } catch (e) { return fehler(e); }
}

export async function onRequestPost({ request, env }) {
  try {
    const me = await wer(env, request);
    return json(200, await aktion(env, me, await request.json().catch(() => ({}))));
  } catch (e) { return fehler(e); }
}
