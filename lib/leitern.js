// Leiter-Prüfbuch (Reiter Allgemeines → Leitern)
// Grundlage: Betriebssicherheitsverordnung § 14 (wiederkehrende Prüfung durch eine „zur Prüfung befähigte Person“),
// TRBS 2121-2 und DGUV Information 208-016 „Die Verwendung von Leitern und Tritten“ (Leiterkontrollblatt).
// Die Frist legt der Betrieb in der Gefährdungsbeurteilung fest – üblich und hier eingestellt: jährlich (INTERVALL Monate).
//  • ansehen: alle Angemeldeten; Leitern pflegen und Prüfungen eintragen: Recht „leitern“
//  • Prüfung = Datum, Prüfer, Prüfpunkte mit Mangel, Ergebnis ok | maengel (gesperrt bis zur Nachprüfung) | aussondern
//  • einmal im Monat: Nachricht ans Büro, wenn Leitern in den nächsten 30 Tagen fällig, überfällig oder gesperrt sind
import { all, one, run, batch, jetzt, heute } from "./db.js";
import { darf } from "./rechte.js";
import { plusMonate } from "./personal.js";

export const INTERVALL = 12;   // Monate
export const VORLAUF = 30;     // Tage vor Fälligkeit „bald fällig“

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max) => String(v ?? "").trim().slice(0, max);
const tagPlus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const de = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";

export const ARTEN = [["anlege", "Anlegeleiter"], ["steh", "Stehleiter"], ["mehrzweck", "Mehrzweckleiter"], ["schiebe", "Schiebe-/Seilzugleiter"],
  ["podest", "Podestleiter"], ["tritt", "Tritt / Klapptritt"], ["teleskop", "Teleskopleiter"], ["sonstige", "Sonstige"]];
export const MATERIAL = ["Aluminium", "GFK (Kunststoff)", "Holz", "Stahl"];

// Prüfpunkte nach dem Leiterkontrollblatt der DGUV Information 208-016 (arten leer = gilt für alle Leitern)
export const PUNKTE = [
  { k: "kennz", t: "Kennzeichnung/Typschild und Gebrauchsanleitung bzw. Piktogramme vorhanden und lesbar" },
  { k: "holme", t: "Holme/Wangen ohne Risse, Knicke, Verformungen, Korrosion oder Brandschäden" },
  { k: "sprossen", t: "Sprossen/Stufen fest, nicht verbogen oder ausgetreten, Trittflächen rutschhemmend" },
  { k: "verb", t: "Verbindungen (Nieten, Schrauben, Bördelungen, Schweißnähte) fest und unbeschädigt" },
  { k: "fuesse", t: "Leiterfüße/Fußkappen vollständig, unbeschädigt und rutschhemmend" },
  { k: "sauber", t: "Frei von Öl, Fett und Verschmutzung; Holz ohne Splitter und ohne deckenden Anstrich" },
  { k: "spreiz", t: "Spreizsicherung (Gurte, Ketten, Gelenkstreben) vorhanden und funktionsfähig", arten: ["steh", "mehrzweck", "podest", "tritt"] },
  { k: "gelenk", t: "Gelenke, Beschläge und Verriegelungen leichtgängig, rasten sicher ein", arten: ["steh", "mehrzweck", "schiebe", "podest", "tritt", "teleskop"] },
  { k: "plattform", t: "Plattform, Ablageschale, Haken und Haltebügel fest und unbeschädigt", arten: ["steh", "podest", "tritt"] },
  { k: "traverse", t: "Traverse/Fußverbreiterung vorhanden und fest", arten: ["anlege", "schiebe", "mehrzweck"] },
  { k: "fuehrung", t: "Führungs- und Einhakbeschläge, Seilzug und Rollen in Ordnung", arten: ["schiebe", "mehrzweck", "teleskop"] },
];
const ERGEBNIS = { ok: "Ohne Mängel", maengel: "Mängel – gesperrt", aussondern: "Ausgesondert" };

