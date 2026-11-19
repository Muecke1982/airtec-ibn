// Nachrichten (intern „Austausch“): Chats mit Verlauf, Fotos, angepinnte Mitteilungen, Bestätigen, Abstimmungen.
//
// Priorität beim Senden:
//  • normal  – erscheint im Reiter „Nachrichten“ (neueste oben)
//  • wichtig – steht im Reiter „Nachrichten“ ganz oben und muss vom Empfänger bestätigt werden
//  • pin     – „Anpinnen“ (nur Büro): erscheint auf der Startseite, braucht ein Ablaufdatum, optional Erinnerung
//
// Wer darf was:
//  • alle: an Kollegen oder ans Büro schreiben, antworten (Chat), Foto anhängen, bestätigen, Chat schließen/wiederherstellen
//  • Büro (Recht „hinweise“): zusätzlich an alle, anpinnen, „sichtbar ab“, Abstimmungen, fremde Nachrichten löschen
//
// Ordner je Person: „offen“ (laufende Chats), „verlauf“ (geschlossen oder abgelaufen), „geloescht“ (Papierkorb, 30 Tage;
// nur Absender und Büro). Ein geschlossener Chat kommt bei einer neuen Antwort von selbst zurück.
// Nachrichten ans Büro: schließt/bestätigt eine Person aus dem Büro, gilt das für das ganze Büro.
import { all, one, run, batch, jetzt, heute } from "./db.js";
import { darf } from "./rechte.js";
import { users } from "./auth.js";
import { birthdays } from "./hinweise.js";
import { autosVon } from "./autos.js";

const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const t = (v, max) => String(v ?? "").trim().slice(0, max);
const lc = s => String(s || "").toLowerCase().trim();
const ALLE = "*alle", BUERO = "*buero";
const TAGE_VERLAUF = 365;     // so lange bleiben Chats im Verlauf
const TAGE_PAPIERKORB = 30;   // so lange bleiben gelöschte Nachrichten wiederherstellbar
const MAX_BILDER = 4;

const isoTag = v => { const s = String(v || "").trim(); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/) || s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return ""; return m[0].includes("-") ? m[0] : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; };
const zeitMs = s => { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : 0; };
const tageZwischen = (a, b) => (zeitMs(b) - zeitMs(a)) / 864e5;
// Zeitpunkt mit Sekunden (damit „neu“ auch innerhalb derselben Minute stimmt)
const jetztSek = () => { const d = new Date(); return jetzt(d) + ":" + String(d.getSeconds()).padStart(2, "0"); };
const vorTagen = n => heute(new Date(Date.now() - n * 864e5));

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
const prioVon = m => m.pin ? "pin" : m.prio === "normal" ? "normal" : "wichtig";   // alt „dringend“ = wichtig

// Alles laden, was für mich sichtbar sein kann
async function laden(env, me) {
  const grenze = vorTagen(TAGE_VERLAUF);
  const papierkorb = darf(me, "hinweise") ? "geloescht = 1 AND geloescht_am >= ?" : "geloescht = 1 AND von = ? COLLATE NOCASE AND geloescht_am >= ?";
  const args = darf(me, "hinweise") ? [vorTagen(TAGE_PAPIERKORB)] : [me.name, vorTagen(TAGE_PAPIERKORB)];
  const msgs = await all(env, `SELECT * FROM nachrichten WHERE (geloescht = 0 AND (zuletzt >= ? OR pin = 1 OR bis >= ?)) OR (${papierkorb})
    ORDER BY id DESC LIMIT 800`, grenze, heute(), ...args);
  if (!msgs.length) return { msgs: [], an: {}, st: {}, ant: {}, opt: {}, stim: {}, bild: {} };
  const ids = msgs.map(m => m.id);
  const gruppe = (rows, key = "nachricht_id") => rows.reduce((o, r) => ((o[r[key]] = o[r[key]] || []).push(r), o), {});
  const je = async sql => {   // IN-Liste in Paketen (Grenze für Parameter)
    const out = [];
    for (let i = 0; i < ids.length; i += 90) { const p = ids.slice(i, i + 90); out.push(...await all(env, sql.replace("$IDS", p.map(() => "?").join(",")), ...p)); }
    return out;
  };
  return {
    msgs,
    an: gruppe(await je("SELECT * FROM nachricht_an WHERE nachricht_id IN ($IDS)")),
    st: gruppe(await je("SELECT * FROM nachricht_status WHERE nachricht_id IN ($IDS)")),
    ant: gruppe(await je("SELECT * FROM antworten WHERE nachricht_id IN ($IDS) ORDER BY id")),
    opt: gruppe(await je("SELECT * FROM umfrage_optionen WHERE nachricht_id IN ($IDS) ORDER BY nr")),
    stim: gruppe(await je("SELECT * FROM stimmen WHERE nachricht_id IN ($IDS)")),
    bild: gruppe(await je("SELECT id, nachricht_id, antwort_id FROM nachricht_bilder WHERE nachricht_id IN ($IDS) ORDER BY id")),
  };
}

