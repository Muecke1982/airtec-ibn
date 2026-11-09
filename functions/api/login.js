import { login, auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";

// Anmeldung: POST { name, passwort }  →  { token, user }
export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => ({}));
    const r = await login(env, b.name, b.passwort);
    if (!r) {
      await new Promise(res => setTimeout(res, 800)); // Raten bremsen
      return json(401, { error: "Name oder Passwort falsch" });
    }
    return json(200, r);
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
}

// Anmeldung prüfen: GET mit x-app-code  →  { user }
// Ohne Anmeldung: GET ?liste=1  →  Namen für die Auswahl auf der Anmeldeseite (ohne weitere Daten)
export async function onRequestGet({ request, env }) {
  try {
    if (new URL(request.url).searchParams.get("liste")) {
      return json(200, { namen: (await users(env)).filter(u => u.pw).map(u => u.name) });
    }
    const me = await auth(env, request);
    return me && !me.legacy ? json(200, { user: me }) : json(401, { error: "Nicht angemeldet" });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
