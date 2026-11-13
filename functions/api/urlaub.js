import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { list, toPlan } from "../../lib/urlaub.js";
import { writePlan } from "../../lib/planwrite.js";

// GET  → { meine:[…], alle?:[…] (Büro), postfach?, geprueft?, fehler? }
export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    return json(200, await list(env, me, await users(env)));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

// POST { aktion:"abrufen" } | { aktion:"wochenplan", id } – nur Büro
export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    if (!me.schreiben) return json(403, { error: "Nur für das Büro" });
    const b = await request.json().catch(() => ({}));
    const people = await users(env);
    let info = {};
    if (b.aktion === "wochenplan") info = await toPlan(env, me, String(b.id || ""), writePlan, people);
    else if (b.aktion !== "abrufen") return json(400, { error: "Unbekannte Aktion" });
    const out = await list(env, me, people, { sync: b.aktion === "abrufen" });
    return json(200, { ...out, ...info });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
