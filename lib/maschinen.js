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
const PC = { nr: ["nr"], name: ["maschine"], wer: ["monteur", "mitarbeiter"], von: ["entnommen", "entnahme"], bis: ["zurückgelegt", "zurück am", "zurueck"], best: ["zuletzt bestätigt", "bestätigt", "bestaetigt"], bem: ["bemerkung"],
  an: ["verliehen an"], kontakt: ["ansprechpartner"], frist: ["rückgabe bis", "frist"] };
export const P_HEAD = ["Nr", "Maschine", "Monteur", "Entnommen", "Zurückgelegt", "Zuletzt bestätigt", "Bemerkung", "Verliehen an", "Ansprechpartner", "Rückgabe bis"];
const V_DEFAULT = [["Empfänger (Vorschläge für „Maschine verleihen“)", "Erinnerung alle … Tage"], ["Trogo", "3"], ["Airtec Service", ""], ["Airtec Lüftung", ""]];
const dateOnly = d => fmt(d).slice(0, 10);

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
  const p = cols(pr[0] && pr[0].length ? pr[0] : P_HEAD, PC);
  const log = pr.slice(1).map(r => ({ nr: v(r, p.nr), name: v(r, p.name), wer: v(r, p.wer), von: v(r, p.von), bis: v(r, p.bis), best: v(r, p.best), bem: v(r, p.bem),
    an: v(r, p.an), kontakt: v(r, p.kontakt), frist: v(r, p.frist) }))
    .filter(e => e.wer && (e.nr || e.name));
  const headOk = P_HEAD.every((h, i) => String((pr[0] || [])[i] || "").trim().toLowerCase() === h.toLowerCase());
  // Blatt „Verleih“: Empfänger-Vorschläge + Erinnerungsabstand
  const vr = await wb.rows("Verleih");
  const empf = (vr || V_DEFAULT).slice(1).map(r => String(r[0] || "").trim()).filter(Boolean);
  const every = +((vr || V_DEFAULT).slice(1).map(r => String(r[1] || "").trim()).find(Boolean)) || 3;
  return { f, wb, machines, log, headOk, hasVerleih: !!vr, empf, every };
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
      if (open.an) {
        // an Externe verliehen: nach „Rückgabe bis“ wird das Büro erinnert, danach alle X Tage
        const frist = parseDate(open.frist);
        const over = frist && now > frist.getTime() + 864e5 / 2;
        const rem = parseDate(open.best);
        const erinnern = !!over && (!rem || now - rem >= d.every * 864e5);
        aus = { wer: open.wer, seit: open.von, tage, extern: true, an: open.an, kontakt: open.kontakt, frist: open.frist, ueberfaellig: !!over, erinnern, erinnert: open.best };
      } else {
        const ohne = seen ? Math.floor((now - seen) / 864e5) : 0;
        aus = { wer: open.wer, seit: open.von, tage, faellig: ohne >= lim };
      }
    }
    const out = { id: m.id, nr: m.nr, name: m.name, typ: m.typ, sn: m.sn, kat: m.kat, bem: m.bem, aus };
    if (me && me.schreiben) out.verlauf = d.log.filter(e => keyOf(e) === m.id).slice(0, KEEP).map(e => ({ wer: e.wer, von: e.von, bis: e.bis, bem: e.bem, an: e.an, kontakt: e.kontakt, frist: e.frist }));
    return out;
  });
}

export async function list(env, me, fresh = false) {
  if (fresh || !cache.data || Date.now() - cache.at > 10000) cache = { at: Date.now(), data: await load(env) };
  const d = cache.data, out = { maschinen: view(env, d, me), tage: maxDays(env), empfaenger: d.empf, erinnerung_tage: d.every };
  if (me && me.schreiben) {
    // in den letzten 3 Tagen zurückgekommene Verleihe – damit das Büro sieht, wer es erledigt hat
    const since = Date.now() - 3 * 864e5;
    out.erledigt = d.log.filter(e => e.an && e.bis && (parseDate(e.bis) || 0) >= since)
      .map(e => ({ name: e.name, an: e.an, kontakt: e.kontakt, bis: e.bis, von: (e.bem.match(/zurückgestellt von ([^;]+)/) || [])[1] || e.wer }));
  }
  return out;
}

// aktion: nehmen | zurueck | uebernehmen | bestaetigen | verleihen | erinnern
export function act(env, me, aktion, id, extra = {}) {
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
      } else if (aktion === "verleihen") {
        const an = String(extra.an || "").trim().slice(0, 80), kontakt = String(extra.kontakt || "").trim().slice(0, 80);
        const tage = Math.max(1, Math.min(365, Math.round(+extra.tage || 0)));
        if (!an) throw Object.assign(new Error("Bitte angeben, an wen die Maschine verliehen wird"), { status: 400 });
        if (!kontakt) throw Object.assign(new Error("Bitte einen Namen (Ansprechpartner) angeben"), { status: 400 });
        if (!extra.tage) throw Object.assign(new Error("Bitte angeben, für wie viele Tage"), { status: 400 });
        if (open && !mine && !me.schreiben) throw Object.assign(new Error(`${m.name} ist gerade bei ${open.an || open.wer}`), { status: 409 });
        if (open) { open.bis = now; open.bem = (open.bem ? open.bem + "; " : "") + "verliehen an " + an; }
        d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: "", an, kontakt, frist: dateOnly(new Date(Date.now() + tage * 864e5)) });
      } else if (aktion === "erinnern") {
        if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
        if (!open || !open.an) return list(env, me, true);
        open.best = now;
        open.bem = (open.bem ? open.bem.replace(/;?\s*nachgehakt von [^;]+$/, "") + "; " : "") + "nachgehakt von " + me.name;
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });

      // je Maschine nur die letzten 10 Einträge behalten (offene Ausleihen immer)
      const count = {};
      const keep = d.log.filter(e => { const k = keyOf(e); count[k] = (count[k] || 0) + 1; return count[k] <= KEEP || !e.bis; });
      await d.wb.setBody("Protokoll", keep.map(e => [e.nr, e.name, e.wer, e.von, e.bis, e.best, e.bem, e.an, e.kontakt, e.frist]), d.headOk ? undefined : P_HEAD);
      if (!d.hasVerleih) await d.wb.addSheet("Verleih", V_DEFAULT, [48, 24]);
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
