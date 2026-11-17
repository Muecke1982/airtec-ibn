import { auth } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { importiere, status } from "../../lib/import.js";
import { darf } from "../../lib/rechte.js";
import * as V from "../../lib/verwaltung.js";
import { liste as logbuchListe } from "../../lib/logbuch.js";
import { sichern, zurueckspielen, status as sicherungStatus } from "../../lib/sicherung.js";

// Verwaltung: Mitarbeiter (Recht „mitarbeiter“), Stammdaten (Recht „stammdaten“), Datenbank-Import (Recht „mitarbeiter“;
// Mitarbeiter-Import nur Admin, weil er alle Rechte überschreibt)
const fail = (msg, status) => Object.assign(new Error(msg), { status });
async function angemeldet(env, request) {
  const me = await auth(env, request);
  if (!me || me.legacy) throw fail("Nicht angemeldet", 401);
  return me;
}
const brauche = (me, recht) => { if (!darf(me, recht)) throw fail("Dafür fehlt das Recht", 403); };
const fehler = e => { if (!e.status || e.status >= 500) console.error(e); return json(e.status && e.status < 500 ? e.status : 500, { error: e.message }); };

// GET ?teil=mitarbeiter | stamm  (ohne: Datenbank-Überblick)
export async function onRequestGet({ request, env }) {
  try {
    const me = await angemeldet(env, request);
    const teil = new URL(request.url).searchParams.get("teil");
    if (teil === "mitarbeiter") { brauche(me, "mitarbeiter"); return json(200, { mitarbeiter: await V.mitarbeiterListe(env) }); }
    if (teil === "stamm") { brauche(me, "stammdaten"); return json(200, await V.stammListe(env)); }
    if (teil === "sicherung") {
      if (!me.admin) throw fail("Die Datensicherung sieht nur der Admin", 403);
      return json(200, await sicherungStatus(env));
    }
    if (teil === "logbuch") {
      if (!me.admin) throw fail("Das Logbuch sieht nur der Admin", 403);
      const q = new URL(request.url).searchParams;
      return json(200, await logbuchListe(env, { tage: q.get("tage"), wer: q.get("wer"), bereich: q.get("bereich") }));
    }
    brauche(me, "mitarbeiter");
    return json(200, await status(env));
  } catch (e) { return fehler(e); }
}

// POST { aktion, … }
export async function onRequestPost({ request, env }) {
  try {
    const me = await angemeldet(env, request);
    const b = await request.json().catch(() => ({}));
    switch (b.aktion) {
      case "import":
        brauche(me, "mitarbeiter");
        // Mitarbeiter-Import überschreibt alle Rechte → nur der Admin. Solange es noch keinen Admin gibt (erster Import), auch andere Verwalter.
        if (b.bereich === "mitarbeiter" && !me.admin && (await status(env)).adminDa)
          throw fail("Den Mitarbeiter-Import darf nur der Admin starten (er überschreibt alle Rechte).", 403);
        { const erg = await importiere(env, me, b); return json(200, { ...erg, status: await status(env) }); }
      case "ma_speichern": brauche(me, "mitarbeiter"); return json(200, { mitarbeiter: await V.mitarbeiterSpeichern(env, me, b) });
      case "ma_passwort": brauche(me, "mitarbeiter"); return json(200, { mitarbeiter: await V.mitarbeiterPasswort(env, me, b) });
      case "ma_loeschen": brauche(me, "mitarbeiter"); return json(200, { mitarbeiter: await V.mitarbeiterLoeschen(env, me, b) });
      case "sichern":
        if (!me.admin) throw fail("Nur der Admin", 403);
        return json(200, { ergebnis: await sichern(env, me.name), status: await sicherungStatus(env) });
      case "zurueckspielen":
        if (!me.admin) throw fail("Nur der Admin", 403);
        return json(200, { ergebnis: await zurueckspielen(env, me.name, b), status: await sicherungStatus(env) });
      case "ma_admin": return json(200, { mitarbeiter: await V.adminUebergeben(env, me, b) });
      case "liste_speichern": brauche(me, "stammdaten"); return json(200, await V.listeSpeichern(env, b));
      case "liste_loeschen": brauche(me, "stammdaten"); return json(200, await V.listeLoeschen(env, b));
      case "tabelle_speichern": brauche(me, "stammdaten"); return json(200, await V.tabelleSpeichern(env, b));
      default: return json(400, { error: "Unbekannte Aktion" });
    }
  } catch (e) { return fehler(e); }
}
