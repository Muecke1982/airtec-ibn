// Verwaltung fürs Büro: Mitarbeiter und Stammdaten in der Datenbank pflegen.
import { all, one, run, batch } from "./db.js";
import { hashPasswort } from "./passwort.js";
import { resetUsers } from "./auth.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const anzahl = async (env, tab) => (await one(env, `SELECT COUNT(*) AS n FROM ${tab}`)).n;

// ---------- Mitarbeiter ----------
export async function mitarbeiterListe(env) {
  const rows = await all(env, "SELECT id, name, mail, plan, schreiben, geb_tag, geb_monat, aktiv, pw_hash <> '' AS hat_pw FROM mitarbeiter ORDER BY aktiv DESC, pos, name");
  return rows.map(r => ({ id: r.id, name: r.name, mail: r.mail, plan: r.plan, schreiben: !!r.schreiben, aktiv: !!r.aktiv, hatPw: !!r.hat_pw,
    geb: r.geb_tag && r.geb_monat ? `${String(r.geb_tag).padStart(2, "0")}.${String(r.geb_monat).padStart(2, "0")}.` : "" }));
}

// Es muss immer mindestens eine aktive Person mit Büro-Recht und Passwort geben – sonst kommt niemand mehr in die Verwaltung.
const bueroZahl = async env => (await one(env, "SELECT COUNT(*) AS n FROM mitarbeiter WHERE aktiv = 1 AND schreiben = 1 AND pw_hash <> ''")).n;
// vorher: Anzahl vor der Änderung – blockiert wird nur, wenn die Änderung den letzten Büro-Zugang entfernt
async function bueroBleibt(env, vorher) {
  if (vorher > 0 && !(await bueroZahl(env))) throw fail("Das geht nicht: Danach gäbe es niemanden mehr mit Büro-Recht und Passwort.");
}

function geburtstag(s) {
  s = t(s, 20);
  if (!s) return [null, null];
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?/);
  if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) throw fail("Geburtstag bitte als TT.MM. angeben, z. B. 24.03.");
  return [+m[1], +m[2]];
}

