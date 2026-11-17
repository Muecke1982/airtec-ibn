import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { importiere, status } from "../../lib/import.js";

// Verwaltung (nur Büro): Datenbank-Überblick und Einmal-Import aus den Excel-Dateien
async function buero(env, request) {
  const me = await auth(env, request);
  if (!me) throw Object.assign(new Error("Nicht angemeldet"), { status: 401 });
  if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
  return me;
}
const fehler = e => { console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

export async function onRequestGet({ request, env }) {
  try { await buero(env, request); return json(200, await status(env)); }
  catch (e) { return fehler(e); }
}

// POST { aktion: "import", bereich, datei?, stamm? }
export async function onRequestPost({ request, env }) {
  try {
    const me = await buero(env, request);
    const b = await request.json().catch(() => ({}));
    if (b.aktion !== "import") return json(400, { error: "Unbekannte Aktion" });
    const erg = await importiere(env, me, b);
    return json(200, { ...erg, status: await status(env) });
  } catch (e) { return fehler(e); }
}
