// Ausgehende Mails je Bereich – gepflegt in der App (Verwaltung → E-Mail-Adressen), gespeichert in der Tabelle
// „einstellungen“ (Schlüssel „mail_<bereich>“, Inhalt JSON). Nicht gesetzte Felder → Standardwerte unten bzw. MAIL_FROM.
//   von     = Absender-Postfach (Microsoft 365, App braucht „Mail.Send“), z. B. noreply@airtec-kaeltetechnik.de
//   an / cc = Empfänger / Kopie (mehrere mit „;“ trennen) – bei Bestellungen kommt der Empfänger vom Lieferanten
//   antwort = „Antworten an“ (leer + Absender noreply@… → automatisch info@, siehe graph.js)
import { one, run } from "./db.js";
import { cfg } from "./graph.js";

export const MUELL_TEXT = "Sehr geehrte Damen und Herren,\n\nbitte leeren Sie unseren Restmüllbehälter am Standort:\n\nAirtec Kältetechnik GmbH\nMax-Planck-Str. 2\n48599 Gronau\n\nVielen Dank und freundliche Grüße\n{name}\nAirtec Kältetechnik GmbH";

// Felder je Bereich (Reihenfolge = Anzeige in der App)
export const BEREICHE = {
  muell: { titel: "🗑️ Restmüll – Mail an den Entsorger", felder: ["von", "an", "cc", "antwort", "betreff", "text"],
    std: { von: "info@airtec-kaeltetechnik.de", an: "", cc: "", antwort: "info@airtec-kaeltetechnik.de",
      betreff: "Leerung Restmüllbehälter – Airtec Kältetechnik GmbH", text: MUELL_TEXT } },
  lager: { titel: "📦 Lager – Bestellungen an Lieferanten", felder: ["von", "cc", "antwort"], std: { von: "", cc: "", antwort: "" },
    hinweis: "Empfänger ist der jeweilige Lieferant (Adressen unten)." },
  urlaub: { titel: "🌴 Urlaub – Infomail ans Büro (bitte in Label eintragen)", felder: ["von", "an", "antwort"], std: { von: "", an: "", antwort: "" } },
};
export const FELDER = { von: "Absender", an: "Empfänger", cc: "Kopie (CC)", antwort: "Antworten an", betreff: "Betreff", text: "Text" };
const MAIL = /^[^@\s;,]+@[^@\s;,]+\.[a-z]{2,}$/i;
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const liste = v => String(v || "").split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);

async function gespeichert(env, bereich) {
  const r = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = ?", "mail_" + bereich);
  try { return r ? JSON.parse(r.wert) || {} : null; } catch { return {}; }
}

// Einstellung eines Bereichs mit Standardwerten. Urlaub: Empfänger = bisherige Einstellung „urlaub_info_an“.
export async function mailEinstellung(env, bereich) {
  const B = BEREICHE[bereich]; if (!B) throw fail("Unbekannter Bereich");
  const g = (await gespeichert(env, bereich)) || {};
  const out = {};
  for (const f of B.felder) out[f] = String(g[f] ?? B.std[f] ?? "");
  if (!out.von) out.von = cfg(env, "MAIL_FROM", false) || "";
  if (bereich === "urlaub") {   // Empfänger nur an einer Stelle: „urlaub_info_an“ (auch auf der Urlaub-Seite änderbar)
    const r = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'urlaub_info_an'");
    if (r) out.an = r.wert;
    else {   // noch nie gesetzt → Mail-Adresse von Frau Schatz aus der Mitarbeiterliste
      const s = await one(env, "SELECT mail FROM mitarbeiter WHERE aktiv = 1 AND name LIKE '%Schatz%' AND mail <> '' LIMIT 1");
      out.an = s ? s.mail : "";
    }
  }
  return out;
}
export const istGespeichert = async (env, bereich) => !!(await gespeichert(env, bereich));

export async function alle(env) {
  const out = {};
  for (const [id, B] of Object.entries(BEREICHE)) out[id] = { titel: B.titel, felder: B.felder, hinweis: B.hinweis || "", werte: await mailEinstellung(env, id) };
  return { bereiche: out, felder: FELDER };
}

// werte: { von, an, cc, antwort, betreff, text } – Adressen werden geprüft
export async function speichern(env, bereich, werte = {}) {
  const B = BEREICHE[bereich]; if (!B) throw fail("Unbekannter Bereich");
  const neu = {};
  for (const f of B.felder) {
    let v = String(werte[f] ?? "").trim();
    if (["von", "an", "cc", "antwort"].includes(f)) {
      const l = liste(v);
      for (const a of l) if (!MAIL.test(a)) throw fail(`${FELDER[f]}: „${a}“ ist keine gültige Mail-Adresse`);
      if (f === "von" && l.length > 1) throw fail("Absender: bitte nur eine Adresse");
      v = l.join("; ");
    }
    neu[f] = f === "text" ? v.slice(0, 4000) : v.slice(0, 500);
  }
  if (!neu.von) throw fail("Bitte einen Absender eintragen");
  if (bereich === "muell" && !neu.an) throw fail("Bitte die Adresse des Entsorgers eintragen");
  if (bereich === "urlaub") {   // Empfänger gehört in „urlaub_info_an“ (siehe oben)
    await run(env, "INSERT INTO einstellungen (schluessel, wert) VALUES ('urlaub_info_an', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert", liste(neu.an).join(", "));
    delete neu.an;
  }
  await run(env, "INSERT INTO einstellungen (schluessel, wert) VALUES (?, ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert", "mail_" + bereich, JSON.stringify(neu));
  return mailEinstellung(env, bereich);
}
