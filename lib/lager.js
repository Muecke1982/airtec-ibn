// Lager: Artikel aus der Excel „Airtec_Lager.xlsx“ (Standard: neben den Stammdaten), Meldungen „Fast leer“/„Leer“,
// Bestellliste je Lieferant und Bestell-Mail.
//   Kategorien: A Kategorie | B Blatt | C Kürzel | D Symbol | E Sortierung ; Unterkategorien ab Spalte G (je Kategorie 2 Spalten)
//   Kategorie-Blätter: Art.-Nr | Unterkategorie | Bezeichnung | Größe/Typ | Hersteller | Lieferant | Bestellnummer | Einheit | VE |
//                      Standard-Bestellmenge | Lagerort | Häufig | Suchbegriffe | Aktiv | Bemerkung
//   Meldungen (App): Art.-Nr | Artikel | Lieferant | Status | Gemeldet von | Gemeldet am | Bestellt am | Bestellt von | Bemerkung
//   Bestellungen (App): Bestellt am | Lieferant | An E-Mail | Bestellt von | Positionen | Anzahl Pos.
import { cfg, downloadTagged, overwrite, sendMail } from "./graph.js";
import { openWorkbook, colName } from "./xlsx.js";
import { parseDate } from "./maschinen.js";

const SYS = ["übersicht", "anleitung", "kategorien", "lieferanten", "einheiten", "meldungen", "bestellungen"];
const KEEP_DAYS = 180;   // erledigte Meldungen so lange behalten (für „häufig gemeldet“)
let cache = { at: 0, data: null };
let queue = Promise.resolve();

export const path = env => cfg(env, "SP_LAGER_PATH", false) || cfg(env, "SP_STAMM_PATH").replace(/[^/]*$/, "") + "Airtec_Lager.xlsx";
const fmt = d => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
};
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim();
const off = v => /^(nein|n|0|-|aus|inaktiv)$/i.test(String(v || "").trim());
const yes = v => /^(x|ja|j|1|true|wahr)$/i.test(String(v || "").trim());

async function load(env) {
  const f = await downloadTagged(env, path(env));
  const wb = await openWorkbook(f.bytes);
  const v = (r, i) => String((r || [])[i] ?? "").trim();
  const kr = await wb.rows("Kategorien");
  if (!kr) throw new Error("Blatt „Kategorien“ fehlt in der Lager-Excel");
  const sheetsLc = wb.sheets.map(s => s.toLowerCase());
  const catSheets = wb.sheets.filter(s => !SYS.includes(s.toLowerCase()));
  const kats = [];
  for (let i = 0; i < 40; i++) {
    const r = kr[1 + i]; if (!r) break;
    const name = v(r, 0); if (!name) continue;
    // Blatt finden: Spalte B, sonst Name, sonst nach Reihenfolge
    let sheet = [v(r, 1), name].find(x => x && sheetsLc.includes(x.toLowerCase())) || catSheets[i];
    if (!sheet) continue;
    sheet = wb.sheets[sheetsLc.indexOf(sheet.toLowerCase())];
    const col = 6 + 2 * i;
    const subs = [];
    for (let j = 2; j < 2 + 30; j++) { const s = v(kr[j], col); if (s) subs.push(s); }
    kats.push({ id: "k" + i, name, sheet, pre: v(r, 2), sym: v(r, 3) || "📦", sort: +v(r, 4) || i + 1, subs, row: i + 2, col });
  }
  kats.sort((a, b) => a.sort - b.sort);
  const arts = [];
  for (const k of kats) {
    const rows = (await wb.rows(k.sheet)) || [];
    rows.slice(1).forEach((r, idx) => {
      const nr = v(r, 0), bez = v(r, 2);
      if (!nr || !bez || off(r[13])) return;
      arts.push({ nr, kat: k.id, sub: v(r, 1), bez, gr: v(r, 3), herst: v(r, 4), lief: v(r, 5), best: v(r, 6), einh: v(r, 7), ve: v(r, 8),
        menge: v(r, 9), ort: v(r, 10), fav: yes(r[11]), such: v(r, 12), pos: idx });
    });
  }
  const lr = (await wb.rows("Lieferanten")) || [];
  const lief = lr.slice(1).map(r => ({ name: v(r, 0), mail: v(r, 1), cc: v(r, 2), kd: v(r, 3), kontakt: v(r, 4) })).filter(x => x.name);
  const mr = (await wb.rows("Meldungen")) || [];
  const meld = mr.slice(1).map(r => ({ nr: v(r, 0), art: v(r, 1), lief: v(r, 2), status: v(r, 3), von: v(r, 4), am: v(r, 5), best: v(r, 6), bestVon: v(r, 7), bem: v(r, 8) }))
    .filter(m => m.nr);
  const br = (await wb.rows("Bestellungen")) || [];
  const bestellungen = br.slice(1).map(r => r.slice(0, 6).map(x => String(x ?? ""))).filter(r => r[0]);
  return { f, wb, kats, arts, lief, meld, bestellungen, hasMeld: !!mr.length, hasBest: !!br.length };
}

