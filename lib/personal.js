// Reiter „Allgemeines“ → Mitarbeiter: Führerscheinprüfung, Urlaubstage, Notizen.
// Mit dem Recht „personal“: alle Mitarbeiter sehen und pflegen. Ohne: nur die eigenen Angaben ansehen.
// Urlaubstage (genommen/geplant) kommen aus dem Wochenplan (lib/urlaubplan.js), Anspruch + Vorjahresrest aus der Datenbank.
import { all, one, run, jetzt, heute } from "./db.js";
import { darf } from "./rechte.js";
import { laden as urlaubLaden } from "./urlaubplan.js";

export const FS_MONATE = 12;   // Führerschein alle 12 Monate sichten
const fail = (m, status = 400) => Object.assign(new Error(m), { status });

// Datum + n Monate (Tag bleibt, notfalls Monatsende)
export function plusMonate(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const z = new Date(Date.UTC(y, m - 1 + n, 1));
  const ende = new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate();
  z.setUTCDate(Math.min(d, ende));
  return z.toISOString().slice(0, 10);
}

const isoMinus = (iso, tage) => new Date(Date.parse(iso + "T12:00:00Z") - tage * 864e5).toISOString().slice(0, 10);

// Status der Führerscheinprüfung: ok | bald (≤ 14 Tage) | faellig | leer
export function fsStatus(letzte, tag = heute()) {
  if (!letzte) return { status: "leer", naechste: "" };
  const naechste = plusMonate(letzte, FS_MONATE);
  const status = tag >= naechste ? "faellig" : tag >= isoMinus(naechste, 14) ? "bald" : "ok";
  return { status, naechste };
}

// ---------- Fälligkeiten melden (zeitgesteuert + beim Öffnen) ----------
// 14 Tage vor der nächsten Prüfung (oder wenn schon fällig): Hinweis ans Büro und angepinnte Erinnerung an den Mitarbeiter.
// Je Mitarbeiter und Fälligkeit nur einmal (Tabelle fs_meldungen). Nach der Sichtung werden beide Nachrichten ausgeblendet.
async function nachricht(env, an, text, pin, bis) {
  const jz = jetzt();
  const r = await run(env, "INSERT INTO nachrichten (typ, von, text, prio, pin, bis, erinnerung, erstellt, zuletzt) VALUES ('auto', 'Fuhrpark', ?, 'wichtig', ?, ?, ?, ?, ?)",
    text, pin ? 1 : 0, bis || "", pin ? 2 : 0, jz, jz);
  await run(env, "INSERT INTO nachricht_an (nachricht_id, empfaenger) VALUES (?, ?)", r.meta.last_row_id, an);
  return r.meta.last_row_id;
}
const deDatum = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

export async function pruefen(env) {
  const h = heute(), jz = jetzt();
  const rows = await all(env, `SELECT m.id, m.name, MAX(p.datum) AS letzte FROM mitarbeiter m JOIN fs_pruefungen p ON p.mitarbeiter_id = m.id
    WHERE m.aktiv = 1 GROUP BY m.id, m.name`);
  let n = 0;
  for (const r of rows) {
    const s = fsStatus(r.letzte, h);
    if (s.status !== "bald" && s.status !== "faellig") continue;
    const neu = await run(env, "INSERT OR IGNORE INTO fs_meldungen (mitarbeiter_id, faellig, erstellt) VALUES (?, ?, ?)", r.id, s.naechste, jz);
    if (!neu.meta.changes) continue;
    const wann = s.status === "faellig" ? `seit ${deDatum(s.naechste)} fällig` : `fällig am ${deDatum(s.naechste)}`;
    const ids = [
      await nachricht(env, r.name, `🪪 Führerscheinprüfung ${wann}. Bitte Ihren Führerschein im Büro vorzeigen.`, true, plusMonate(s.naechste, 3)),
      await nachricht(env, "*buero", `🪪 Führerscheinprüfung ${wann}: ${r.name}. Nach der Sichtung unter Allgemeines → Mitarbeiter „Führerschein gesichtet“ antippen.`),
    ];
    await run(env, "UPDATE fs_meldungen SET nachrichten = ? WHERE mitarbeiter_id = ? AND faellig = ?", ids.join(","), r.id, s.naechste);
    n++;
  }
  return n;
}

// Nach der Sichtung: offene Meldungen dieses Mitarbeiters ausblenden (Ablaufdatum gestern)
async function meldungenErledigt(env, mid) {
  const ids = (await all(env, "SELECT nachrichten FROM fs_meldungen WHERE mitarbeiter_id = ?", mid))
    .flatMap(r => String(r.nachrichten || "").split(",")).map(Number).filter(Boolean);
  if (!ids.length) return;
  const gestern = isoMinus(heute(), 1);
  await run(env, `UPDATE nachrichten SET bis = ? WHERE id IN (${ids.map(() => "?").join(",")}) AND (bis = '' OR bis > ?)`, gestern, ...ids, gestern);
}

