// Büro-Hinweise an Monteure. Daten: Excel in SharePoint (Standard: Airtec_Hinweise.xlsx neben den Stammdaten)
//   Blatt „Hinweise“: An | Hinweis | Von | Erstellt | Sichtbar ab | Erledigt
import { cfg, downloadTagged, overwrite } from "./graph.js";
import { openWorkbook } from "./xlsx.js";
import { parseDate } from "./maschinen.js";

const HEAD = ["An", "Hinweis", "Von", "Erstellt", "Sichtbar ab", "Erledigt", "Angepinnt", "Anzeigen bis"];
const yes = v => /^(x|ja|j|1|true|wahr|📌)$/i.test(String(v || "").trim());
let cache = { at: 0, data: null };
let queue = Promise.resolve();

export function path(env) {
  return cfg(env, "SP_HINWEISE_PATH", false) || cfg(env, "SP_STAMM_PATH").replace(/[^/]*$/, "") + "Airtec_Hinweise.xlsx";
}
const fmt = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// kurze, stabile Kennung je Zeile (auch für Zeilen, die direkt in Excel geschrieben wurden)
function idOf(r) {
  let h = 2166136261;
  for (const ch of `${r.an}|${r.text}|${r.erstellt}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
// Erledigt-Spalte: "Nick Pauls 11.11.2026 07:12; Elvin Morawez 12.11.2026 06:55"
const doneList = s => String(s || "").split(";").map(x => x.trim()).filter(Boolean).map(x => {
  const m = x.match(/^(.*?)\s+(\d{1,2}\.\d{1,2}\.\d{4}(?:\s+\d{1,2}:\d{2})?)$/);
  return m ? { wer: m[1], am: m[2] } : { wer: x, am: "" };
});

async function load(env) {
  const f = await downloadTagged(env, path(env));
  const wb = await openWorkbook(f.bytes);
  const rows = await wb.rows("Hinweise") || await wb.rows();
  const v = (r, i) => String((r || [])[i] ?? "").trim();
  const list = (rows || []).slice(1).map(r => ({ an: v(r, 0), text: v(r, 1), von: v(r, 2), erstellt: v(r, 3), ab: v(r, 4), erledigt: v(r, 5), pin: yes(v(r, 6)), bis: v(r, 7) }))
    .filter(r => r.text);
  list.forEach(r => { r.id = idOf(r); r.done = doneList(r.erledigt); });
  const headOk = HEAD.every((h, i) => String(((rows || [])[0] || [])[i] || "").trim().toLowerCase() === h.toLowerCase());
  return { f, wb, list, headOk };
}

// Ist der Hinweis für diese Person? (An = voller Name, Wochenplan-Name, eindeutiger Vorname oder „Alle“)
const isBuero = an => ["buro", "buero", "buro team", "an das buro"].includes(norm(an));
export function forMe(an, me, allNames = []) {
  const a = norm(an);
  if (!a) return false;
  if (isBuero(an)) return !!me.schreiben;
  if (["alle", "alle monteure", "jeder", "*"].includes(a)) return true;
  const keys = [me.name, me.plan].map(norm).filter(Boolean);
  if (keys.includes(a)) return true;
  const first = norm(me.name).split(" ")[0];
  if (a === first) return allNames.filter(n => norm(n).split(" ")[0] === a).length <= 1;
  return false;
}
const isAll = an => ["alle", "alle monteure", "jeder", "*"].includes(norm(an));

export async function list(env, me, names, fresh = false) {
  if (fresh || !cache.data || Date.now() - cache.at > 15000) cache = { at: Date.now(), data: await load(env) };
  const now = Date.now();
  const expired = r => { const d = parseDate(r.bis); return d && d.getTime() + 12 * 3600e3 < now; };   // „Anzeigen bis“ einschließlich
  const visible = r => { const d = parseDate(r.ab); return (!d || d.getTime() - 12 * 3600e3 <= now) && !expired(r); };
  // Nachrichten ans Büro sind erledigt, sobald EINE Person aus dem Büro abgehakt hat
  const doneForMe = r => isBuero(r.an) ? r.done.length > 0 : r.done.some(d => norm(d.wer) === norm(me.name));
  // angepinnte Hinweise lassen sich nicht abhaken – sie stehen bis zum Ablaufdatum oben
  const mine = cache.data.list.filter(r => visible(r) && forMe(r.an, me, names) && (r.pin || !doneForMe(r)))
    .map(r => ({ id: r.id, text: r.text, von: r.von, erstellt: r.erstellt, alle: isAll(r.an), buero: isBuero(r.an), pin: r.pin, bis: r.bis }))
    .sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0));
  const out = { meine: mine };
  // eigene Nachrichten ans Büro (letzte 14 Tage) – damit der Monteur sieht, ob sie erledigt sind
  const lim = now - 14 * 864e5;
  out.gesendet = cache.data.list.filter(r => isBuero(r.an) && norm(r.von) === norm(me.name) && (parseDate(r.erstellt) || new Date()).getTime() > lim)
    .map(r => ({ text: r.text, erstellt: r.erstellt, done: r.done }));
  if (me.schreiben) out.alle = cache.data.list.filter(r => !isBuero(r.an))
    .map(r => ({ id: r.id, an: r.an, text: r.text, von: r.von, erstellt: r.erstellt, ab: r.ab, done: r.done, alle: isAll(r.an), pin: r.pin, bis: r.bis, abgelaufen: !!expired(r) }));
  return out;
}

export function act(env, me, names, b) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await load(env);
      const now = fmt(new Date());
      if (b.aktion === "erledigt") {
        const r = d.list.find(x => x.id === b.id);
        if (!r) return list(env, me, names, true);
        if (!r.done.some(x => norm(x.wer) === norm(me.name))) r.done.push({ wer: me.name, am: now });
      } else if (b.aktion === "neu") {
        // Monteure können nur ans Büro schreiben, das Büro an alle
        const text = String(b.text || "").trim().slice(0, 500), an = me.schreiben ? String(b.an || "").trim().slice(0, 80) : "Büro";
        if (!text || !an) throw Object.assign(new Error("Empfänger und Text angeben"), { status: 400 });
        const pin = !!b.pin && !!me.schreiben;
        const r = { an, text, von: me.name, erstellt: now, ab: String(b.ab || "").trim(), done: [], pin, bis: String(b.bis || "").trim() };
        if (pin && !r.bis) throw Object.assign(new Error("Bitte für angepinnte Hinweise ein Ablaufdatum angeben"), { status: 400 });
        r.id = idOf(r);
        d.list.unshift(r);
      } else if (b.aktion === "loeschen") {
        if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
        d.list = d.list.filter(x => x.id !== b.id);
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });

      // erledigte Hinweise (an Einzelne) 30 Tage nach dem Abhaken entfernen
      const lim = Date.now() - 30 * 864e5;
      // abgelaufene Hinweise 7 Tage nach „Anzeigen bis“ entfernen
      d.list = d.list.filter(r => { const x = parseDate(r.bis); return !x || x.getTime() > Date.now() - 7 * 864e5; });
      d.list = d.list.filter(r => r.pin || isAll(r.an) || !r.done.length || (parseDate(r.done[r.done.length - 1].am) || new Date()).getTime() > lim);
      await d.wb.setBody("Hinweise", d.list.map(r => [r.an, r.text, r.von, r.erstellt, r.ab, r.done.map(x => (x.wer + " " + x.am).trim()).join("; "), r.pin ? "x" : "", r.bis || ""]), d.headOk ? undefined : HEAD);
      try { await overwrite(env, d.f.id, await d.wb.toBytes(), d.f.etag); }
      catch (e) { if (e.status === 412 && attempt < 2) continue; throw e; }
      cache = { at: 0, data: null };
      return list(env, me, names, true);
    }
    throw new Error("Speichern nicht möglich – bitte nochmal versuchen");
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
