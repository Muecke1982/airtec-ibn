// Urlaub-Infomail: Sobald im Wochenplan neuer Urlaub steht (über die App oder direkt in der Google-Tabelle),
// bekommt das Büro eine Mail „bitte in Label eintragen“. Gestrichener künftiger Urlaub → „bitte in Label prüfen“.
//  • Absender: Postfach aus MAIL_FROM (Cloudflare), z. B. kapp@airtec-kaeltetechnik.de – App braucht „Mail.Send“
//  • Empfänger: Einstellung „urlaub_info_an“ (im Reiter Allgemeines → Urlaub); vorbelegt mit der Mail von Frau Schatz
//  • Läuft zeitgesteuert (alle 15 Min. tagsüber) und direkt nach dem Eintragen in der App.
//  • Beim allerersten Lauf wird nur der Stand gemerkt (keine Mail für alten Urlaub).
import { all, one, run, batch, jetzt } from "./db.js";
import { cfg, sendMail } from "./graph.js";
import { bereich, heuteBerlin, inEinemJahr, plus } from "./urlaubplan.js";

const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const de = iso => `${WT[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const zahl = n => String(n).replace(".", ",");
// viele Anweisungen in Paketen zu 50 an die Datenbank (statt einzeln) – Ergebnis je Anweisung in derselben Reihenfolge
async function stapel(env, list) {
  const out = [];
  for (let i = 0; i < list.length; i += 50) out.push(...(await batch(env, list.slice(i, i + 50))));
  return out;
}

export async function einstellung(env) {
  const r = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'urlaub_info_an'");
  let an = r ? r.wert : null;
  if (an === null) {   // noch nie gesetzt → Mail-Adresse von Frau Schatz aus der Mitarbeiterliste
    const s = await one(env, "SELECT mail FROM mitarbeiter WHERE aktiv = 1 AND name LIKE '%Schatz%' AND mail <> '' LIMIT 1");
    an = s ? s.mail : "";
  }
  return { an, von: cfg(env, "MAIL_FROM", false) };
}

export async function speichereEmpfaenger(env, an) {
  const liste = String(an || "").split(/[;,\s]+/).map(s => s.trim()).filter(Boolean);
  for (const a of liste) if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(a)) throw Object.assign(new Error(`„${a}“ ist keine gültige Mail-Adresse`), { status: 400 });
  await run(env, "INSERT INTO einstellungen (schluessel, wert) VALUES ('urlaub_info_an', ?) ON CONFLICT(schluessel) DO UPDATE SET wert = excluded.wert", liste.join(", "));
}

// Tage → zusammenhängende Zeiträume (Wochenenden dazwischen überbrücken)
export function zuZeitraeumen(tage) {
  const out = [];
  for (const [d, art] of [...tage].sort((a, b) => a[0].localeCompare(b[0]))) {
    const last = out[out.length - 1];
    let anschluss = !!last;
    if (last) for (let x = plus(last.bis, 1); x < d; x = plus(x, 1)) { const w = new Date(x + "T12:00:00Z").getUTCDay(); if (w !== 0 && w !== 6) { anschluss = false; break; } }
    const wert = art === "halb" ? 0.5 : 1;
    if (anschluss) { last.bis = d; last.tage += wert; } else out.push({ von: d, bis: d, tage: wert });
  }
  return out;
}
const zeile = (name, z) => `• ${name}: ${z.von === z.bis ? de(z.von) : de(z.von) + " – " + de(z.bis)} (${z.tage === 0.5 ? "halber Tag" : zahl(z.tage) + (z.tage === 1 ? " Arbeitstag" : " Arbeitstage")})`;

export function mailText(neu, weg, wer) {
  const n = Object.entries(neu).flatMap(([name, t]) => zuZeitraeumen(t).map(z => ({ name, ...z })));
  const w = Object.entries(weg).flatMap(([name, t]) => zuZeitraeumen(t).map(z => ({ name, ...z })));
  const teile = ["Hallo,", ""];
  if (n.length) teile.push("im Wochenplan wurde Urlaub eingetragen. Bitte in Label übernehmen:", "", ...n.map(z => zeile(z.name, z)), "");
  if (w.length) teile.push(n.length ? "Außerdem wurde Urlaub im Wochenplan gestrichen – bitte in Label prüfen:" : "im Wochenplan wurde Urlaub gestrichen. Bitte in Label prüfen:", "", ...w.map(z => zeile(z.name, z)), "");
  if (wer) teile.push(`Eingetragen über die Airtec KApp von ${wer}.`);
  teile.push("Diese Mail wurde automatisch von der Airtec KApp verschickt.");
  const erst = n[0] || w[0];
  const subject = n.length + w.length === 1
    ? `${n.length ? "Urlaub in Label eintragen" : "Urlaub gestrichen"}: ${erst.name}, ${erst.von === erst.bis ? de(erst.von) : de(erst.von) + " – " + de(erst.bis)}`
    : `Urlaub in Label eintragen (${n.length + w.length} Änderungen)`;
  return { subject, text: teile.join("\n") };
}

// Abgleich Wochenplan ↔ gemeldeter Stand. Rückgabe: { gesendet, neu, weg } oder { aus: "Grund" }
export async function abgleich(env, people, { neu: frisch = false, wer = "", heute } = {}) {
  heute = heute || heuteBerlin();
  const e = await einstellung(env);
  if (!e.von) return { aus: "Absender fehlt (MAIL_FROM in Cloudflare)" };
  if (!e.an) return { aus: "Kein Empfänger für die Infomail eingetragen" };
  const d = await bereich(env, people, heute, inEinemJahr(heute), frisch);
  if (!d.wochen) return { aus: "Wochenplan nicht lesbar" };
  const geladen = new Set(d.geladen);
  const montag = iso => { const t = new Date(iso + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
  await run(env, "DELETE FROM urlaub_gemeldet WHERE datum < ?", heute);
  const alt = await all(env, "SELECT name, datum, art FROM urlaub_gemeldet");
  const jz = jetzt();
  // erster Lauf: nur merken
  const start = await one(env, "SELECT wert FROM einstellungen WHERE schluessel = 'urlaub_info_start'");
  if (!start) {
    const ins = [];
    for (const [name, t] of Object.entries(d.tage)) for (const [datum, art] of Object.entries(t))
      ins.push(["INSERT OR IGNORE INTO urlaub_gemeldet (name, datum, art, erstellt) VALUES (?, ?, ?, ?)", name, datum, art, jz]);
    await stapel(env, ins);
    await run(env, "INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('urlaub_info_start', ?)", jz);
    return { gesendet: false, start: true };
  }
  const key = (n, dt) => n.toLowerCase() + "|" + dt;
  const altMap = new Map(alt.map(r => [key(r.name, r.datum), r]));
  const neu = {}, weg = {}, neuRows = [];
  // Änderungen gesammelt schreiben (statt einer Datenbank-Anfrage je Tag); gemeldet wird nur, was dabei wirklich
  // geändert wurde – was ein gleichzeitiger anderer Lauf schon gemeldet hat, zählt nicht doppelt
  const kand = [];
  for (const [name, t] of Object.entries(d.tage)) for (const [datum, art] of Object.entries(t)) {
    const a = altMap.get(key(name, datum));
    if (a && a.art === art) continue;
    kand.push({ name, datum, art, a, sql: a ? ["UPDATE urlaub_gemeldet SET art = ?, erstellt = ? WHERE name = ? AND datum = ? AND art = ?", art, jz, a.name, datum, a.art]
      : ["INSERT OR IGNORE INTO urlaub_gemeldet (name, datum, art, erstellt) VALUES (?, ?, ?, ?)", name, datum, art, jz] });
  }
  (await stapel(env, kand.map(k => k.sql))).forEach((r, i) => {
    if (!r || !r.meta || !r.meta.changes) return;
    const { name, datum, art, a } = kand[i];
    (neu[name] = neu[name] || new Map()).set(datum, art);
    neuRows.push({ name: a ? a.name : name, datum, alt: a ? a.art : null });
  });
  const jetztTage = new Set(Object.entries(d.tage).flatMap(([n, t]) => Object.keys(t).map(dt => key(n, dt))));
  const wegKand = alt.filter(r => !jetztTage.has(key(r.name, r.datum)) && geladen.has(montag(r.datum)));   // Woche nicht gelesen → nicht als gestrichen werten
  const wegRows = [];
  (await stapel(env, wegKand.map(r => ["DELETE FROM urlaub_gemeldet WHERE name = ? AND datum = ?", r.name, r.datum]))).forEach((x, i) => {
    if (!x || !x.meta || !x.meta.changes) return;
    const r = wegKand[i];
    (weg[r.name] = weg[r.name] || new Map()).set(r.datum, r.art);
    wegRows.push(r);
  });
  if (!neuRows.length && !wegRows.length) return { gesendet: false, neu: 0, weg: 0 };
  const m = mailText(neu, weg, wer);
  try {
    await sendMail(env, e.von, { to: e.an.split(/[;,\s]+/), subject: m.subject, text: m.text });
  } catch (err) {
    // zurücksetzen, damit der nächste Lauf es noch einmal versucht
    for (const r of neuRows) {
      if (r.alt) await run(env, "UPDATE urlaub_gemeldet SET art = ? WHERE name = ? AND datum = ?", r.alt, r.name, r.datum);
      else await run(env, "DELETE FROM urlaub_gemeldet WHERE name = ? AND datum = ?", r.name, r.datum);
    }
    for (const r of wegRows) await run(env, "INSERT OR IGNORE INTO urlaub_gemeldet (name, datum, art, erstellt) VALUES (?, ?, ?, ?)", r.name, r.datum, r.art, jz);
    throw Object.assign(new Error("Infomail konnte nicht gesendet werden: " + err.message), { status: 502 });
  }
  return { gesendet: true, neu: neuRows.length, weg: wegRows.length, an: e.an, betreff: m.subject };
}
