// Baustellen: Vorschlagsliste aus dem Wochenplan (Google-Tabelle) und Baustellen-Mappen
// (Infos/Aufgaben mit „Reminder nächster Einsatz“, Protokolle, Abschluss mit Archiv in SharePoint).
import { users } from "./auth.js";
import { sheets, sheetValuesBatch } from "./google.js";
import { isoWeek, mondayOf, isoDate, findSheet, parseWeek, norm } from "./wochenplan.js";
import { planJahr } from "./jahreswechsel.js";
import { all, one, run, jetzt, heute } from "./db.js";
import { laden as ladeEinsaetze, zusammenfassen } from "./einsaetze.js";

export const MONATE = 5;        // so weit zurück werden Baustellen aus dem Wochenplan vorgeschlagen
export const VORAUS_WOCHEN = 4; // schon eingeplante Baustellen der nächsten Wochen zählen auch

// Keine Baustellen: Abwesenheiten (wie in app/wochenplan.js) und feste Orte
const KEINE = ["urlaub", "berufsschule", "schule", "hbz", "krank", "feiertag", "frei", "zeitausgleich", "uberstunden", "elternzeit",
  "buro", "buero", "werkstatt", "lager"];
export function keineBaustelle(v) {
  const n = norm(v);
  if (n.length < 2 || /^\d+$/.test(n)) return true;
  return KEINE.some(k => n === k || n.startsWith(k + " ") || n.split(" ").includes(k));
}
// Zelleintrag → einzelne Baustellen („A · B“ bei mehreren Zeilen, „A / B“ = zweite Baustelle am selben Tag)
export const teile = v => String(v || "").split(/\s+[·\/]\s+/).map(s => s.trim()).filter(Boolean);

// wochen: [{ tage: [{ datum, e: { name: eintrag } }] }] → sortierte Liste
// Sortierung: aktuell eingeplante/kommende Baustellen zuerst, dann nach letztem Einsatz (neueste zuerst)
// meta (optional): Einsatz-Angaben aus lib/einsaetze.js { datum: { schluessel: { art, nummer, info, fix } } } –
// Einträge mit Art „info“ (Schule, TÜV …) sind keine Baustelle; Nummer/Info/Art kommen an den Vorschlag.
export function sammeln(wochen, tag, ab, meta = {}) {
  const map = new Map();
  for (const w of wochen) for (const t of w.tage || []) {
    if (t.datum < ab) continue;
    for (const [person, v] of Object.entries(t.e || {})) for (const teil of teile(v)) {
      const mv = (meta[t.datum] || {})[norm(v)];
      if (mv && mv.art === "info") continue;
      if (keineBaustelle(teil)) continue;
      const k = norm(teil);
      let x = map.get(k);
      if (!x) map.set(k, x = { schreib: new Map(), tage: new Set(), leute: new Set(), zuletzt: "", naechster: "" });
      x.schreib.set(teil, (x.schreib.get(teil) || 0) + 1);
      x.tage.add(t.datum);
      if (t.datum <= tag) { if (t.datum > x.zuletzt) x.zuletzt = t.datum; if (t.datum === tag) x.leute.add(person); }
      else if (!x.naechster || t.datum < x.naechster) x.naechster = t.datum;
    }
  }
  // Angaben je Baustelle: aus Einträgen, deren Überschrift genau diese Baustelle ist
  const angaben = zusammenfassen(meta, tag);
  const list = [...map.entries()].map(([k, x]) => {
    const a = angaben[k] || {};
    const o = { name: [...x.schreib].sort((a, b) => b[1] - a[1])[0][0], zuletzt: x.zuletzt, naechster: x.naechster, tage: x.tage.size, heute: [...x.leute] };
    if (a.art === "kd") o.art = "kd";
    if (a.nummer) o.nummer = a.nummer;
    if (a.info) { o.info = a.info; o.infoTag = a.infoTag; }
    if (a.fixTage && a.fixTage.length) o.fix = a.fixTage[0];
    return o;
  });
  const rang = x => x.zuletzt === tag || x.naechster ? tag : x.zuletzt;
  return list.sort((a, b) => rang(b).localeCompare(rang(a)) || (b.zuletzt || "").localeCompare(a.zuletzt || "")
    || (a.naechster || "9").localeCompare(b.naechster || "9") || b.tage - a.tage || a.name.localeCompare(b.name, "de"));
}

let cache = { at: 0, tag: "", list: null };
const CACHE_MS = 10 * 60 * 1000;
export const resetVorschlaege = () => { cache = { at: 0, tag: "", list: null }; };

