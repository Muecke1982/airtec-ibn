// Urlaub aus Label: Label schickt Genehmigungen/Ablehnungen per Mail an ein festes Postfach
// (Standard urlaub@airtec-kaeltetechnik.de, Einstellung URLAUB_MAILBOX). Die App liest dieses Postfach
// (App-Recht „Application Mail.Read“, per Exchange auf genau dieses Postfach beschränkt), erkennt
// Mitarbeiter, Zeitraum und Status und führt eine Liste in SharePoint:
//   Airtec_Urlaub.xlsx (neben den Stammdaten), Blatt „Urlaub“:
//   Mitarbeiter | Von | Bis | Status | Arbeitstage | Eingegangen | Betreff | Im Wochenplan | Mail-ID | Hinweis
// Das Büro kann die Liste in Excel korrigieren oder ergänzen.
import { cfg, downloadTagged, overwrite, upload, graphGet } from "./graph.js";
import { openWorkbook } from "./xlsx.js";
import { VORLAGE } from "./urlaub-vorlage.js";

const HEAD = ["Mitarbeiter", "Von", "Bis", "Status", "Arbeitstage", "Eingegangen", "Betreff", "Im Wochenplan", "Mail-ID", "Hinweis"];
const SYNC_MS = 10 * 60 * 1000;
let cache = { at: 0, data: null };
let state = { sync: 0, fehler: "", geprueft: "" };
let queue = Promise.resolve();

export const mailbox = env => cfg(env, "URLAUB_MAILBOX", false) || "urlaub@airtec-kaeltetechnik.de";
export function path(env) {
  return cfg(env, "SP_URLAUB_PATH", false) || cfg(env, "SP_STAMM_PATH").replace(/[^/]*$/, "") + "Airtec_Urlaub.xlsx";
}
export const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const deOf = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
function berlin(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}
// Datum aus Zelle/Text → ISO (TT.MM.JJJJ, TT.MM.JJ, JJJJ-MM-TT oder Excel-Seriennummer)
export function toIso(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  const n = +s;
  if (n > 30000 && n < 80000) return isoOf(new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5));
  return "";
}

