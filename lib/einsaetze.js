// Einsätze im Wochenplan: Zusatzangaben zu einem Eintrag (Team) an einem Tag, die nicht in der Google-Tabelle stehen.
// In der Tabelle steht weiter nur die Überschrift (z. B. „Bochum DRV“); hier dazu:
//   art    – baustelle | kd (Kundendiensteinsatz) | info (nur Info, z. B. Schule, TÜV – keine Baustelle)
//   nummer – Projektnummer (Baustelle) bzw. Kundendienstnummer (kd)
//   info   – kurze Info, z. B. „Krantermin 7 Uhr“
//   fix    – fester Termin: nur nach Rücksprache ändern
// Schlüssel: Datum + normalisierte Überschrift (wie der Zelleintrag aller Team-Mitglieder).
import { all, batch, hasDb, jetzt } from "./db.js";
import { norm } from "./wochenplan.js";

export const ARTEN = ["baustelle", "kd", "info"];
const kurz = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const datumOk = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// Eingabe säubern; null = nichts Besonderes (normale Baustelle ohne Angaben → muss nicht gespeichert werden)
export function einsatzAus(e) {
  const titel = kurz(e && e.titel, 120);
  if (!norm(titel)) return null;
  const art = ARTEN.includes(e.art) ? e.art : "baustelle";
  return { titel, art, nummer: art === "info" ? "" : kurz(e.nummer, 40), info: kurz(e.info, 200), fix: !!e.fix };
}
const leer = x => x.art === "baustelle" && !x.nummer && !x.info && !x.fix;

// { "2026-11-24": { "bochum drv": { titel, art, nummer, info, fix } } }
export async function laden(env, von, bis) {
  if (!hasDb(env)) return {};
  const rows = await all(env, "SELECT * FROM einsaetze WHERE datum >= ? AND datum <= ? ORDER BY datum", von, bis);
  const out = {};
  for (const r of rows) (out[r.datum] = out[r.datum] || {})[r.schluessel] = { titel: r.titel, art: r.art, nummer: r.nummer, info: r.info, fix: !!r.fix };
  return out;
}

// liste: [{ datum, titel, art, nummer, info, fix }] – je (Datum, Überschrift) eintragen oder ersetzen.
// ersetzen: Tage, deren übrige Einträge (nicht in der Liste) gelöscht werden – z. B. beim Speichern des Tagesbretts.
export async function speichern(env, wer, liste = [], ersetzen = []) {
  const tage = [...new Set(ersetzen.filter(datumOk))];
  const ops = [], behalten = {};
  for (const e of liste) {
    if (!datumOk(e && e.datum)) continue;
    const x = einsatzAus(e); if (!x) continue;
    const k = norm(x.titel);
    (behalten[e.datum] = behalten[e.datum] || []).push(k);
    if (leer(x)) { ops.push(["DELETE FROM einsaetze WHERE datum = ? AND schluessel = ?", e.datum, k]); continue; }
    ops.push(["INSERT INTO einsaetze (datum, schluessel, titel, art, nummer, info, fix, von, am) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      + " ON CONFLICT (datum, schluessel) DO UPDATE SET titel = excluded.titel, art = excluded.art, nummer = excluded.nummer, info = excluded.info,"
      + " fix = excluded.fix, von = excluded.von, am = excluded.am", e.datum, k, x.titel, x.art, x.nummer, x.info, x.fix ? 1 : 0, wer, jetzt()]);
  }
  for (const d of tage) {
    const k = behalten[d] || [];
    ops.unshift([`DELETE FROM einsaetze WHERE datum = ?${k.length ? ` AND schluessel NOT IN (${k.map(() => "?").join(",")})` : ""}`, d, ...k]);
  }
  if (ops.length) await batch(env, ops);
  return ops.length;
}

// Für die Baustellen-Vorschläge: je Überschrift die Angaben – Nummer = zuletzt eingetragene,
// Info = vom nächsten Einsatz ab „tag“ (sonst vom letzten), Art = zuletzt.
export function zusammenfassen(meta, tag) {
  const out = {};
  for (const d of Object.keys(meta).sort()) for (const [k, m] of Object.entries(meta[d])) {
    const x = out[k] || (out[k] = { art: m.art, nummer: "", info: "", infoTag: "", fixTage: [] });
    x.art = m.art;
    if (m.nummer) x.nummer = m.nummer;
    if (m.info && (!x.infoTag || x.infoTag < tag)) { x.info = m.info; x.infoTag = d; }
    if (m.fix && d >= tag) x.fixTage.push(d);
  }
  return out;
}
