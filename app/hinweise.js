/* Airtec App – Startseite:
   • oben: Begrüßung mit dem heutigen Einsatz (Banner)
   • Geburtstag: Banner fürs Geburtstagskind, Karte mit „Gratulieren“ für alle anderen
   • Austausch-Kurzübersicht: angepinnte und dringende Nachrichten, sonst „x neue Nachrichten“
   • Maschinen: zu lange ausgeliehen (Monteur) / überfällig verliehen (Büro), Reservierungen
   • Büro: Lager – was muss bestellt werden?  • Restmüll
   • ganz unten: Urlaub (siehe urlaub.js) */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const short = s => String(s || "").replace(/^(\d{2}\.\d{2}\.)\d{4}/, "$1");
  const dd = iso => iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.` : "";
  const toast2 = t => { if (typeof toast === "function") toast(t); };

  const root = document.getElementById("stView");
  root.innerHTML = `<section class="card sthello"><div class="hi" id="stHi"></div><div class="me" id="stMe"></div>
      <button class="mehint" id="stToPlan">Wochenplan ansehen →</button></section>
    <section class="card stsuche"><input id="stQ" type="search" placeholder="🔍 Suchen: Kennzeichen, Name, Telefon, Maschine, Artikel …" autocomplete="off" enterkeyhint="search">
      <div id="stRes"></div></section>
    <div id="hiBox"></div>`;
  const box = root.querySelector("#hiBox");

  // ---------- Suche ----------
  // Server: Mitarbeiter (Name, Telefon) + Autos (Kennzeichen, Marke, Fahrer). Lokal: Maschinen, Lager-Artikel, Nachrichten.
  const sst = document.createElement("style");
  sst.textContent = `.stsuche{padding:10px 12px} .stsuche input{margin:0}
    .sres{margin-top:8px} .sres h4{margin:10px 2px 4px;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.03em}
    .sres .sr{display:block;width:100%;text-align:left;border:0;border-top:1px solid #eef1f4;background:none;padding:8px 2px;font:inherit;color:var(--ink)}
    .sres .sr b{font-size:15px} .sres .sr small{display:block;color:var(--mut);font-size:13px;margin-top:1px}
    .sres .sr a{color:var(--blue);font-weight:600;text-decoration:none} .sres .kzs{font:700 13px ui-monospace,Consolas,monospace;border:1.5px solid #1a1a1a;border-left:6px solid #1f4fa8;border-radius:4px;padding:1px 5px;margin-right:6px}`;
  document.head.appendChild(sst);
  const tel = t => t ? `<a href="tel:${esc(String(t).replace(/[^\d+]/g, ""))}">📞 ${esc(t)}</a>` : "";
  const kzNorm = s => String(s || "").toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "");
  let sTimer = null, sNr = 0;
  function sucheLokal(q) {
    const ql = q.toLowerCase(), kz = kzNorm(q);
    const has = (...f) => f.some(x => String(x || "").toLowerCase().includes(ql));
    const mas = (((ls.get("ma_cache") || {}).maschinen) || []).filter(m => has(m.name, m.nr, m.typ, m.sn, m.kat) || (kz.length >= 2 && kzNorm(m.nr) === kz)).slice(0, 6);
    const arts = (((ls.get("lg_cache") || {}).arts) || []).filter(a => has(a.bez, a.gr, a.nr, a.best, a.herst, a.such)).slice(0, 6);
    const msgs = (((AT.austausch && AT.austausch.data) || {}).nachrichten || []).filter(m => m.typ !== "gruss" && (has(m.text, m.von) || m.antworten.some(a => has(a.text)))).slice(0, 5);
    return { mas, arts, msgs };
  }
  async function suchen(q) {
    const res = root.querySelector("#stRes"), nr = ++sNr;
    if (q.length < 2) { res.innerHTML = ""; return; }
    const lok = sucheLokal(q);
    let srv = { personen: [], autos: [] };
    try { srv = await AT.api("suche?q=" + encodeURIComponent(q)); } catch (e) {}
    if (nr !== sNr) return;   // inzwischen weitergetippt
    const out = [];
    if (srv.autos.length) out.push(`<h4>Fahrzeuge</h4>` + srv.autos.map(a => `<div class="sr"><b><span class="kzs">${esc(a.kennzeichen)}</span>${esc(a.name || (a.art === "anhaenger" ? "Anhänger" : "Auto"))}</b>
      <small>${a.fahrer ? `👤 ${esc(a.fahrer)} ${tel(a.fahrerTel)}` : "keinem Mitarbeiter zugeordnet"}${a.tuev ? ` · TÜV bis ${esc(a.tuev)}` : ""}</small></div>`).join(""));
    if (srv.personen.length) out.push(`<h4>Mitarbeiter</h4>` + srv.personen.map(p => `<div class="sr"><b>${esc(p.name)}</b>
      <small>${[tel(p.telefon), p.mail ? `<a href="mailto:${esc(p.mail)}">✉️ ${esc(p.mail)}</a>` : "", p.autos ? "🚐 " + esc(p.autos) : ""].filter(Boolean).join(" · ") || "keine Kontaktdaten hinterlegt"}</small></div>`).join(""));
    if (lok.mas.length) out.push(`<h4>Maschinen</h4>` + lok.mas.map(m => `<button class="sr" data-go="maschinen"><b>${esc(m.name)}</b>
      <small>${[m.nr, m.typ].filter(Boolean).map(esc).join(" · ")}${m.aus ? ` · ${m.aus.baustelle ? "auf Baustelle " + esc(m.aus.baustelle) : m.aus.extern ? "verliehen an " + esc(m.aus.an) : "bei " + esc(m.aus.wer)}` : " · im Lager"}</small></button>`).join(""));
    if (lok.arts.length) out.push(`<h4>Lager</h4>` + lok.arts.map(a => `<button class="sr" data-go="lager"><b>${esc(a.bez)}${a.gr ? " – " + esc(a.gr) : ""}</b>
      <small>${[a.nr, a.ort ? "Lagerort " + a.ort : "", a.lief].filter(Boolean).map(esc).join(" · ")}</small></button>`).join(""));
    if (lok.msgs.length) out.push(`<h4>Nachrichten</h4>` + lok.msgs.map(m => `<button class="sr" data-msg="${m.id}"><b>${esc(m.von)}</b>
      <small>${esc(m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text)}</small></button>`).join(""));
    res.innerHTML = out.length ? `<div class="sres">${out.join("")}</div>` : `<div class="hint">Nichts gefunden für „${esc(q)}“.</div>`;
    res.querySelectorAll("[data-go]").forEach(b => b.onclick = () => AT.tab(b.dataset.go));
    res.querySelectorAll("[data-msg]").forEach(b => b.onclick = () => AT.austausch.oeffnen(+b.dataset.msg));
  }
  const qIn = root.querySelector("#stQ");
  qIn.oninput = () => { clearTimeout(sTimer); sTimer = setTimeout(() => suchen(qIn.value.trim()), 300); };
  qIn.onkeydown = e => { if (e.key === "Escape") { qIn.value = ""; suchen(""); } };

  async function hello() {
    const W = AT.wp;
    root.querySelector("#stHi").textContent = W.greet();
    try {
      const t = W.todayIso(), d = await W.week(t);
      const txt = W.sentence(d, t);
      root.querySelector("#stMe").innerHTML = txt || (AT.user && AT.user.schreiben ? "Schönen Tag im Büro!" : "");
    } catch (e) { root.querySelector("#stMe").textContent = navigator.onLine ? "" : "Offline – Wochenplan nicht geladen."; }
  }

  let ma = ls.get("ma_cache"), mu = ls.get("mu_cache"), muStep = 0, busy = false;
  const au = () => (AT.austausch && AT.austausch.data) || null;

  async function load() {
    const [m, lg, mm] = await Promise.allSettled([(AT.darf("maschinen") || AT.darf("maschinen_buero")) ? AT.api("maschinen") : Promise.reject(),
      AT.darf("lager_bestellen") ? AT.api("lager") : Promise.reject(), AT.api("muell"), AT.austausch ? AT.austausch.load() : null]);
    if (mm.status === "fulfilled") { mu = mm.value; ls.set("mu_cache", mu); }
    if (lg.status === "fulfilled") { ls.set("lg_cache", lg.value); }
    if (m.status === "fulfilled") { ma = m.value; ma.geladen = Date.now(); ls.set("ma_cache", ma); }
    paint();
  }

  function paint() {
    const me = norm(AT.user && AT.user.name);
    const items = [];
    const A = au();
    // ---------- Geburtstage (ganz oben) ----------
    const first = n => String(n || "").split(" ")[0];
    const today = new Date().toISOString().slice(0, 10);
    const wishes = ((A && A.nachrichten) || []).filter(m => m.typ === "gruss" && m.anMich);
    const geb = [];
    for (const g of (A && A.geburtstage) || []) {
      if (g.ich) {
        geb.unshift(`<section class="card hicard higeb"><div class="higebbig">🎂</div><b>Alles Gute zum Geburtstag, ${esc(first(g.name))}!</b>
          <div>${g.wann === "heute" ? "Wir wünschen dir einen schönen Tag!" : `Schon mal vorab für ${esc(g.wann)} – schönes Wochenende!`}</div>
          ${wishes.length ? `<div class="hiwish">🎉 Glückwünsche von ${wishes.map(w => esc(first(w.von))).join(", ")}</div>` : ""}</section>`);
      } else {
        const k = "grat_" + g.name + "_" + today, done = ls.get(k);
        geb.push(`<section class="card hicard higeb"><div class="hihead">🎂 Geburtstag</div>
          <b>${g.wann === "heute" ? `Heute hat ${esc(g.name)} Geburtstag!` : `${esc(g.wann[0].toUpperCase() + g.wann.slice(1))} hat ${esc(g.name)} Geburtstag.`}</b>
          ${done ? `<div class="hiwish">✓ Glückwunsch gesendet</div>` : `<button class="hidone higrat" data-grat="${esc(g.name)}">🎉 Gratulieren</button>`}</section>`);
      }
    }
    items.push(...geb);

    // ---------- Austausch: angepinnt, dringend, Zähler ----------
    if (A) {
      const N = (A.nachrichten || []).filter(m => m.typ !== "gruss");
      const pins = N.filter(m => m.pin && m.anMich);   // eigene angepinnte Mitteilungen an alle sieht der Absender auch
      const dringend = N.filter(m => !m.pin && m.neu && m.prio === "dringend" && m.anMich && !m.eigene);
      for (const m of pins) items.push(`<section class="card hicard hipin au ${m.prio}"><div class="hihead">📌 ${esc(m.eigene ? "Du" : m.von.split(" ")[0])}${m.bis && m.typ !== "auto" ? " · bis " + esc(dd(m.bis)) : ""}${m.prio !== "normal" ? (m.prio === "dringend" ? " · 🔴 dringend" : " · 🟠 wichtig") : ""}</div>
        <div class="hitext">${esc(m.text)}</div>
        ${m.eigene ? `<div class="hiwish" style="margin-top:6px">von dir gesendet</div>` : m.erledigt ? `<div class="hiwish" style="margin-top:6px">✓ zur Kenntnis genommen</div>` : `<button class="hidone" data-ok="${m.id}">Zur Kenntnis genommen ✓</button>`}</section>`);
      for (const m of dringend) items.push(`<section class="card hicard au dringend" style="border-left-width:5px"><div class="hihead">🔴 Dringend · ${esc(m.von)}</div>
        <div class="hitext">${esc(m.text.length > 220 ? m.text.slice(0, 220) + "…" : m.text)}</div>
        <button class="hidone" data-open="${m.id}" style="background:var(--bad)">Öffnen</button></section>`);
      const rest = A.ungelesen - dringend.length - pins.filter(m => m.neu).length;
      items.push(`<section class="card hicard"><div class="hihead">✉️ Nachrichten</div>
        <b>${rest > 0 ? `${rest} neue Nachricht${rest > 1 ? "en" : ""}` : "Keine weiteren neuen Nachrichten"}</b>
        <div class="maaskbtn"><button class="mabtn take" data-open="">Nachrichten öffnen</button><button class="mabtn back" id="stWrite">${AT.darf("hinweise") ? "✉️ Nachricht schreiben" : "✉️ Nachricht ans Büro"}</button></div></section>`);
    }

    // ---------- Maschinen ----------
    for (const m of (ma && ma.maschinen) || []) {
      // Reservierungen: heute für mich / bald für jemand anderen, während ich sie habe
      const span = r => { const x = String(r.von).slice(0, 6), y = String(r.bis).slice(0, 6); return x === y ? x : x + " – " + y; };
      const rMe = (m.res || []).find(r => r.jetzt && norm(r.fuer) === me);
      if (rMe) items.push(`<section class="card hicard hires"><div class="hihead">📅 Reservierung</div><b>„${esc(m.name)}“ ist für dich reserviert</b>
        <div>${esc(span(rMe))} · ${m.aus ? (m.aus.baustelle ? "steht auf Baustelle " + esc(m.aus.baustelle) : m.aus.extern ? "noch verliehen an " + esc(m.aus.an) : norm(m.aus.wer) === me ? "hast du schon" : "noch bei " + esc(m.aus.wer)) : "steht im Lager"}</div>
        ${!m.aus || m.aus.baustelle ? `<div class="maaskbtn"><button class="mabtn take" data-ma="nehmen" data-id="${esc(m.id)}">Jetzt mitnehmen</button></div>` : ""}</section>`);
      const rOther = m.aus && !m.aus.extern && !m.aus.baustelle && norm(m.aus.wer) === me && (m.res || []).find(r => r.bald && norm(r.fuer) !== me);
      if (rOther) items.push(`<section class="card hicard hima"><div class="hihead">📅 Reservierung</div><b>„${esc(m.name)}“ wird gebraucht</b>
        <div>Ab ${esc(String(rOther.von).slice(0, 6))} für ${esc(rOther.fuer)} reserviert – bitte rechtzeitig zurücklegen.</div>
        <div class="maaskbtn"><button class="mabtn back" data-ma="zurueck" data-id="${esc(m.id)}">Zurückgelegt</button></div></section>`);
      const a = m.aus; if (!a) continue;
      if (!a.extern && !a.baustelle && norm(a.wer) === me && a.faellig)
        items.push(a.wiederDa ? `<section class="card hicard hima"><div class="hihead">🔧 Maschine – Reservierung zu Ende</div><b>Wieder da? „${esc(m.name)}“</b>
          <div>War für dich geplant bis ${esc(String(a.frist).slice(0, 6))}.</div>
          <div class="maaskbtn"><button class="mabtn back" data-ma="zurueck" data-id="${esc(m.id)}">Ja, zurückgelegt</button>
          <button class="mabtn take" data-ma="bestaetigen" data-id="${esc(m.id)}">Brauche sie noch</button></div></section>`
          : `<section class="card hicard hima"><div class="hihead">🔧 Maschine</div><b>Hast du „${esc(m.name)}“ noch?</b>
          <div>Bei dir seit ${esc(short(a.seit))} (${a.tage} Tage).</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="bestaetigen" data-id="${esc(m.id)}">Ja, noch bei mir</button>
          <button class="mabtn back" data-ma="zurueck" data-id="${esc(m.id)}">Zurückgelegt</button></div></section>`);
      if (AT.darf("maschinen_buero") && a.extern && a.erinnern)
        items.push(`<section class="card hicard hima"><div class="hihead">⏰ Verliehen – Rückgabe fällig</div><b>Wieder da? ${esc(m.name)}</b>
          <div>an ${esc(a.an)}${a.kontakt ? " (" + esc(a.kontakt) + ")" : ""}, Rückgabe war bis ${esc(String(a.frist).slice(0, 6))}</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="zurueck" data-id="${esc(m.id)}">Ja, ist zurück</button>
          <button class="mabtn back" data-ma="erinnern" data-id="${esc(m.id)}">In ${(ma && ma.erinnerung_tage) || 3} Tagen erinnern</button></div></section>`);
    }

    // ---------- Büro: Lager – was muss bestellt werden? ----------
    if (AT.darf("lager_bestellen")) {
      const lgd = ls.get("lg_cache");
      const open = [...((lgd && lgd.arts) || []).filter(a => a.offen), ...((lgd && lgd.frei) || [])];
      const byL = {};
      for (const a of open) { const k = a.lief || (a.frei ? "🆕 nicht in der Liste" : "ohne Lieferant"); byL[k] = (byL[k] || 0) + 1; }
      items.push(`<section class="card hicard hilager"><div class="hihead">📦 Lager</div>
        <b>${open.length ? `${open.length} Artikel zu bestellen` : "Nichts zu bestellen"}</b>
        ${open.length ? `<div class="hivon">${Object.entries(byL).map(([l, n]) => esc(l) + ": " + n).join(" · ")}</div>` : ""}
        <button class="hidone" id="hiLager" style="background:var(--blue)">${open.length ? "Bestellliste öffnen" : "Lager ansehen"}</button></section>`);
    }

    // ---------- Restmüll: für alle ----------
    const lz = mu && mu.letzte;
    const muQ = [
      "",
      `<div class="muq">Ist die Tonne richtig voll?<br><small>Wir zahlen pauschal für eine Leerung, deshalb sollte die Tonne schön voll sein!</small></div>
       <div class="maaskbtn"><button class="mabtn take" data-mu="1">Ja, sie ist richtig voll</button><button class="mabtn back" data-mu="x">Abbrechen</button></div>`,
      `<div class="muq">Leerung jetzt anfordern?</div>
       <div class="maaskbtn"><button class="mabtn take" data-mu="go">Jetzt anfordern</button><button class="mabtn back" data-mu="x">Abbrechen</button></div>`,
      `<div class="muq">⚠ ${esc(muWarn)}<br><small>Trotzdem nochmal anfordern?</small></div>
       <div class="maaskbtn"><button class="mabtn take" data-mu="force">Trotzdem anfordern</button><button class="mabtn back" data-mu="x">Abbrechen</button></div>`,
    ];
    items.push(`<section class="card hicard himuell"><div class="hihead">🗑️ Restmüll</div>
      <div class="hivon" style="margin-top:0">${lz ? `Letzte Leerung angefordert: <b>${esc(String(lz.am).slice(0, 10))}</b> von ${esc(lz.von)}` : "Noch keine Leerung über die App angefordert."}</div>
      ${muStep ? muQ[muStep] : `<button class="hidone mubtn" data-mu="0">Restmüll leeren</button>`}</section>`);
    box.innerHTML = items.join("");
    const hl = box.querySelector("#hiLager");
    if (hl) hl.onclick = () => { const d = ls.get("lg_cache"); if (d && ((d.arts || []).some(a => a.offen) || (d.frei || []).length) && AT.lagerOrders) AT.lagerOrders(); else AT.tab("lager"); };
    bind();
  }

  async function post(path, body) {
    return AT.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  let muWarn = "";
  async function muSend(force) {
    if (busy) return; busy = true;
    const b = box.querySelector('[data-mu="go"],[data-mu="force"]'); if (b) { b.disabled = true; b.textContent = "Wird gesendet …"; }
    try {
      mu = await post("muell", force ? { trotzdem: true } : {}); ls.set("mu_cache", mu); muStep = 0;
      toast2("🗑️ Leerung angefordert – Mail an den Entsorger ist raus ✓");
    } catch (e) {
      if (e.status === 409) { muWarn = e.message; muStep = 3; }
      else { toast2(e.message); muStep = 0; }
    }
    busy = false; paint();
  }

  function bind() {
    box.querySelectorAll("[data-mu]").forEach(b => b.onclick = () => {
      const a = b.dataset.mu;
      if (a === "0") muStep = 1; else if (a === "1") muStep = 2; else if (a === "x") muStep = 0;
      else if (a === "go") return muSend(false); else if (a === "force") return muSend(true);
      paint();
    });
    box.querySelectorAll("[data-ma]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      try { ma = await post("maschinen", { aktion: b.dataset.ma, id: b.dataset.id }); ma.geladen = Date.now(); ls.set("ma_cache", ma);
        toast2({ nehmen: "Mitgenommen ✓", bestaetigen: "Danke – wir fragen in 10 Tagen nochmal", zurueck: "Als zurück eingetragen", erinnern: "Okay, Erinnerung später" }[b.dataset.ma]);
        if (AT.checkMaschinen) AT.checkMaschinen(true);
      } catch (e) { toast2(e.message); }
      busy = false; paint();
    });
    box.querySelectorAll("[data-grat]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      try {
        await AT.austausch.post({ aktion: "gratulieren", an: b.dataset.grat });
        ls.set("grat_" + b.dataset.grat + "_" + new Date().toISOString().slice(0, 10), true);
        toast2("🎉 Glückwunsch an " + b.dataset.grat.split(" ")[0] + " gesendet");
      } catch (e) { toast2(e.message); }
      busy = false; paint();
    });
    box.querySelectorAll("[data-ok]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      try { await AT.austausch.post({ aktion: "erledigt", id: +b.dataset.ok }); toast2("Zur Kenntnis genommen ✓"); } catch (e) { toast2(e.message); }
      busy = false; paint();
    });
    box.querySelectorAll("[data-open]").forEach(b => b.onclick = () => AT.austausch.oeffnen(+b.dataset.open || null));
    const w = box.querySelector("#stWrite"); if (w) w.onclick = () => AT.austausch.schreiben(AT.darf("hinweise") ? "" : "*buero");
    root.querySelector("#stToPlan").onclick = () => AT.tab("wochenplan");
  }

  // bei jedem Öffnen der Startseite aktualisieren
  AT.modules.start = { show() { paint(); hello(); if (navigator.onLine) load(); } };
  if (AT.austausch) AT.austausch.onChange(() => { if (!root.classList.contains("hide")) paint(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !root.classList.contains("hide")) AT.modules.start.show();
  });
})();
