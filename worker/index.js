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
  "POST /api/hinweise": hinweise.onRequestPost,
  "GET /api/maschinen": maschinen.onRequestGet,
  "POST /api/maschinen": maschinen.onRequestPost,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const h = routes[`${request.method} ${url.pathname.replace(/\/+$/, "")}`];
      return h ? h({ request, env }) : json(404, { error: "Unbekannte Adresse" });
    }
    return env.ASSETS.fetch(request);
  },
};
