// Autos und Anhänger.
//  • sehen: Recht „autos“ (alle), pflegen: Recht „autos_verwalten“
//  • Nächster TÜV als „JJJJ-MM“ (Plakette gilt bis Monatsende). „TÜV erledigt“ schiebt ihn um das Intervall weiter.
//  • Prüfung (zeitgesteuert + beim Öffnen): einen Monat vor dem TÜV-Monat
//      – angepinnte Nachricht mit Erinnerung an den zugeordneten Mitarbeiter (verschwindet mit „Zur Kenntnis genommen“)
//      – Hinweis ans Büro
//    Leasing: x Monate vor Leasingende ein Hinweis ans Büro. Jede Fälligkeit wird nur einmal gemeldet (Tabelle auto_meldungen).
import { all, one, run, batch, jetzt, heute } from "./db.js";
import { darf } from "./rechte.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max) => String(v ?? "").trim().slice(0, max);
const pad = n => String(n).padStart(2, "0");
export const normKz = s => String(s || "").toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export const monatText = ym => ym ? `${MONATE[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}` : "";

// „JJJJ-MM“ + n Monate
function plusMonate(ym, n) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
  return `${y + Math.floor(m / 12)}-${pad(((m % 12) + 12) % 12 + 1)}`;
}
const letzterTag = ym => { const [y, m] = [+ym.slice(0, 4), +ym.slice(5, 7)]; return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; };
const tagPlus = (iso, n) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const leasingEnde = a => a.kaufdatum && a.leasing_monate > 0 ? plusMonate(a.kaufdatum.slice(0, 7), a.leasing_monate) + a.kaufdatum.slice(7, 10) : "";

function status(a, h = heute()) {
  const m = h.slice(0, 7);
  let tuev = "";
  if (a.tuev_naechster) tuev = a.tuev_naechster < m ? "ueberfaellig" : a.tuev_naechster === m ? "faellig" : plusMonate(m, 1) >= a.tuev_naechster ? "bald" : "ok";
  const le = leasingEnde(a);
  const leasing = !le ? "" : le < h ? "abgelaufen" : plusMonate(h.slice(0, 7), a.leasing_erinnerung || 3) >= le.slice(0, 7) ? "bald" : "ok";
  return { tuev, leasing, leasingEnde: le };
}

export async function liste(env, me) {
  if (!darf(me, "autos") && !darf(me, "autos_verwalten")) throw fail("Kein Zugriff auf Autos", 403);
  await pruefen(env).catch(e => console.error("Autos prüfen:", e.message));
  const rows = await all(env, `SELECT a.*, m.name AS fahrer, m.telefon AS fahrer_tel FROM autos a LEFT JOIN mitarbeiter m ON m.id = a.mitarbeiter_id
    ORDER BY a.art, a.kennzeichen`);
  const verwalten = darf(me, "autos_verwalten");
  return {
    autos: rows.map(a => ({ id: a.id, art: a.art, marke: a.marke, modell: a.modell, kennzeichen: a.kennzeichen, kaufdatum: a.kaufdatum,
      leasingMonate: a.leasing_monate, leasingErinnerung: a.leasing_erinnerung, tuevIntervall: a.tuev_intervall, tuevNaechster: a.tuev_naechster,
      tuevText: monatText(a.tuev_naechster), mitarbeiterId: a.mitarbeiter_id, fahrer: a.fahrer || "", fahrerTel: a.fahrer_tel || "",
      bem: a.bem, meins: !!a.fahrer && a.fahrer.toLowerCase() === String(me.name).toLowerCase(), ...status(a) })),
    personen: verwalten ? await all(env, "SELECT id, name FROM mitarbeiter WHERE aktiv = 1 ORDER BY name") : undefined,
    verwalten,
  };
}

