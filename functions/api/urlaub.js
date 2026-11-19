import { darf } from "../../lib/rechte.js";
import { auth, users } from "../../lib/auth.js";
import { json } from "../../lib/graph.js";
import { liste, eintragen, cacheLeeren } from "../../lib/urlaubplan.js";
import { status as jahrStatus, vorbereiten, neuesJahr } from "../../lib/jahreswechsel.js";
import { abgleich, einstellung, speichereEmpfaenger } from "../../lib/urlaubinfo.js";

// Urlaub aus dem Wochenplan (Google-Tabelle), ab heute ein Jahr voraus.
// GET [?neu=1] → { heute, bis, planBis, meine:[{von,bis,tage}], alle?:[{name,von,bis,tage}], personen?, info? } (Büro: alle/personen/info)
// POST { aktion:"eintragen", name?, von, bis, halb? } → Urlaub in den Wochenplan + Infomail ans Büro
// POST { aktion:"infomail", an } (Büro) → Empfänger der Infomail
// POST { aktion:"blaetter" } (Büro) → Wochenblätter bis KW 4 des nächsten Jahres anlegen
// POST { aktion:"neuesjahr" } (Admin, ab 1. Januar) → Sicherung + alle Wochenblätter aufs neue Jahr umschreiben
async function antwort(env, me, people, neu) {
  const buero = darf(me, "urlaub");
  const out = await liste(env, me, people, { neu, buero });
  if (buero) {
    out.personen = people.map(p => p.name).sort((a, b) => a.localeCompare(b));
    const e = await einstellung(env);
    out.info = { an: e.an, von: e.von };
    try { out.jahr = await jahrStatus(env); } catch (x) { out.jahr = { fehler: x.message }; }
    out.admin = !!me.admin;
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const neu = darf(me, "urlaub") && new URL(request.url).searchParams.get("neu") === "1";
    return json(200, await antwort(env, me, await users(env), neu));
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const me = await auth(env, request);
    if (!me || !me.name) return json(401, { error: "Nicht angemeldet" });
    const b = await request.json().catch(() => ({}));
    const people = await users(env);
    if (b.aktion === "infomail") {
      if (!darf(me, "urlaub")) return json(403, { error: "Nur für das Büro" });
      await speichereEmpfaenger(env, b.an);
      return json(200, await antwort(env, me, people, false));
    }
    if (b.aktion === "blaetter") {
      if (!darf(me, "urlaub")) return json(403, { error: "Nur für das Büro" });
      const r = await vorbereiten(env);
      cacheLeeren();
      return json(200, { ...(await antwort(env, me, people, true)), blaetter: r });
    }
    if (b.aktion === "neuesjahr") {
      if (!me.admin) return json(403, { error: "Nur für den Admin" });
      const r = await neuesJahr(env, me.name);
      cacheLeeren();
      return json(200, { ...(await antwort(env, me, people, true)), neuesjahr: r });
    }
    if (b.aktion !== "eintragen") return json(400, { error: "Unbekannte Aktion" });
    const r = await eintragen(env, me, b, people);
    let mail;
    try { mail = r.eingetragen ? await abgleich(env, people, { neu: true, wer: me.name }) : { gesendet: false }; }
    catch (e) { mail = { fehler: e.message }; }
    return json(200, { ...(await antwort(env, me, people, false)), ergebnis: r, mail });
  } catch (e) {
    console.error(e);
    return json(e.status && e.status < 500 ? e.status : 500, { error: e.message });
  }
}
