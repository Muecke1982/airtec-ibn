// Logbuch: wer hat wann was in der App geändert (nur Änderungen und Anmeldungen, kein reines Ansehen).
// Sichtbar nur für den Admin, Einträge werden nach 90 Tagen gelöscht.
// Aufgezeichnet wird zentral im Worker (worker/index.js) für jede erfolgreiche Änderung (POST) und jede Anmeldung.
// Passwörter, Dateien und andere Inhalte werden nie gespeichert – nur die Felder unten in FELDER.
import { hasDb, run, all, jetzt, heute } from "./db.js";

export const TAGE = 90;

const BEREICH = { login: "Anmeldung", maschinen: "Maschinen", lager: "Lager", hinweise: "Hinweise", muell: "Restmüll", urlaub: "Urlaub",
  plan: "Wochenplan", upload: "Protokolle", admin: "Verwaltung", austausch: "Nachrichten", autos: "Autos", personal: "Mitarbeiter-Infos" };

const AKTION = {
  maschinen: { nehmen: "Maschine mitgenommen", zurueck: "Maschine zurückgestellt", uebernehmen: "Maschine übernommen", bestaetigen: "„Noch bei mir“ bestätigt",
    verleihen: "Maschine verliehen", baustelle: "Auf Baustelle gelassen", reservieren: "Maschine reserviert", storno: "Reservierung storniert", erinnern: "Verleih nachgehakt" },
  lager: { melden: "Material gemeldet", zurueck: "Meldung zurückgenommen", neu: "Material außerhalb der Liste gemeldet", aufnehmen: "Artikel in die Liste aufgenommen",
    lieferant: "Lieferant für Meldung gewählt", importieren: "Artikel importiert", abhaken: "Meldungen abgehakt", bestellt: "Bestellung", vorschau: null },
  hinweise: { neu: "Hinweis geschrieben", erledigt: "Hinweis abgehakt", gratulieren: "Gratuliert", loeschen: "Hinweis gelöscht" },
  austausch: { senden: "Nachricht geschrieben", umfrage: "Abstimmung gestartet", antworten: "Geantwortet", erledigt: "Nachricht abgehakt",
    abstimmen: "Abgestimmt", loeschen: "Nachricht gelöscht", gratulieren: "Gratuliert", reaktion: null, gelesen: null, erinnert: null },
  autos: { speichern: "Auto gespeichert", loeschen: "Auto gelöscht", tuev: "TÜV erledigt eingetragen" },
  urlaub: { eintragen: "Urlaub in den Wochenplan eingetragen", infomail: "Empfänger der Urlaub-Infomail geändert" },
  personal: { fuehrerschein: "Führerschein gesichtet", fs_loeschen: "Führerscheinprüfung gelöscht", speichern: "Urlaubstage/Notizen gespeichert" },
  admin: { import: "Import aus Excel", ma_speichern: "Mitarbeiter gespeichert", ma_passwort: "Passwort neu gesetzt", ma_loeschen: "Mitarbeiter gelöscht",
    ma_admin: "Admin weitergegeben", sichern: "Datensicherung erstellt", zurueckspielen: "Datensicherung zurückgespielt", liste_speichern: "Auswahlliste gespeichert", liste_loeschen: "Auswahlliste gelöscht", tabelle_speichern: "Stammdaten gespeichert" },
};

// erlaubte Angaben für die Details (alles andere – Passwörter, Dateien, Stammdaten-Inhalte – bleibt draußen)
const FELDER = [["kennzeichen", "Kennzeichen"], ["bereich", "Bereich"], ["name", "Name"], ["id", "Nr."], ["nr", "Art.-Nr."], ["status", "Status"], ["an", "An"], ["kontakt", "Kontakt"],
  ["tage", "Tage"], ["datum", "Datum"], ["anspruch", "Urlaubsanspruch"], ["vorjahr", "Rest Vorjahr"],["fuer", "Für"], ["von", "Von"], ["bis", "Bis"], ["baustelle", "Baustelle"], ["lieferant", "Lieferant"], ["bez", "Bezeichnung"],
  ["tabelle", "Tabelle"], ["text", "Text"], ["pin", "angepinnt"], ["aktiv", "aktiv"]];