export async function speichern(env, me, b) {
  if (!darf(me, "autos_verwalten")) throw fail("Autos pflegen darf nur, wer das Recht dazu hat", 403);
  const kz = t(b.kennzeichen, 20).toUpperCase();
  if (!normKz(kz)) throw fail("Bitte das Kennzeichen eingeben");
  const dup = (await all(env, "SELECT id, kennzeichen FROM autos WHERE id <> ?", +b.id || 0)).find(x => normKz(x.kennzeichen) === normKz(kz));
  if (dup) throw fail(`Das Kennzeichen ${dup.kennzeichen} gibt es schon`);
  const kauf = t(b.kaufdatum, 10);
  if (kauf && !/^\d{4}-\d{2}-\d{2}$/.test(kauf)) throw fail("Kaufdatum ungültig");
  const tuev = t(b.tuevNaechster, 7);
  if (tuev && !/^\d{4}-\d{2}$/.test(tuev)) throw fail("Nächster TÜV bitte als Monat angeben");
  const intervall = [1, 2, 3].includes(+b.tuevIntervall) ? +b.tuevIntervall : 2;
  const lm = Math.max(0, Math.min(120, Math.round(+b.leasingMonate || 0)));
  const le = Math.max(1, Math.min(12, Math.round(+b.leasingErinnerung || 3)));
  let mid = b.mitarbeiterId ? +b.mitarbeiterId : null;
  if (mid && !(await one(env, "SELECT id FROM mitarbeiter WHERE id = ?", mid))) throw fail("Mitarbeiter nicht gefunden");
  const vals = [b.art === "anhaenger" ? "anhaenger" : "auto", t(b.marke, 60), t(b.modell, 60), kz, kauf, lm, le, intervall, tuev, mid, t(b.bem, 300)];
  if (b.id) await run(env, `UPDATE autos SET art=?, marke=?, modell=?, kennzeichen=?, kaufdatum=?, leasing_monate=?, leasing_erinnerung=?,
    tuev_intervall=?, tuev_naechster=?, mitarbeiter_id=?, bem=? WHERE id=?`, ...vals, +b.id);
  else await run(env, `INSERT INTO autos (art, marke, modell, kennzeichen, kaufdatum, leasing_monate, leasing_erinnerung, tuev_intervall,
    tuev_naechster, mitarbeiter_id, bem) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...vals);
  return liste(env, me);
}

export async function loeschen(env, me, b) {
  if (!darf(me, "autos_verwalten")) throw fail("Autos pflegen darf nur, wer das Recht dazu hat", 403);
  await batch(env, [["DELETE FROM auto_meldungen WHERE auto_id = ?", +b.id], ["DELETE FROM autos WHERE id = ?", +b.id]]);
  return liste(env, me);
}

// TÜV gemacht → nächster TÜV = bisheriger + Intervall (ohne bisherigen: ab jetzt)
export async function tuevErledigt(env, me, b) {
  if (!darf(me, "autos_verwalten")) throw fail("Autos pflegen darf nur, wer das Recht dazu hat", 403);
  const a = await one(env, "SELECT * FROM autos WHERE id = ?", +b.id);
  if (!a) throw fail("Auto nicht gefunden", 404);
  const basis = a.tuev_naechster || heute().slice(0, 7);
  await run(env, "UPDATE autos SET tuev_naechster = ? WHERE id = ?", plusMonate(basis, 12 * a.tuev_intervall), a.id);
  return liste(env, me);
}

// ---------- Fälligkeiten prüfen und Nachrichten anlegen ----------
async function nachricht(env, { an, text, pin, bis, erinnerung }) {
  const jz = jetzt();
  const r = await run(env, "INSERT INTO nachrichten (typ, von, text, prio, pin, bis, erinnerung, erstellt, zuletzt) VALUES ('auto', 'Fuhrpark', ?, 'wichtig', ?, ?, ?, ?, ?)",
    text, pin ? 1 : 0, bis || "", erinnerung || 0, jz, jz);
  await run(env, "INSERT INTO nachricht_an (nachricht_id, empfaenger) VALUES (?, ?)", r.meta.last_row_id, an);
}

export async function pruefen(env) {
  const h = heute(), jz = jetzt();
  const rows = await all(env, "SELECT a.*, m.name AS fahrer FROM autos a LEFT JOIN mitarbeiter m ON m.id = a.mitarbeiter_id AND m.aktiv = 1");
  let n = 0;
  for (const a of rows) {
    const name = [a.marke, a.modell].filter(Boolean).join(" ");
    const was = `${a.art === "anhaenger" ? "Anhänger" : "Auto"} ${a.kennzeichen}${name ? " (" + name + ")" : ""}`;
    // TÜV: ab einem Monat vor dem TÜV-Monat
    if (a.tuev_naechster && h.slice(0, 7) >= plusMonate(a.tuev_naechster, -1)) {
      const neu = await run(env, "INSERT OR IGNORE INTO auto_meldungen (auto_id, art, faellig, erstellt) VALUES (?, 'tuev', ?, ?)", a.id, a.tuev_naechster, jz);
      if (neu.meta.changes) {
        const bis = tagPlus(letzterTag(a.tuev_naechster), 90);   // bleibt bis zum Abhaken stehen (spätestens 3 Monate nach dem TÜV-Monat)
        if (a.fahrer) await nachricht(env, { an: a.fahrer, pin: true, bis, erinnerung: 2,
          text: `🚗 TÜV fällig: ${was} – Plakette gilt bis Ende ${monatText(a.tuev_naechster)}. Bitte mit dem Büro einen Termin abstimmen.` });
        await nachricht(env, { an: "*buero", text: `🚗 TÜV fällig ${monatText(a.tuev_naechster)}: ${was}${a.fahrer ? " – Fahrer: " + a.fahrer : " – keinem Mitarbeiter zugeordnet"}. Nach dem Termin im Reiter „Autos“ „TÜV erledigt“ antippen.` });
        n++;
      }
    }
    // Leasingende
    const le = leasingEnde(a);
    if (le && h.slice(0, 7) >= plusMonate(le.slice(0, 7), -(a.leasing_erinnerung || 3))) {
      const neu = await run(env, "INSERT OR IGNORE INTO auto_meldungen (auto_id, art, faellig, erstellt) VALUES (?, 'leasing', ?, ?)", a.id, le, jz);
      if (neu.meta.changes) {
        await nachricht(env, { an: "*buero", text: `📄 Leasing läuft aus am ${le.slice(8, 10)}.${le.slice(5, 7)}.${le.slice(0, 4)}: ${was}${a.fahrer ? " – Fahrer: " + a.fahrer : ""}.` });
        n++;
      }
    }
  }
  return n;
}

// Autos eines Mitarbeiters (für „Autoinfo an Büro“)
export async function autosVon(env, name) {
  return all(env, `SELECT a.id, a.art, a.marke, a.modell, a.kennzeichen, a.tuev_naechster FROM autos a JOIN mitarbeiter m ON m.id = a.mitarbeiter_id
    WHERE m.name = ? COLLATE NOCASE ORDER BY a.kennzeichen`, name);
}
