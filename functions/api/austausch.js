import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, aktion, bild } from "../../lib/austausch.js";

// Nachrichten: Chats, angepinnte Mitteilungen, Antworten, Fotos, Abstimmungen, Geburtstage
async function wer(env, request) {
  const me = await auth(env, request);
  if (!me || !me.name) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  return me;
}
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

// GET → Liste; GET ?bild=ID[&gross=1] → Foto
export async function onRequestGet({ request, env }) {
  try {
    const me = await wer(env, request);
    const q = new URL(request.url).searchParams;
    if (q.get("bild")) {
      const b = await bild(env, me, q.get("bild"), q.get("gross") === "1");
      return new Response(b.bytes, { headers: { "Content-Type": b.typ, "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    return json(200, await liste(env, me));
  } catch (e) { return fehler(e); }
}

// POST { aktion: senden | umfrage | antworten | gelesen | bestaetigen | schliessen | wiederherstellen | erinnert | reaktion | abstimmen | loeschen | gratulieren, … }
export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const me = await wer(env, request);
    return json(200, await aktion(env, me, await request.json().catch(() => ({})), waitUntil || undefined));
  } catch (e) { return fehler(e); }
}
