// Schutz der Anmeldung: Sperre nach zu vielen Fehlversuchen und eigenes Passwort ändern.
//
// Sperre (Tabelle login_fehler, Zeiten in Millisekunden):
//  • je Name: nach 5 falschen Passwörtern innerhalb von 15 Minuten ist der Name 15 Minuten gesperrt
//  • je Internet-Anschluss (IP): nach 20 Fehlversuchen 15 Minuten gesperrt (bremst Durchprobieren vieler Namen)
//  • eine erfolgreiche Anmeldung setzt den Zähler des Namens zurück
// Ohne Datenbank (alte Excel-Zugangsliste) gibt es keine Sperre.
import { hasDb, one, run } from "./db.js";
import { hashPasswort, pruefePasswort } from "./passwort.js";
import { resetUsers } from "./auth.js";

export const NAME_MAX = 5, IP_MAX = 20, FENSTER = 15 * 60 * 1000, SPERRE = 15 * 60 * 1000, MIN_LAENGE = 8;
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const nameKey = name => "n:" + String(name || "").trim().toLowerCase();
const ipKey = ip => (ip ? "ip:" + ip : "");

const minuten = ms => Math.max(1, Math.ceil(ms / 60000));
export const sperrText = ms => `Zu viele falsche Versuche – die Anmeldung ist für ${minuten(ms)} Minute${minuten(ms) === 1 ? "" : "n"} gesperrt. Passwort vergessen? Bitte im Büro melden.`;

// Gesperrt? → verbleibende Millisekunden, sonst 0
export async function gesperrt(env, name, ip, jetzt = Date.now()) {
  if (!hasDb(env)) return 0;
  let rest = 0;
  for (const k of [nameKey(name), ipKey(ip)].filter(Boolean)) {
    const r = await one(env, "SELECT gesperrt_bis FROM login_fehler WHERE schluessel = ?", k);
    if (r && r.gesperrt_bis > jetzt) rest = Math.max(rest, r.gesperrt_bis - jetzt);
  }
  return rest;
}

// Fehlversuch zählen → { rest: verbleibende Versuche für den Namen, sperre: ms (0 = nicht gesperrt) }
export async function fehlversuch(env, name, ip, jetzt = Date.now()) {
  if (!hasDb(env)) return { rest: NAME_MAX, sperre: 0 };
  const out = { rest: NAME_MAX, sperre: 0 };
  for (const [k, max] of [[nameKey(name), NAME_MAX], [ipKey(ip), IP_MAX]]) {
    if (!k) continue;
    const r = await one(env, "SELECT anzahl, erster, gesperrt_bis FROM login_fehler WHERE schluessel = ?", k);
    let anzahl = 1, erster = jetzt;
    if (r && jetzt - r.erster < FENSTER && r.gesperrt_bis <= jetzt) { anzahl = r.anzahl + 1; erster = r.erster; }
    const bis = anzahl >= max ? jetzt + SPERRE : 0;
    await run(env, `INSERT INTO login_fehler (schluessel, anzahl, erster, gesperrt_bis) VALUES (?, ?, ?, ?)
      ON CONFLICT(schluessel) DO UPDATE SET anzahl = excluded.anzahl, erster = excluded.erster, gesperrt_bis = excluded.gesperrt_bis`, k, anzahl, erster, bis);
    if (bis) out.sperre = Math.max(out.sperre, SPERRE);
    if (max === NAME_MAX) out.rest = Math.max(0, max - anzahl);
  }
  return out;
}

export async function erfolgreich(env, name) {
  if (hasDb(env)) await run(env, "DELETE FROM login_fehler WHERE schluessel = ?", nameKey(name));
}

// alte Einträge wegräumen (Cron)
export async function fehlerAufraeumen(env, jetzt = Date.now()) {
  if (hasDb(env)) await run(env, "DELETE FROM login_fehler WHERE erster < ? AND gesperrt_bis < ?", jetzt - 24 * 3600e3, jetzt);
}

// Eigenes Passwort ändern (me = angemeldete Person). Falsches bisheriges Passwort zählt als Fehlversuch.
export async function passwortAendern(env, me, b, ip) {
  if (!me || !me.name) throw fail("Bitte neu anmelden", 401);
  if (!hasDb(env)) throw fail("Passwort ändern geht erst, wenn die Mitarbeiter in der Datenbank sind – bitte im Büro melden.");
  const row = await one(env, "SELECT id, name, pw_hash FROM mitarbeiter WHERE name = ? COLLATE NOCASE AND aktiv = 1", me.name);
  if (!row) throw fail("Bitte neu anmelden", 401);
  const warte = await gesperrt(env, row.name, ip);
  if (warte) throw fail(sperrText(warte), 429);
  const alt = String(b.alt || ""), neu = String(b.neu || "");
  if (!(await pruefePasswort(alt, row.pw_hash))) {
    const f = await fehlversuch(env, row.name, ip);
    if (f.sperre) throw fail(sperrText(f.sperre), 429);
    throw fail("Das bisherige Passwort stimmt nicht" + (f.rest <= 2 ? ` (noch ${f.rest} Versuch${f.rest === 1 ? "" : "e"})` : ""), 403);
  }
  pruefeNeues(neu, alt, row.name);
  await run(env, "UPDATE mitarbeiter SET pw_hash = ?, pw_neu = 0 WHERE id = ?", await hashPasswort(neu), row.id);
  await erfolgreich(env, row.name);
  resetUsers();
  return row.name;
}

export function pruefeNeues(neu, alt, name) {
  if (neu.length < MIN_LAENGE) throw fail(`Das neue Passwort braucht mindestens ${MIN_LAENGE} Zeichen`);
  if (neu.length > 100) throw fail("Das neue Passwort ist zu lang");
  if (neu === alt) throw fail("Das neue Passwort muss anders sein als das bisherige");
  const vorname = String(name || "").toLowerCase().trim().split(/\s+/)[0];
  if ((vorname.length >= 3 && neu.toLowerCase().includes(vorname)) ||/^(.)\1+$/.test(neu) || /^(12345678|123456789|passwort|password|airtec)/i.test(neu))
    throw fail("Dieses Passwort ist zu leicht zu erraten – bitte ein anderes wählen");
}
