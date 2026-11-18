// Datenbank (Cloudflare D1, Bindung „DB“ in wrangler.jsonc).
// Die Tabellen legt die App beim ersten Zugriff selbst an. Neue Änderungen am Aufbau kommen als weitere
// Einträge unten in MIGRATIONS dazu – niemals bestehende Einträge ändern, sonst passt die Datenbank nicht mehr.
//
// Zeitangaben werden als Text in deutscher Zeit gespeichert: „JJJJ-MM-TT HH:MM“ (Zeitpunkt) bzw. „JJJJ-MM-TT“ (Tag).
// So sortieren sie richtig und lassen sich direkt vergleichen.

const MIGRATIONS = [
  // 1: Grundaufbau
  `
  CREATE TABLE mitarbeiter (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    mail TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL DEFAULT '',          -- PBKDF2, „pbkdf2$<runden>$<salt>$<hash>“
    plan TEXT NOT NULL DEFAULT '',             -- Name im Wochenplan
    schreiben INTEGER NOT NULL DEFAULT 0,      -- 1 = Büro
    geb_tag INTEGER, geb_monat INTEGER,
    aktiv INTEGER NOT NULL DEFAULT 1,
    pos INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE einstellungen (schluessel TEXT PRIMARY KEY, wert TEXT NOT NULL DEFAULT '');

  -- Stammdaten fürs Protokoll
  CREATE TABLE listen (name TEXT PRIMARY KEY, frei INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE listen_werte (liste TEXT NOT NULL, wert TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (liste, wert));
  CREATE TABLE nachfuell (id INTEGER PRIMARY KEY AUTOINCREMENT, geraet TEXT NOT NULL, km TEXT NOT NULL DEFAULT '',
    f6 TEXT NOT NULL DEFAULT '', f10 TEXT NOT NULL DEFAULT '', f12 TEXT NOT NULL DEFAULT '', f16 TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE gwp (kaeltemittel TEXT PRIMARY KEY, wert REAL NOT NULL);
  CREATE TABLE dokumente (id INTEGER PRIMARY KEY AUTOINCREMENT, hersteller TEXT NOT NULL, kit TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '', url TEXT NOT NULL, pos INTEGER NOT NULL DEFAULT 0);

  -- Maschinen
  CREATE TABLE maschinen (id TEXT PRIMARY KEY, nr TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, typ TEXT NOT NULL DEFAULT '',
    sn TEXT NOT NULL DEFAULT '', kat TEXT NOT NULL DEFAULT 'Sonstige', bem TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1, pos INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE ausleihen (id INTEGER PRIMARY KEY AUTOINCREMENT, maschine_id TEXT NOT NULL, wer TEXT NOT NULL,
    von TEXT NOT NULL, bis TEXT NOT NULL DEFAULT '', bestaetigt TEXT NOT NULL DEFAULT '', bem TEXT NOT NULL DEFAULT '',
    an TEXT NOT NULL DEFAULT '', kontakt TEXT NOT NULL DEFAULT '', frist TEXT NOT NULL DEFAULT '', baustelle TEXT NOT NULL DEFAULT '');
  CREATE INDEX ausleihen_maschine ON ausleihen (maschine_id, id);
  CREATE INDEX ausleihen_offen ON ausleihen (bis);
  CREATE TABLE reservierungen (id INTEGER PRIMARY KEY AUTOINCREMENT, maschine_id TEXT NOT NULL, fuer TEXT NOT NULL,
    von TEXT NOT NULL, bis TEXT NOT NULL, notiz TEXT NOT NULL DEFAULT '', von_wem TEXT NOT NULL DEFAULT '', am TEXT NOT NULL DEFAULT '');
  CREATE INDEX reservierungen_maschine ON reservierungen (maschine_id, von);
  CREATE TABLE verleih_empfaenger (name TEXT PRIMARY KEY, pos INTEGER NOT NULL DEFAULT 0);

  -- Lager
  CREATE TABLE kategorien (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kuerzel TEXT NOT NULL DEFAULT '', symbol TEXT NOT NULL DEFAULT '📦', sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE unterkategorien (kategorie_id INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, pos INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kategorie_id, name));
  CREATE TABLE lieferanten (name TEXT PRIMARY KEY COLLATE NOCASE, mail TEXT NOT NULL DEFAULT '', cc TEXT NOT NULL DEFAULT '',
    kundennr TEXT NOT NULL DEFAULT '', kontakt TEXT NOT NULL DEFAULT '');
  CREATE TABLE artikel (nr TEXT PRIMARY KEY, kategorie_id INTEGER NOT NULL, unterkategorie TEXT NOT NULL DEFAULT '',
    bez TEXT NOT NULL, groesse TEXT NOT NULL DEFAULT '', hersteller TEXT NOT NULL DEFAULT '', lieferant TEXT NOT NULL DEFAULT '',
    bestellnr TEXT NOT NULL DEFAULT '', einheit TEXT NOT NULL DEFAULT '', ve TEXT NOT NULL DEFAULT '', menge TEXT NOT NULL DEFAULT '',
    lagerort TEXT NOT NULL DEFAULT '', haeufig INTEGER NOT NULL DEFAULT 0, such TEXT NOT NULL DEFAULT '',
    aktiv INTEGER NOT NULL DEFAULT 1, bem TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX artikel_kategorie ON artikel (kategorie_id, pos);
  CREATE TABLE meldungen (id INTEGER PRIMARY KEY AUTOINCREMENT, nr TEXT NOT NULL, artikel TEXT NOT NULL DEFAULT '',
    lieferant TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, von TEXT NOT NULL DEFAULT '', am TEXT NOT NULL,
    bestellt_am TEXT NOT NULL DEFAULT '', bestellt_von TEXT NOT NULL DEFAULT '', bem TEXT NOT NULL DEFAULT '');
  CREATE INDEX meldungen_nr ON meldungen (nr, bestellt_am);
  CREATE TABLE bestellungen (id INTEGER PRIMARY KEY AUTOINCREMENT, am TEXT NOT NULL, lieferant TEXT NOT NULL DEFAULT '',
    an TEXT NOT NULL DEFAULT '', von TEXT NOT NULL DEFAULT '', positionen TEXT NOT NULL DEFAULT '', anzahl INTEGER NOT NULL DEFAULT 0);

  -- Hinweise, Müll, Urlaub
  CREATE TABLE hinweise (id INTEGER PRIMARY KEY AUTOINCREMENT, an TEXT NOT NULL, text TEXT NOT NULL, von TEXT NOT NULL DEFAULT '',
    erstellt TEXT NOT NULL, ab TEXT NOT NULL DEFAULT '', bis TEXT NOT NULL DEFAULT '', pin INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE hinweise_erledigt (hinweis_id INTEGER NOT NULL, wer TEXT NOT NULL COLLATE NOCASE, am TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (hinweis_id, wer));
  CREATE TABLE muell (id INTEGER PRIMARY KEY AUTOINCREMENT, am TEXT NOT NULL, von TEXT NOT NULL, an TEXT NOT NULL DEFAULT '');
  CREATE TABLE urlaub (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT '', von TEXT NOT NULL DEFAULT '',
    bis TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unklar', tage TEXT NOT NULL DEFAULT '', eingang TEXT NOT NULL DEFAULT '',
    betreff TEXT NOT NULL DEFAULT '', im_plan TEXT NOT NULL DEFAULT '', mail_id TEXT UNIQUE, hinweis TEXT NOT NULL DEFAULT '');

  -- Protokoll der Einmal-Importe aus Excel
  CREATE TABLE importe (bereich TEXT PRIMARY KEY, am TEXT NOT NULL, von TEXT NOT NULL, anzahl TEXT NOT NULL DEFAULT '');
  `,
  // 2: einzelne Rechte je Mitarbeiter + Admin. Bisheriges „Büro“ = alle Rechte, sonst die Bereiche (Monteur).
  //    Admin wird Sebastian (so festgelegt am 17.11.2026).
  `
  ALTER TABLE mitarbeiter ADD COLUMN rechte TEXT NOT NULL DEFAULT '';
  ALTER TABLE mitarbeiter ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
  UPDATE mitarbeiter SET rechte = CASE WHEN schreiben = 1
    THEN 'wochenplan,protokolle,maschinen,lager,plan_aendern,hinweise,urlaub,maschinen_buero,lager_bestellen,stammdaten,mitarbeiter'
    ELSE 'wochenplan,protokolle,maschinen,lager' END;
  UPDATE mitarbeiter SET admin = 1 WHERE id = (SELECT id FROM mitarbeiter WHERE name = 'Sebastian' COLLATE NOCASE LIMIT 1);
  `,
  // 3: In der Mitarbeiterliste heißt der Admin „Sebastian Stern“ – nachholen, falls noch kein Admin gesetzt ist
  `
  UPDATE mitarbeiter SET admin = 1, aktiv = 1,
    rechte = 'wochenplan,protokolle,maschinen,lager,plan_aendern,hinweise,urlaub,maschinen_buero,lager_bestellen,stammdaten,mitarbeiter'
    WHERE id = (SELECT id FROM mitarbeiter WHERE name = 'Sebastian Stern' COLLATE NOCASE LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM mitarbeiter WHERE admin = 1);
  `,
  // 4: Logbuch (Änderungen und Anmeldungen, 90 Tage)
  `
  CREATE TABLE logbuch (id INTEGER PRIMARY KEY AUTOINCREMENT, zeit TEXT NOT NULL, wer TEXT NOT NULL DEFAULT '',
    bereich TEXT NOT NULL DEFAULT '', aktion TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '');
  CREATE INDEX logbuch_zeit ON logbuch (zeit);
  `,
  // 5: weitere Mitarbeiter-Angaben (nur in der Verwaltung sichtbar)
  `
  ALTER TABLE mitarbeiter ADD COLUMN telefon TEXT NOT NULL DEFAULT '';
  ALTER TABLE mitarbeiter ADD COLUMN adresse TEXT NOT NULL DEFAULT '';
  ALTER TABLE mitarbeiter ADD COLUMN schluessel TEXT NOT NULL DEFAULT '';
  ALTER TABLE mitarbeiter ADD COLUMN alarm TEXT NOT NULL DEFAULT '';
  `,
  // 6: Austausch – Nachrichten (statt Hinweise), Empfänger, Lese-/Erledigt-Status, Antworten, Abstimmungen.
  //    Empfänger: Mitarbeiter-Name, „*alle“ oder „*buero“. Bisherige Hinweise werden übernommen.
  `
  CREATE TABLE nachrichten (id INTEGER PRIMARY KEY AUTOINCREMENT, typ TEXT NOT NULL DEFAULT 'nachricht', von TEXT NOT NULL,
    text TEXT NOT NULL, prio TEXT NOT NULL DEFAULT 'normal', pin INTEGER NOT NULL DEFAULT 0, ab TEXT NOT NULL DEFAULT '', bis TEXT NOT NULL DEFAULT '',
    erinnerung INTEGER NOT NULL DEFAULT 0, mehrfach INTEGER NOT NULL DEFAULT 0, erstellt TEXT NOT NULL, zuletzt TEXT NOT NULL, geloescht INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX nachrichten_zuletzt ON nachrichten (zuletzt);
  CREATE TABLE nachricht_an (nachricht_id INTEGER NOT NULL, empfaenger TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY (nachricht_id, empfaenger));
  CREATE TABLE nachricht_status (nachricht_id INTEGER NOT NULL, wer TEXT NOT NULL COLLATE NOCASE, gelesen TEXT NOT NULL DEFAULT '',
    erledigt TEXT NOT NULL DEFAULT '', erinnert TEXT NOT NULL DEFAULT '', reaktion TEXT NOT NULL DEFAULT '', PRIMARY KEY (nachricht_id, wer));
  CREATE TABLE antworten (id INTEGER PRIMARY KEY AUTOINCREMENT, nachricht_id INTEGER NOT NULL, von TEXT NOT NULL, text TEXT NOT NULL, zeit TEXT NOT NULL);
  CREATE INDEX antworten_nachricht ON antworten (nachricht_id, id);
  CREATE TABLE umfrage_optionen (nachricht_id INTEGER NOT NULL, nr INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (nachricht_id, nr));
  CREATE TABLE stimmen (nachricht_id INTEGER NOT NULL, wer TEXT NOT NULL COLLATE NOCASE, nr INTEGER NOT NULL, PRIMARY KEY (nachricht_id, wer, nr));
  INSERT INTO nachrichten (id, typ, von, text, pin, ab, bis, erstellt, zuletzt)
    SELECT id, CASE WHEN text LIKE '🎉%' THEN 'gruss' ELSE 'nachricht' END, von, text, pin, ab, bis, erstellt, erstellt FROM hinweise;
  INSERT OR IGNORE INTO nachricht_an (nachricht_id, empfaenger)
    SELECT id, CASE WHEN lower(an) IN ('alle', 'alle monteure', 'jeder', '*') THEN '*alle'
      WHEN lower(an) IN ('büro', 'buero', 'buro', 'büro team', 'an das büro') THEN '*buero' ELSE an END FROM hinweise;
  INSERT OR IGNORE INTO nachricht_status (nachricht_id, wer, gelesen, erledigt) SELECT hinweis_id, wer, am, am FROM hinweise_erledigt;
  `,
  // 7: Autos und Anhänger. Nächster TÜV als „JJJJ-MM“ (Plakette gilt bis Monatsende).
  //    Rechte: alle bekommen den Bereich „autos“, wer „Büro“ (hinweise) hat, zusätzlich „autos_verwalten“.
  //    auto_meldungen merkt sich, welche TÜV-/Leasing-Hinweise schon verschickt wurden (je Fälligkeit nur einmal).
  `
  CREATE TABLE autos (id INTEGER PRIMARY KEY AUTOINCREMENT, art TEXT NOT NULL DEFAULT 'auto', marke TEXT NOT NULL DEFAULT '',
    modell TEXT NOT NULL DEFAULT '', kennzeichen TEXT NOT NULL, kaufdatum TEXT NOT NULL DEFAULT '', leasing_monate INTEGER NOT NULL DEFAULT 0,
    leasing_erinnerung INTEGER NOT NULL DEFAULT 3, tuev_intervall INTEGER NOT NULL DEFAULT 2, tuev_naechster TEXT NOT NULL DEFAULT '',
    mitarbeiter_id INTEGER, bem TEXT NOT NULL DEFAULT '', pos INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE auto_meldungen (auto_id INTEGER NOT NULL, art TEXT NOT NULL, faellig TEXT NOT NULL, erstellt TEXT NOT NULL,
    PRIMARY KEY (auto_id, art, faellig));
  UPDATE mitarbeiter SET rechte = rechte || ',autos' WHERE rechte <> '' AND ',' || rechte || ',' NOT LIKE '%,autos,%';
  UPDATE mitarbeiter SET rechte = rechte || ',autos_verwalten' WHERE ',' || rechte || ',' LIKE '%,hinweise,%';
  `,
  // 8: Reiter „Allgemeines“ → Mitarbeiter: Führerscheinprüfungen (jede Sichtung einzeln, als Nachweis),
  //    Urlaubsanspruch, Resturlaub aus dem Vorjahr, Notizen. Neues Recht „personal“ für alle, die Mitarbeiter verwalten.
  `
  ALTER TABLE mitarbeiter ADD COLUMN urlaub_anspruch REAL NOT NULL DEFAULT 0;
  ALTER TABLE mitarbeiter ADD COLUMN urlaub_vorjahr REAL NOT NULL DEFAULT 0;
  ALTER TABLE mitarbeiter ADD COLUMN notiz TEXT NOT NULL DEFAULT '';
  CREATE TABLE fs_pruefungen (id INTEGER PRIMARY KEY AUTOINCREMENT, mitarbeiter_id INTEGER NOT NULL, datum TEXT NOT NULL,
    von TEXT NOT NULL DEFAULT '', erstellt TEXT NOT NULL);
  CREATE INDEX fs_pruefungen_ma ON fs_pruefungen (mitarbeiter_id, datum);
  UPDATE mitarbeiter SET rechte = rechte || ',personal' WHERE ',' || rechte || ',' LIKE '%,mitarbeiter,%';
  `,
  // 9: Meldungen „Führerscheinprüfung fällig“ – je Mitarbeiter und Fälligkeit nur einmal; merkt sich die Nachrichten,
  //    damit sie nach der Sichtung verschwinden.
  `
  CREATE TABLE fs_meldungen (mitarbeiter_id INTEGER NOT NULL, faellig TEXT NOT NULL, erstellt TEXT NOT NULL,
    nachrichten TEXT NOT NULL DEFAULT '', PRIMARY KEY (mitarbeiter_id, faellig));
  `,
  // 10: Urlaub-Infomail: welche künftigen Urlaubstage aus dem Wochenplan schon per Mail gemeldet wurden
  //     (neu eingetragen → „bitte in Label eintragen“, gestrichen → „bitte in Label prüfen“).
  `
  CREATE TABLE urlaub_gemeldet (name TEXT NOT NULL, datum TEXT NOT NULL, art TEXT NOT NULL DEFAULT 'ganz', erstellt TEXT NOT NULL,
    PRIMARY KEY (name, datum));
  `,
];

