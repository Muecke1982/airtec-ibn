import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { importiere, status } from "../../lib/import.js";
import * as V from "../../lib/verwaltung.js";

// Verwaltung (nur Büro): Datenbank-Überblick, Einmal-Import aus Excel, Mitarbeiter und Stammdaten pflegen
async function buero(env, request) {
  const me = await auth(env, request);
  if (!me) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
  return me;
}
const fehler = e => { console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

// GET ?teil=mitarbeiter | stamm  (ohne: Datenbank-Überblick)
export async function onRequestGet({ request, env }) {
  try {
    await buero(env, request);
    const teil = new URL(request.url).searchParams.get("teil");
    if (teil === "mitarbeiter") return json(200, { mitarbeiter: await V.mitarbeiterListe(env) });
    if (teil === "stamm") return json(200, await V.stammListe(env));
    return json(200, await status(env));
  } catch (e) { return fehler(e); }
}

// POST { aktion, … }
export async function onRequestPost({ request, env }) {
  try {
    const me = await buero(env, request);
    const b = await request.json().catch(() => ({}));
    switch (b.aktion) {
      case "import": { const erg = await importiere(env, me, b); return json(200, { ...erg, status: await status(env) }); }
      case "ma_speichern": return json(200, { mitarbeiter: await V.mitarbeiterSpeichern(env, me, b) });
      case "ma_passwort": return json(200, { mitarbeiter: await V.mitarbeiterPasswort(env, b) });
      case "ma_loeschen": return json(200, { mitarbeiter: await V.mitarbeiterLoeschen(env, me, b) });
      case "liste_speichern": return json(200, await V.listeSpeichern(env, b));
      case "liste_loeschen": return json(200, await V.listeLoeschen(env, b));
      case "tabelle_speichern": return json(200, await V.tabelleSpeichern(env, b));
      default: return json(400, { error: "Unbekannte Aktion" });
    }
  } catch (e) { return fehler(e); }
}
