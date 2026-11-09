// Maschinen-Ausleihe. Daten: Excel-Datei in SharePoint (Standard: Airtec_Maschinen.xlsx neben den Stammdaten)
//   Blatt „Maschinen“: Nr | Maschine | Hersteller / Typ | Seriennummer | Kategorie | Bemerkung   (pflegt das Büro)
//   Blatt „Protokoll“: Nr | Maschine | Monteur | Entnommen | Zurückgelegt | Zuletzt bestätigt | Bemerkung (schreibt die App)
import { cfg, downloadTagged, overwrite } from "./graph.js";
import { openWorkbook } from "./xlsx.js";

const KEEP = 10;                 // je Maschine die letzten 10 Ausleihen behalten
let cache = { at: 0, data: null };
let queue = Promise.resolve();   // Schreibvorgänge nacheinander ausführen

export function path(env) {
  const p = cfg(env, "SP_MASCHINEN_PATH", false);
  if (p) return p;
  return cfg(env, "SP_STAMM_PATH").replace(/[^/]*$/, "") + "Airtec_Maschinen.xlsx";
}
export const maxDays = env => +cfg(env, "MASCHINEN_TAGE", false) || 10;

const fmt = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
export function parseDate(s) {
  const m = String(s || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 12) - 1, +m[5] || 0));
  const n = +s; // Excel-Seriennummer, falls jemand ein echtes Datum eingetragen hat
  if (n > 30000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 864e5);
  return null;
}

function cols(head, spec) {
  const h = head.map(x => String(x || "").toLowerCase().trim());
  const out = {};
  for (const [k, keys] of Object.entries(spec)) out[k] = h.findIndex(x => keys.some(q => x === q || x.startsWith(q)));
  return out;
}
const MC = { nr: ["nr", "nummer", "inventar", "id"], name: ["maschine", "bezeichnung", "gerät", "geraet", "name"], typ: ["hersteller", "typ", "modell"], sn: ["serien", "sn"], kat: ["kategorie", "gruppe", "art"], bem: ["bemerkung", "hinweis", "notiz"] };
const PC = { nr: ["nr"], name: ["maschine"], wer: ["monteur", "name", "mitarbeiter"], von: ["entnommen", "entnahme", "von"], bis: ["zurück", "zurueck", "rückgabe"], best: ["zuletzt bestätigt", "bestätigt", "bestaetigt"], bem: ["bemerkung"] };

async function load(env) {
  const f = await downloadTagged(env, path(env));
  const wb = await openWorkbook(f.bytes);
  const mr = await wb.rows("Maschinen") || await wb.rows();
  if (!mr || !mr.length) throw new Error("Blatt „Maschinen“ ist leer");
  const pr = await wb.rows("Protokoll");
  if (!pr) throw new Error("Blatt „Protokoll“ fehlt in der Maschinen-Datei");
  const c = cols(mr[0], MC);
  if (c.name < 0) throw new Error("Spalte „Maschine“ fehlt im Blatt Maschinen");
  const v = (r, i) => i >= 0 ? String(r[i] ?? "").trim() : "";
  const machines = mr.slice(1).map((r, i) => {
    const name = v(r, c.name), nr = v(r, c.nr);
    return { id: nr || name, nr, name, typ: v(r, c.typ), sn: v(r, c.sn), kat: v(r, c.kat) || "Sonstige", bem: v(r, c.bem), pos: i };
  }).filter(m => m.name);
  const p = cols(pr[0] && pr[0].length ? pr[0] : ["Nr", "Maschine", "Monteur", "Entnommen", "Zurückgelegt", "Zuletzt bestätigt", "Bemerkung"], PC);
  const log = pr.slice(1).map(r => ({ nr: v(r, p.nr), name: v(r, p.name), wer: v(r, p.wer), von: v(r, p.von), bis: v(r, p.bis), best: v(r, p.best), bem: v(r, p.bem) }))
    .filter(e => e.wer && (e.nr || e.name));
  return { f, wb, machines, log };
}

const keyOf = e => e.nr || e.name;

function view(env, d, me) {
  const now = Date.now(), lim = maxDays(env);
  return d.machines.map(m => {
    const open = d.log.find(e => keyOf(e) === m.id && !e.bis);
    let aus = null;
    if (open) {
      const since = parseDate(open.von), seen = parseDate(open.best) || since;
      const tage = since ? Math.floor((now - since) / 864e5) : 0;
      const ohne = seen ? Math.floor((now - seen) / 864e5) : 0;
      aus = { wer: open.wer, seit: open.von, tage, faellig: ohne >= lim };
    }
    const out = { id: m.id, nr: m.nr, name: m.name, typ: m.typ, sn: m.sn, kat: m.kat, bem: m.bem, aus };
    if (me && me.schreiben) out.verlauf = d.log.filter(e => keyOf(e) === m.id).slice(0, KEEP).map(e => ({ wer: e.wer, von: e.von, bis: e.bis, bem: e.bem }));
    return out;
  });
}

export async function list(env, me, fresh = false) {
  if (fresh || !cache.data || Date.now() - cache.at > 10000) cache = { at: Date.now(), data: await load(env) };
  return { maschinen: view(env, cache.data, me), tage: maxDays(env) };
}

// aktion: nehmen | zurueck | uebernehmen | bestaetigen
export function act(env, me, aktion, id) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await load(env);
      const m = d.machines.find(x => x.id === id);
      if (!m) throw Object.assign(new Error("Maschine nicht gefunden – wurde die Liste geändert?"), { status: 404 });
      const now = fmt(new Date());
      const open = d.log.find(e => keyOf(e) === m.id && !e.bis);
      const mine = open && open.wer.toLowerCase() === me.name.toLowerCase();
      if (aktion === "nehmen") {
        if (open && !mine) throw Object.assign(new Error(`${m.name} ist bereits bei ${open.wer} (seit ${open.von})`), { status: 409, wer: open.wer });
        if (mine) return list(env, me, true);
        d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: "" });
      } else if (aktion === "uebernehmen") {
        if (open && !mine) { open.bis = now; open.bem = (open.bem ? open.bem + "; " : "") + "übergeben an " + me.name; }
        if (!mine) d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: open ? "übernommen von " + open.wer : "" });
      } else if (aktion === "zurueck") {
        if (!open) return list(env, me, true);
        if (!mine && !me.schreiben) throw Object.assign(new Error(`${m.name} ist bei ${open.wer} – nur ${open.wer} oder das Büro kann sie zurückstellen`), { status: 403 });
        open.bis = now;
        if (!mine) open.bem = (open.bem ? open.bem + "; " : "") + "zurückgestellt von " + me.name;
      } else if (aktion === "bestaetigen") {
        if (!open || !mine) return list(env, me, true);
        open.best = now;
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });

      // je Maschine nur die letzten 10 Einträge behalten (offene Ausleihen immer)
      const count = {};
      const keep = d.log.filter(e => { const k = keyOf(e); count[k] = (count[k] || 0) + 1; return count[k] <= KEEP || !e.bis; });
      await d.wb.setBody("Protokoll", keep.map(e => [e.nr, e.name, e.wer, e.von, e.bis, e.best, e.bem]));
      try {
        await overwrite(env, d.f.id, await d.wb.toBytes(), d.f.etag);
      } catch (e) {
        if (e.status === 412 && attempt < 2) continue; // jemand anderes hat gerade gespeichert → neu laden und nochmal
        throw e;
      }
      cache = { at: 0, data: null };
      return list(env, me, true);
    }
    throw new Error("Speichern nicht möglich – bitte nochmal versuchen");
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