const isFrei = nr => /^NEU-/i.test(nr);

function view(d, me) {
  const lim = Date.now() - KEEP_DAYS * 864e5;
  const count = {};
  for (const m of d.meld) if ((parseDate(m.am) || new Date()).getTime() > lim) count[m.nr] = (count[m.nr] || 0) + 1;
  const open = {};
  for (const m of d.meld) if (!m.best) open[m.nr] = { status: m.status, von: m.von, am: m.am };
  const arts = d.arts.map(a => ({ ...a, n: count[a.nr] || 0, offen: open[a.nr] || null }));
  const out = { kats: d.kats.map(({ id, name, sym, subs }) => ({ id, name, sym, subs })), arts };
  // Material, das (noch) nicht in der Liste steht
  out.frei = d.meld.filter(m => isFrei(m.nr) && !m.best).map(m => {
    const [bez, ...gr] = m.art.split(" – ");
    return { nr: m.nr, bez, gr: gr.join(" – "), lief: m.lief, best: "", einh: "", ve: "", menge: "", frei: true, notiz: m.bem,
      offen: { status: m.status, von: m.von, am: m.am } };
  });
  if (me.schreiben) {
    out.lieferanten = d.lief.map(l => ({ name: l.name, mail: l.mail, cc: l.cc, kd: l.kd }));
    out.bestellungen = d.bestellungen.slice(0, 10);
  }
  return out;
}

export async function list(env, me, fresh = false) {
  if (fresh || !cache.data || Date.now() - cache.at > 15000) cache = { at: Date.now(), data: await load(env) };
  return view(cache.data, me);
}

// Artikel in ein Kategorie-Blatt der Excel schreiben (nächste freie Zeile, nächste Art.-Nr.). Gibt die neue Art.-Nr. zurück.
async function addArticle(d, b) {
  const K = d.kats.find(k => k.id === b.kat);
  if (!K) throw Object.assign(new Error("Bitte eine Kategorie wählen"), { status: 400 });
  const bez = String(b.bez || "").trim();
  if (!bez) throw Object.assign(new Error("Bezeichnung fehlt"), { status: 400 });
  const t = x => String(x ?? "").trim().slice(0, 200);
  // Unterkategorie: vorhandene oder neue (dann in den nächsten freien Platz im Blatt „Kategorien“)
  let sub = t(b.sub);
  if (sub) {
    const have = K.subs.find(s => norm(s) === norm(sub));
    if (have) sub = have;
    else {
      const kr = await d.wb.rows("Kategorien");
      let rn = 0;
      for (let j = 2; j < 32; j++) if (!String((kr[j] || [])[K.col] ?? "").trim()) { rn = j + 1; break; }
      if (!rn) throw Object.assign(new Error(`Bei „${K.name}“ sind alle Plätze für Unterkategorien belegt`), { status: 400 });
      await d.wb.setCells("Kategorien", [{ ref: colName(K.col) + rn, value: sub }]);
      K.subs.push(sub);
    }
  }
  // Lieferant: vorhandener oder neuer (dann im Blatt „Lieferanten“ anlegen)
  let lief = t(b.lief);
  if (lief) {
    const have = d.lief.find(l => norm(l.name) === norm(lief));
    if (have) lief = have.name;
    else {
      const lr = (await d.wb.rows("Lieferanten")) || [];
      let rn = lr.length + 1;
      for (let j = 1; j < lr.length; j++) if (!String((lr[j] || [])[0] ?? "").trim()) { rn = j + 1; break; }
      await d.wb.setCells("Lieferanten", [{ ref: "A" + rn, value: lief }, ...(b.liefMail ? [{ ref: "B" + rn, value: t(b.liefMail) }] : [])]);
      d.lief.push({ name: lief, mail: t(b.liefMail), cc: "", kd: "", kontakt: "" });
    }
  }
  // nächste Art.-Nr. und erste freie Zeile im Kategorie-Blatt
  const rows = (await d.wb.rows(K.sheet)) || [];
  const pre = K.pre || K.name.slice(0, 2).toUpperCase();
  let max = 0, width = 3, rn = 0;
  rows.forEach((r, i) => {
    if (i === 0) return;
    const nr = String((r || [])[0] ?? "").trim();
    const m = nr.match(/^(.*?)(\d+)$/);
    if (m && norm(m[1]).replace(/[-\s]/g, "") === norm(pre)) { max = Math.max(max, +m[2]); width = Math.max(width, m[2].length); }
    if (!rn && ![0, 1, 2].some(c => String((r || [])[c] ?? "").trim())) rn = i + 1;
  });
  if (!rn) rn = Math.max(rows.length, 1) + 1;
  const nr = `${pre}-${String(max + 1).padStart(width, "0")}`;
  const vals = [nr, sub, bez, t(b.gr), t(b.herst), lief, t(b.best), t(b.einh), t(b.ve), t(b.menge), t(b.ort), b.fav ? "x" : "", t(b.such), "x", "über App aufgenommen"];
  await d.wb.setCells(K.sheet, vals.map((value, c) => ({ ref: colName(c) + rn, value })));
  return { nr, lief, art: [bez, t(b.gr)].filter(Boolean).join(" – ") };
}