// gesetzliche Feiertage NRW
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mon = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(mon)}-${pad(day)}`;
}
export function holiday(iso) {
  const y = +iso.slice(0, 4), md = iso.slice(5);
  if (["01-01", "05-01", "10-03", "11-01", "12-25", "12-26"].includes(md)) return true;
  const E = easter(y);
  return [-2, 1, 39, 50, 60].some(k => addDays(E, k) === iso);
}
// Arbeitstage (Mo–Fr ohne Feiertage NRW) im Zeitraum
export function workdays(von, bis) {
  const out = [];
  if (!von || !bis || bis < von) return out;
  for (let d = von, n = 0; d <= bis && n < 400; d = addDays(d, 1), n++) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    if (wd !== 0 && wd !== 6 && !holiday(d)) out.push(d);
  }
  return out;
}

// ---------- Mail erkennen ----------
const RX_DATE = String.raw`\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})(?!\d)`;
export function parseMail(mail, people) {
  const body = String((mail.body && mail.body.content) || mail.bodyPreview || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  const subject = String(mail.subject || "");
  const text = subject + "\n" + body;
  const low = text.toLowerCase();
  const hinweise = [];

  // Status – Ablehnung/Storno zuerst prüfen („nicht genehmigt“ enthält „genehmigt“)
  let status = "unklar";
  if (/storniert|zurückgezogen|zurueckgezogen|annulliert|gelöscht/.test(low)) status = "storniert";
  else if (/abgelehnt|nicht genehmigt|nicht bewilligt|abgewiesen|verweigert/.test(low)) status = "abgelehnt";
  else if (/genehmigt|bewilligt|freigegeben|bestätigt|bestaetigt|angenommen/.test(low)) status = "genehmigt";

  // Zeitraum: „22.12.2026 – 02.01.2027“ / „vom … bis …“ – sonst die ersten Datumsangaben
  let von = "", bis = "";
  const range = text.match(new RegExp(`(${RX_DATE})\\s*(?:-|–|—|bis(?:\\s+(?:einschließlich|einschl\\.|zum))?)\\s*(${RX_DATE})`, "i"));
  if (range) { von = toIso(range[1]); bis = toIso(range[2]); }
  else {
    const all = (body.match(new RegExp(RX_DATE, "g")) || subject.match(new RegExp(RX_DATE, "g")) || []).map(toIso).filter(Boolean);
    if (all.length === 1) { von = bis = all[0]; }
    else if (all.length > 1) { von = all[0] < all[1] ? all[0] : all[1]; bis = all[0] < all[1] ? all[1] : all[0]; hinweise.push("Zeitraum bitte prüfen"); }
  }
  if (von && bis && bis < von) [von, bis] = [bis, von];
  if (/halber tag|halbtags|vormittags|nachmittags|0,5 tag/.test(low)) hinweise.push("halber Tag");

  // Mitarbeiter: Namen aus der Zugangsliste im Text suchen (auch „Nachname, Vorname“) oder Empfänger-Adresse
  const T = " " + norm(text) + " ";
  let best = null;
  for (const u of people) {
    const keys = new Set([u.name, u.plan].filter(Boolean).map(norm));
    const parts = norm(u.name).split(" ");
    if (parts.length >= 2) keys.add(parts.slice(1).join(" ") + " " + parts[0]);
    for (const k of keys) {
      if (!k) continue;
      const i = T.indexOf(" " + k + " ");
      if (i >= 0 && (!best || i < best.i || (i === best.i && k.length > best.len))) best = { u, i, len: k.length };
    }
  }
  if (!best) {
    const adr = [...(mail.toRecipients || []), ...(mail.ccRecipients || [])].map(r => norm(r.emailAddress && r.emailAddress.address));
    const u = people.find(p => p.mail && adr.includes(norm(p.mail)));
    if (u) best = { u };
  }
  const name = best ? best.u.name : "";
  if (!name) hinweise.push("Mitarbeiter nicht erkannt");
  if (!von) hinweise.push("Zeitraum nicht erkannt");
  if (status === "unklar") hinweise.push("Status nicht erkannt");
  return { name, von, bis, status: name && von ? status : "unklar", hinweis: hinweise.join(", ") };
}

// ---------- Excel ----------
async function load(env) {
  let f;
  try { f = await downloadTagged(env, path(env)); }
  catch (e) {
    if (e.status !== 404) throw e;
    const p = path(env), folder = p.replace(/\/?[^/]*$/, ""), file = p.split("/").pop();
    await upload(env, folder, file, Uint8Array.from(atob(VORLAGE), c => c.charCodeAt(0)));
    f = await downloadTagged(env, p);
  }
  const wb = await openWorkbook(f.bytes);
  const rows = (await wb.rows("Urlaub")) || [];
  const v = (r, i) => String((r || [])[i] ?? "").trim();
  const list = rows.slice(1).map(r => ({
    name: v(r, 0), von: toIso(v(r, 1)), bis: toIso(v(r, 2)), status: norm(v(r, 3)) || "genehmigt", tage: v(r, 4),
    eingang: v(r, 5), betreff: v(r, 6), plan: v(r, 7), mid: v(r, 8), hinweis: v(r, 9),
  })).filter(r => r.name || r.von || r.mid);
  list.forEach(r => { r.id = idOf(r); });
  return { f, wb, list };
}
function idOf(r) {
  let h = 2166136261;
  for (const ch of `${r.mid}|${r.name}|${r.von}|${r.bis}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
const rowOf = r => [r.name, deOf(r.von), deOf(r.bis), r.status, r.tage, r.eingang, r.betreff, r.plan, r.mid, r.hinweis];

