// Urlaub aus dem Wochenplan (Google-Tabelle): jede Zelle mit „Urlaub“ zählt als Urlaubstag.
// Aufeinanderfolgende Tage (auch über Wochenende/Feiertag hinweg) werden zu einem Zeitraum zusammengefasst.
// Keine Mails, keine Excel – maßgeblich ist allein, was im Wochenplan steht.
import { sheets, sheetValuesBatch } from "./google.js";
import { isoWeek, mondayOf, isoDate, findSheet, parseWeek, matchName, norm } from "./wochenplan.js";

const CACHE_MS = 10 * 60 * 1000;
let cache = { at: 0, jahr: "", data: null };

export const istUrlaub = v => /urlaub/.test(norm(v));
const istHalb = v => /½|1\/2|halb/i.test(String(v));
const istFrei = v => !String(v || "").trim() ? false : /(^| )(feiertag|frei)( |$)/.test(norm(v)) && !istUrlaub(v);
const wt = iso => new Date(iso + "T12:00:00Z").getUTCDay();   // 0 = So, 6 = Sa
const plus = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };

// wochen: [{ spalten, tage:[{ datum, e:{ name: zelle } }] }] → { "Plan-Name": [{ von, bis, tage }] }
export function zeitraeume(wochen, jahr) {
  const zelle = new Map();   // name → Map(datum → wert)
  for (const w of wochen) for (const t of w.tage) {
    if (jahr && t.datum.slice(0, 4) !== String(jahr)) continue;
    for (const [name, v] of Object.entries(t.e)) {
      if (!zelle.has(name)) zelle.set(name, new Map());
      zelle.get(name).set(t.datum, v);
    }
  }
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

// Alle Wochenblätter eines Jahres lesen (eine Anfrage an Google je 30 Blätter)
export async function laden(env, people, jahr, neu = false) {
  if (!neu && cache.data && cache.jahr === jahr && Date.now() - cache.at < CACHE_MS) return cache.data;
  const list = await sheets(env);
  const anzahl = isoWeek(new Date(Date.UTC(+jahr, 11, 28))).week;
  const wochen = [], blaetter = [], fehlt = [];
  for (let kw = 1; kw <= anzahl; kw++) {
    const sh = findSheet(list, +jahr, kw);
    if (!sh) { fehlt.push(kw); continue; }
    if (blaetter.some(b => b.sh === sh)) continue;
    blaetter.push({ sh, kw });
  }
  const werte = await sheetValuesBatch(env, blaetter.map(b => b.sh));
  const known = people.map(u => u.plan).filter(Boolean);
  blaetter.forEach((b, i) => {
    try { wochen.push(parseWeek(werte[i], known, mondayOf(+jahr, b.kw))); }
    catch (e) { /* Blatt ohne erkennbaren Aufbau überspringen */ }
  });
  const spalten = [...new Set(wochen.flatMap(w => w.spalten))];
  // Plan-Spalte → Mitarbeitername aus der Verwaltung
  const zuName = {};
  for (const u of people) { const s = matchName(u, spalten); if (s && !zuName[s]) zuName[s] = u.name; }
  const roh = zeitraeume(wochen, jahr);
  const personen = {};
  for (const [spalte, z] of Object.entries(roh)) {
    const name = zuName[spalte] || spalte;
    personen[name] = (personen[name] || []).concat(z).sort((a, b) => a.von.localeCompare(b.von));
  }
  const data = { jahr, personen, spalten, zuName, wochen: blaetter.length, stand: new Date().toISOString() };
  cache = { at: Date.now(), jahr, data };
  return data;
}

// Für die Startseite: eigene Zeiträume des Jahres; Büro zusätzlich alle anstehenden
export async function liste(env, me, people, { neu = false, buero = false, heute } = {}) {
  heute = heute || isoDate(new Date());
  const jahr = heute.slice(0, 4);
  const d = await laden(env, people, jahr, neu);
  const meine = d.personen[me.name] || (me.plan && d.personen[me.plan]) || [];
  const out = { heute, jahr, meine, stand: d.stand };
  if (buero) {
    out.alle = Object.entries(d.personen).flatMap(([name, z]) => z.filter(r => r.bis >= heute).map(r => ({ name, ...r })))
      .sort((a, b) => a.von.localeCompare(b.von) || a.name.localeCompare(b.name));
    out.wochen = d.wochen;
  }
  return out;
}
