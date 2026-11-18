// Urlaub aus dem Wochenplan (Google-Tabelle): jede Zelle mit „Urlaub“ zählt als Urlaubstag.
// Aufeinanderfolgende Tage (auch über Wochenende/Feiertag hinweg) werden zu einem Zeitraum zusammengefasst.
// Maßgeblich ist allein, was im Wochenplan steht.
//  • laden(jahr)          – alle Wochen eines Jahres (für genommen/geplant)
//  • bereich(von, bis)    – beliebiger Zeitraum, z. B. heute bis in einem Jahr („so weit der Wochenplan reicht“)
//  • eintragen(...)       – Urlaub in den Wochenplan schreiben (eigener; Büro mit Recht „urlaub“ für alle)
import { sheets, sheetValuesBatch } from "./google.js";
import { isoWeek, mondayOf, isoDate, findSheet, parseWeek, matchName, norm } from "./wochenplan.js";
import { writePlan } from "./planwrite.js";
import { darf } from "./rechte.js";

const CACHE_MS = 10 * 60 * 1000;
const caches = new Map();   // "von|bis" → { at, data }
const fail = (m, status = 400) => Object.assign(new Error(m), { status });

export const istUrlaub = v => /urlaub/.test(norm(v));
export const istHalb = v => /½|1\/2|halb/i.test(String(v));
const istFrei = v => !String(v || "").trim() ? false : /(^| )(feiertag|frei)( |$)/.test(norm(v)) && !istUrlaub(v);
const wt = iso => new Date(iso + "T12:00:00Z").getUTCDay();   // 0 = So, 6 = Sa
export const plus = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
export const heuteBerlin = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
export const inEinemJahr = h => `${+h.slice(0, 4) + 1}${h.slice(4)}`;

// filter: Jahr ("2026") oder { von, bis }
const imFilter = (d, f) => !f ? true : typeof f === "object" ? d >= f.von && d <= f.bis : d.slice(0, 4) === String(f);

// wochen: [{ spalten, tage:[{ datum, e:{ name: zelle } }] }] → { "Plan-Name": [{ von, bis, tage }] }
export function zeitraeume(wochen, filter) {
  const zelle = zellen(wochen, filter);
  const out = {};
  for (const [name, tage] of zelle) {
    const urlaub = [...tage].filter(([, v]) => istUrlaub(v)).map(([d]) => d).sort();
    const liste = [];
    for (const d of urlaub) {
      const last = liste[liste.length - 1];
      // an den letzten Zeitraum anhängen, wenn dazwischen nur Wochenende oder Feiertag/frei liegt
      let anschluss = !!last;
      if (last) for (let x = plus(last.bis, 1); x < d; x = plus(x, 1)) {
        if (wt(x) === 0 || wt(x) === 6 || istFrei(tage.get(x))) continue;
        anschluss = false; break;
      }
      const wert = wt(d) === 0 || wt(d) === 6 ? 0 : istHalb(tage.get(d)) ? 0.5 : 1;
      if (anschluss) { last.bis = d; last.tage += wert; } else liste.push({ von: d, bis: d, tage: wert });
    }
    if (liste.length) out[name] = liste;
  }
  return out;
}

function zellen(wochen, filter) {
  const zelle = new Map();   // name → Map(datum → wert)
  for (const w of wochen) for (const t of w.tage) {
    if (!imFilter(t.datum, filter)) continue;
    for (const [name, v] of Object.entries(t.e)) {
      if (!zelle.has(name)) zelle.set(name, new Map());
      zelle.get(name).set(t.datum, v);
    }
  }
  return zelle;
}

// Blatt zu einer Kalenderwoche. Blätter ohne Jahreszahl im Namen (z. B. „KW 2“) gelten nur für das Jahr „basis“ –
// sonst würde z. B. im November das alte Januar-Blatt als nächstes Jahr gelesen.
export function blattFuer(list, year, week, basis) {
  const sh = findSheet(list, year, week);
  if (sh && year !== basis && !sh.title.includes(String(year))) return null;
  return sh;
}