export function status(l, letzte, h = heute()) {
  if (l.ausgesondert) return { status: "aus", naechste: "" };
  if (!letzte) return { status: "leer", naechste: "" };
  if (letzte.ergebnis === "maengel") return { status: "gesperrt", naechste: "" };
  const naechste = plusMonate(letzte.datum, INTERVALL);
  return { status: naechste < h ? "faellig" : naechste <= tagPlus(h, VORLAUF) ? "bald" : "ok", naechste };
}

export async function liste(env, me) {
  if (!me || !me.name) throw fail("Nicht angemeldet", 401);
  await pruefen(env).catch(e => console.error("Leitern prüfen:", e.message));
  const h = heute();
  const L = await all(env, "SELECT * FROM leitern ORDER BY nr COLLATE NOCASE");
  const P = await all(env, "SELECT * FROM leiter_pruefungen ORDER BY datum DESC, id DESC");
  const Q = await all(env, "SELECT code, ziel FROM qr_codes WHERE art = 'leiter'");
  const leitern = L.map(l => {
    const pr = P.filter(p => p.leiter_id === l.id).map(p => ({ id: p.id, datum: p.datum, pruefer: p.pruefer, ergebnis: p.ergebnis,
      maengel: p.maengel ? p.maengel.split(",") : [], bem: p.bem, von: p.von }));
    return { id: l.id, nr: l.nr, art: l.art, material: l.material, hersteller: l.hersteller, groesse: l.groesse, standort: l.standort,
      anschaffung: l.anschaffung, bem: l.bem, ausgesondert: l.ausgesondert, qr: (Q.find(q => q.ziel === String(l.id)) || {}).code || "",
      pruefungen: pr, ...status(l, pr[0], h) };
  });
  return { leitern, heute: h, intervall: INTERVALL, vorlauf: VORLAUF, arten: ARTEN, material: MATERIAL, punkte: PUNKTE, pflegen: darf(me, "leitern") };
}

