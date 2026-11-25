// Verwaltung fürs Büro: Mitarbeiter (mit Rechten) und Stammdaten in der Datenbank pflegen.
//
// Regeln für Rechte und Admin:
//  • Der Admin (genau eine Person) hat immer alle Rechte und ist immer aktiv.
//  • Den Admin kann nur der Admin selbst ändern (auch Passwort); löschen geht gar nicht.
//  • Das Recht „Mitarbeiter verwalten“ vergibt oder entzieht nur der Admin – auch Personen mit diesem Recht
//    deaktiviert oder löscht nur der Admin.
//  • Den Admin weitergeben kann nur der Admin.
import { all, one, run, batch } from "./db.js";
import { hashPasswort } from "./passwort.js";
import { resetUsers } from "./auth.js";
import { ALLE, MONTEUR, rechteAus, rechteText, istBuero } from "./rechte.js";
import { ARTEN as PUSH_ARTEN, geraete } from "./push.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const anzahl = async (env, tab) => (await one(env, `SELECT COUNT(*) AS n FROM ${tab}`)).n;
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// Art des Mitarbeiters (Auswahlfeld, Anzeige im Wochenplan)
export const ARTEN_MA = ["Meister", "Techniker", "Monteur", "Helfer", "Azubi", "Praktikant"];
const artAus = v => ARTEN_MA.find(a => same(a, t(v, 40))) || "Monteur";

// ---------- Mitarbeiter ----------
export async function mitarbeiterListe(env) {
  const rows = await all(env, "SELECT id, name, mail, plan, rechte, admin, geb_tag, geb_monat, aktiv, telefon, adresse, schluessel, alarm, mitteilungen_aus, pw_hash <> '' AS hat_pw, pw_neu, art, im_plan FROM mitarbeiter ORDER BY admin DESC, aktiv DESC, pos, name");
  const sperren = new Set((await all(env, "SELECT schluessel FROM login_fehler WHERE gesperrt_bis > ?", Date.now())).map(r => r.schluessel));
  const handys = await geraete(env).catch(() => ({}));
  return rows.map(r => ({ id: r.id, name: r.name, mail: r.mail, plan: r.plan, art: r.art || "Monteur", imPlan: r.im_plan !== 0, rechte: r.admin ? [...ALLE] : rechteAus(r.rechte), admin: !!r.admin,
    aktiv: !!r.aktiv, hatPw: !!r.hat_pw, pwNeu: !!r.hat_pw && !!r.pw_neu, gesperrt: sperren.has("n:" + String(r.name).trim().toLowerCase()), telefon: r.telefon, adresse: r.adresse, schluessel: r.schluessel, alarm: r.alarm,
    mitteilungenAus: String(r.mitteilungen_aus || "").split(",").filter(Boolean), handys: handys[String(r.name).toLowerCase().trim()] || 0,
    geb: r.geb_tag && r.geb_monat ? `${String(r.geb_tag).padStart(2, "0")}.${String(r.geb_monat).padStart(2, "0")}.` : "" }));
}

// Ohne Admin (z. B. vor dem Festlegen) gilt die alte Sicherung: mindestens eine aktive Person mit
// „Mitarbeiter verwalten“ und Passwort muss bleiben. Mit Admin ist das nie ein Problem.
const verwalterZahl = async env => (await one(env,
  "SELECT COUNT(*) AS n FROM mitarbeiter WHERE aktiv = 1 AND pw_hash <> '' AND (admin = 1 OR ',' || rechte || ',' LIKE '%,mitarbeiter,%')")).n;
async function verwalterBleibt(env, vorher) {
  if (vorher > 0 && !(await verwalterZahl(env))) throw fail("Das geht nicht: Danach könnte niemand mehr Mitarbeiter verwalten.");
}

function geburtstag(s) {
  s = t(s, 20);
  if (!s) return [null, null];
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?/);
  if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) throw fail("Geburtstag bitte als TT.MM. angeben, z. B. 24.03.");
  return [+m[1], +m[2]];
}

const NUR_ADMIN = "Nur der Admin kann das Recht „Mitarbeiter verwalten“ vergeben oder entziehen.";

