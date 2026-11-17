// Austausch: Nachrichten, angepinnte Mitteilungen mit Erinnerung, Antworten, Reaktionen und Abstimmungen.
//
// Wer darf was:
//  • alle: Nachrichten an einzelne Kollegen oder „ans Büro“, Priorität, Ablaufdatum, antworten, 👍, abhaken, abstimmen
//  • Büro (Recht „hinweise“): zusätzlich an alle, anpinnen (mit Ablaufdatum + Erinnerung), „sichtbar ab“, Abstimmungen, löschen
//
// Sichtbarkeit: Absender, genannte Empfänger (Name oder Wochenplan-Name), „*alle“, „*buero“ (alle mit Büro-Recht).
// Erledigt: Nachricht verschwindet für diese Person (kommt bei neuer Antwort wieder). Nachrichten ans Büro sind für das
// ganze Büro erledigt, sobald eine Person aus dem Büro abhakt. Angepinnte bleiben bis zum Ablaufdatum stehen –
// „Zur Kenntnis genommen“ beendet nur die Erinnerungen.
import { all, one, run, batch, jetzt, heute } from "./db.js";
import { darf } from "./rechte.js";
import { users } from "./auth.js";
import { birthdays } from "./hinweise.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max) => String(v ?? "").trim().slice(0, max);
const lc = s => String(s || "").toLowerCase().trim();
const PRIOS = ["normal", "wichtig", "dringend"];
const ALLE = "*alle", BUERO = "*buero";
const TAGE_SICHTBAR = 120;   // ältere, erledigte Nachrichten werden nicht mehr geladen

const isoTag = v => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return ""; return m[0].includes("-") ? m[0] : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
const zeitMs = s => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0; };
const tageZwischen = (a, b) => (zeitMs(b) - zeitMs(a)) / 864e5;
// Zeitpunkt mit Sekunden (damit „neu“ auch innerhalb derselben Minute stimmt)
const jetztSek = () => { const d = new Date(); return jetzt(d) + ":" + String(d.getSeconds()).padStart(2, "0"); };

// Gehört ein Empfänger-Eintrag zu mir?
function fuerMich(empf, me, alleNamen) {
  if (empf === ALLE) return true;
  if (empf === BUERO) return darf(me, "hinweise");
  const e = lc(empf);
  if (e === lc(me.name) || (me.plan && e === lc(me.plan))) return true;
  const vorname = lc(me.name).split(" ")[0];   // alte Hinweise: nur Vorname
  return e === vorname && alleNamen.filter(n => lc(n).split(" ")[0] === vorname).length <= 1;
}
const anText = list => list.map(e => e === ALLE ? "Alle" : e === BUERO ? "Büro" : e);

// Alles laden, was für mich sichtbar ist
async function laden(env, me) {
  const grenze = heute(new Date(Date.now() - TAGE_SICHTBAR * 864e5));
  const msgs = await all(env, "SELECT * FROM nachrichten WHERE geloescht = 0 AND (zuletzt >= ? OR pin = 1 OR bis >= ?) ORDER BY id DESC LIMIT 600", grenze, heute());
  if (!msgs.length) return { msgs: [], an: {}, st: {}, ant: {}, opt: {}, stim: {} };
  const ids = msgs.map(m => m.id), ph = ids.map(() => "?").join(",");
  const gruppe = (rows, key = "nachricht_id") => rows.reduce((o, r) => ((o[r[key]] = o[r[key]] || []).push(r), o), {});
  return {
    msgs,
    an: gruppe(await all(env, `SELECT * FROM nachricht_an WHERE nachricht_id IN (${ph})`, ...ids)),
    st: gruppe(await all(env, `SELECT * FROM nachricht_status WHERE nachricht_id IN (${ph})`, ...ids)),
    ant: gruppe(await all(env, `SELECT * FROM antworten WHERE nachricht_id IN (${ph}) ORDER BY id`, ...ids)),
    opt: gruppe(await all(env, `SELECT * FROM umfrage_optionen WHERE nachricht_id IN (${ph}) ORDER BY nr`, ...ids)),
    stim: gruppe(await all(env, `SELECT * FROM stimmen WHERE nachricht_id IN (${ph})`, ...ids)),
  };
}

