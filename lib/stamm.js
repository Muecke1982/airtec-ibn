// Stammdaten fürs Protokoll (Auswahllisten, Nachfüllmengen, GWP, Dokumente, Upload-Link) aus der Datenbank.
// Liefert dieselbe Form, die die App bisher aus der Stammdaten-Excel gelesen hat.
import { hasDb, all, one } from "./db.js";
import { users } from "./auth.js";

// null = noch nichts in der Datenbank (dann gilt weiter die Excel-Datei)
export async function stammAusDb(env) {
  if (!hasDb(env)) return null;
  const listen = await all(env, "SELECT name, frei FROM listen ORDER BY pos, name");
  if (!listen.length) return null;
  const werte = await all(env, "SELECT liste, wert FROM listen_werte ORDER BY liste, pos, wert");
  const out = { lists: {}, free: {}, nach: [], gwp: {}, docs: [] };
  for (const l of listen) { out.lists[l.name] = []; out.free[l.name] = !!l.frei; }
  for (const w of werte) if (out.lists[w.liste]) out.lists[w.liste].push(w.wert);
  for (const n of await all(env, "SELECT geraet, km, f6, f10, f12, f16 FROM nachfuell ORDER BY pos, id"))
    out.nach.push({ h: n.geraet, km: n.km, f: { 6: n.f6, 10: n.f10, 12: n.f12, 16: n.f16 } });
  for (const g of await all(env, "SELECT kaeltemittel, wert FROM gwp ORDER BY kaeltemittel")) out.gwp[g.kaeltemittel] = g.wert;
  out.docs = (await all(env, "SELECT hersteller, kit, name, url FROM dokumente ORDER BY pos, id")).map(d => ({ h: d.hersteller, kit: d.kit, name: d.name, url: d.url }));
  const up = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'upload_link'");
  if (up && up.wert) out.upload = up.wert;
  // Monteure fürs Protokoll = Mitarbeiter
  out.monteure = (await users(env)).map(u => ({ name: u.name, mail: u.mail || "" }));
  return out;
}