export async function liste(env, me) {
  const leute = await users(env);
  const namen = leute.map(u => u.name);
  const buero = leute.filter(u => darf({ rechte: u.rechte, admin: u.admin }, "hinweise")).map(u => u.name);
  const istBuero = n => buero.some(b => lc(b) === lc(n));
  const d = await laden(env, me);
  const h = heute(), jz = jetzt();
  const out = [];
  for (const m of d.msgs) {
    const an = (d.an[m.id] || []).map(x => x.empfaenger);
    const eigene = lc(m.von) === lc(me.name);
    const anMich = an.some(e => fuerMich(e, me, namen));
    if (!eigene && !anMich) continue;
    if (!eigene && m.ab && m.ab > h && !m.geloescht) continue;   // noch nicht sichtbar
    const st = d.st[m.id] || [];
    const ich = st.find(s => lc(s.wer) === lc(me.name)) || {};
    const ant = d.ant[m.id] || [];
    const letzte = ant.length ? ant[ant.length - 1] : null;
    const zuletztFremd = letzte && lc(letzte.von) !== lc(me.name) ? letzte.zeit : (eigene ? "" : m.erstellt);
    const nurBuero = an.length === 1 && an[0] === BUERO;
    const buerofall = nurBuero && !eigene;   // ans Büro: eine Person aus dem Büro gilt für alle
    const ersteAusBuero = feld => (st.filter(s => s[feld] && istBuero(s.wer)).sort((a, b) => a[feld].localeCompare(b[feld]))[0] || {})[feld] || "";
    let erledigt = ich.erledigt || "";
    if (buerofall && !erledigt) erledigt = ersteAusBuero("erledigt");
    const wiederNeu = !!erledigt && !!zuletztFremd && zuletztFremd > erledigt;   // neue Antwort nach dem Schließen
    const geschlossen = !!erledigt && !wiederNeu;
    const abgelaufen = !!m.bis && m.bis < h;
    const ordner = m.geloescht ? "geloescht" : (geschlossen || abgelaufen) ? "verlauf" : "offen";
    if (m.typ === "gruss" && ordner !== "offen") continue;
    const prio = prioVon(m);
    const brauchtOk = anMich && !eigene && (prio === "wichtig" || prio === "pin") && m.typ !== "gruss";
    const bestaetigt = ich.bestaetigt || (buerofall ? ersteAusBuero("bestaetigt") : "");
    const antwortFremd = letzte && lc(letzte.von) !== lc(me.name) ? letzte.zeit : "";
    const neu = ordner === "offen" && (eigene ? !!antwortFremd && (!ich.gelesen || antwortFremd > ich.gelesen)
      : (!ich.gelesen || (zuletztFremd && zuletztFremd > ich.gelesen)));
    const bilder = d.bild[m.id] || [];
    const v = {
      id: m.id, typ: m.typ, von: m.von, an: anText(an), text: m.text, prio, pin: !!m.pin, ab: m.ab, bis: m.bis, erinnerung: m.erinnerung,
      erstellt: m.erstellt, zuletzt: m.zuletzt, eigene, anMich, neu: !!neu, ordner, nurBuero,
      geschlossen: geschlossen ? erledigt : "", abgelaufen,
      brauchtOk, bestaetigt: brauchtOk ? bestaetigt : "",
      geloescht: m.geloescht ? { am: m.geloescht_am, von: m.geloescht_von } : null,
      bilder: bilder.filter(b => !b.antwort_id).map(b => b.id),
      antworten: ant.map(a => ({ id: a.id, von: a.von, text: a.text, zeit: a.zeit, bilder: bilder.filter(b => b.antwort_id === a.id).map(b => b.id) })),
      reaktionen: st.filter(s => s.reaktion).map(s => ({ wer: s.wer, r: s.reaktion })),
      meineReaktion: ich.reaktion || "",
      darfLoeschen: eigene || darf(me, "hinweise"),
      // für den Personen-Filter im Verlauf: wer ist an diesem Chat direkt beteiligt?
      beteiligt: [...new Set([m.von, ...an.filter(e => e !== ALLE && e !== BUERO), ...ant.map(a => a.von)].map(n => namen.find(x => lc(x) === lc(n)) || n))],
    };
    // Erinnerung (nur angepinnt, noch nicht bestätigt)
    if (ordner === "offen" && m.pin && m.erinnerung > 0 && brauchtOk && !bestaetigt)
      v.erinnern = !ich.erinnert || tageZwischen(ich.erinnert, jz) >= m.erinnerung - 0.01;
    // Absender und Büro sehen, wer gelesen/bestätigt hat
    if (eigene || darf(me, "hinweise")) {
      const ziel = [...new Set(an.flatMap(e => e === ALLE ? namen : e === BUERO ? buero : [namen.find(n => lc(n) === lc(e)) || e]))]
        .filter(n => lc(n) !== lc(m.von));
      v.empfaenger = ziel.map(n => { const s = st.find(x => lc(x.wer) === lc(n)) || {};
        return { wer: n, gelesen: s.gelesen || "", bestaetigt: s.bestaetigt || "", geschlossen: s.erledigt || "" }; });
    }
    if (m.typ === "umfrage") {
      const stim = d.stim[m.id] || [];
      const zeigeNamen = eigene || darf(me, "hinweise");
      v.umfrage = {
        mehrfach: !!m.mehrfach, offen: !abgelaufen && !m.geloescht,
        optionen: (d.opt[m.id] || []).map(o => { const s = stim.filter(x => x.nr === o.nr); return { nr: o.nr, text: o.text, stimmen: s.length, namen: zeigeNamen ? s.map(x => x.wer) : undefined }; }),
        meine: stim.filter(x => lc(x.wer) === lc(me.name)).map(x => x.nr),
        teilnehmer: new Set(stim.map(x => lc(x.wer))).size,
      };
    }
    out.push(v);
  }
  // Sortierung: angepinnt, dann wichtig, dann neueste Aktivität oben
  const rang = m => m.pin ? 0 : m.prio === "wichtig" ? 1 : 2;
  out.sort((a, b) => rang(a) - rang(b) || (b.zuletzt || "").localeCompare(a.zuletzt || ""));
  const imReiter = out.filter(m => m.ordner === "offen" && !m.pin && m.typ !== "gruss");
  const geb = birthdays(leute).map(g => ({ name: g.name, wann: g.wann, ich: lc(g.name) === lc(me.name) }));
  return {
    nachrichten: out,
    offen: imReiter.length,
    ungelesen: imReiter.filter(m => m.neu).length,
    wichtigOffen: imReiter.filter(m => m.brauchtOk && !m.bestaetigt).length,
    pinsOffen: out.filter(m => m.ordner === "offen" && m.pin && m.brauchtOk && !m.bestaetigt).length,
    erinnern: out.filter(m => m.erinnern).map(m => m.id),
    geburtstage: geb,
    personen: namen.filter(n => lc(n) !== lc(me.name)),
    buero: darf(me, "hinweise"),
    meineAutos: (await autosVon(env, me.name).catch(() => [])).map(a => ({ id: a.id, kennzeichen: a.kennzeichen, name: [a.marke, a.modell].filter(Boolean).join(" "), art: a.art })),
  };
}

