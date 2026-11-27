// Geburtstage für die Startseite (Austausch): heute – freitags auch die vom Wochenende. Montag–Freitag, Zeitzone Berlin.
export function birthdays(users, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", day: "numeric", month: "numeric", year: "numeric", weekday: "short" })
    .formatToParts(now).map(x => [x.type, x.value]));
  const base = Date.UTC(+p.year, +p.month - 1, +p.day);
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  if (wd >= 5) return [];
  const days = [[0, "heute"]].concat(wd === 4 ? [[1, "am Samstag"], [2, "am Sonntag"]] : []);
  const out = [];
  for (const [off, wann] of days) {
    const d = new Date(base + off * 864e5);
    for (const u of users) if (u.geb && u.geb.t === d.getUTCDate() && u.geb.m === d.getUTCMonth() + 1)
      out.push({ name: u.name, wann, bis: `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}` });
  }
  return out;
}
