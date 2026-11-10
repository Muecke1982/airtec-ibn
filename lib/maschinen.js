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
  an: ["verliehen an"], kontakt: ["ansprechpartner"], frist: ["rückgabe bis", "frist"], bst: ["baustelle"] };
export const P_HEAD = ["Nr", "Maschine", "Monteur", "Entnommen", "Zurückgelegt", "Zuletzt bestätigt", "Bemerkung", "Verliehen an", "Ansprechpartner", "Rückgabe bis", "Baustelle"];
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
    an: v(r, p.an), kontakt: v(r, p.kontakt), frist: v(r, p.frist), bst: v(r, p.bst) }))
    .filter(e => e.wer && (e.nr || e.name));
  const headOk = P_HEAD.every((h, i) => String((pr[0] || [])[i] || "").trim().toLowerCase() === h.toLowerCase());
  // Blatt „Verleih“: Empfänger-Vorschläge + Erinnerungsabstand
  const vr = await wb.rows("Verleih");
  const empf = (vr || V_DEFAULT).slice(1).map(r => String(r[0] || "").trim()).filter(Boolean);
  const every = +((vr || V_DEFAULT).slice(1).map(r => String(r[1] || "").trim()).find(Boolean)) || 3;
  // Blatt „Reservierungen“: Nr | Maschine | Für | Von | Bis | Notiz | Reserviert von | Reserviert am
  const rr = await wb.rows("Reservierungen");
  const res = (rr || []).slice(1).map(r => ({ nr: v(r, 0), name: v(r, 1), fuer: v(r, 2), von: v(r, 3), bis: v(r, 4) || v(r, 3), notiz: v(r, 5), by: v(r, 6), am: v(r, 7) }))
    .filter(r => (r.nr || r.name) && r.fuer && parseDate(r.von));
  res.forEach(r => { r.rid = resId(r); });
  return { f, wb, machines, log, headOk, hasVerleih: !!vr, empf, every, res, hasRes: !!rr };
}