export async function vorschlaege(env, { tag = heute(), frisch = false } = {}) {
  if (!frisch && cache.list && cache.tag === tag && Date.now() - cache.at < CACHE_MS) return cache.list;
  const d0 = new Date(tag + "T12:00:00Z");
  const start = new Date(d0); start.setUTCMonth(start.getUTCMonth() - MONATE);
  const ab = isoDate(start);
  const basis = await planJahr(env), meta = await sheets(env), wochen = [];
  for (let d = new Date(start); d <= new Date(d0.getTime() + VORAUS_WOCHEN * 7 * 864e5); d.setUTCDate(d.getUTCDate() + 7)) {
    const { year, week } = isoWeek(d);
    const sh = findSheet(meta, year, week, basis);
    if (sh && !wochen.some(w => w.sh === sh)) wochen.push({ sh, monday: mondayOf(year, week) });
  }
  const known = (await users(env)).map(u => u.plan);
  const werte = wochen.length ? await sheetValuesBatch(env, wochen.map(w => w.sh)) : [];
  const plaene = [];
  wochen.forEach((w, i) => { try { plaene.push(parseWeek(werte[i], known, w.monday)); } catch (e) { /* Blatt ohne erkennbaren Aufbau */ } });
  let ein = {};
  try { ein = await ladeEinsaetze(env, ab, isoDate(new Date(d0.getTime() + (VORAUS_WOCHEN + 1) * 7 * 864e5))); } catch (e) { console.error(e); }
  const list = sammeln(plaene, tag, ab, ein);
  cache = { at: Date.now(), tag, list };
  return list;
}

/* ---------- Baustellen-Mappen ---------- */
const kurz = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const fehler = (status, m) => Object.assign(new Error(m), { status });

// Mappe zur Baustelle holen (offen) – bei Bedarf anlegen
export async function mappeFuer(env, name, wer, anlegen = true) {
  const n = kurz(name, 120), k = norm(n);
  if (!k) throw fehler(400, "Bitte die Baustelle angeben");
  const m = await one(env, "SELECT * FROM mappen WHERE schluessel = ? AND status = 'offen' ORDER BY id DESC LIMIT 1", k);
  if (m || !anlegen) return m;
  const r = await run(env, "INSERT INTO mappen (name, schluessel, status, angelegt_von, angelegt_am) VALUES (?, ?, 'offen', ?, ?)", n, k, wer, jetzt());
  return one(env, "SELECT * FROM mappen WHERE id = ?", r.meta.last_row_id);
}

const eintragAus = e => ({ id: e.id, text: e.text, reminder: !!e.reminder, von: e.von, am: e.am, erledigt: e.erledigt_am ? { von: e.erledigt_von, am: e.erledigt_am } : null });
const dokAus = d => ({ id: d.id, art: d.art, name: d.name, ordner: d.ordner, url: d.url, projekt: d.projekt, von: d.von, am: d.am });

// Übersicht: offene Mappen mit Zählern und offenen Reminder-Einträgen (für den Hinweis auf der Startseite)
export async function uebersicht(env, { geschlossen = false } = {}) {
  const mappen = await all(env, `SELECT * FROM mappen WHERE status = ? ORDER BY ${geschlossen ? "geschlossen_am DESC LIMIT 60" : "id DESC"}`, geschlossen ? "geschlossen" : "offen");
  if (!mappen.length) return [];
  const ids = mappen.map(m => m.id), q = ids.map(() => "?").join(",");
  const ein = await all(env, `SELECT * FROM mappe_eintraege WHERE mappe_id IN (${q}) ORDER BY id`, ...ids);
  const dok = await all(env, `SELECT mappe_id, COUNT(*) AS n, MAX(am) AS am FROM mappe_dokumente WHERE mappe_id IN (${q}) GROUP BY mappe_id`, ...ids);
  return mappen.map(m => {
    const e = ein.filter(x => x.mappe_id === m.id), d = dok.find(x => x.mappe_id === m.id);
    const zuletzt = [m.angelegt_am, ...e.map(x => x.am), d ? d.am : ""].sort().pop();
    return {
      id: m.id, name: m.name, status: m.status, projekt: m.projekt, zuletzt,
      eintraege: e.length, offen: e.filter(x => !x.erledigt_am).length, dokumente: d ? d.n : 0,
      reminder: e.filter(x => x.reminder && !x.erledigt_am).map(eintragAus),
      geschlossen: m.geschlossen_am ? { von: m.geschlossen_von, am: m.geschlossen_am, ordner: m.archiv_ordner, url: m.archiv_url } : null,
    };
  }).sort((a, b) => (b.zuletzt || "").localeCompare(a.zuletzt || ""));
}

export async function mappe(env, id) {
  const m = await one(env, "SELECT * FROM mappen WHERE id = ?", +id);
  if (!m) throw fehler(404, "Mappe nicht gefunden");
  const ein = await all(env, "SELECT * FROM mappe_eintraege WHERE mappe_id = ? ORDER BY id DESC", m.id);
  const dok = await all(env, "SELECT * FROM mappe_dokumente WHERE mappe_id = ? ORDER BY id DESC", m.id);
  return {
    id: m.id, name: m.name, status: m.status, projekt: m.projekt, angelegt: { von: m.angelegt_von, am: m.angelegt_am },
    geschlossen: m.geschlossen_am ? { von: m.geschlossen_von, am: m.geschlossen_am, ordner: m.archiv_ordner, url: m.archiv_url } : null,
    eintraege: ein.map(eintragAus), dokumente: dok.map(dokAus),
  };
}

