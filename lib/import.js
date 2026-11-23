// Einmal-Import: bestehende Excel-Dateien aus SharePoint in die Datenbank übernehmen.
// Je Bereich werden die Tabellen in der Datenbank vollständig ersetzt (alles oder nichts).
import { batch, all, one, jetzt, isoZeit, schemaVersion, hasDb } from "./db.js";
import { hashPasswort } from "./passwort.js";
import { rechteText, ALLE } from "./rechte.js";
import { parseUsers, zugangPath } from "./auth.js";
import { readFirstSheet } from "./xlsx.js";
import { download } from "./graph.js";
import { load as ladeMaschinen, path as maschinenPath } from "./maschinen.js";
import { load as ladeLager, path as lagerPath } from "./lager.js";
import { load as ladeHinweise, path as hinweisePath } from "./hinweise.js";
import { load as ladeMuell } from "./muell.js";
import { load as ladeUrlaub, path as urlaubPath } from "./urlaub.js";

export const BEREICHE = {
  mitarbeiter: { titel: "Mitarbeiter (Zugänge)", tabellen: ["mitarbeiter"], datei: zugangPath },
  stammdaten: { titel: "Stammdaten (Protokoll)", tabellen: ["listen", "listen_werte", "nachfuell", "gwp", "dokumente"], datei: null },
  maschinen: { titel: "Maschinen", tabellen: ["maschinen", "ausleihen", "reservierungen", "verleih_empfaenger"], datei: maschinenPath },
  lager: { titel: "Lager", tabellen: ["kategorien", "unterkategorien", "artikel", "lieferanten", "meldungen", "bestellungen"], datei: lagerPath },
  hinweise: { titel: "Hinweise (Austausch) und Restmüll", tabellen: ["hinweise", "hinweise_erledigt", "muell",
    "nachrichten", "nachricht_an", "nachricht_status", "antworten", "umfrage_optionen", "stimmen"], datei: hinweisePath },
  urlaub: { titel: "Urlaub", tabellen: ["urlaub"], datei: urlaubPath },
};