let ready = null;

export function hasDb(env) { return !!(env && env.DB); }

function dbOf(env) {
  if (!env || !env.DB) throw Object.assign(new Error("Datenbank ist noch nicht verbunden (Bindung „DB“ fehlt in Cloudflare)"), { status: 500 });
  return env.DB;
}

// SQL-Text in einzelne Anweisungen zerlegen (Kommentare entfernen)
const statements = sql => sql.replace(/--[^\n]*/g, "").split(";").map(s => s.trim()).filter(Boolean);

async function migrate(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS _schema (version INTEGER NOT NULL)").run();
  const row = await db.prepare("SELECT MAX(version) AS v FROM _schema").first();
  let v = (row && row.v) || 0;
  for (; v < MIGRATIONS.length; v++) {
    const list = statements(MIGRATIONS[v]).map(s => db.prepare(s));
    list.push(db.prepare("INSERT INTO _schema (version) VALUES (?)").bind(v + 1));
    await db.batch(list);   // alles oder nichts
  }
  return v;
}

// Datenbank holen – beim ersten Zugriff je Worker-Instanz werden fehlende Tabellen angelegt
export async function db(env) {
  const d = dbOf(env);
  if (!ready) ready = migrate(d).catch(e => { ready = null; throw e; });
  await ready;
  return d;
}

