// QR-Codes (Aufkleber) → Maschine, Anlage oder sonstiger Gegenstand.
// Ein Code ist der Text im QR-Code. Steht darin ein Link der App (…/q/ABC123 oder …?qr=ABC123), zählt nur der Teil dahinter.
// Lesen darf jeder Angemeldete (Scannen bei Maschinen und im Logbuch), zuordnen/lösen nur mit dem Recht „qr“.
import { all, one, run, jetzt } from "./db.js";
import { darf } from "./rechte.js";

export const ARTEN = ["maschine", "anlage", "sonstiges", "artikel"];   // artikel = Lagerartikel (ziel = Art.-Nr.)
const fail = (m, status = 400) => Object.assign(new Error(m), { status });

// QR-Inhalt → Code (gleiche Regel wie in app/qr.js)
export function codeAus(text) {
  let s = String(text ?? "").trim();
  const m = s.match(/[?&]qr=([^&#\s]+)/i) || s.match(/^https?:\/\/[^/]+\/q\/([^/?#\s]+)/i);
  if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
  return s.slice(0, 200);
}

const zeile = r => r && { code: r.code, art: r.art, ziel: r.ziel, bezeichnung: r.bezeichnung, erstellt: r.erstellt, von: r.von };

export async function suchen(env, text) {
  const code = codeAus(text);
  if (!code) throw fail("Kein Code gelesen");
  return { code, zuordnung: zeile(await one(env, "SELECT * FROM qr_codes WHERE code = ?", code)) };
}

export async function liste(env, me) {
  const codes = (await all(env, "SELECT * FROM qr_codes ORDER BY art, bezeichnung, code")).map(zeile);
  return { codes, darf: darf(me, "qr") };
}

// b = { aktion: "zuordnen", code, art, ziel, bezeichnung, ersetzen } | { aktion: "loesen", code }
export async function aktion(env, me, b) {
  if (!darf(me, "qr")) throw fail("QR-Codes zuordnen darf nur, wer das Recht „QR-Codes zuordnen“ hat", 403);
  const code = codeAus(b.code);
  if (!code) throw fail("Kein Code angegeben");
  if (b.aktion === "loesen") {
    await run(env, "DELETE FROM qr_codes WHERE code = ?", code);
    return liste(env, me);
  }
  if (b.aktion !== "zuordnen") throw fail("Unbekannte Aktion");
  const art = String(b.art || "");
  if (!ARTEN.includes(art)) throw fail("Unbekannte Art");
  const ziel = art === "sonstiges" ? "" : String(b.ziel ?? "").trim().slice(0, 120);
  const bezeichnung = String(b.bezeichnung ?? "").trim().slice(0, 120);
  if (art !== "sonstiges" && !ziel) throw fail("Bitte auswählen, wozu der Code gehört");
  if (art === "sonstiges" && !bezeichnung) throw fail("Bitte eine Bezeichnung eintragen");
  const alt = await one(env, "SELECT * FROM qr_codes WHERE code = ?", code);
  if (alt && !(alt.art === art && alt.ziel === ziel) && !b.ersetzen)
    throw Object.assign(fail(`Dieser Code gehört schon zu „${alt.bezeichnung || alt.ziel}“`, 409), { zuordnung: zeile(alt) });
  // je Maschine/Anlage nur ein Code: alten Aufkleber lösen
  if (art !== "sonstiges") await run(env, "DELETE FROM qr_codes WHERE art = ? AND ziel = ? AND code <> ?", art, ziel, code);
  await run(env, "INSERT INTO qr_codes (code, art, ziel, bezeichnung, erstellt, von) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(code) DO UPDATE SET art = excluded.art, ziel = excluded.ziel, bezeichnung = excluded.bezeichnung, erstellt = excluded.erstellt, von = excluded.von",
    code, art, ziel, bezeichnung, jetzt(), me.name || "");
  return liste(env, me);
}