export async function liste(env, me) {
  const leute = await users(env);
  const namen = leute.map(u => u.name);
  const buero = leute.filter(u => darf({ rechte: u.rechte, admin: u.admin }, "hinweise")).map(u => u.name);
  const d = await laden(env, me);
  const h = heute(), jz = jetzt();
  const out = [];
  for (const m of d.msgs) {
    const an = (d.an[m.id] || []).map(x => x.empfaenger);
    const eigene = lc(m.von) === lc(me.name);
    const anMich = an.some(e => fuerMich(e, me, namen));
    if (!eigene && !anMich) continue;
    if (m.bis && m.bis < h) continue;                        // abgelaufen
    if (!eigene && m.ab && m.ab > h) continue;               // noch nicht sichtbar
    const st = d.st[m.id] || [];
    const ich = st.find(s => lc(s.wer) === lc(me.name)) || {};
    const ant = d.ant[m.id] || [];
    const letzte = ant.length ? ant[ant.length - 1] : null;
    const zuletztFremd = letzte && lc(letzte.von) !== lc(me.name) ? letzte.zeit : (eigene ? "" : m.erstellt);
    // erledigt? – ans Büro: wenn irgendwer aus dem Büro abgehakt hat
    const nurBuero = an.length === 1 && an[0] === BUERO;
    let erledigt = ich.erledigt || "";
    if (nurBuero && !eigene && !erledigt) erledigt = (st.filter(s => s.erledigt && buero.some(b => lc(b) === lc(s.wer)))[0] || {}).erledigt || "";
    const wiederNeu = erledigt && zuletztFremd && zuletztFremd > erledigt;   // neue Antwort nach dem Abhaken
    if (anMich && !eigene && erledigt && !wiederNeu && !m.pin) { if (m.typ !== "umfrage" || (m.bis && m.bis < h)) continue; }
    const antwortFremd = letzte && lc(letzte.von) !== lc(me.name) ? letzte.zeit : "";
    const neu = eigene ? !!antwortFremd && (!ich.gelesen || antwortFremd > ich.gelesen) : (!ich.gelesen || (zuletztFremd && zuletztFremd > ich.gelesen));
    const v = {
      id: m.id, typ: m.typ, von: m.von, an: anText(an), text: m.text, prio: m.prio, pin: !!m.pin, ab: m.ab, bis: m.bis, erinnerung: m.erinnerung,
      erstellt: m.erstellt, zuletzt: m.zuletzt, eigene, anMich, neu: !!neu, erledigt: !!erledigt && !wiederNeu, nurBuero,
      antworten: ant.map(a => ({ von: a.von, text: a.text, zeit: a.zeit })),
      reaktionen: st.filter(s => s.reaktion).map(s => ({ wer: s.wer, r: s.reaktion })),
      meineReaktion: ich.reaktion || "",
      darfLoeschen: eigene || darf(me, "hinweise"),
    };
    // Erinnerung (nur angepinnt, noch nicht zur Kenntnis genommen)
    if (m.pin && m.erinnerung > 0 && anMich && !eigene && !ich.erledigt)
      v.erinnern = !ich.erinnert || tageZwischen(ich.erinnert, jz) >= m.erinnerung - 0.01;
    // Absender und Büro sehen, wer gelesen/erledigt hat
    if (eigene || darf(me, "hinweise")) {
      const ziel = [...new Set(an.flatMap(e => e === ALLE ? namen : e === BUERO ? buero : [namen.find(n => lc(n) === lc(e)) || e]))]
        .filter(n => lc(n) !== lc(m.von));
      v.empfaenger = ziel.map(n => { const s = st.find(x => lc(x.wer) === lc(n)) || {}; return { wer: n, gelesen: s.gelesen || "", erledigt: s.erledigt || "" }; });
    }
    if (m.typ === "umfrage") {
      const stim = d.stim[m.id] || [];
      const zeigeNamen = eigene || darf(me, "hinweise");
      v.umfrage = {
        mehrfach: !!m.mehrfach, offen: !m.bis || m.bis >= h,
        optionen: (d.opt[m.id] || []).map(o => { const s = stim.filter(x => x.nr === o.nr); return { nr: o.nr, text: o.text, stimmen: s.length, namen: zeigeNamen ? s.map(x => x.wer) : undefined }; }),
        meine: stim.filter(x => lc(x.wer) === lc(me.name)).map(x => x.nr),
        teilnehmer: new Set(stim.map(x => lc(x.wer))).size,
      };
    }
    out.push(v);
  }
  // Sortierung: angepinnt zuerst, dann nach Priorität (nur ungelesen), dann neueste Aktivität
  const p = m => (m.pin ? 0 : 10) + (m.neu ? 2 - PRIOS.indexOf(m.prio) : 5);
  out.sort((a, b) => p(a) - p(b) || (b.zuletzt || "").localeCompare(a.zuletzt || ""));
  const geb = birthdays(leute).map(g => ({ name: g.name, wann: g.wann, ich: lc(g.name) === lc(me.name) }));
  return {
    nachrichten: out,
    ungelesen: out.filter(m => m.neu && m.typ !== "gruss").length,
    erinnern: out.filter(m => m.erinnern).map(m => m.id),
    geburtstage: geb,
    personen: namen.filter(n => lc(n) !== lc(me.name)),
    buero: darf(me, "hinweise"),
  };
}