export async function schemaVersion(env) { await db(env); return MIGRATIONS.length; }

// ---------- Kurzformen ----------
export async function all(env, sql, ...args) { return (await (await db(env)).prepare(sql).bind(...args).all()).results || []; }
export async function one(env, sql, ...args) { return (await db(env)).prepare(sql).bind(...args).first(); }
export async function run(env, sql, ...args) { return (await db(env)).prepare(sql).bind(...args).run(); }
// mehrere Anweisungen in einem Rutsch (alles oder nichts): list = [[sql, ...args], …]
export async function batch(env, list) {
  const d = await db(env);
  if (!list.length) return [];
  return d.batch(list.map(([sql, ...args]) => d.prepare(sql).bind(...args)));
}

// ---------- Zeit (deutsche Zeit, sortierbarer Text) ----------
const parts = (d, opt) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", ...opt }).formatToParts(d).map(x => [x.type, x.value]));
export function jetzt(d = new Date()) {
  const p = parts(d, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
export const heute = (d = new Date()) => jetzt(d).slice(0, 10);

// Text aus Excel/Eingabe → „JJJJ-MM-TT HH:MM“ bzw. „JJJJ-MM-TT“ (ohne Uhrzeit). Leer, wenn nicht erkannt.
export function isoZeit(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? ` ${m[4]}:${m[5]}` : "");
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` + (m[4] ? ` ${m[4].padStart(2, "0")}:${m[5]}` : "");
  }
  const n = +s;   // Excel-Seriennummer
  if (n > 30000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5);
    const iso = d.toISOString();
    return n % 1 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
  }
  return "";
}
// „JJJJ-MM-TT HH:MM“ → „TT.MM.JJJJ HH:MM“ (für Anzeige und Mails)
export function deZeit(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` + (m[4] ? " " + m[4] : "") : String(iso || "");
}