// Alle Wochenblätter zwischen von und bis lesen (eine Anfrage an Google je 30 Blätter)
export async function bereich(env, people, von, bis, neu = false) {
  const key = von + "|" + bis;
  const c = caches.get(key);
  if (!neu && c && Date.now() - c.at < CACHE_MS) return c.data;
  const list = await sheets(env);
  const basis = +von.slice(0, 4);
  const blaetter = [];
  const w0 = isoWeek(new Date(von + "T12:00:00Z"));
  for (let m = mondayOf(w0.year, w0.week); isoDate(m) <= bis; m = new Date(m.getTime() + 7 * 864e5)) {
    const { year, week } = isoWeek(m);
    const sh = blattFuer(list, year, week, basis);
    if (!sh || blaetter.some(b => b.sh === sh)) continue;
    blaetter.push({ sh, year, week, montag: isoDate(m) });
  }
  const werte = blaetter.length ? await sheetValuesBatch(env, blaetter.map(b => b.sh)) : [];
  const known = people.map(u => u.plan).filter(Boolean);
  const wochen = [], geladen = [];
  blaetter.forEach((b, i) => {
    try { wochen.push(parseWeek(werte[i], known, mondayOf(b.year, b.week))); geladen.push(b.montag); }
    catch (e) { /* Blatt ohne erkennbaren Aufbau überspringen */ }
  });
  const spalten = [...new Set(wochen.flatMap(w => w.spalten))];
  // Plan-Spalte → Mitarbeitername aus der Verwaltung
  const zuName = {};
  for (const u of people) { const s = matchName(u, spalten); if (s && !zuName[s]) zuName[s] = u.name; }
  const f = { von, bis };
  const roh = zeitraeume(wochen, f);
  const personen = {};
  for (const [spalte, z] of Object.entries(roh)) {
    const name = zuName[spalte] || spalte;
    personen[name] = (personen[name] || []).concat(z).sort((a, b) => a.von.localeCompare(b.von));
  }
  // einzelne Urlaubstage (Mo–Fr) je Mitarbeiter – für die Infomail
  const tage = {};
  for (const [spalte, t] of zellen(wochen, f)) {
    const name = zuName[spalte] || spalte;
    for (const [d, v] of t) if (istUrlaub(v) && wt(d) !== 0 && wt(d) !== 6) (tage[name] = tage[name] || {})[d] = istHalb(v) ? "halb" : "ganz";
  }
  const letzte = geladen.sort().pop();
  const data = { von, bis, personen, tage, spalten, zuName, wochen: geladen.length, geladen,
    planBis: letzte ? plus(letzte, 6) : "", stand: new Date().toISOString() };
  caches.set(key, { at: Date.now(), data });
  if (caches.size > 20) caches.delete(caches.keys().next().value);
  return data;
}

// Alle Wochenblätter eines Jahres
export async function laden(env, people, jahr, neu = false) {
  const d = await bereich(env, people, `${jahr}-01-01`, `${jahr}-12-31`, neu);
  return { ...d, jahr };
}

export function cacheLeeren() { caches.clear(); }

// Ab heute ein Jahr voraus (so weit der Wochenplan reicht): eigene Zeiträume; Büro zusätzlich alle
export async function liste(env, me, people, { neu = false, buero = false, heute } = {}) {
  heute = heute || heuteBerlin();
  const d = await bereich(env, people, heute, inEinemJahr(heute), neu);
  const meine = d.personen[me.name] || (me.plan && d.personen[me.plan]) || [];
  const out = { heute, bis: d.bis, planBis: d.planBis, meine, stand: d.stand };
  if (buero) {
    out.alle = Object.entries(d.personen).flatMap(([name, z]) => z.map(r => ({ name, ...r })))
      .sort((a, b) => a.von.localeCompare(b.von) || a.name.localeCompare(b.name));
    out.wochen = d.wochen;
  }
  return out;
}

// Urlaub in den Wochenplan schreiben: { name?, von, bis, halb? }
// Wochenenden, Feiertage/frei und schon eingetragener Urlaub werden übersprungen. Ein anderer Eintrag (z. B. Baustelle)
// wird überschrieben – der alte Wert steht dann in der Notiz der Zelle.
export async function eintragen(env, me, b, people, { heute } = {}) {
  heute = heute || heuteBerlin();
  const name = String(b.name || me.name).trim();
  if (name.toLowerCase() !== String(me.name).toLowerCase() && !darf(me, "urlaub")) throw fail("Sie können nur Ihren eigenen Urlaub eintragen", 403);
  const u = people.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (!u) throw fail("Mitarbeiter nicht gefunden", 404);
  const von = String(b.von || ""), bis = String(b.bis || b.von || "");
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s));
  if (!ok(von) || !ok(bis)) throw fail("Bitte ein gültiges Datum wählen");
  if (bis < von) throw fail("„Bis“ liegt vor „Von“");
  if (von < heute) throw fail("Urlaub kann nur ab heute eingetragen werden");
  if (bis > inEinemJahr(heute)) throw fail("Höchstens ein Jahr im Voraus");
  if ((Date.parse(bis) - Date.parse(von)) / 864e5 > 62) throw fail("Bitte höchstens zwei Monate auf einmal eintragen");
  const halb = !!b.halb && von === bis;
  const tage = [];
  for (let d = von; d <= bis; d = plus(d, 1)) if (wt(d) !== 0 && wt(d) !== 6) tage.push(d);
  if (!tage.length) throw fail("Im Zeitraum liegen keine Arbeitstage");
  const wert = halb ? "Urlaub ½" : "Urlaub";
  const stamp = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  const res = await writePlan(env, tage.map(datum => ({
    datum, name: u.plan || u.name, wert,
    skip: prev => istFrei(prev) || (istUrlaub(prev) && istHalb(prev) === halb),
    notiz: prev => (prev && !istUrlaub(prev) ? `vorher: ${prev} – ` : "") + `Urlaub eingetragen über die App von ${me.name} am ${stamp}`,
  })), true, { basis: +heute.slice(0, 4) });
  cacheLeeren();
  const ueberschrieben = res.cells.filter(c => { const v = res.vorher[(u.plan || u.name) + "|" + c.datum]; return v && !istUrlaub(v); })
    .map(c => ({ datum: c.datum, vorher: res.vorher[(u.plan || u.name) + "|" + c.datum] }));
  return { name: u.name, eingetragen: res.cells.length, uebersprungen: res.uebersprungen || 0, fehler: res.fehler, ueberschrieben };
}