// Hochgeladenes Protokoll/Aufmaß der Mappe der Baustelle zuordnen (Mappe wird bei Bedarf angelegt)
export async function dokumentMerken(env, wer, { baustelle, art, name, ordner, url, projekt }) {
  if (!norm(baustelle)) return null;
  const m = await mappeFuer(env, baustelle, wer);
  await run(env, "INSERT INTO mappe_dokumente (mappe_id, art, name, ordner, url, projekt, von, am) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    m.id, kurz(art, 40), kurz(name, 200), kurz(ordner, 300), kurz(url, 1000), kurz(projekt, 60), wer, jetzt());
  if (projekt && !m.projekt) await run(env, "UPDATE mappen SET projekt = ? WHERE id = ?", kurz(projekt, 60), m.id);
  return m.id;
}

const darfAendern = (me, e) => me.admin || (Array.isArray(me.rechte) && me.rechte.includes("plan_aendern")) || norm(e.von) === norm(me.name);

// POST-Aktionen; Rückgabe: die betroffene Mappe
export async function aktion(env, me, b) {
  const wer = me.name;
  if (b.aktion === "eintrag") {
    const text = kurz(b.text, 2000);
    if (!text) throw fehler(400, "Bitte einen Text eingeben");
    const m = b.id ? await one(env, "SELECT * FROM mappen WHERE id = ?", +b.id) : await mappeFuer(env, b.baustelle, wer);
    if (!m) throw fehler(404, "Mappe nicht gefunden");
    if (m.status !== "offen") throw fehler(409, "Die Mappe ist schon geschlossen");
    await run(env, "INSERT INTO mappe_eintraege (mappe_id, text, reminder, von, am) VALUES (?, ?, ?, ?, ?)", m.id, text, b.reminder ? 1 : 0, wer, jetzt());
    return mappe(env, m.id);
  }
  if (b.aktion === "erledigt" || b.aktion === "loeschen" || b.aktion === "reminder") {
    const e = await one(env, "SELECT * FROM mappe_eintraege WHERE id = ?", +b.eintrag);
    if (!e) throw fehler(404, "Eintrag nicht gefunden");
    if (b.aktion === "erledigt") {
      if (b.ja === false) await run(env, "UPDATE mappe_eintraege SET erledigt_von = '', erledigt_am = '' WHERE id = ?", e.id);
      else await run(env, "UPDATE mappe_eintraege SET erledigt_von = ?, erledigt_am = ? WHERE id = ?", wer, jetzt(), e.id);
    } else {
      if (!darfAendern(me, e)) throw fehler(403, "Nur wer den Eintrag geschrieben hat (oder das Büro) kann ihn ändern");
      if (b.aktion === "loeschen") await run(env, "DELETE FROM mappe_eintraege WHERE id = ?", e.id);
      else await run(env, "UPDATE mappe_eintraege SET reminder = ? WHERE id = ?", b.ja ? 1 : 0, e.id);
    }
    return mappe(env, e.mappe_id);
  }
  if (b.aktion === "schliessen") {
    const m = await one(env, "SELECT * FROM mappen WHERE id = ?", +b.id);
    if (!m) throw fehler(404, "Mappe nicht gefunden");
    if (m.status !== "offen") throw fehler(409, "Die Mappe ist schon geschlossen");
    await run(env, "UPDATE mappen SET status = 'geschlossen', geschlossen_von = ?, geschlossen_am = ?, archiv_ordner = ?, archiv_url = ? WHERE id = ?",
      wer, jetzt(), kurz(b.ordner, 300), kurz(b.url, 1000), m.id);
    return mappe(env, m.id);
  }
  if (b.aktion === "oeffnen") {
    const m = await one(env, "SELECT * FROM mappen WHERE id = ?", +b.id);
    if (!m) throw fehler(404, "Mappe nicht gefunden");
    if (await one(env, "SELECT id FROM mappen WHERE schluessel = ? AND status = 'offen' AND id <> ?", m.schluessel, m.id))
      throw fehler(409, "Für diese Baustelle gibt es schon eine offene Mappe");
    await run(env, "UPDATE mappen SET status = 'offen' WHERE id = ?", m.id);
    return mappe(env, m.id);
  }
  if (b.aktion === "umbenennen") {
    const m = await one(env, "SELECT * FROM mappen WHERE id = ?", +b.id);
    const n = kurz(b.name, 120);
    if (!m) throw fehler(404, "Mappe nicht gefunden");
    if (!norm(n)) throw fehler(400, "Bitte einen Namen eingeben");
    await run(env, "UPDATE mappen SET name = ?, schluessel = ? WHERE id = ?", n, norm(n), m.id);
    return mappe(env, m.id);
  }
  throw fehler(400, "Unbekannte Aktion");
}