async function sichtbar(env, me, id) {
  const l = await liste(env, me);
  const m = l.nachrichten.find(x => x.id === +id);
  if (!m) throw fail("Nachricht nicht gefunden – bitte neu laden", 404);
  return m;
}
const status = (id, wer, feld, wert) => [`INSERT INTO nachricht_status (nachricht_id, wer, ${feld}) VALUES (?, ?, ?)
  ON CONFLICT (nachricht_id, wer) DO UPDATE SET ${feld} = excluded.${feld}`, id, wer, wert];

// Empfänger prüfen und vereinheitlichen
async function empfaenger(env, me, an) {
  const list = (Array.isArray(an) ? an : [an]).map(x => String(x || "").trim()).filter(Boolean).slice(0, 60);
  if (!list.length) throw fail("Bitte Empfänger wählen");
  const namen = (await users(env)).map(u => u.name);
  const out = [];
  for (const e of list) {
    if (e === ALLE || lc(e) === "alle") { if (!darf(me, "hinweise")) throw fail("An alle schreiben kann nur das Büro", 403); out.push(ALLE); continue; }
    if (e === BUERO || ["büro", "buero"].includes(lc(e))) { out.push(BUERO); continue; }
    const n = namen.find(x => lc(x) === lc(e));
    if (!n) throw fail(`„${e}“ ist kein Mitarbeiter`);
    if (lc(n) !== lc(me.name)) out.push(n);
  }
  if (!out.length) throw fail("Bitte Empfänger wählen");
  return [...new Set(out)];
}