export async function liste(env, me, people) {
  const alle = darf(me, "personal");
  if (alle) await pruefen(env).catch(e => console.error("Führerschein prüfen:", e.message));
  const rows = await all(env, `SELECT id, name, plan, aktiv, urlaub_anspruch, urlaub_vorjahr, notiz FROM mitarbeiter
    WHERE ${alle ? "aktiv = 1" : "name = ? COLLATE NOCASE"} ORDER BY pos, name`, ...(alle ? [] : [me.name]));
  const ids = rows.map(r => r.id);
  const pr = ids.length ? await all(env, `SELECT id, mitarbeiter_id, datum, von, erstellt FROM fs_pruefungen
    WHERE mitarbeiter_id IN (${ids.map(() => "?").join(",")}) ORDER BY datum DESC, id DESC`, ...ids) : [];
  // Urlaub aus dem Wochenplan – ein Fehler dort darf die Seite nicht verhindern
  const tag = heute();
  let urlaub = null, urlaubFehler = "";
  try { urlaub = await urlaubLaden(env, people, tag.slice(0, 4)); } catch (e) { urlaubFehler = e.message; }
  const mitarbeiter = rows.map(r => {
    const hist = pr.filter(p => p.mitarbeiter_id === r.id).slice(0, 10).map(({ id, datum, von, erstellt }) => ({ id, datum, von, erstellt }));
    const z = urlaub ? (urlaub.personen[r.name] || []) : null;
    const sum = l => l.reduce((s, x) => s + (+x.tage || 0), 0);
    const genommen = z ? sum(z.filter(x => x.bis < tag)) : null, geplant = z ? sum(z.filter(x => x.bis >= tag)) : null;
    const gesamt = (+r.urlaub_anspruch || 0) + (+r.urlaub_vorjahr || 0);
    return {
      id: r.id, name: r.name, notiz: alle ? r.notiz : undefined,
      fuehrerschein: { letzte: hist[0] ? hist[0].datum : "", von: hist[0] ? hist[0].von : "", ...fsStatus(hist[0] && hist[0].datum, tag), historie: hist },
      urlaub: { anspruch: +r.urlaub_anspruch || 0, vorjahr: +r.urlaub_vorjahr || 0, genommen, geplant,
        rest: z && gesamt ? gesamt - genommen - geplant : null, zeitraeume: z || [] },
    };
  });
  return { heute: tag, jahr: tag.slice(0, 4), pflegen: alle, intervall: FS_MONATE, mitarbeiter, urlaubFehler };
}

async function ma(env, id) {
  const r = await one(env, "SELECT id, name FROM mitarbeiter WHERE id = ?", +id || 0);
  if (!r) throw fail("Mitarbeiter nicht gefunden", 404);
  return r;
}

// POST-Aktionen (nur mit Recht „personal“)
export async function aktion(env, me, b, people) {
  if (!darf(me, "personal")) throw fail("Nur für das Büro (Recht „Mitarbeiter-Infos“)", 403);
  if (b.aktion === "fuehrerschein") {
    const m = await ma(env, b.id);
    const datum = String(b.datum || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || isNaN(new Date(datum))) throw fail("Bitte ein gültiges Datum wählen");
    if (datum > heute()) throw fail("Das Datum darf nicht in der Zukunft liegen");
    if (datum < plusMonate(heute(), -24)) throw fail("Das Datum liegt mehr als 2 Jahre zurück");
    await run(env, "INSERT INTO fs_pruefungen (mitarbeiter_id, datum, von, erstellt) VALUES (?, ?, ?, ?)", m.id, datum, me.name, jetzt());
    if (fsStatus(datum).status === "ok") await meldungenErledigt(env, m.id);
  } else if (b.aktion === "fs_loeschen") {
    await run(env, "DELETE FROM fs_pruefungen WHERE id = ?", +b.pid || 0);
  } else if (b.aktion === "speichern") {
    const m = await ma(env, b.id);
    const zahl = (v, max) => { const n = Math.round((+String(v ?? "").replace(",", ".") || 0) * 2) / 2; if (n < 0 || n > max) throw fail(`Bitte eine Zahl zwischen 0 und ${max}`); return n; };
    await run(env, "UPDATE mitarbeiter SET urlaub_anspruch = ?, urlaub_vorjahr = ?, notiz = ? WHERE id = ?",
      zahl(b.anspruch, 60), zahl(b.vorjahr, 60), String(b.notiz || "").slice(0, 2000), m.id);
  } else throw fail("Unbekannte Aktion");
  return liste(env, me, people);
}