async function sichtbar(env, me, id, ordner) {
  const l = await liste(env, me);
  const m = l.nachrichten.find(x => x.id === +id);
  if (!m) throw fail("Nachricht nicht gefunden – bitte neu laden", 404);
  if (ordner === "nichtGeloescht" && m.geloescht) throw fail("Die Nachricht ist gelöscht – bitte erst wiederherstellen");
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

// Fotos: vom Handy verkleinert als Daten-URL (klein = Vorschau, gross = Ansicht)
const BILD = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function bilderPruefen(list) {
  const b = (Array.isArray(list) ? list : []).slice(0, MAX_BILDER + 1);
  if (b.length > MAX_BILDER) throw fail(`Höchstens ${MAX_BILDER} Fotos je Nachricht`);
  for (const x of b) {
    if (!x || !BILD.test(x.klein || "") || !BILD.test(x.gross || "")) throw fail("Das Foto konnte nicht gelesen werden");
    if (x.klein.length > 200000 || x.gross.length > 1500000) throw fail("Das Foto ist zu groß");
  }
  return b;
}
const bilderSpeichern = (id, antwortId, list, jz) => list.map(x =>
  ["INSERT INTO nachricht_bilder (nachricht_id, antwort_id, klein, gross, erstellt) VALUES (?, ?, ?, ?, ?)", id, antwortId, x.klein, x.gross, jz]);

// Ein Foto ausliefern (nur wer die Nachricht sehen darf)
export async function bild(env, me, id, gross) {
  const b = await one(env, `SELECT id, nachricht_id, ${gross ? "gross" : "klein"} AS daten FROM nachricht_bilder WHERE id = ?`, +id);
  if (!b) throw fail("Foto nicht gefunden", 404);
  const m = await one(env, "SELECT id, von, ab, geloescht FROM nachrichten WHERE id = ?", b.nachricht_id);
  if (!m) throw fail("Foto nicht gefunden", 404);
  const namen = (await users(env)).map(u => u.name);
  const an = (await all(env, "SELECT empfaenger FROM nachricht_an WHERE nachricht_id = ?", m.id)).map(r => r.empfaenger);
  const eigene = lc(m.von) === lc(me.name);
  const ok = eigene || (an.some(e => fuerMich(e, me, namen)) && (!m.geloescht || darf(me, "hinweise")) && (!m.ab || m.ab <= heute() || m.geloescht));
  if (!ok) throw fail("Foto nicht gefunden", 404);
  const [, typ, b64] = String(b.daten).match(/^data:([^;]+);base64,(.*)$/) || [];
  if (!b64) throw fail("Foto beschädigt", 500);
  return { typ, bytes: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) };
}