export async function aktion(env, me, b) {
  const jz = jetztSek();
  switch (b.aktion) {
    case "senden":
    case "umfrage": {
      const buero = darf(me, "hinweise");
      if (b.aktion === "umfrage" && !buero) throw fail("Abstimmungen kann nur das Büro starten", 403);
      const text = t(b.text, 2000);
      if (!text) throw fail(b.aktion === "umfrage" ? "Bitte die Frage eingeben" : "Bitte einen Text eingeben");
      const an = await empfaenger(env, me, b.an);
      const prio = PRIOS.includes(b.prio) ? b.prio : "normal";
      const pin = !!b.pin && buero;
      const bis = isoTag(b.bis), ab = buero ? isoTag(b.ab) : "";
      if (pin && !bis) throw fail("Angepinnte Nachrichten brauchen ein Ablaufdatum");
      if (bis && bis < heute()) throw fail("Das Ablaufdatum liegt in der Vergangenheit");
      const erinnerung = pin ? Math.max(0, Math.min(30, Math.round(+b.erinnerung || 0))) : 0;
      let optionen = [];
      if (b.aktion === "umfrage") {
        optionen = [...new Set((b.optionen || []).map(o => t(o, 120)).filter(Boolean))].slice(0, 10);
        if (optionen.length < 2) throw fail("Bitte mindestens zwei Antwortmöglichkeiten angeben");
      }
      const r = await run(env, "INSERT INTO nachrichten (typ, von, text, prio, pin, ab, bis, erinnerung, mehrfach, erstellt, zuletzt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        b.aktion === "umfrage" ? "umfrage" : "nachricht", me.name, text, prio, pin ? 1 : 0, ab, bis, erinnerung, b.mehrfach ? 1 : 0, jz, jz);
      const id = r.meta.last_row_id;
      await batch(env, [...an.map(e => ["INSERT INTO nachricht_an (nachricht_id, empfaenger) VALUES (?, ?)", id, e]),
        ...optionen.map((o, i) => ["INSERT INTO umfrage_optionen (nachricht_id, nr, text) VALUES (?, ?, ?)", id, i + 1, o])]);
      break;
    }
    case "antworten": {
      const m = await sichtbar(env, me, b.id);
      const text = t(b.text, 2000);
      if (!text) throw fail("Bitte einen Text eingeben");
      await batch(env, [["INSERT INTO antworten (nachricht_id, von, text, zeit) VALUES (?, ?, ?, ?)", m.id, me.name, text, jz],
        ["UPDATE nachrichten SET zuletzt = ? WHERE id = ?", jz, m.id], status(m.id, me.name, "gelesen", jz)]);
      break;
    }
    case "gelesen": {
      const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 200);
      if (ids.length) await batch(env, ids.map(id => status(id, me.name, "gelesen", jz)));
      break;
    }
    case "erledigt": {   // bei angepinnten: „Zur Kenntnis genommen“
      const m = await sichtbar(env, me, b.id);
      await batch(env, [status(m.id, me.name, "erledigt", jz), status(m.id, me.name, "gelesen", jz)]);
      break;
    }
    case "erinnert": {
      const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 50);
      if (ids.length) await batch(env, ids.map(id => status(id, me.name, "erinnert", jz)));
      break;
    }
    case "reaktion": {
      const m = await sichtbar(env, me, b.id);
      const r = ["👍", "✅", "❤️", "😂"].includes(b.r) && m.meineReaktion !== b.r ? b.r : "";
      await batch(env, [status(m.id, me.name, "reaktion", r)]);
      break;
    }
    case "abstimmen": {
      const m = await sichtbar(env, me, b.id);
      if (!m.umfrage) throw fail("Das ist keine Abstimmung");
      if (!m.umfrage.offen) throw fail("Die Abstimmung ist schon beendet");
      let nrs = [...new Set((b.nrs || []).map(Number))].filter(n => m.umfrage.optionen.some(o => o.nr === n));
      if (!m.umfrage.mehrfach) nrs = nrs.slice(0, 1);
      await batch(env, [["DELETE FROM stimmen WHERE nachricht_id = ? AND wer = ?", m.id, me.name],
        ...nrs.map(n => ["INSERT INTO stimmen (nachricht_id, wer, nr) VALUES (?, ?, ?)", m.id, me.name, n]), status(m.id, me.name, "gelesen", jz)]);
      break;
    }
    case "loeschen": {
      const m = await one(env, "SELECT id, von FROM nachrichten WHERE id = ?", +b.id);
      if (!m) break;
      if (lc(m.von) !== lc(me.name) && !darf(me, "hinweise")) throw fail("Löschen kann nur der Absender oder das Büro", 403);
      await run(env, "UPDATE nachrichten SET geloescht = 1 WHERE id = ?", m.id);
      break;
    }
    case "gratulieren": {
      const leute = await users(env);
      const g = birthdays(leute).find(x => lc(x.name) === lc(b.an));
      if (!g) throw fail("Heute hat diese Person keinen Geburtstag");
      if (lc(g.name) === lc(me.name)) throw fail("Sich selbst gratulieren geht leider nicht 🙂");
      const schon = await one(env, `SELECT n.id FROM nachrichten n JOIN nachricht_an a ON a.nachricht_id = n.id
        WHERE n.typ = 'gruss' AND n.von = ? AND a.empfaenger = ? AND n.erstellt >= ?`, me.name, g.name, heute());
      if (!schon) {
        const bis = isoTag(g.bis);
        const r = await run(env, "INSERT INTO nachrichten (typ, von, text, bis, erstellt, zuletzt) VALUES ('gruss', ?, '🎉 Alles Gute zum Geburtstag!', ?, ?, ?)", me.name, bis, jz, jz);
        await run(env, "INSERT INTO nachricht_an (nachricht_id, empfaenger) VALUES (?, ?)", r.meta.last_row_id, g.name);
      }
      break;
    }
    default: throw fail("Unbekannte Aktion");
  }
  return liste(env, me);
}

// Aufräumen (zeitgesteuert): gelöschte und seit 30 Tagen abgelaufene Nachrichten endgültig entfernen
export async function aufraeumen(env) {
  const grenze = heute(new Date(Date.now() - 30 * 864e5));
  const alt = (await all(env, "SELECT id FROM nachrichten WHERE geloescht = 1 OR (bis <> '' AND bis < ?) OR (pin = 0 AND bis = '' AND zuletzt < ?)",
    grenze, heute(new Date(Date.now() - 365 * 864e5)))).map(r => r.id);
  for (let i = 0; i < alt.length; i += 50) {
    const part = alt.slice(i, i + 50), ph = part.map(() => "?").join(",");
    await batch(env, ["nachricht_an", "nachricht_status", "antworten", "umfrage_optionen", "stimmen"].map(tb => [`DELETE FROM ${tb} WHERE nachricht_id IN (${ph})`, ...part])
      .concat([[`DELETE FROM nachrichten WHERE id IN (${ph})`, ...part]]));
  }
}