const keyOf = e => e.nr || e.name;
export const R_HEAD = ["Nr", "Maschine", "Für", "Von", "Bis", "Notiz", "Reserviert von", "Reserviert am"];
function resId(r) {
  let h = 2166136261;
  for (const ch of `${r.nr || r.name}|${r.fuer}|${r.von}|${r.bis}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const dayStart = () => { const t = new Date(); return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()); };
// Reservierung noch aktuell? (bis einschließlich „Bis“)
const resLive = r => { const b = parseDate(r.bis); return b && b.getTime() + 864e5 > dayStart(); };

function view(env, d, me) {
  const now = Date.now(), lim = maxDays(env);
  return d.machines.map(m => {
    const open = d.log.find(e => keyOf(e) === m.id && !e.bis);
    let aus = null;
    if (open) {
      const since = parseDate(open.von), seen = parseDate(open.best) || since;
      const tage = since ? Math.floor((now - since) / 864e5) : 0;
      if (open.bst) {
        // auf einer Baustelle abgestellt: angezeigt wird die Baustelle, zurückstellen/abholen darf jeder
        aus = { wer: open.wer, seit: open.von, tage, baustelle: open.bst, abgestellt: open.best || open.von };
      } else if (open.an) {
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
    // anstehende Reservierungen (nach Datum), „jetzt“ = heute im Zeitraum
    out.res = d.res.filter(r => (r.nr || r.name) === m.id && resLive(r))
      .sort((a, b) => parseDate(a.von) - parseDate(b.von))
      .map(r => ({ rid: r.rid, fuer: r.fuer, von: r.von.slice(0, 10), bis: r.bis.slice(0, 10), notiz: r.notiz, by: r.by,
        jetzt: parseDate(r.von).getTime() < dayStart() + 864e5,
        bald: parseDate(r.von).getTime() < dayStart() + 3 * 864e5 }));
    if (me && me.schreiben) out.verlauf = d.log.filter(e => keyOf(e) === m.id).slice(0, KEEP).map(e => ({ wer: e.wer, von: e.von, bis: e.bis, bem: e.bem, an: e.an, kontakt: e.kontakt, frist: e.frist, bst: e.bst }));
    return out;
  });
}

export async function list(env, me, fresh = false) {
  if (fresh || !cache.data || Date.now() - cache.at > 10000) cache = { at: Date.now(), data: await load(env) };
  const d = cache.data, out = { maschinen: view(env, d, me), tage: maxDays(env), empfaenger: d.empf, erinnerung_tage: d.every,
    baustellen: [...new Set(d.log.map(e => e.bst).filter(Boolean))].slice(0, 20) };
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
      const mine = open && !open.bst && open.wer.toLowerCase() === me.name.toLowerCase();
      const takeFromSite = open && open.bst && (aktion === "nehmen" || aktion === "uebernehmen");
      if (takeFromSite) {
        // von der Baustelle abholen: alter Eintrag wird geschlossen, neuer für den Abholer
        open.bis = now; open.bem = (open.bem ? open.bem + "; " : "") + `von Baustelle ${open.bst} abgeholt von ${me.name}`;
        d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: "von Baustelle " + open.bst, an: "", kontakt: "", frist: "", bst: "" });
      } else if (aktion === "nehmen") {
        if (open && !mine) throw Object.assign(new Error(`${m.name} ist bereits bei ${open.wer} (seit ${open.von})`), { status: 409, wer: open.wer });
        if (mine) return list(env, me, true);
        d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: "", an: "", kontakt: "", frist: "", bst: "" });
      } else if (aktion === "uebernehmen") {
        if (open && !mine) { open.bis = now; open.bem = (open.bem ? open.bem + "; " : "") + "übergeben an " + me.name; }
        if (!mine) d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: open ? "übernommen von " + open.wer : "", an: "", kontakt: "", frist: "", bst: "" });
      } else if (aktion === "zurueck") {
        if (!open) return list(env, me, true);
        if (!mine && !me.schreiben && !open.bst) throw Object.assign(new Error(`${m.name} ist bei ${open.wer} – nur ${open.wer} oder das Büro kann sie zurückstellen`), { status: 403 });
        open.bis = now;
        if (open.bst && !mine) open.bem = (open.bem ? open.bem + "; " : "") + `von Baustelle ${open.bst} zurückgestellt von ${me.name}`;
        else if (!mine) open.bem = (open.bem ? open.bem + "; " : "") + "zurückgestellt von " + me.name;
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
        d.log.unshift({ nr: m.nr, name: m.name, wer: me.name, von: now, bis: "", best: "", bem: "", an, kontakt, frist: dateOnly(new Date(Date.now() + tage * 864e5)), bst: "" });
      } else if (aktion === "baustelle") {
        const bst = String(extra.baustelle || "").trim().slice(0, 80);
        if (!bst) throw Object.assign(new Error("Bitte die Baustelle angeben"), { status: 400 });
        if (!open || open.an) throw Object.assign(new Error(`${m.name} ist nicht bei dir ausgeliehen – bitte zuerst mitnehmen`), { status: 409 });
        if (!mine && !me.schreiben && !open.bst) throw Object.assign(new Error(`${m.name} ist bei ${open.wer}`), { status: 403 });
        open.bst = bst; open.best = now;
        open.bem = (open.bem ? open.bem + "; " : "") + `auf Baustelle gelassen von ${me.name}`;
      } else if (aktion === "reservieren") {
        const fuer = String(extra.fuer || me.name).trim().slice(0, 80);   // für sich, Kollegen oder Externe (Trogo, Airtec Service …)
        const v1 = parseDate(extra.von), v2 = parseDate(extra.bis || extra.von);
        if (!v1 || !v2) throw Object.assign(new Error("Bitte Zeitraum angeben"), { status: 400 });
        if (v2 < v1) throw Object.assign(new Error("„Bis“ liegt vor „Von“"), { status: 400 });
        if (v2.getTime() + 864e5 <= dayStart()) throw Object.assign(new Error("Der Zeitraum liegt in der Vergangenheit"), { status: 400 });
        const clash = d.res.find(r => (r.nr || r.name) === m.id && resLive(r) && parseDate(r.von) <= v2 && parseDate(r.bis) >= v1);
        if (clash) throw Object.assign(new Error(`${m.name} ist schon für ${clash.fuer} reserviert (${clash.von.slice(0, 10)} – ${clash.bis.slice(0, 10)})`), { status: 409 });
        const r = { nr: m.nr, name: m.name, fuer, von: dateOnly(v1), bis: dateOnly(v2), notiz: String(extra.notiz || "").trim().slice(0, 120), by: me.name, am: now };
        r.rid = resId(r);
        d.res.push(r);
      } else if (aktion === "storno") {
        const r = d.res.find(x => x.rid === extra.rid);
        if (!r) return list(env, me, true);
        if (!me.schreiben && r.fuer.toLowerCase() !== me.name.toLowerCase() && r.by.toLowerCase() !== me.name.toLowerCase())
          throw Object.assign(new Error("Nur die eigene Reservierung oder das Büro kann stornieren"), { status: 403 });
        d.res = d.res.filter(x => x !== r);
      } else if (aktion === "erinnern") {
        if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
        if (!open || !open.an) return list(env, me, true);
        open.best = now;
        open.bem = (open.bem ? open.bem.replace(/;?\s*nachgehakt von [^;]+$/, "") + "; " : "") + "nachgehakt von " + me.name;
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });

      // je Maschine nur die letzten 10 Einträge behalten (offene Ausleihen immer)
      const count = {};
      const keep = d.log.filter(e => { const k = keyOf(e); count[k] = (count[k] || 0) + 1; return count[k] <= KEEP || !e.bis; });
      await d.wb.setBody("Protokoll", keep.map(e => [e.nr, e.name, e.wer, e.von, e.bis, e.best, e.bem, e.an, e.kontakt, e.frist, e.bst]), d.headOk ? undefined : P_HEAD);
      if (!d.hasVerleih) await d.wb.addSheet("Verleih", V_DEFAULT, [48, 24]);
      // wer eine heute gültige Reservierung hat und die Maschine mitnimmt, „verbraucht“ sie
      if (["nehmen", "uebernehmen"].includes(aktion))
        d.res = d.res.filter(r => !((r.nr || r.name) === m.id && r.fuer.toLowerCase() === me.name.toLowerCase() && parseDate(r.von).getTime() < dayStart() + 864e5));
      const resRows = d.res.filter(resLive).sort((a, b) => parseDate(a.von) - parseDate(b.von))
        .map(r => [r.nr, r.name, r.fuer, r.von, r.bis, r.notiz, r.by, r.am]);
      if (d.hasRes) await d.wb.setBody("Reservierungen", resRows);
      else if (resRows.length) await d.wb.addSheet("Reservierungen", [R_HEAD, ...resRows], [10, 30, 22, 13, 13, 30, 22, 18]);
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