export async function aktion(env, me, b) {
  if (!darf(me, "leitern")) throw fail("Leitern pflegen und prüfen darf nur, wer das Recht „Leitern prüfen“ hat", 403);
  const a = b.aktion;
  if (a === "speichern") {
    const nr = t(b.nr, 30);
    if (!nr) throw fail("Bitte eine Leiter-Nr. eingeben (z. B. L-01)");
    const dup = await one(env, "SELECT id FROM leitern WHERE nr = ? COLLATE NOCASE AND id <> ?", nr, +b.id || 0);
    if (dup) throw fail(`Die Leiter-Nr. ${nr} gibt es schon`);
    const art = ARTEN.some(x => x[0] === b.art) ? b.art : "sonstige";
    const ans = t(b.anschaffung, 10);
    if (ans && !/^\d{4}-\d{2}-\d{2}$/.test(ans)) throw fail("Anschaffungsdatum ungültig");
    const vals = [nr, art, t(b.material, 30), t(b.hersteller, 80), t(b.groesse, 60), t(b.standort, 80), ans, t(b.bem, 300)];
    if (b.id) {
      if (!(await one(env, "SELECT id FROM leitern WHERE id = ?", +b.id))) throw fail("Leiter nicht gefunden", 404);
      await batch(env, [["UPDATE leitern SET nr=?, art=?, material=?, hersteller=?, groesse=?, standort=?, anschaffung=?, bem=? WHERE id=?", ...vals, +b.id],
        ["UPDATE qr_codes SET bezeichnung = ? WHERE art = 'leiter' AND ziel = ?", "Leiter " + nr, String(+b.id)]]);
    } else await run(env, "INSERT INTO leitern (nr, art, material, hersteller, groesse, standort, anschaffung, bem, erstellt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", ...vals, jetzt());
  } else if (a === "pruefung") {
    const l = await one(env, "SELECT * FROM leitern WHERE id = ?", +b.id);
    if (!l) throw fail("Leiter nicht gefunden", 404);
    if (l.ausgesondert) throw fail("Die Leiter ist ausgesondert");
    const datum = t(b.datum, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw fail("Bitte das Prüfdatum angeben");
    if (datum > heute()) throw fail("Das Prüfdatum liegt in der Zukunft");
    const pruefer = t(b.pruefer, 80) || me.name;
    const maengel = (Array.isArray(b.maengel) ? b.maengel : []).filter(k => PUNKTE.some(p => p.k === k));
    const ergebnis = ERGEBNIS[b.ergebnis] ? b.ergebnis : "ok";
    if (ergebnis === "ok" && maengel.length) throw fail("Es sind Mängel angehakt – bitte „Mängel“ oder „Aussondern“ wählen");
    if (ergebnis !== "ok" && !maengel.length && !t(b.bem, 10)) throw fail("Bitte den Mangel ankreuzen oder beschreiben");
    const ops = [["INSERT INTO leiter_pruefungen (leiter_id, datum, pruefer, ergebnis, maengel, bem, erstellt, von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      l.id, datum, pruefer, ergebnis, maengel.join(","), t(b.bem, 500), jetzt(), me.name]];
    if (ergebnis === "aussondern") ops.push(["UPDATE leitern SET ausgesondert = ? WHERE id = ?", datum, l.id]);
    await batch(env, ops);
  } else if (a === "pruefung_loeschen") {
    const p = await one(env, "SELECT * FROM leiter_pruefungen WHERE id = ?", +b.pid);
    if (!p) throw fail("Eintrag nicht gefunden", 404);
    const ops = [["DELETE FROM leiter_pruefungen WHERE id = ?", p.id]];
    if (p.ergebnis === "aussondern") ops.push(["UPDATE leitern SET ausgesondert = '' WHERE id = ?", p.leiter_id]);
    await batch(env, ops);
  } else if (a === "loeschen") {
    await batch(env, [["DELETE FROM leiter_pruefungen WHERE leiter_id = ?", +b.id], ["DELETE FROM qr_codes WHERE art = 'leiter' AND ziel = ?", String(+b.id)],
      ["DELETE FROM leitern WHERE id = ?", +b.id]]);
  } else throw fail("Unbekannte Aktion");
  return liste(env, me);
}

// Einmal im Monat eine Sammel-Nachricht ans Büro (fällig in 30 Tagen, überfällig, gesperrt).
// Noch nie geprüfte Leitern nicht – die sind meist gerade erst erfasst und stehen ohnehin oben in der Liste.
export async function pruefen(env, h = heute()) {
  const monat = h.slice(0, 7);
  const schon = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'leitern_meldung'");
  if (schon && schon.wert === monat) return 0;
  const L = await all(env, "SELECT * FROM leitern WHERE ausgesondert = ''");
  if (!L.length) return 0;
  const P = await all(env, "SELECT * FROM leiter_pruefungen ORDER BY datum DESC, id DESC");
  const zeilen = [];
  for (const l of L) {
    const s = status(l, P.find(p => p.leiter_id === l.id), h);
    const name = `${l.nr}${l.standort ? " (" + l.standort + ")" : ""}`;
    if (s.status === "faellig") zeilen.push(`${name} – überfällig seit ${de(s.naechste)}`);
    else if (s.status === "bald") zeilen.push(`${name} – fällig bis ${de(s.naechste)}`);
    else if (s.status === "gesperrt") zeilen.push(`${name} – gesperrt wegen Mängeln, Nachprüfung nach Reparatur`);
  }
  await run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('leitern_meldung', ?)", monat);
  if (!zeilen.length) return 0;
  const jz = jetzt();
  const r = await run(env, "INSERT INTO nachrichten (typ, von, text, prio, pin, bis, erinnerung, erstellt, zuletzt) VALUES ('auto', 'Leiterprüfung', ?, 'wichtig', 0, '', 0, ?, ?)",
    `🪜 Leiterprüfung: ${zeilen.length} ${zeilen.length === 1 ? "Leiter braucht" : "Leitern brauchen"} Aufmerksamkeit:\n• ${zeilen.join("\n• ")}\nAbhaken unter Allgemeines → Leitern.`, jz, jz);
  await run(env, "INSERT INTO nachricht_an (nachricht_id, empfaenger) VALUES (?, ?)", r.meta.last_row_id, "*buero");
  return 1;
}
