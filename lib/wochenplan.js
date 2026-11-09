// Wochenplan aus der Google-Tabelle lesen.
// Aufbau der Tabelle: ein Blatt je Kalenderwoche (z. B. „KW 45“), Zeilen = Wochentage, Spalten = Monteure,
// Zelle = Baustelle / Urlaub / Schule / HBZ / krank. Gleicher Eintrag am gleichen Tag = ein Team.

export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  return { year: y, week: Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7) };
}
export function mondayOf(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const m = new Date(jan4);
  m.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  return m;
}
export const isoDate = d => d.toISOString().slice(0, 10);

export const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Passendes Blatt zur Kalenderwoche finden
export function findSheet(list, year, week) {
  const hits = list.filter(s => {
    const t = s.title.toLowerCase();
    const nums = (t.match(/\d+/g) || []).map(Number);
    if (/^\s*\d{1,2}\s*$/.test(t)) return nums[0] === week;
    return /kw|woche/.test(t) && nums.includes(week);
  });
  return hits.find(s => s.title.includes(String(year))) || hits.find(s => !/20\d\d/.test(s.title)) || hits[0] || null;
}

const WD = [
  [/^mo(ntag)?\b/i, 0], [/^di(enstag|e)?\b/i, 1], [/^mi(ttwoch)?\b/i, 2], [/^do(nnerstag)?\b/i, 3],
  [/^fr(eitag)?\b/i, 4], [/^sa(mstag)?\b/i, 5], [/^so(nntag)?\b/i, 6],
];
function weekdayOf(cell, monday) {
  const s = String(cell || "").trim();
  if (!s) return -1;
  for (const [re, i] of WD) if (re.test(s)) return i;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.?/);
  if (m && monday) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday); d.setUTCDate(d.getUTCDate() + i);
      if (d.getUTCDate() === +m[1] && d.getUTCMonth() + 1 === +m[2]) return i;
    }
  }
  return -1;
}

// rows: Zellwerte des Blatts, known: bekannte Namen im Wochenplan (aus der Zugangsliste)
export function parseWeek(rows, known, monday) {
  // Aufbau erkennen: Wochentage nebeneinander in einer Zeile (Namen links untereinander) oder untereinander
  let dayRow = -1;
  rows.forEach((r, ri) => { if (dayRow < 0 && r.filter(v => weekdayOf(v, null) >= 0).length >= 3) dayRow = ri; });
  if (dayRow >= 0) return parseByColumns(rows, dayRow, monday);
  return parseByRows(rows, known, monday);
}

// Wochentage als Spalten, Monteure als Zeilen (Name in den Spalten links vom ersten Tag)
function parseByColumns(rows, dayRow, monday) {
  const dayCols = [];
  rows[dayRow].forEach((v, c) => { const wd = weekdayOf(v, null); if (wd >= 0 && !dayCols.some(d => d.wd === wd)) dayCols.push({ c, wd }); });
  const firstDayCol = Math.min(...dayCols.map(d => d.c));
  const isDate = v => /^\d{1,2}\.\d{1,2}\.(\d{2,4})?$/.test(String(v || "").trim());
  const people = new Map();
  for (let ri = dayRow + 1; ri < rows.length; ri++) {
    const r = rows[ri] || [];
    let name = "";
    for (let c = 0; c < firstDayCol; c++) { const v = String(r[c] || "").trim(); if (v) { name = v; break; } }
    if (!name || isDate(name) || weekdayOf(name, null) >= 0) continue;
    if (!people.has(name)) people.set(name, {});
    const p = people.get(name);
    for (const { c, wd } of dayCols) {
      const v = String(r[c] || "").trim();
      if (!v || isDate(v)) continue;
      p[wd] = p[wd] ? (p[wd].split(" · ").includes(v) ? p[wd] : p[wd] + " · " + v) : v;
    }
  }
  const tage = dayCols.slice().sort((a, b) => a.wd - b.wd).map(({ wd }) => {
    const e = {};
    for (const [name, p] of people) if (p[wd]) e[name] = p[wd];
    const dt = new Date(monday); dt.setUTCDate(dt.getUTCDate() + wd);
    return { datum: isoDate(dt), wt: wd, e };
  });
  return { spalten: [...people.keys()], tage };
}