export async function mitarbeiterSpeichern(env, me, b) {
  if (!(await anzahl(env, "mitarbeiter"))) throw fail("Bitte zuerst die Mitarbeiter aus Excel importieren.");
  const name = t(b.name, 80);
  if (!name) throw fail("Name fehlt");
  const [gt, gm] = geburtstag(b.geb);
  let rechte = Array.isArray(b.rechte) ? rechteAus(b.rechte.join(",")) : [...MONTEUR];
  let aktiv = b.aktiv === false ? 0 : 1;
  const extra = [t(b.telefon, 40), t(b.adresse, 300), t(b.schluessel, 60), t(b.alarm, 60)];   // Telefon, Adresse, Schlüssel-Nr., Alarmanlagen-Schlüssel
  const dup = await one(env, "SELECT id FROM mitarbeiter WHERE name = ? COLLATE NOCASE AND id <> ?", name, +b.id || 0);
  if (dup) throw fail(`„${name}“ gibt es schon`);

  if (b.id) {
    const alt = await one(env, "SELECT * FROM mitarbeiter WHERE id = ?", +b.id);
    if (!alt) throw fail("Mitarbeiter nicht gefunden – bitte neu laden", 404);
    if (alt.admin) {
      if (!me.admin) throw fail("Den Admin kann nur der Admin selbst ändern.", 403);
      rechte = [...ALLE]; aktiv = 1;   // Admin hat immer alles und bleibt aktiv
    }
    const hatte = rechteAus(alt.rechte).includes("mitarbeiter") || !!alt.admin, hat = rechte.includes("mitarbeiter");
    if (!me.admin && (hatte !== hat || (hatte && !aktiv && alt.aktiv))) throw fail(NUR_ADMIN, 403);
    if (same(alt.name, me.name) && !aktiv) throw fail("Sich selbst kann man nicht deaktivieren.");
    const vals = [name, t(b.mail, 120), t(b.plan, 80), rechteText(rechte), istBuero({ rechte }) ? 1 : 0, gt, gm, aktiv, ...extra];
    const vorher = await verwalterZahl(env);
    await run(env, "UPDATE mitarbeiter SET name=?, mail=?, plan=?, rechte=?, schreiben=?, geb_tag=?, geb_monat=?, aktiv=?, telefon=?, adresse=?, schluessel=?, alarm=? WHERE id=?", ...vals, alt.id);
    try { await verwalterBleibt(env, vorher); } catch (e) {   // rückgängig machen
      await run(env, "UPDATE mitarbeiter SET name=?, mail=?, plan=?, rechte=?, schreiben=?, geb_tag=?, geb_monat=?, aktiv=?, telefon=?, adresse=?, schluessel=?, alarm=? WHERE id=?",
        alt.name, alt.mail, alt.plan, alt.rechte, alt.schreiben, alt.geb_tag, alt.geb_monat, alt.aktiv, alt.telefon, alt.adresse, alt.schluessel, alt.alarm, alt.id);
      throw e;
    }
  } else {
    if (rechte.includes("mitarbeiter") && !me.admin) throw fail(NUR_ADMIN, 403);
    const pos = (await one(env, "SELECT COALESCE(MAX(pos), 0) + 1 AS p FROM mitarbeiter")).p;
    const pw = t(b.passwort, 100);
    if (pw && pw.length < 6) throw fail("Passwort bitte mit mindestens 6 Zeichen");
    await run(env, "INSERT INTO mitarbeiter (name, mail, plan, rechte, schreiben, geb_tag, geb_monat, aktiv, pos, pw_hash, pw_neu, telefon, adresse, schluessel, alarm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      name, t(b.mail, 120), t(b.plan, 80), rechteText(rechte), istBuero({ rechte }) ? 1 : 0, gt, gm, aktiv, pos, pw ? await hashPasswort(pw) : "", pw ? 1 : 0, ...extra);
  }
  // Art (nur wenn das Formular sie mitschickt – neue Mitarbeiter ohne Angabe = Monteur)
  if (b.art !== undefined) await run(env, "UPDATE mitarbeiter SET art = ? WHERE name = ? COLLATE NOCASE", artAus(b.art), name);
  // im Wochenplan anzeigen (aus = nur sichtbar, wenn eingeplant – z. B. Praktikant)
  if (b.imPlan !== undefined) await run(env, "UPDATE mitarbeiter SET im_plan = ? WHERE name = ? COLLATE NOCASE", b.imPlan === false ? 0 : 1, name);
  // Handy-Mitteilungen: ausgeschaltete Arten (nur wenn das Formular sie mitschickt)
  if (Array.isArray(b.mitteilungenAus)) {
    const aus = PUSH_ARTEN.map(a => a[0]).filter(k => b.mitteilungenAus.includes(k)).join(",");
    await run(env, "UPDATE mitarbeiter SET mitteilungen_aus = ? WHERE name = ? COLLATE NOCASE", aus, name);
  }
  resetUsers();
  return mitarbeiterListe(env);
}

export async function mitarbeiterPasswort(env, me, b) {
  const pw = t(b.passwort, 100);
  if (pw.length < 6) throw fail("Passwort bitte mit mindestens 6 Zeichen");
  const alt = await one(env, "SELECT id, name, admin, rechte FROM mitarbeiter WHERE id = ?", +b.id);
  if (!alt) throw fail("Mitarbeiter nicht gefunden – bitte neu laden", 404);
  if (alt.admin && !me.admin) throw fail("Das Passwort des Admins kann nur der Admin selbst ändern.", 403);
  // andere Verwalter: nur der Admin (sonst könnte sich ein Verwalter als ein anderer anmelden)
  if (!me.admin && !same(alt.name, me.name) && rechteAus(alt.rechte).includes("mitarbeiter"))
    throw fail("Das Passwort eines anderen Verwalters kann nur der Admin neu setzen.", 403);
  // Startpasswort: die Person muss beim nächsten Öffnen ein eigenes wählen (außer man setzt sein eigenes)
  await run(env, "UPDATE mitarbeiter SET pw_hash = ?, pw_neu = ? WHERE id = ?", await hashPasswort(pw), same(alt.name, me.name) ? 0 : 1, alt.id);
  await run(env, "DELETE FROM login_fehler WHERE schluessel = ?", "n:" + String(alt.name).trim().toLowerCase());   // Sperre aufheben
  resetUsers();
  return mitarbeiterListe(env);
}

export async function mitarbeiterLoeschen(env, me, b) {
  const alt = await one(env, "SELECT * FROM mitarbeiter WHERE id = ?", +b.id);
  if (!alt) return mitarbeiterListe(env);
  if (alt.admin) throw fail("Der Admin kann nicht gelöscht werden.", 403);
  if (same(alt.name, me.name)) throw fail("Sich selbst kann man nicht löschen.");
  if (rechteAus(alt.rechte).includes("mitarbeiter") && !me.admin) throw fail(NUR_ADMIN, 403);
  const vorher = await verwalterZahl(env);
  await run(env, "DELETE FROM mitarbeiter WHERE id = ?", alt.id);
  try { await verwalterBleibt(env, vorher); } catch (e) {
    const k = Object.keys(alt);   // alle Spalten wiederherstellen
    await run(env, `INSERT INTO mitarbeiter (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`, ...k.map(x => alt[x]));
    throw e;
  }
  await run(env, "DELETE FROM fs_pruefungen WHERE mitarbeiter_id = ?", alt.id);
  await run(env, "DELETE FROM fs_meldungen WHERE mitarbeiter_id = ?", alt.id);
  resetUsers();
  return mitarbeiterListe(env);
}

// Admin an eine andere Person weitergeben (nur der Admin selbst)
export async function adminUebergeben(env, me, b) {
  if (!me.admin) throw fail("Nur der Admin kann den Admin weitergeben.", 403);
  const neu = await one(env, "SELECT * FROM mitarbeiter WHERE id = ?", +b.id);
  if (!neu) throw fail("Mitarbeiter nicht gefunden – bitte neu laden", 404);
  if (!neu.aktiv || !neu.pw_hash) throw fail("Der neue Admin muss aktiv sein und ein Passwort haben.");
  await batch(env, [
    ["UPDATE mitarbeiter SET admin = 0, rechte = ? WHERE admin = 1", rechteText(ALLE)],   // bisheriger Admin behält alle Rechte
    ["UPDATE mitarbeiter SET admin = 1, rechte = ?, schreiben = 1 WHERE id = ?", rechteText(ALLE), neu.id],
  ]);
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