export async function aktion(env, me, b) {
  const jz = jetztSek();
  const buero = darf(me, "hinweise");
  switch (b.aktion) {
    case "senden":
    case "umfrage": {
      if (b.aktion === "umfrage" && !buero) throw fail("Abstimmungen kann nur das Büro starten", 403);
      const text = t(b.text, 2000);
      const fotos = b.aktion === "senden" ? bilderPruefen(b.bilder) : [];
      if (!text && !fotos.length) throw fail(b.aktion === "umfrage" ? "Bitte die Frage eingeben" : "Bitte einen Text eingeben");
      const an = await empfaenger(env, me, b.an);
      const pin = (b.prio === "pin" || !!b.pin) && buero;
      const prio = pin ? "normal" : (b.prio === "wichtig" || b.prio === "dringend" || b.prio === "pin") ? "wichtig" : "normal";
      const bis = isoTag(b.bis), ab = buero ? isoTag(b.ab) : "";
      if (pin && !bis) throw fail("Angepinnte Nachrichten brauchen ein Ablaufdatum („Gilt bis“)");
      if (bis && bis < heute()) throw fail("Das Ablaufdatum liegt in der Vergangenheit");
      if (ab && bis && ab > bis) throw fail("„Sichtbar ab“ liegt nach „Gilt bis“");
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
        ...optionen.map((o, i) => ["INSERT INTO umfrage_optionen (nachricht_id, nr, text) VALUES (?, ?, ?)", id, i + 1, o]),
        ...bilderSpeichern(id, 0, fotos, jz)]);
      break;
    }
    case "antworten": {
      const m = await sichtbar(env, me, b.id, "nichtGeloescht");
      if (m.typ === "gruss") throw fail("Auf Glückwünsche kann man nicht antworten");
      const text = t(b.text, 2000);
      const fotos = bilderPruefen(b.bilder);
      if (!text && !fotos.length) throw fail("Bitte einen Text eingeben");
      const r = await run(env, "INSERT INTO antworten (nachricht_id, von, text, zeit) VALUES (?, ?, ?, ?)", m.id, me.name, text, jz);
      // wer antwortet, holt den Chat für sich zurück (die anderen bekommen ihn durch die neue Antwort zurück)
      await batch(env, [["UPDATE nachrichten SET zuletzt = ? WHERE id = ?", jz, m.id], status(m.id, me.name, "gelesen", jz),
        status(m.id, me.name, "erledigt", ""), ...bilderSpeichern(m.id, r.meta.last_row_id, fotos, jz)]);
      break;
    }
    case "gelesen": {
      const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 200);
      if (ids.length) await batch(env, ids.map(id => status(id, me.name, "gelesen", jz)));
      break;
    }
    case "bestaetigen": {   // wichtige / angepinnte Nachricht: „Gelesen und verstanden“
      const m = await sichtbar(env, me, b.id, "nichtGeloescht");
      await batch(env, [status(m.id, me.name, "bestaetigt", jz), status(m.id, me.name, "gelesen", jz)]);
      break;
    }
    case "erledigt":        // ältere App-Versionen
    case "schliessen": {    // Chat schließen → Ordner „Verlauf“
      const m = await sichtbar(env, me, b.id, "nichtGeloescht");
      const list = [status(m.id, me.name, "erledigt", jz), status(m.id, me.name, "gelesen", jz)];
      if (b.aktion === "erledigt" && m.brauchtOk && !m.bestaetigt) list.push(status(m.id, me.name, "bestaetigt", jz));
      await batch(env, list);
      break;
    }
    case "wiederherstellen": {
      const m = await sichtbar(env, me, b.id);
      if (m.geloescht) {
        if (!m.darfLoeschen) throw fail("Wiederherstellen kann nur der Absender oder das Büro", 403);
        await run(env, "UPDATE nachrichten SET geloescht = 0, geloescht_am = '', geloescht_von = '' WHERE id = ?", m.id);
        break;
      }
      const list = [status(m.id, me.name, "erledigt", "")];
      if (m.nurBuero && !m.eigene) list.push(["UPDATE nachricht_status SET erledigt = '' WHERE nachricht_id = ?", m.id]);   // ganzes Büro
      if (m.abgelaufen) {
        if (!m.eigene && !buero) throw fail("Die Nachricht ist abgelaufen – nur der Absender oder das Büro kann sie wieder öffnen");
        list.push(["UPDATE nachrichten SET bis = '', pin = 0 WHERE id = ?", m.id]);   // ohne Ablaufdatum wieder offen (nicht mehr angepinnt)
      }
      await batch(env, list);
      break;
    }
    case "erinnert": {
      const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 50);
      if (ids.length) await batch(env, ids.map(id => status(id, me.name, "erinnert", jz)));
      break;
    }
    case "reaktion": {
      const m = await sichtbar(env, me, b.id, "nichtGeloescht");
      const r = ["👍", "✅", "❤️", "😂"].includes(b.r) && m.meineReaktion !== b.r ? b.r : "";
      await batch(env, [status(m.id, me.name, "reaktion", r)]);
      break;
    }
    case "abstimmen": {
      const m = await sichtbar(env, me, b.id, "nichtGeloescht");
      if (!m.umfrage) throw fail("Das ist keine Abstimmung");
      if (!m.umfrage.offen) throw fail("Die Abstimmung ist schon beendet");
      let nrs = [...new Set((b.nrs || []).map(Number))].filter(n => m.umfrage.optionen.some(o => o.nr === n));
      if (!m.umfrage.mehrfach) nrs = nrs.slice(0, 1);
      await batch(env, [["DELETE FROM stimmen WHERE nachricht_id = ? AND wer = ?", m.id, me.name],
        ...nrs.map(n => ["INSERT INTO stimmen (nachricht_id, wer, nr) VALUES (?, ?, ?)", m.id, me.name, n]), status(m.id, me.name, "gelesen", jz)]);
      break;
    }
    case "loeschen": {   // → Papierkorb (30 Tage wiederherstellbar)
      const m = await one(env, "SELECT id, von FROM nachrichten WHERE id = ?", +b.id);
      if (!m) break;
      if (lc(m.von) !== lc(me.name) && !buero) throw fail("Löschen kann nur der Absender oder das Büro", 403);
      await run(env, "UPDATE nachrichten SET geloescht = 1, geloescht_am = ?, geloescht_von = ? WHERE id = ?", jz, me.name, m.id);
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

// Aufräumen (zeitgesteuert): Papierkorb nach 30 Tagen leeren, Chats nach einem Jahr ohne Aktivität endgültig entfernen
export async function aufraeumen(env) {
  const jahr = vorTagen(TAGE_VERLAUF);
  const alt = (await all(env, `SELECT id FROM nachrichten WHERE (geloescht = 1 AND geloescht_am < ?) OR (bis <> '' AND bis < ?)
    OR (pin = 0 AND bis = '' AND zuletzt < ?)`, vorTagen(TAGE_PAPIERKORB), jahr, jahr)).map(r => r.id);
  for (let i = 0; i < alt.length; i += 50) {
    const part = alt.slice(i, i + 50), ph = part.map(() => "?").join(",");
    await batch(env, ["nachricht_an", "nachricht_status", "antworten", "umfrage_optionen", "stimmen", "nachricht_bilder"].map(tb => [`DELETE FROM ${tb} WHERE nachricht_id IN (${ph})`, ...part])
      .concat([[`DELETE FROM nachrichten WHERE id IN (${ph})`, ...part]]));
  }
}