async function save(env, mutate) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await load(env);
      const changed = await mutate(d.list);
      if (!changed) { cache = { at: Date.now(), data: d }; return d.list; }
      d.list.sort((a, b) => (b.von || "").localeCompare(a.von || ""));
      await d.wb.setBody("Urlaub", d.list.map(rowOf), HEAD);
      try { await overwrite(env, d.f.id, await d.wb.toBytes(), d.f.etag); }
      catch (e) { if (e.status === 412 && attempt < 2) continue; throw e; }
      cache = { at: 0, data: null };
      return d.list;
    }
    throw new Error("Speichern nicht möglich – bitte nochmal versuchen");
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---------- Postfach abrufen ----------
export async function sync(env, people) {
  const mb = mailbox(env);
  try {
    const known = (cache.data && cache.data.list) || (await load(env)).list;
    const seen = new Set(known.map(r => r.mid).filter(Boolean));
    const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const sel = "id,internetMessageId,subject,body,receivedDateTime,toRecipients,ccRecipients";
    let url = `/users/${encodeURIComponent(mb)}/messages?$top=50&$select=${sel}&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc`;
    const neu = [];
    for (let page = 0; url && page < 4; page++) {
      const j = await graphGet(env, url, { Prefer: 'outlook.body-content-type="text"' });
      for (const m of j.value || []) {
        const mid = m.internetMessageId || m.id;
        if (seen.has(mid)) continue;
        seen.add(mid);
        const p = parseMail(m, people);
        neu.push({ ...p, tage: p.von ? String(workdays(p.von, p.bis).length) : "", eingang: berlin(new Date(m.receivedDateTime)),
          betreff: String(m.subject || "").slice(0, 200), plan: "", mid });
      }
      url = j["@odata.nextLink"] || "";
    }
    if (neu.length) await save(env, list => { const have = new Set(list.map(r => r.mid)); const add = neu.filter(r => !have.has(r.mid)); list.push(...add); return add.length > 0; });
    state = { sync: Date.now(), fehler: "", geprueft: berlin() };
    return neu.length;
  } catch (e) {
    let m = e.message || String(e);
    if (e.status === 403 || /access ?is ?denied|ErrorAccessDenied|Authorization_RequestDenied/i.test(m)) m = `Kein Zugriff auf das Postfach ${mb} – Recht „Application Mail.Read“ fehlt oder ist noch nicht aktiv (kann bis zu 2 Std. dauern)`;
    else if (e.status === 404) m = `Postfach ${mb} nicht gefunden – ist es angelegt?`;
    state = { sync: Date.now(), fehler: m, geprueft: berlin() };
    console.error("Urlaub-Sync:", m);
    return 0;
  }
}

export async function list(env, me, people, opts = {}) {
  if (opts.sync || Date.now() - state.sync > SYNC_MS) await sync(env, people);
  if (!cache.data || Date.now() - cache.at > 15000) cache = { at: Date.now(), data: await load(env) };
  const today = isoOf(new Date());
  const mine = r => [me.name, me.plan].map(norm).filter(Boolean).includes(norm(r.name));
  const pub = r => ({ id: r.id, name: r.name, von: r.von, bis: r.bis, status: r.status, tage: r.tage, eingang: r.eingang, plan: r.plan, hinweis: r.hinweis, betreff: r.betreff });
  const all = cache.data.list;
  const out = {
    // eigene Einträge: alles, was noch nicht vorbei ist, plus Entscheidungen der letzten 30 Tage
    meine: all.filter(r => mine(r) && r.status !== "unklar" && (r.bis >= today || (toIso(r.eingang) || "") >= addDays(today, -30))).map(pub)
      .sort((a, b) => (a.von || "").localeCompare(b.von || "")),
    heute: today,
  };
  if (me.schreiben) {
    out.alle = all.filter(r => r.status === "unklar" || !r.bis || r.bis >= addDays(today, -14)).map(pub)
      .sort((a, b) => (a.status === "unklar" ? -1 : 0) - (b.status === "unklar" ? -1 : 0) || (a.von || "").localeCompare(b.von || ""));
    out.postfach = mailbox(env);
    out.geprueft = state.geprueft;
    out.fehler = state.fehler;
  }
  return out;
}

// Büro: genehmigten Urlaub als „Urlaub“ in den Wochenplan schreiben
export async function toPlan(env, me, id, writePlan, people) {
  const d = cache.data || await load(env);
  const r = d.list.find(x => x.id === id);
  if (!r) throw Object.assign(new Error("Eintrag nicht gefunden – bitte neu laden"), { status: 404 });
  if (r.status !== "genehmigt") throw Object.assign(new Error("Nur genehmigter Urlaub kann eingetragen werden"), { status: 400 });
  const u = people.find(p => norm(p.name) === norm(r.name) || norm(p.plan) === norm(r.name));
  const planName = (u && u.plan) || r.name;
  const tage = workdays(r.von, r.bis);
  if (!tage.length) throw Object.assign(new Error("Im Zeitraum liegen keine Arbeitstage"), { status: 400 });
  const stamp = berlin().slice(0, 6);
  const res = await writePlan(env, tage.map(datum => ({
    datum, name: planName, wert: "Urlaub",
    notiz: prev => (prev && norm(prev) !== "urlaub" ? `vorher: ${prev} – ` : "") + `Urlaub genehmigt (Label) – eingetragen von ${me.name} am ${stamp}`,
  })), true);
  const n = res.cells.length;
  if (n) await save(env, list => { const x = list.find(y => idOf(y) === id); if (!x) return false; x.plan = `${berlin().slice(0, 10)} ${me.name}`; return true; });
  return { geschrieben: n, fehler: res.fehler };
}
