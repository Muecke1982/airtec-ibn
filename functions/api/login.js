import { login, auth, users, hatPasswort, sitzung } from "../../lib/auth.js";
import { gesperrt, fehlversuch, erfolgreich, sperrText, passwortAendern } from "../../lib/anmeldung.js";
import { json } from "../../lib/graph.js";

const ipVon = request => request.headers.get("cf-connecting-ip") || "";

// Anmeldung: POST { name, passwort }  →  { token, user }
// Eigenes Passwort ändern: POST { aktion: "passwort", alt, neu } (angemeldet)  →  { token, user } (neues Token)
export async function onRequestPost({ request, env }) {
  try {
    const b = await request.json().catch(() => ({}));
    const ip = ipVon(request);
    if (b.aktion === "passwort") {
      const name = await passwortAendern(env, await auth(env, request), b, ip);
      return json(200, await sitzung(env, name));
    }
    const warte = await gesperrt(env, b.name, ip);
    if (warte) return json(429, { error: sperrText(warte) });
    const r = await login(env, b.name, b.passwort);
    if (!r) {
      await new Promise(res => setTimeout(res, 800)); // Raten bremsen
      const f = await fehlversuch(env, b.name, ip);
      if (f.sperre) return json(429, { error: sperrText(f.sperre) });
      return json(401, { error: "Name oder Passwort falsch" + (f.rest <= 2 ? ` – noch ${f.rest} Versuch${f.rest === 1 ? "" : "e"}, dann wird die Anmeldung 15 Minuten gesperrt` : "") });
    }
    await erfolgreich(env, r.user.name);
    return json(200, r);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return json(e.status || 500, { error: e.message });
  }
}

// Anmeldung prüfen: GET mit x-app-code  →  { user }
// Ohne Anmeldung: GET ?liste=1  →  Namen für die Auswahl auf der Anmeldeseite (ohne weitere Daten)
export async function onRequestGet({ request, env }) {
  try {
    if (new URL(request.url).searchParams.get("liste")) {
      return json(200, { namen: (await users(env)).filter(hatPasswort).map(u => u.name) });
    }
    const me = await auth(env, request);
    return me && !me.legacy ? json(200, { user: me }) : json(401, { error: "Nicht angemeldet" });
  } catch (e) {
    return json(500, { error: e.message });
  }
}