export async function mitarbeiterSpeichern(env, me, b) {
  if (!(await anzahl(env, "mitarbeiter"))) throw fail("Bitte zuerst die Mitarbeiter aus Excel importieren.");
  const name = t(b.name, 80);
  if (!name) throw fail("Name fehlt");
  const [gt, gm] = geburtstag(b.geb);
  const vals = [name, t(b.mail, 120), t(b.plan, 80), b.schreiben ? 1 : 0, gt, gm, b.aktiv === false ? 0 : 1];
  const dup = await one(env, "SELECT id FROM mitarbeiter WHERE name = ? COLLATE NOCASE AND id <> ?", name, +b.id || 0);
  if (dup) throw fail(`„${name}“ gibt es schon`);
  if (b.id) {
    const alt = await one(env, "SELECT * FROM mitarbeiter WHERE id = ?", +b.id);
    if (!alt) throw fail("Mitarbeiter nicht gefunden – bitte neu laden", 404);
    if (alt.name.toLowerCase() === String(me.name).toLowerCase() && (!vals[3] || !vals[6])) throw fail("Das eigene Büro-Recht kann man sich nicht selbst entziehen.");
    const vorher = await bueroZahl(env);
    await batch(env, [["UPDATE mitarbeiter SET name=?, mail=?, plan=?, schreiben=?, geb_tag=?, geb_monat=?, aktiv=? WHERE id=?", ...vals, +b.id]]);
    try { await bueroBleibt(env, vorher); } catch (e) {   // rückgängig machen
      await run(env, "UPDATE mitarbeiter SET name=?, mail=?, plan=?, schreiben=?, geb_tag=?, geb_monat=?, aktiv=? WHERE id=?",
        alt.name, alt.mail, alt.plan, alt.schreiben, alt.geb_tag, alt.geb_monat, alt.aktiv, alt.id);
      throw e;
    }
  } else {
    const pos = (await one(env, "SELECT COALESCE(MAX(pos), 0) + 1 AS p FROM mitarbeiter")).p;
    const pw = t(b.passwort, 100);
    if (pw && pw.length < 6) throw fail("Passwort bitte mit mindestens 6 Zeichen");
    await run(env, "INSERT INTO mitarbeiter (name, mail, plan, schreiben, geb_tag, geb_monat, aktiv, pos, pw_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ...vals, pos, pw ? await hashPasswort(pw) : "");
  }
  resetUsers();
  return mitarbeiterListe(env);
}

export async function mitarbeiterPasswort(env, b) {
  const pw = t(b.passwort, 100);
  if (pw.length < 6) throw fail("Passwort bitte mit mindestens 6 Zeichen");
  const r = await run(env, "UPDATE mitarbeiter SET pw_hash = ? WHERE id = ?", await hashPasswort(pw), +b.id);
  if (!r.meta.changes) throw fail("Mitarbeiter nicht gefunden – bitte neu laden", 404);
  resetUsers();
  return mitarbeiterListe(env);
}

export async function mitarbeiterLoeschen(env, me, b) {
  const alt = await one(env, "SELECT * FROM mitarbeiter WHERE id = ?", +b.id);
  if (!alt) return mitarbeiterListe(env);
  if (alt.name.toLowerCase() === String(me.name).toLowerCase()) throw fail("Sich selbst kann man nicht löschen.");
  const vorher = await bueroZahl(env);
  await run(env, "DELETE FROM mitarbeiter WHERE id = ?", alt.id);
  try { await bueroBleibt(env, vorher); } catch (e) {
    await run(env, "INSERT INTO mitarbeiter (id, name, mail, pw_hash, plan, schreiben, geb_tag, geb_monat, aktiv, pos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      alt.id, alt.name, alt.mail, alt.pw_hash, alt.plan, alt.schreiben, alt.geb_tag, alt.geb_monat, alt.aktiv, alt.pos);
    throw e;
  }
  resetUsers();
  return mitarbeiterListe(env);
}

// ---------- Stammdaten ----------
export async function stammListe(env) {
  const listen = await all(env, "SELECT name, frei FROM listen ORDER BY pos, name");
  const werte = await all(env, "SELECT liste, wert FROM listen_werte ORDER BY liste, pos, wert");
  const up = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'upload_link'");
  return {
    listen: listen.map(l => ({ name: l.name, frei: !!l.frei, werte: werte.filter(w => w.liste === l.name).map(w => w.wert) })),
    nach: await all(env, "SELECT geraet, km, f6, f10, f12, f16 FROM nachfuell ORDER BY pos, id"),
    gwp: await all(env, "SELECT kaeltemittel, wert FROM gwp ORDER BY kaeltemittel"),
    docs: await all(env, "SELECT hersteller, kit, name, url FROM dokumente ORDER BY pos, id"),
    upload: (up && up.wert) || "",
  };
}

async function stammDa(env) { if (!(await anzahl(env, "listen"))) throw fail("Bitte zuerst die Stammdaten aus Excel importieren."); }
const uniq = list => { const s = new Set(); return list.filter(x => { const k = x.toLowerCase(); if (!x || s.has(k)) return false; s.add(k); return true; }); };

// Eine Auswahlliste speichern (neu, umbenennen, Werte ersetzen)
export async function listeSpeichern(env, b) {
  await stammDa(env);
  const name = t(b.name, 80), alt = t(b.alt, 80) || name;
  if (!name) throw fail("Name der Liste fehlt");
  const werte = uniq((Array.isArray(b.werte) ? b.werte : String(b.werte || "").split("\n")).map(w => t(w, 120)));
  if (name.toLowerCase() !== alt.toLowerCase() && await one(env, "SELECT 1 FROM listen WHERE name = ? COLLATE NOCASE", name)) throw fail(`Liste „${name}“ gibt es schon`);
  const da = await one(env, "SELECT pos FROM listen WHERE name = ?", alt);
  const pos = da ? da.pos : (await one(env, "SELECT COALESCE(MAX(pos), 0) + 1 AS p FROM listen")).p;
  await batch(env, [
    ["DELETE FROM listen_werte WHERE liste = ?", alt],
    ["DELETE FROM listen WHERE name = ?", alt],
    ["INSERT INTO listen (name, frei, pos) VALUES (?, ?, ?)", name, b.frei === false ? 0 : 1, pos],
    ...werte.map((w, i) => ["INSERT INTO listen_werte (liste, wert, pos) VALUES (?, ?, ?)", name, w, i]),
  ]);
  return stammListe(env);
}

export async function listeLoeschen(env, b) {
  await stammDa(env);
  await batch(env, [["DELETE FROM listen_werte WHERE liste = ?", t(b.name, 80)], ["DELETE FROM listen WHERE name = ?", t(b.name, 80)]]);
  return stammListe(env);
}

// Tabellen (Nachfüllmengen, GWP, Dokumente) komplett ersetzen
export async function tabelleSpeichern(env, b) {
  await stammDa(env);
  const rows = Array.isArray(b.zeilen) ? b.zeilen.slice(0, 2000) : [];
  if (b.tabelle === "nach") {
    const z = rows.map(r => [t(r.geraet, 120), t(r.km, 20), t(r.f6, 20), t(r.f10, 20), t(r.f12, 20), t(r.f16, 20)]).filter(r => r[0]);
    await batch(env, [["DELETE FROM nachfuell"], ...z.map((r, i) => ["INSERT INTO nachfuell (geraet, km, f6, f10, f12, f16, pos) VALUES (?, ?, ?, ?, ?, ?, ?)", ...r, i])]);
  } else if (b.tabelle === "gwp") {
    const z = [];
    for (const r of rows) {
      const k = t(r.kaeltemittel, 40), w = String(r.wert ?? "").replace(",", ".").trim();
      if (!k) continue;
      if (!isFinite(+w) || w === "") throw fail(`GWP für ${k} ist keine Zahl`);
      if (!z.some(x => x[0].toLowerCase() === k.toLowerCase())) z.push([k, +w]);
    }
    await batch(env, [["DELETE FROM gwp"], ...z.map(r => ["INSERT INTO gwp (kaeltemittel, wert) VALUES (?, ?)", ...r])]);
  } else if (b.tabelle === "docs") {
    const z = rows.map(r => [t(r.hersteller, 120), t(r.kit, 120), t(r.name, 160), t(r.url, 1000)]).filter(r => r[0] || r[3]);
    for (const r of z) if (!r[0] || !/^https?:\/\//i.test(r[3])) throw fail(`Dokument „${r[2] || r[0]}“: Hersteller und ein Link (https://…) werden benötigt`);
    await batch(env, [["DELETE FROM dokumente"], ...z.map((r, i) => ["INSERT INTO dokumente (hersteller, kit, name, url, pos) VALUES (?, ?, ?, ?, ?)", ...r, i])]);
  } else if (b.tabelle === "upload") {
    const u = t(b.wert, 1000);
    if (u && !/^https?:\/\//i.test(u)) throw fail("Der Upload-Link muss mit https:// beginnen");
    await run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('upload_link', ?)", u);
  } else throw fail("Unbekannte Tabelle");
  return stammListe(env);
}
