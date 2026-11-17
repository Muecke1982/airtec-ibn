// Suche auf der Startseite: Mitarbeiter (Name, Telefon) und Autos (Kennzeichen, Marke, Modell).
// Ergebnis für alle Angemeldeten: Name, Telefon, E-Mail und das zugeordnete Auto – Adresse, Schlüssel und
// Alarmanlage bleiben in der Verwaltung. Maschinen, Lager und Nachrichten durchsucht die App selbst (lokal).
import { all } from "./db.js";
import { normKz, monatText } from "./autos.js";

export async function suche(env, q) {
  q = String(q || "").trim().slice(0, 60);
  if (q.length < 2) return { personen: [], autos: [] };
  const like = "%" + q.replace(/[%_]/g, "") + "%";
  const ziffern = q.replace(/\D/g, "");
  const kz = normKz(q);
  const personen = await all(env, `SELECT m.name, m.telefon, m.mail, (SELECT GROUP_CONCAT(a.kennzeichen, ', ') FROM autos a WHERE a.mitarbeiter_id = m.id) AS autos
    FROM mitarbeiter m WHERE m.aktiv = 1 AND (m.name LIKE ? OR m.plan LIKE ? ${ziffern.length >= 3 ? "OR REPLACE(REPLACE(REPLACE(REPLACE(m.telefon, ' ', ''), '/', ''), '-', ''), '+49', '0') LIKE ?" : ""})
    ORDER BY m.name LIMIT 10`, like, like, ...(ziffern.length >= 3 ? ["%" + ziffern.replace(/^49/, "0") + "%"] : []));
  const autos = (await all(env, `SELECT a.*, m.name AS fahrer, m.telefon AS fahrer_tel FROM autos a LEFT JOIN mitarbeiter m ON m.id = a.mitarbeiter_id ORDER BY a.kennzeichen`))
    .filter(a => (kz.length >= 2 && normKz(a.kennzeichen).includes(kz)) || `${a.marke} ${a.modell}`.toLowerCase().includes(q.toLowerCase())
      || (a.fahrer && a.fahrer.toLowerCase().includes(q.toLowerCase())))
    .slice(0, 10)
    .map(a => ({ kennzeichen: a.kennzeichen, art: a.art, name: [a.marke, a.modell].filter(Boolean).join(" "), fahrer: a.fahrer || "", fahrerTel: a.fahrer_tel || "",
      tuev: monatText(a.tuev_naechster) }));
  return { personen: personen.map(p => ({ name: p.name, telefon: p.telefon, mail: p.mail, autos: p.autos || "" })), autos };
}