// INSERT für viele Zeilen – aufgeteilt, damit je Anweisung höchstens 100 Werte gebunden werden (Grenze von D1)
function inserts(table, cols, rows) {
  const per = Math.max(1, Math.floor(100 / cols.length));
  const out = [];
  for (let i = 0; i < rows.length; i += per) {
    const part = rows.slice(i, i + per);
    out.push([`INSERT INTO ${table} (${cols.join(", ")}) VALUES ` + part.map(() => "(" + cols.map(() => "?").join(", ") + ")").join(", "),
      ...part.flatMap(r => cols.map((c, k) => r[k] === undefined ? null : r[k]))]);
  }
  return out;
}
const t = v => String(v ?? "").trim();
// doppelte Schlüssel entfernen (erster Eintrag gewinnt), Vergleich ohne Groß-/Kleinschreibung
const unique = (list, key) => { const seen = new Set(); return list.filter(x => { const k = t(key(x)).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const nachZeit = list => [...list].sort((a, b) => a.zeit.localeCompare(b.zeit));

// ---------- je Bereich: Excel lesen → Anweisungen ----------
async function mitarbeiter(env, bytes) {
  const list = unique(parseUsers(await readFirstSheet(bytes)), u => u.name);
  const rows = [];
  for (const [i, u] of list.entries())
    rows.push([u.name, u.mail, u.pw ? await hashPasswort(u.pw) : "", u.plan === u.name ? "" : u.plan, u.write ? 1 : 0, rechteText(u.rechte),
      u.geb ? u.geb.t : null, u.geb ? u.geb.m : null, i]);
  // Admin bleibt beim erneuten Import erhalten (sonst: Sebastian Stern, wie festgelegt)
  const adm = await one(env, "SELECT name FROM mitarbeiter WHERE admin = 1");
  const kandidaten = adm ? [adm.name] : ["Sebastian Stern", "Sebastian"];
  return { anzahl: `${rows.length} Mitarbeiter`, sql: [
    ...inserts("mitarbeiter", ["name", "mail", "pw_hash", "plan", "schreiben", "rechte", "geb_tag", "geb_monat", "pos"], rows),
    ...kandidaten.map(n => ["UPDATE mitarbeiter SET admin = 1, rechte = ? WHERE id = (SELECT id FROM mitarbeiter WHERE name = ? COLLATE NOCASE LIMIT 1) AND NOT EXISTS (SELECT 1 FROM mitarbeiter WHERE admin = 1)",
      rechteText(ALLE), n]),
    // Passwörter aus der Excel-Liste kennt das Büro → beim ersten Öffnen eigenes Passwort wählen (außer Admin)
    ["UPDATE mitarbeiter SET pw_neu = 1 WHERE pw_hash <> '' AND admin = 0"],
  ] };
}

// Stammdaten: Die App liest die Excel im Browser (wegen der Links im Blatt „Dokumente“) und schickt das Ergebnis.
function stammdaten(st) {
  if (!st || typeof st !== "object" || !st.lists) throw Object.assign(new Error("Stammdaten fehlen – bitte zuerst „Stammdaten aus SharePoint neu laden“"), { status: 400 });
  const names = Object.keys(st.lists);
  const werte = names.flatMap(n => unique((st.lists[n] || []).map(String), w => w).map((w, i) => [n, t(w), i]));
  const nach = (st.nach || []).filter(x => t(x.h)).map((x, i) => [t(x.h), t(x.km), t(x.f && x.f[6]), t(x.f && x.f[10]), t(x.f && x.f[12]), t(x.f && x.f[16]), i]);
  const gwp = Object.entries(st.gwp || {}).filter(([k, v]) => t(k) && isFinite(+v)).map(([k, v]) => [t(k), +v]);
  const docs = (st.docs || []).filter(d => t(d.h) && t(d.url)).map((d, i) => [t(d.h), t(d.kit), t(d.name), t(d.url), i]);
  const sql = [
    ...inserts("listen", ["name", "frei", "pos"], names.map((n, i) => [n, st.free && st.free[n] === false ? 0 : 1, i])),
    ...inserts("listen_werte", ["liste", "wert", "pos"], werte),
    ...inserts("nachfuell", ["geraet", "km", "f6", "f10", "f12", "f16", "pos"], nach),
    ...inserts("gwp", ["kaeltemittel", "wert"], unique(gwp, x => x[0])),
    ...inserts("dokumente", ["hersteller", "kit", "name", "url", "pos"], docs),
  ];
  const extra = [];
  if (st.upload) extra.push(["INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('upload_link', ?)", t(st.upload)]);
  // Monteur-Liste aus den Stammdaten aufheben – künftig kommt sie aus den Mitarbeitern
  if (st.monteure) extra.push(["INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('stamm_monteure', ?)", JSON.stringify(st.monteure)]);
  return { anzahl: `${names.length} Auswahllisten, ${werte.length} Einträge, ${nach.length} Nachfüllmengen, ${gwp.length} GWP, ${docs.length} Dokumente`, sql: [...sql, ...extra] };
}

async function maschinen(env, bytes) {
  const d = await ladeMaschinen(env, bytes);
  const ms = unique(d.machines, m => m.id);
  const ids = new Set(ms.map(m => m.id));
  const log = nachZeit(d.log.map(e => ({ ...e, mid: e.nr || e.name, zeit: isoZeit(e.von) })).filter(e => ids.has(e.mid) && e.zeit));
  const res = d.res.map(r => ({ ...r, mid: r.nr || r.name })).filter(r => ids.has(r.mid) && isoZeit(r.von));
  return {
    anzahl: `${ms.length} Maschinen, ${log.length} Ausleihen, ${res.length} Reservierungen`,
    sql: [
      ...inserts("maschinen", ["id", "nr", "name", "typ", "sn", "kat", "bem", "pos"], ms.map((m, i) => [m.id, m.nr, m.name, m.typ, m.sn, m.kat, m.bem, i])),
      ...inserts("ausleihen", ["maschine_id", "wer", "von", "bis", "bestaetigt", "bem", "an", "kontakt", "frist", "baustelle"],
        log.map(e => [e.mid, e.wer, e.zeit, isoZeit(e.bis), isoZeit(e.best), e.bem, e.an, e.kontakt, isoZeit(e.frist).slice(0, 10), e.bst])),
      ...inserts("reservierungen", ["maschine_id", "fuer", "von", "bis", "notiz", "von_wem", "am"],
        res.map(r => [r.mid, r.fuer, isoZeit(r.von).slice(0, 10), (isoZeit(r.bis) || isoZeit(r.von)).slice(0, 10), r.notiz, r.by, isoZeit(r.am)])),
      ...inserts("verleih_empfaenger", ["name", "pos"], unique(d.empf, x => x).map((n, i) => [n, i])),
      ["INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('verleih_erinnerung_tage', ?)", String(d.every || 3)],
    ],
  };
}

async function lager(env, bytes) {
  const d = await ladeLager(env, bytes);
  const kats = unique(d.kats, k => k.name);
  const katId = Object.fromEntries(kats.map((k, i) => [k.id, i + 1]));
  const arts = unique(d.arts.filter(a => katId[a.kat]), a => a.nr);
  const lief = unique(d.lief, l => l.name);
  const meld = nachZeit(d.meld.map(m => ({ ...m, zeit: isoZeit(m.am) || jetzt() })));
  const best = [...d.bestellungen].reverse();
  return {
    anzahl: `${kats.length} Kategorien, ${arts.length} Artikel, ${lief.length} Lieferanten, ${meld.length} Meldungen, ${best.length} Bestellungen`,
    sql: [
      ...inserts("kategorien", ["id", "name", "kuerzel", "symbol", "sort"], kats.map((k, i) => [i + 1, k.name, k.pre, k.sym, k.sort])),
      ...inserts("unterkategorien", ["kategorie_id", "name", "pos"], kats.flatMap((k, i) => unique(k.subs, s => s).map((s, j) => [i + 1, s, j]))),
      ...inserts("artikel", ["nr", "kategorie_id", "unterkategorie", "bez", "groesse", "hersteller", "lieferant", "bestellnr", "einheit", "ve", "menge", "lagerort", "haeufig", "such", "pos"],
        arts.map(a => [a.nr, katId[a.kat], a.sub, a.bez, a.gr, a.herst, a.lief, a.best, a.einh, a.ve, a.menge, a.ort, a.fav ? 1 : 0, a.such, a.pos])),
      ...inserts("lieferanten", ["name", "mail", "cc", "kundennr", "kontakt"], lief.map(l => [l.name, l.mail, l.cc, l.kd, l.kontakt])),
      ...inserts("meldungen", ["nr", "artikel", "lieferant", "status", "von", "am", "bestellt_am", "bestellt_von", "bem"],
        meld.map(m => [m.nr, m.art, m.lief, m.status, m.von, m.zeit, isoZeit(m.best), m.bestVon, m.bem])),
      ...inserts("bestellungen", ["am", "lieferant", "an", "von", "positionen", "anzahl"], best.map(r => [isoZeit(r[0]) || r[0], r[1], r[2], r[3], r[4], +r[5] || 0])),
    ],
  };
}

async function hinweise(env, bytes) {
  const d = await ladeHinweise(env, bytes);
  const m = await ladeMuell(env, bytes);
  const list = nachZeit(d.list.map(r => ({ ...r, zeit: isoZeit(r.erstellt) || jetzt() })));
  const sql = [];
  // Hinweise einzeln mit fester Nummer anlegen, damit „erledigt“-Einträge dazu passen
  list.forEach((r, i) => {
    sql.push(["INSERT INTO hinweise (id, an, text, von, erstellt, ab, bis, pin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      i + 1, r.an, r.text, r.von, r.zeit, isoZeit(r.ab).slice(0, 10), isoZeit(r.bis).slice(0, 10), r.pin ? 1 : 0]);
  });
  sql.push(...inserts("hinweise_erledigt", ["hinweis_id", "wer", "am"],
    list.flatMap((r, i) => unique(r.done, x => x.wer).map(x => [i + 1, x.wer, isoZeit(x.am)]))));
  // in den Austausch übernehmen (wie Datenbank-Migration 6)
  sql.push(["INSERT INTO nachrichten (id, typ, von, text, pin, ab, bis, erstellt, zuletzt) SELECT id, CASE WHEN text LIKE '🎉%' THEN 'gruss' ELSE 'nachricht' END, von, text, pin, ab, bis, erstellt, erstellt FROM hinweise"],
    ["INSERT OR IGNORE INTO nachricht_an (nachricht_id, empfaenger) SELECT id, CASE WHEN lower(an) IN ('alle', 'alle monteure', 'jeder', '*') THEN '*alle' WHEN lower(an) IN ('büro', 'buero', 'buro', 'büro team', 'an das büro') THEN '*buero' ELSE an END FROM hinweise"],
    ["INSERT OR IGNORE INTO nachricht_status (nachricht_id, wer, gelesen, erledigt) SELECT hinweis_id, wer, am, am FROM hinweise_erledigt"]);
  const ml = [...m.log].reverse().filter(r => isoZeit(r[0]));
  sql.push(...inserts("muell", ["am", "von", "an"], ml.map(r => [isoZeit(r[0]), r[1], r[2]])));
  const keys = { "Empfänger": "muell_empfaenger", "Kopie (CC)": "muell_cc", "Absender": "muell_absender", "Betreff": "muell_betreff", "Text": "muell_text" };
  for (const [k, s] of Object.entries(keys)) sql.push(["INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES (?, ?)", s, String(m.s[k] ?? "")]);
  return { anzahl: `${list.length} Hinweise, ${ml.length} Müll-Anforderungen`, sql };
}

async function urlaub(env, bytes) {
  const d = await ladeUrlaub(env, bytes);
  const seen = new Set();
  const list = d.list.filter(r => { if (!r.mid) return true; if (seen.has(r.mid)) return false; seen.add(r.mid); return true; })
    .map(r => ({ ...r, zeit: isoZeit(r.eingang) || r.von || "" }));
  return {
    anzahl: `${list.length} Urlaubseinträge`,
    sql: inserts("urlaub", ["name", "von", "bis", "status", "tage", "eingang", "betreff", "im_plan", "mail_id", "hinweis"],
      nachZeit(list).map(r => [r.name, r.von, r.bis, r.status, r.tage, isoZeit(r.eingang), r.betreff, r.plan, r.mid || null, r.hinweis])),
  };
}

const LESER = { mitarbeiter, maschinen, lager, hinweise, urlaub };

// b: { bereich, datei?: base64 (statt SharePoint), stamm?: {…} (nur Stammdaten) }
export async function importiere(env, me, b) {
  const B = BEREICHE[b.bereich];
  if (!B) throw Object.assign(new Error("Unbekannter Bereich"), { status: 400 });
  let erg;
  if (b.bereich === "stammdaten") erg = stammdaten(b.stamm);
  else {
    const bytes = b.datei ? Uint8Array.from(atob(String(b.datei).replace(/^data:[^,]*,/, "")), c => c.charCodeAt(0))
      : await download(env, B.datei(env));
    erg = await LESER[b.bereich](env, bytes);
  }
  const loeschen = B.tabellen.map(tb => [`DELETE FROM ${tb}`]);
  await batch(env, [...loeschen, ...erg.sql,
    ["INSERT OR REPLACE INTO importe (bereich, am, von, anzahl) VALUES (?, ?, ?, ?)", b.bereich, jetzt(), me.name || "Firmen-Code", erg.anzahl]]);
  return { bereich: b.bereich, anzahl: erg.anzahl };
}

// Überblick für die Verwaltung: Datenbank verbunden? Was wurde wann importiert? Wie viele Einträge je Tabelle?
export async function status(env) {
  if (!hasDb(env)) return { verbunden: false };
  const version = await schemaVersion(env);
  const importe = Object.fromEntries((await all(env, "SELECT bereich, am, von, anzahl FROM importe")).map(r => [r.bereich, r]));
  const bereiche = [];
  for (const [id, B] of Object.entries(BEREICHE)) {
    const zahlen = {};
    for (const tb of B.tabellen) zahlen[tb] = (await one(env, `SELECT COUNT(*) AS n FROM ${tb}`)).n;
    bereiche.push({ id, titel: B.titel, zahlen, import: importe[id] || null });
  }
  const adminDa = !!(await one(env, "SELECT 1 AS x FROM mitarbeiter WHERE admin = 1"));
  return { verbunden: true, version, bereiche, adminDa };
}