// aktion: melden {nr, status: "Fast leer"|"Leer"} | zurueck {nr} | abhaken {nrs} | bestellt {lieferant, nrs, mail?, an, cc, betreff, text}
//         neu {bez, gr, notiz}  (Material nicht in der Liste) | aufnehmen {nr, kat, sub, bez, gr, herst, lief, best, einh, ve, menge} (Büro)
//         lieferant {nr, lief} (Büro: nur einmalig bestellen, ohne in die Liste aufzunehmen)
export function act(env, me, b) {
  const run = async () => {
    // Mail zuerst und nur einmal senden (nicht bei einem Wiederholungsversuch des Speicherns)
    let mailed = false;
    if (b.aktion === "bestellt" && b.senden) {
      if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
      const from = cfg(env, "MAIL_FROM", false);
      if (!from) throw Object.assign(new Error("Direktes Senden ist noch nicht eingerichtet – bitte „In Mail-Programm öffnen“ nutzen"), { status: 400 });
      if (!b.an) throw Object.assign(new Error("Keine E-Mail-Adresse beim Lieferanten hinterlegt"), { status: 400 });
      await sendMail(env, from, { to: String(b.an).split(/[;,]\s*/), cc: String(b.cc || "").split(/[;,]\s*/), subject: b.betreff, text: b.text });
      mailed = true;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await load(env);
      const now = fmt(new Date());
      const artOf = nr => d.arts.find(a => a.nr === nr);
      if (b.aktion === "melden") {
        const a = artOf(b.nr); if (!a) throw Object.assign(new Error("Artikel nicht gefunden"), { status: 404 });
        const st = b.status === "Leer" ? "Leer" : "Fast leer";
        const o = d.meld.find(m => m.nr === a.nr && !m.best);
        if (o) {   // schon gemeldet: Status ggf. verschärfen, Melder ergänzen
          if (st === "Leer") o.status = "Leer";
          if (!norm(o.von).split(", ").includes(norm(me.name))) o.von = o.von ? o.von + ", " + me.name : me.name;
          o.am = now;
        } else d.meld.unshift({ nr: a.nr, art: [a.bez, a.gr].filter(Boolean).join(" – "), lief: a.lief, status: st, von: me.name, am: now, best: "", bestVon: "", bem: "" });
      } else if (b.aktion === "neu") {
        const bez = String(b.bez || "").trim().slice(0, 120), gr = String(b.gr || "").trim().slice(0, 80);
        if (!bez) throw Object.assign(new Error("Bitte eintragen, welches Material fehlt"), { status: 400 });
        const art = [bez, gr].filter(Boolean).join(" – ");
        const o = d.meld.find(m => isFrei(m.nr) && !m.best && norm(m.art) === norm(art));
        if (o) {
          if (!norm(o.von).split(", ").includes(norm(me.name))) o.von = o.von ? o.von + ", " + me.name : me.name;
          if (b.notiz) o.bem = [o.bem, String(b.notiz).trim()].filter(Boolean).join(" / ").slice(0, 300);
          o.am = now;
        } else d.meld.unshift({ nr: "NEU-" + Date.now().toString(36).toUpperCase().slice(-6), art, lief: "", status: "Benötigt", von: me.name, am: now, best: "", bestVon: "",
          bem: String(b.notiz || "").trim().slice(0, 300) });
      } else if (b.aktion === "aufnehmen" || b.aktion === "lieferant") {
        if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
        const m = d.meld.find(x => x.nr === b.nr && !x.best);
        if (!m) throw Object.assign(new Error("Meldung nicht mehr offen – bitte neu laden"), { status: 404 });
        if (b.aktion === "aufnehmen") {
          const r = await addArticle(d, b);
          m.nr = r.nr; m.lief = r.lief; m.art = r.art;
        } else {
          const lief = String(b.lief || "").trim();
          if (!lief) throw Object.assign(new Error("Bitte einen Lieferanten wählen"), { status: 400 });
          const have = d.lief.find(l => norm(l.name) === norm(lief));
          m.lief = have ? have.name : lief;
        }
      } else if (b.aktion === "zurueck") {
        d.meld = d.meld.filter(m => !(m.nr === b.nr && !m.best));
      } else if (b.aktion === "abhaken" || b.aktion === "bestellt") {
        if (!me.schreiben) throw Object.assign(new Error("Nur für das Büro"), { status: 403 });
        const nrs = new Set(b.nrs || []);
        if (!nrs.size) throw Object.assign(new Error("Keine Artikel ausgewählt"), { status: 400 });
        for (const m of d.meld) if (nrs.has(m.nr) && !m.best) {
          m.best = now; m.bestVon = me.name;
          m.bem = b.aktion === "abhaken" ? "abgehakt (ohne Bestellung)" : ("bestellt bei " + (b.lieferant || m.lief) + (b.mengen && b.mengen[m.nr] ? ", Menge " + b.mengen[m.nr] : ""));
        }
        if (b.aktion === "bestellt")
          d.bestellungen.unshift([now, b.lieferant || "", b.an || "", me.name,
            [...nrs].map(nr => { const a = artOf(nr); const m = d.meld.find(x => x.nr === nr); return `${(b.mengen && b.mengen[nr]) || ""} × ${a ? (a.best || a.nr) + " " + a.bez : (m ? m.art : nr)}`; }).join(" | "), String(nrs.size)]);
      } else throw Object.assign(new Error("Unbekannte Aktion"), { status: 400 });

      const lim = Date.now() - KEEP_DAYS * 864e5;
      d.meld = d.meld.filter(m => !m.best || (parseDate(m.best) || new Date()).getTime() > lim);
      const MH = ["Art.-Nr", "Artikel", "Lieferant", "Status", "Gemeldet von", "Gemeldet am", "Bestellt am", "Bestellt von", "Bemerkung"];
      const rows = d.meld.map(m => [m.nr, m.art, m.lief, m.status, m.von, m.am, m.best, m.bestVon, m.bem]);
      if (d.hasMeld) await d.wb.setBody("Meldungen", rows); else await d.wb.addSheet("Meldungen", [MH, ...rows], [10, 34, 16, 12, 20, 17, 17, 20, 30]);
      const BH = ["Bestellt am", "Lieferant", "An E-Mail", "Bestellt von", "Positionen", "Anzahl Pos."];
      const brows = d.bestellungen.slice(0, 500);
      if (d.hasBest) await d.wb.setBody("Bestellungen", brows); else if (brows.length) await d.wb.addSheet("Bestellungen", [BH, ...brows], [17, 16, 30, 20, 70, 11]);
      try { await overwrite(env, d.f.id, await d.wb.toBytes(), d.f.etag); }
      catch (e) { if (e.status === 412 && attempt < 2) continue; throw e; }
      cache = { at: 0, data: null };
      const out = await list(env, me, true);
      out.gesendet = mailed;
      return out;
    }
    throw new Error("Speichern nicht möglich – bitte nochmal versuchen");
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

export const canSend = env => !!cfg(env, "MAIL_FROM", false);