function parseByRows(rows, known, monday) {
  const LABEL_COLS = 3;
  // 1) Zeilen mit Wochentag finden
  const days = [];
  rows.forEach((r, ri) => {
    for (let c = 0; c < Math.min(LABEL_COLS, r.length); c++) {
      const wd = weekdayOf(r[c], monday);
      if (wd >= 0) { if (!days.some(d => d.wd === wd)) days.push({ wd, row: ri, col: c }); return; }
    }
  });
  if (!days.length) throw new Error("Keine Wochentage (Mo, Di, …) in den ersten Spalten gefunden");
  const labelCols = new Set();
  rows.forEach(r => { for (let c = 0; c < Math.min(LABEL_COLS, r.length); c++) if (weekdayOf(r[c], monday) >= 0) labelCols.add(c); });
  // Datumsspalte neben dem Wochentag ebenfalls ausblenden
  for (const d of days) for (let c = 0; c < LABEL_COLS; c++) if (/^\d{1,2}\.\d{1,2}\.?(\d{2,4})?$/.test(String(rows[d.row][c] || "").trim())) labelCols.add(c);

  // 2) Kopfzeile mit Monteurnamen finden (vor dem ersten Wochentag)
  const K = new Set(known.map(norm).filter(Boolean));
  const firstDay = Math.min(...days.map(d => d.row));
  let head = -1, best = 0;
  for (let ri = 0; ri < firstDay; ri++) {
    const n = (rows[ri] || []).filter((v, c) => !labelCols.has(c) && K.has(norm(v))).length;
    if (n > best) { best = n; head = ri; }
  }
  if (head < 0) { // keine bekannten Namen: Zeile mit den meisten Einträgen direkt über dem ersten Tag
    for (let ri = firstDay - 1; ri >= 0; ri--) {
      const n = (rows[ri] || []).filter((v, c) => !labelCols.has(c) && String(v).trim()).length;
      if (n > best) { best = n; head = ri; }
    }
  }
  if (head < 0) throw new Error("Keine Zeile mit Monteurnamen gefunden");
  const cols = [];
  (rows[head] || []).forEach((v, c) => {
    const name = String(v).trim();
    if (name && !labelCols.has(c) && !cols.some(x => x.name === name)) cols.push({ c, name });
  });

  // 3) Einträge je Tag (ein Tag kann mehrere Zeilen umfassen – bis zur nächsten Tageszeile)
  days.sort((a, b) => a.row - b.row);
  const gaps = days.slice(1).map((d, i) => d.row - days[i].row).filter(g => g > 0);
  const block = gaps.length ? Math.min(...gaps) : 1;
  const tage = days.map((d, i) => {
    const end = i + 1 < days.length ? days[i + 1].row : d.row + block;
    const e = {};
    for (const { c, name } of cols) {
      const vals = [];
      for (let r = d.row; r < end; r++) {
        const v = String((rows[r] || [])[c] || "").trim();
        if (v && !vals.includes(v)) vals.push(v);
      }
      if (vals.length) e[name] = vals.join(" · ");
    }
    const dt = new Date(monday); dt.setUTCDate(dt.getUTCDate() + d.wd);
    return { datum: isoDate(dt), wt: d.wd, e };
  }).sort((a, b) => a.wt - b.wt);
  return { spalten: cols.map(x => x.name), tage };
}

// Spalte/Zeile einer Person im Plan finden: genauer Wochenplan-Name, sonst voller Name, sonst eindeutiger Vorname
export function matchName(u, names) {
  const N = names.map(n => [n, norm(n)]);
  for (const key of [u.plan, u.name].map(norm).filter(Boolean)) {
    const hit = N.find(([, n]) => n === key);
    if (hit) return hit[0];
  }
  const first = norm(u.plan || u.name).split(" ")[0];
  const cand = N.filter(([, n]) => n.split(" ")[0] === first);
  return cand.length === 1 ? cand[0][0] : "";
}
