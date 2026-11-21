// Einstiegspunkt für Cloudflare Workers (Alternative zu Cloudflare Pages):
// /api/* geht an den Hintergrunddienst, alles andere sind die App-Dateien aus /app.
import * as upload from "../functions/api/upload.js";
import * as stamm from "../functions/api/stamm.js";
import * as status from "../functions/api/status.js";
import * as login from "../functions/api/login.js";
import * as wochenplan from "../functions/api/wochenplan.js";
import * as maschinen from "../functions/api/maschinen.js";
import * as plan from "../functions/api/plan.js";
import * as hinweise from "../functions/api/hinweise.js";
import * as lager from "../functions/api/lager.js";
import * as muell from "../functions/api/muell.js";
import * as urlaub from "../functions/api/urlaub.js";
import * as admin from "../functions/api/admin.js";
import * as austausch from "../functions/api/austausch.js";
import { aufraeumen as austauschAufraeumen } from "../lib/austausch.js";
import * as autos from "../functions/api/autos.js";
import * as suche from "../functions/api/suche.js";
import * as personal from "../functions/api/personal.js";
import * as qr from "../functions/api/qr.js";
import * as typenschild from "../functions/api/typenschild.js";
import * as push from "../functions/api/push.js";
import { pruefen as autosPruefen } from "../lib/autos.js";
import { pruefen as fuehrerscheinPruefen } from "../lib/personal.js";
import { abgleich as urlaubInfo } from "../lib/urlaubinfo.js";
import { taeglich as wochenplanVorbereiten } from "../lib/jahreswechsel.js";
import { users } from "../lib/auth.js";
import { taeglich as sicherungTaeglich } from "../lib/sicherung.js";
import { auth } from "../lib/auth.js";
import { schreibe, beschreibe, aufraeumen } from "../lib/logbuch.js";
import { one } from "../lib/db.js";
import { json } from "../lib/graph.js";

const routes = {
  "POST /api/upload": upload.onRequestPost,
  "GET /api/stamm": stamm.onRequestGet,
  "GET /api/status": status.onRequestGet,
  "POST /api/login": login.onRequestPost,
  "GET /api/login": login.onRequestGet,
  "GET /api/wochenplan": wochenplan.onRequestGet,
  "POST /api/plan": plan.onRequestPost,
  "GET /api/hinweise": hinweise.onRequestGet,
  "GET /api/lager": lager.onRequestGet,
  "POST /api/lager": lager.onRequestPost,
  "GET /api/muell": muell.onRequestGet,
  "POST /api/muell": muell.onRequestPost,
  "POST /api/hinweise": hinweise.onRequestPost,
  "GET /api/urlaub": urlaub.onRequestGet,
  "POST /api/urlaub": urlaub.onRequestPost,
  "GET /api/maschinen": maschinen.onRequestGet,
  "POST /api/maschinen": maschinen.onRequestPost,
  "GET /api/admin": admin.onRequestGet,
  "POST /api/admin": admin.onRequestPost,
  "GET /api/austausch": austausch.onRequestGet,
  "POST /api/austausch": austausch.onRequestPost,
  "GET /api/autos": autos.onRequestGet,
  "POST /api/autos": autos.onRequestPost,
  "GET /api/suche": suche.onRequestGet,
  "GET /api/personal": personal.onRequestGet,
  "POST /api/personal": personal.onRequestPost,
  "GET /api/qr": qr.onRequestGet,
  "POST /api/qr": qr.onRequestPost,
  "POST /api/typenschild": typenschild.onRequestPost,
  "GET /api/push": push.onRequestGet,
  "POST /api/push": push.onRequestPost,
};

// Logbuch: Änderungen (POST) und Anmeldungen aufzeichnen – im Hintergrund, damit die Antwort nicht wartet
async function protokolliere(env, me, url, body, res) {
  const pfad = url.pathname.replace(/\/+$/, "");
  if (pfad === "/api/login") {
    const name = String(body.name || "").trim().slice(0, 80) || "?";
    return schreibe(env, name, "Anmeldung", res.ok ? "Angemeldet" : "Anmeldung fehlgeschlagen");
  }
  if (!res.ok) return;
  const b = { ...body };
  if ((pfad === "/api/admin" || pfad === "/api/personal") && b.id && !b.name)   // Mitarbeiter-Name statt interner Nummer
    b.name = body._name || "";
  const e = beschreibe(pfad, b, url.searchParams);
  if (e) await schreibe(env, (me && (me.name || (me.legacy ? "Firmen-Code" : ""))) || "?", e.bereich, e.aktion, e.details);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const h = routes[`${request.method} ${url.pathname.replace(/\/+$/, "")}`];
      if (!h) return json(404, { error: "Unbekannte Adresse" });
      if (request.method !== "POST") return h({ request, env });
      // JSON-Inhalt für das Logbuch mitlesen (PDF-Upload: nur Name aus der Adresse)
      let body = {};
      if ((request.headers.get("content-type") || "").includes("json")) body = await request.clone().json().catch(() => ({}));
      if ((url.pathname.startsWith("/api/admin") || url.pathname.startsWith("/api/personal")) && body.id && !body.name)
        body._name = ((await one(env, "SELECT name FROM mitarbeiter WHERE id = ?", +body.id).catch(() => null)) || {}).name;
      if (url.pathname.startsWith("/api/autos") && body.id && !body.kennzeichen)   // Kennzeichen fürs Logbuch
        body.kennzeichen = ((await one(env, "SELECT kennzeichen FROM autos WHERE id = ?", +body.id).catch(() => null)) || {}).kennzeichen;
      const me = url.pathname.startsWith("/api/login") ? null : await auth(env, request).catch(() => null);   // vor der Aktion (z. B. eigenes Passwort ändern)
      const res = await h({ request, env, waitUntil: ctx && ctx.waitUntil ? p => ctx.waitUntil(p) : null });   // waitUntil: z. B. Handy-Mitteilungen nach der Antwort senden
      if (ctx && ctx.waitUntil) ctx.waitUntil(protokolliere(env, me, url, body, res).catch(e => console.error("Logbuch:", e.message)));
      return res;
    }
    return env.ASSETS.fetch(request);
  },
  // Zeitgesteuert (siehe wrangler.jsonc „triggers“): altes Logbuch/Nachrichten löschen, TÜV prüfen, sichern
  async scheduled(event, env, ctx) {
    ctx.waitUntil(aufraeumen(env).catch(e => console.error("Logbuch aufräumen:", e.message)));
    ctx.waitUntil(austauschAufraeumen(env).catch(e => console.error("Austausch aufräumen:", e.message)));
    ctx.waitUntil(autosPruefen(env).catch(e => console.error("Autos prüfen:", e.message)));
    ctx.waitUntil(fuehrerscheinPruefen(env).catch(e => console.error("Führerschein prüfen:", e.message)));
    // Urlaub-Infomail: neuen/gestrichenen Urlaub im Wochenplan ans Büro melden
    // Wochenplan: ab November Blätter „KW 1 <nächstes Jahr>“ … „KW 4 …“ anlegen, danach Infomail
    ctx.waitUntil(wochenplanVorbereiten(env).catch(e => console.error("Wochenplan nächstes Jahr:", e.message))
      .then(() => users(env)).then(p => urlaubInfo(env, p)).catch(e => console.error("Urlaub-Infomail:", e.message)));
    // Datensicherung: einmal täglich (nachts um 1:30 UTC, sonst beim ersten Lauf des Tages)
    ctx.waitUntil(sicherungTaeglich(env).catch(e => console.error("Datensicherung:", e.message)));
  },
};
