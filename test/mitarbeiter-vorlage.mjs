// Nur für Tests: Mitarbeiter aus vorlagen/Airtec_Zugaenge.xlsx in die (Test-)Datenbank schreiben.
// Die App selbst liest die Zugänge-Excel nicht mehr – Mitarbeiter werden in der App verwaltet.
import { readFileSync } from "node:fs";
import { batch, one } from "../lib/db.js";
import { readFirstSheet } from "../lib/xlsx.js";
import { hashPasswort } from "../lib/passwort.js";
import { rechteText, ALLE, MONTEUR } from "../lib/rechte.js";

const yes = v => /^(x|ja|j|1|true|wahr|yes|✓|✔)$/i.test(String(v ?? "").trim());

export async function mitarbeiterAusVorlage(env) {
  const rows = await readFirstSheet(readFileSync(new URL("../vorlagen/Airtec_Zugaenge.xlsx", import.meta.url)));
  const head = rows[0].map(h => String(h).toLowerCase().trim());
  const col = (...k) => head.findIndex(h => k.some(x => h.includes(x)));
  const cName = head.findIndex(h => h === "name"), cMail = col("mail"), cPw = col("passwort"), cPlan = col("wochenplan", "plan"), cW = col("schreib", "büro"), cGeb = col("geburt");
  const sql = [];
  const seen = new Set();
  for (const [i, r] of rows.slice(1).entries()) {
    const name = String(r[cName] ?? "").trim(); if (!name || seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
    const pw = String(r[cPw] ?? "").trim(), plan = cPlan >= 0 ? String(r[cPlan] ?? "").trim() : "", w = cW >= 0 && yes(r[cW]);
    const g = String((cGeb >= 0 && r[cGeb]) ?? "").match(/^(\d{1,2})\.(\d{1,2})/);
    sql.push(["INSERT INTO mitarbeiter (name, mail, pw_hash, plan, schreiben, rechte, geb_tag, geb_monat, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      name, cMail >= 0 ? String(r[cMail] ?? "").trim() : "", pw ? await hashPasswort(pw) : "", plan === name ? "" : plan, w ? 1 : 0,
      rechteText(w ? ALLE : MONTEUR), g ? +g[1] : null, g ? +g[2] : null, i]);
  }
  const adm = await one(env, "SELECT name FROM mitarbeiter WHERE admin = 1");
  for (const n of adm ? [adm.name] : ["Sebastian Stern", "Sebastian"])
    sql.push(["UPDATE mitarbeiter SET admin = 1, rechte = ? WHERE id = (SELECT id FROM mitarbeiter WHERE name = ? COLLATE NOCASE LIMIT 1) AND NOT EXISTS (SELECT 1 FROM mitarbeiter WHERE admin = 1)", rechteText(ALLE), n]);
  sql.push(["UPDATE mitarbeiter SET pw_neu = 1 WHERE pw_hash <> '' AND admin = 0"]);
  await batch(env, [["DELETE FROM mitarbeiter"], ...sql]);
  return sql.length;
}
