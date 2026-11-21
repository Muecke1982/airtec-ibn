// Typenschild-Foto → Hersteller, Typ, Seriennummer, Kältemittel, Füllmenge, Stromaufnahme (KI: Claude von Anthropic).
// Der Schlüssel steht als Geheimnis ANTHROPIC_API_KEY in Cloudflare. Das Foto wird nicht gespeichert.
// Welche Werte ins Protokoll übernommen werden, entscheidet die App (nur Felder, die das Protokoll abfragt).
import Anthropic from "@anthropic-ai/sdk";

export const MODELL = "claude-opus-5-5";
const MAX_BILD = 6_000_000;   // Zeichen der data:-URL (≈ 4,5 MB Bild) – die App schickt verkleinerte Fotos (< 1 MB)
const fail = (m, status = 400) => Object.assign(new Error(m), { status });

const FELDER = ["hersteller", "modell", "seriennummer", "kaeltemittel", "fuellmenge_kg", "stromaufnahme_a", "geraet", "hinweis"];
const SCHEMA = {
  type: "object",
  properties: {
    hersteller: { type: "string", description: "Hersteller/Marke, z. B. Daikin, Mitsubishi Electric, Panasonic. Leer, wenn nicht erkennbar." },
    modell: { type: "string", description: "Modell-/Typbezeichnung genau wie aufgedruckt (z. B. RXM35R5V1B). Leer, wenn nicht erkennbar." },
    seriennummer: { type: "string", description: "Seriennummer (Serial No., S/N, Fabrik-Nr.) Zeichen für Zeichen genau. Leer, wenn nicht sicher lesbar." },
    kaeltemittel: { type: "string", description: "Kältemittel in der Schreibweise R32, R410A, R454B, R290 usw. Leer, wenn nicht angegeben." },
    fuellmenge_kg: { type: "string", description: "Werksseitige Kältemittel-Füllmenge in kg als Zahl mit Punkt (z. B. 1.15). Angaben in g in kg umrechnen. Leer, wenn nicht angegeben." },
    stromaufnahme_a: { type: "string", description: "Nennstromaufnahme in Ampere als Zahl mit Punkt. Bei mehreren Werten den Nennstrom Kühlen; gibt es nur einen maximalen Strom, diesen. Leer, wenn nicht angegeben." },
    geraet: { type: "string", enum: ["innen", "aussen", "unbekannt"], description: "Innengerät oder Außengerät (Außeneinheit, Verflüssigereinheit), soweit erkennbar." },
    hinweis: { type: "string", description: "Kurzer Hinweis auf Deutsch, falls etwas unscharf, verdeckt oder unsicher ist. Sonst leer." },
  },
  required: FELDER,
  additionalProperties: false,
};

const AUFTRAG = `Das Foto zeigt das Typenschild eines Klima- oder Kältegeräts (Innen- oder Außengerät, Wärmepumpe, Kaltwassersatz).
Lies die Angaben ab und gib sie im vorgegebenen JSON-Format zurück.
Übernimm nur, was tatsächlich auf dem Schild steht – nichts raten oder ergänzen. Ist ein Wert nicht sicher lesbar, lass das Feld leer
und schreib es in „hinweis“. Seriennummer und Modell genau so abschreiben, wie sie aufgedruckt sind (Groß-/Kleinschreibung, Bindestriche),
aber ohne Beschriftung wie „S/N:“. Ist auf dem Foto kein Typenschild zu sehen, lass alle Felder leer und erkläre es kurz in „hinweis“.`;

// bild = data:image/jpeg;base64,… ; client nur für Tests
export async function erkennen(env, bild, { client } = {}) {
  const m = String(bild || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw fail("Bitte ein Foto (JPEG/PNG) schicken");
  if (bild.length > MAX_BILD) throw fail("Das Foto ist zu groß");
  if (!client) {
    if (!env.ANTHROPIC_API_KEY) throw fail("Die Typenschild-Erkennung ist noch nicht eingerichtet (Schlüssel ANTHROPIC_API_KEY fehlt in Cloudflare)", 503);
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
  }
  let res;
  try {
    res = await client.beta.messages.create({
      model: MODELL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
        { type: "text", text: AUFTRAG },
      ] }],
    });
  } catch (e) {
    console.error("Typenschild KI:", e.status, e.message);
    if (e.status === 401 || e.status === 403) throw fail("KI-Schlüssel ungültig – bitte im Büro melden", 503);
    if (e.status === 429) throw fail("Die KI ist gerade ausgelastet – bitte gleich nochmal versuchen", 503);
    throw fail("Die KI ist gerade nicht erreichbar – bitte nochmal versuchen oder von Hand eintragen", 503);
  }
  if (res.stop_reason === "refusal") throw fail("Die KI konnte das Foto nicht auswerten – bitte von Hand eintragen", 422);
  const text = (res.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  let d;
  try { d = JSON.parse(text); } catch (e) { throw fail("Die KI-Antwort war unvollständig – bitte nochmal fotografieren", 502); }
  return bereinigen(d);
}

// Werte säubern: Zahlen mit Punkt, Kältemittel „R32“-Schreibweise
export function bereinigen(d) {
  const s = v => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const zahl = v => { const t = s(v).replace(",", ".").match(/\d+(?:\.\d+)?/); return t ? t[0] : ""; };
  let km = s(d.kaeltemittel).toUpperCase().replace(/\s|-/g, "");
  if (/^\d/.test(km)) km = "R" + km;
  return {
    hersteller: s(d.hersteller), modell: s(d.modell), seriennummer: s(d.seriennummer).replace(/^(S\/?N|SERIAL\s*NO\.?)\s*:?\s*/i, ""),
    kaeltemittel: km, fuellmenge_kg: zahl(d.fuellmenge_kg), stromaufnahme_a: zahl(d.stromaufnahme_a),
    geraet: ["innen", "aussen"].includes(d.geraet) ? d.geraet : "unbekannt", hinweis: s(d.hinweis).slice(0, 200),
  };
}