const kurz = (v, n = 80) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Request → { bereich, aktion, details } (oder null = nicht aufzeichnen)
export function beschreibe(pfad, body = {}, query = new URLSearchParams()) {
  const teil = pfad.replace(/^\/api\//, "").replace(/\/+$/, "");
  const bereich = BEREICH[teil];
  if (!bereich || teil === "login") return null;
  let aktion;
  if (teil === "muell") aktion = body.trotzdem ? "Restmüll-Leerung angefordert (trotz kürzlicher Anforderung)" : "Restmüll-Leerung angefordert";
  else if (teil === "plan") aktion = "Wochenplan geändert";
  else if (teil === "upload") aktion = "Protokoll hochgeladen";
  else {
    const a = AKTION[teil] && AKTION[teil][body.aktion];
    if (a === null) return null;   // reine Vorschau, keine Änderung
    aktion = a || String(body.aktion || "Änderung");
  }
  const d = [];
  if (teil === "upload") { if (query.get("name")) d.push(kurz(query.get("name"), 120)); if (query.get("projekt")) d.push("Projekt " + kurz(query.get("projekt"))); }
  if (teil === "plan" && Array.isArray(body.aenderungen))
    d.push(body.aenderungen.slice(0, 6).map(x => `${kurz(x.name, 30)} ${String(x.datum || "").slice(5).split("-").reverse().join(".")}: ${kurz(x.wert, 30)}`).join("; ")
      + (body.aenderungen.length > 6 ? ` … (+${body.aenderungen.length - 6})` : ""));
  for (const [k, l] of FELDER) {
    const v = body[k];
    if (v === undefined || v === null || v === "" || typeof v === "object") continue;
    if (k === "id" && teil !== "maschinen") continue;   // interne Nummern nur bei Maschinen aussagekräftig (= Maschinen-Nr.)
    d.push(`${l}: ${kurz(v)}`);
  }
  if (Array.isArray(body.bereiche)) d.push("Bereiche: " + body.bereiche.map(x => kurz(x, 20)).join(", "));
  if (Array.isArray(body.an)) d.push("An: " + body.an.map(a => a === "*alle" ? "Alle" : a === "*buero" ? "Büro" : kurz(a, 30)).join(", "));
  if (teil === "austausch" && body.prio && body.prio !== "normal") d.push("Priorität: " + body.prio);
  if (Array.isArray(body.nrs) && teil !== "austausch") d.push(`${body.nrs.length} Artikel`);
  if (Array.isArray(body.rechte)) d.push("Rechte: " + (body.rechte.join(", ") || "keine"));
  if (Array.isArray(body.items)) d.push(`${body.items.length} Artikel`);
  return { bereich, aktion, details: d.join(" · ") };
}

// Eintrag schreiben – Fehler im Logbuch dürfen nie eine Aktion stören
export async function schreibe(env, wer, bereich, aktion, details = "") {
  if (!hasDb(env)) return;
  try {
    await run(env, "INSERT INTO logbuch (zeit, wer, bereich, aktion, details) VALUES (?, ?, ?, ?, ?)",
      jetzt(), kurz(wer || "?", 80), bereich, kurz(aktion, 120), kurz(details, 500));
  } catch (e) { console.error("Logbuch:", e.message); }
}

// Einträge älter als 90 Tage löschen (zeitgesteuert)
export async function aufraeumen(env) {
  if (!hasDb(env)) return;
  const grenze = heute(new Date(Date.now() - TAGE * 864e5));
  await run(env, "DELETE FROM logbuch WHERE zeit < ?", grenze);
}

// Für die Ansicht: Filter tage (1–90), wer, bereich
export async function liste(env, q = {}) {
  const tage = Math.max(1, Math.min(TAGE, +q.tage || 7));
  const where = ["zeit >= ?"], args = [heute(new Date(Date.now() - (tage - 1) * 864e5))];
  if (q.wer) { where.push("wer = ?"); args.push(String(q.wer)); }
  if (q.bereich) { where.push("bereich = ?"); args.push(String(q.bereich)); }
  const eintraege = await all(env, `SELECT zeit, wer, bereich, aktion, details FROM logbuch WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 2000`, ...args);
  const personen = (await all(env, "SELECT DISTINCT wer FROM logbuch ORDER BY wer")).map(r => r.wer);
  return { eintraege, personen, bereiche: Object.values(BEREICH), tage, aufbewahrung: TAGE };
}
