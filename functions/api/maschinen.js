import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, act } from "../../lib/maschinen.js";

// Liste aller Maschinen mit Status
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    return json(200, await list(env, me));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// POST { aktion: "nehmen" | "zurueck" | "uebernehmen" | "bestaetigen" | "verleihen" | "erinnern", id, an?, kontakt?, tage? }
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me) return json(401, { error: "Nicht angemeldet" });
    if (!me.name) return json(403, { error: "Bitte mit Namen und Passwort anmelden" });
    const b = await request.json().catch(() => ({}));
    if (!b.id || !b.aktion) return json(400, { error: "Angaben fehlen" });
    return json(200, await act(env, me, b.aktion, String(b.id), b));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
