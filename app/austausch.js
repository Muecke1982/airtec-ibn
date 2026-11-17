/* Airtec KApp – Reiter „Austausch“: Nachrichten, angepinnte Mitteilungen, Antworten, Abstimmungen.
   • alle: an Kollegen oder ans Büro schreiben (Priorität, Ablaufdatum), antworten, 👍, abhaken, abstimmen
   • Büro (Recht „hinweise“): an alle, anpinnen mit Ablaufdatum + Erinnerung, „sichtbar ab“, Abstimmungen, löschen
   Die Startseite zeigt eine Kurzübersicht (siehe hinweise.js, AT.austausch). */
(function () {
  const AT = window.AT;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const buero = () => AT.darf("hinweise");
  const first = n => String(n || "").split(" ")[0];
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const dd = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "";
  const wann = z => {   // „heute 07:12“, „gestern 16:30“, „Mo 12.11.“
    if (!z) return "";
    const d = z.slice(0, 10), heute = new Date().toLocaleDateString("sv-SE"), gestern = new Date(Date.now() - 864e5).toLocaleDateString("sv-SE");
    return d === heute ? "heute " + z.slice(11, 16) : d === gestern ? "gestern " + z.slice(11, 16) : `${WT[new Date(d + "T12:00:00Z").getUTCDay()]} ${dd(d)}`;
  };
  const PRIO = { normal: ["Normal", ""], wichtig: ["Wichtig", "🟠"], dringend: ["Dringend", "🔴"] };

  // ---------- Reiter + Ansicht ----------
  const tabBtn = document.createElement("button");
  tabBtn.dataset.tab = "austausch"; tabBtn.textContent = "Austausch";
  document.querySelector('#tabs button[data-tab="protokolle"]').before(tabBtn);
  tabBtn.onclick = () => AT.tab("austausch");
  const view = document.createElement("main");
  view.id = "auView"; view.dataset.mod = "austausch"; view.className = "hide";
  document.getElementById("app").before(view);
  const hdr = document.querySelector("#hdrType");
  if (hdr) { const s = document.createElement("small"); s.dataset.mod = "austausch"; s.className = "hide"; s.textContent = "Austausch"; hdr.parentNode.appendChild(s); }

  const css = document.createElement("style");
  css.textContent = `
  .au{border-left:5px solid #c9d1d9;padding:12px 13px}
  .au.wichtig{border-left-color:#f2a20c} .au.dringend{border-left-color:var(--bad)}
  .au.pin{background:#f2fafe;border:2px solid var(--blue);border-left-width:5px}
  .au.neu .auhead b:first-child::after{content:" • neu";color:var(--blue);font-weight:700;font-size:12px}
  .au.erl{opacity:.65}
  .auhead{font-size:12.5px;color:var(--mut);display:flex;flex-wrap:wrap;gap:4px 8px;align-items:baseline}
  .auhead b{color:var(--ink);font-size:13.5px}
  .aubadge{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 6px;background:#eef1f4;color:var(--mut)}
  .aubadge.wichtig{background:#fff1d6;color:#8a5a00} .aubadge.dringend{background:#fdecec;color:var(--bad)} .aubadge.pin{background:#e3effc;color:var(--blue)}
  .autext{white-space:pre-wrap;margin:7px 0 2px;font-size:15.5px;line-height:1.4;word-break:break-word}
  .auacts{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
  .auacts button{border:0;border-radius:9px;padding:8px 11px;font:inherit;font-size:14px;font-weight:600;background:#eef1f4;color:var(--ink)}
  .auacts .ok{background:var(--green);color:#fff} .auacts .on{background:#e3effc;color:var(--blue)} .auacts .del{background:none;color:var(--bad);margin-left:auto}
  .aurep{margin:8px 0 0;border-top:1px dashed #dde3ea;padding-top:6px}
  .aurep div{font-size:14px;margin:5px 0;white-space:pre-wrap;word-break:break-word} .aurep small{color:var(--mut)}
  .auform textarea{min-height:70px}
  .aupick{max-height:210px;overflow:auto;border:1px solid #cfd5dc;border-radius:10px;padding:4px 10px;background:#fff}
  .aupick label{display:flex;gap:8px;align-items:center;margin:6px 0;color:var(--ink);font-size:15px}
  .aupoll button{display:flex;justify-content:space-between;align-items:center;width:100%;position:relative;overflow:hidden;border:1.5px solid #cfd5dc;background:#fff;
    border-radius:10px;padding:9px 11px;margin:6px 0 0;font:inherit;font-size:15px;color:var(--ink);text-align:left}
  .aupoll button.mine{border-color:var(--blue);font-weight:700}
  .aupoll button i{position:absolute;left:0;top:0;bottom:0;background:#e3effc;z-index:0} .aupoll button span{position:relative;z-index:1}
  .austat{font-size:12.5px;color:var(--mut);margin-top:8px} .austat button{border:0;background:none;color:var(--blue);font:inherit;padding:0;text-decoration:underline}
  .aunames{font-size:13px;margin-top:4px;color:var(--ink)}
  #auRem .box{max-height:85vh;overflow:auto}`;
  document.head.appendChild(css);

  const cacheKey = () => "au_cache_" + ((AT.user && AT.user.name) || "");
  let data = null, filter = "mir", form = null, offenAntwort = null, offenStatus = null, alleAntworten = new Set(), busy = false, prio = "normal";

  async function post(body) {
    data = await AT.api("austausch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    ls.set(cacheKey(), data); punkt(); tell(); return data;
  }
  async function load() {
    person();
    if (!AT.user || !navigator.onLine) return;
    try { data = await AT.api("austausch"); ls.set(cacheKey(), data); } catch (e) { return; }
    punkt(); tell();
    // nicht neu zeichnen, während jemand schreibt (sonst wäre der Text weg)
    if (!view.classList.contains("hide") && !form && offenAntwort == null) { paint(); gelesenMelden(); }
    erinnern();
  }
  const horcher = [];
  function tell() { horcher.forEach(f => { try { f(data); } catch (e) {} }); }
  function punkt() { tabBtn.classList.toggle("dot", !!(data && data.ungelesen)); }

  // ---------- Darstellung ----------
  function karte(m, klein) {
    const [plabel, picon] = PRIO[m.prio] || PRIO.normal;
    const an = m.eigene ? "an " + m.an.join(", ") : (m.an.includes("Alle") ? "an alle" : m.an.includes("Büro") ? "ans Büro" : "an dich");
    const head = `<div class="auhead">${m.pin ? `<span class="aubadge pin">📌 Angepinnt${m.bis ? " bis " + dd(m.bis) : ""}</span>` : ""}
      ${m.prio !== "normal" ? `<span class="aubadge ${m.prio}">${picon} ${plabel}</span>` : ""}${m.typ === "umfrage" ? '<span class="aubadge">📊 Abstimmung</span>' : ""}
      <b>${esc(m.eigene ? "Du" : m.von)}</b><span>${esc(an)} · ${esc(wann(m.erstellt))}${!m.pin && m.bis ? " · gilt bis " + dd(m.bis) : ""}${m.ab && m.eigene ? " · sichtbar ab " + dd(m.ab) : ""}</span></div>`;
    let poll = "";
    if (m.umfrage) {
      const u = m.umfrage, max = Math.max(1, ...u.optionen.map(o => o.stimmen));
      poll = `<div class="aupoll">${u.optionen.map(o => `<button data-vote="${o.nr}" data-id="${m.id}" class="${u.meine.includes(o.nr) ? "mine" : ""}" ${u.offen ? "" : "disabled"}>
        <i style="width:${Math.round(o.stimmen / max * 100)}%"></i><span>${u.meine.includes(o.nr) ? "✓ " : ""}${esc(o.text)}</span><span>${o.stimmen}</span></button>
        ${o.namen && o.namen.length ? `<div class="aunames">${o.namen.map(n => esc(first(n))).join(", ")}</div>` : ""}`).join("")}
        <div class="austat">${u.teilnehmer} haben abgestimmt${u.mehrfach ? " · mehrere Antworten möglich" : ""}${u.offen ? (m.bis ? " · bis " + dd(m.bis) : "") : " · <b>beendet</b>"}</div></div>`;
    }
    const zeig = alleAntworten.has(m.id) ? m.antworten : m.antworten.slice(-3);
    const rep = m.antworten.length ? `<div class="aurep">${m.antworten.length > zeig.length ? `<div><button class="austat" data-alle="${m.id}" style="border:0;background:none;color:var(--blue);padding:0">Alle ${m.antworten.length} Antworten anzeigen</button></div>` : ""}
      ${zeig.map(a => `<div><b>${esc(first(a.von))}:</b> ${esc(a.text)} <small>${esc(wann(a.zeit))}</small></div>`).join("")}</div>` : "";
    if (klein) return { head, poll };
    const daumen = m.reaktionen.filter(r => r.r === "👍");
    const acts = [];
    if (m.anMich && !m.eigene && m.typ !== "gruss") acts.push(m.pin ? (m.erledigt ? `<button disabled>✓ Zur Kenntnis genommen</button>` : `<button class="ok" data-done="${m.id}">Zur Kenntnis genommen ✓</button>`)
      : `<button class="ok" data-done="${m.id}">Erledigt ✓</button>`);
    if (m.typ !== "gruss") acts.push(`<button data-reply="${m.id}" class="${offenAntwort === m.id ? "on" : ""}">Antworten</button>`);
    if (!m.eigene && m.typ !== "gruss") acts.push(`<button data-like="${m.id}" class="${m.meineReaktion === "👍" ? "on" : ""}">👍${daumen.length ? " " + daumen.length : ""}</button>`);
    else if (daumen.length) acts.push(`<button disabled>👍 ${daumen.length}</button>`);
    if (m.darfLoeschen) acts.push(`<button class="del" data-del="${m.id}">Löschen</button>`);
    let stat = "";
    if (m.empfaenger && m.empfaenger.length && m.typ !== "umfrage") {
      const g = m.empfaenger.filter(e => e.gelesen).length, e = m.empfaenger.filter(x => x.erledigt).length, n = m.empfaenger.length;
      stat = `<div class="austat">👁 ${g}/${n} gelesen · ✓ ${e}/${n} ${m.pin ? "zur Kenntnis" : "erledigt"} · <button data-stat="${m.id}">${offenStatus === m.id ? "weniger" : "wer?"}</button>
        ${offenStatus === m.id ? `<div class="aunames">${m.empfaenger.map(x => `${x.erledigt ? "✅" : x.gelesen ? "👁" : "⏳"} ${esc(x.wer)}`).join("<br>")}</div>` : ""}</div>`;
    }
    const replyForm = offenAntwort === m.id ? `<div class="auform" style="margin-top:8px"><textarea id="auRepText" rows="2" placeholder="Antwort …"></textarea>
      <button class="bigbtn primary" data-send-reply="${m.id}" style="margin-top:8px">Antwort senden</button></div>` : "";
    return `<section class="card au ${m.prio} ${m.pin ? "pin" : ""} ${m.neu ? "neu" : ""} ${m.erledigt && !m.pin ? "erl" : ""}" data-m="${m.id}">${head}
      <div class="autext">${esc(m.text)}</div>${poll}${rep}${stat}<div class="auacts">${acts.join("")}</div>${replyForm}</section>`;
  }

  function formular() {
    const P = (data && data.personen) || [];
    const isU = form === "umfrage";
    const pick = `<label>An</label><div class="aupick">
      <label><input type="checkbox" data-an="*buero"> 🏢 Büro</label>
      ${buero() ? `<label><input type="checkbox" data-an="*alle" ${isU ? "checked" : ""}> 👥 Alle</label>` : ""}
      ${P.map(n => `<label><input type="checkbox" data-an="${esc(n)}"> ${esc(n)}</label>`).join("")}</div>`;
    return `<section class="card auform"><h2>${isU ? "Neue Abstimmung" : "Neue Nachricht"}</h2>${pick}
      <label>${isU ? "Frage" : "Nachricht"}</label><textarea id="auText" rows="3" placeholder="${isU ? "z. B. Welcher Termin passt für die Weihnachtsfeier?" : "Nachricht …"}"></textarea>
      ${isU ? `<label>Antwortmöglichkeiten</label><div id="auOpts">${[1, 2, 3].map(i => `<input class="auopt" placeholder="Antwort ${i}" style="margin-bottom:6px">`).join("")}</div>
        <button class="add" id="auOptAdd" style="margin-top:0">+ weitere Antwort</button>
        <label class="hichk" style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="auMehr"> mehrere Antworten erlaubt</label>`
        : `<label>Priorität</label><div class="seg" id="auPrio">${Object.entries(PRIO).map(([k, [l, ic]]) => `<button data-prio="${k}" class="${prio === k ? "on" : ""}">${ic} ${l}</button>`).join("")}</div>`}
      <div class="row"><div><label>${isU ? "Abstimmen bis" : "Gilt bis (optional)"}</label><input type="date" id="auBis"></div>
        ${buero() && !isU ? `<div><label>Sichtbar ab (optional)</label><input type="date" id="auAb"></div>` : "<div></div>"}</div>
      ${buero() && !isU ? `<label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-size:15px;margin-top:12px"><input type="checkbox" id="auPin"> 📌 Anpinnen – steht ganz oben bis zum Ablaufdatum</label>
        <div id="auPinBox" class="hide"><label>Erinnerung, bis zur Kenntnis genommen</label><select id="auErin">
          <option value="0">keine</option><option value="1" selected>täglich</option><option value="2">alle 2 Tage</option><option value="7">wöchentlich</option></select></div>` : ""}
      <div class="vwbtns" style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn primary" id="auSend" style="flex:2">${isU ? "Abstimmung starten" : "Senden"}</button>
        <button class="bigbtn secondary" id="auCancel" style="flex:1">Abbrechen</button></div></section>`;
  }

  function paint() {
    if (!AT.user) { view.innerHTML = ""; return; }
    if (!data) { view.innerHTML = `<section class="card">Lade …</section>`; return; }
    const alle = (data.nachrichten || []).filter(m => m.typ !== "gruss");
    const mir = alle.filter(m => m.anMich && !m.eigene), ges = alle.filter(m => m.eigene);
    const list = filter === "mir" ? mir : ges;
    view.innerHTML = `${form ? formular() : `<div class="hirow" style="display:flex;gap:8px;margin-bottom:12px">
        <button class="add" id="auNew" style="margin:0">✉️ Neue Nachricht</button>${buero() ? `<button class="add" id="auPoll" style="margin:0">📊 Abstimmung</button>` : ""}</div>`}
      <div class="seg" style="margin-bottom:12px"><button data-f="mir" class="${filter === "mir" ? "on" : ""}">Für mich${data.ungelesen ? ` (${data.ungelesen})` : ""}</button>
        <button data-f="ges" class="${filter === "ges" ? "on" : ""}">Gesendet (${ges.length})</button></div>
      ${list.length ? list.map(m => karte(m)).join("") : `<section class="card"><div class="hint" style="margin:0">${filter === "mir" ? "Keine offenen Nachrichten. 👍" : "Noch nichts gesendet."}</div></section>`}`;
    bind();
  }

  // ---------- Bedienung ----------
  function bind() {
    const q = s => view.querySelector(s);
    const nn = q("#auNew"); if (nn) nn.onclick = () => { form = "nachricht"; prio = "normal"; paint(); };
    const np = q("#auPoll"); if (np) np.onclick = () => { form = "umfrage"; paint(); };
    view.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; paint(); gelesenMelden(); });
    if (form) {
      q("#auCancel").onclick = () => { form = null; paint(); };
      view.querySelectorAll("[data-prio]").forEach(b => b.onclick = () => { prio = b.dataset.prio; view.querySelectorAll("[data-prio]").forEach(x => x.classList.toggle("on", x === b)); });
      const pin = q("#auPin"); if (pin) pin.onchange = () => q("#auPinBox").classList.toggle("hide", !pin.checked);
      const add = q("#auOptAdd"); if (add) add.onclick = () => { const i = document.createElement("input"); i.className = "auopt"; i.style.marginBottom = "6px"; i.placeholder = "Antwort " + (view.querySelectorAll(".auopt").length + 1); q("#auOpts").appendChild(i); i.focus(); };
      // „Alle“ schließt einzelne Häkchen aus
      view.querySelectorAll("[data-an]").forEach(c => c.onchange = () => { if (c.dataset.an === "*alle" && c.checked) view.querySelectorAll("[data-an]").forEach(x => { if (x !== c) x.checked = false; });
        else if (c.checked) { const a = q('[data-an="*alle"]'); if (a) a.checked = false; } });
      q("#auSend").onclick = async () => {
        const an = [...view.querySelectorAll("[data-an]:checked")].map(c => c.dataset.an);
        const text = q("#auText").value.trim();
        if (!an.length) return say("Bitte Empfänger wählen");
        if (!text) { q("#auText").focus(); return; }
        const b = { aktion: form === "umfrage" ? "umfrage" : "senden", an, text, bis: q("#auBis").value };
        if (form === "umfrage") { b.optionen = [...view.querySelectorAll(".auopt")].map(i => i.value.trim()).filter(Boolean); b.mehrfach = q("#auMehr").checked; }
        else { b.prio = prio; if (q("#auAb")) b.ab = q("#auAb").value; if (q("#auPin") && q("#auPin").checked) { b.pin = true; b.erinnerung = +q("#auErin").value; } }
        q("#auSend").disabled = true;
        try { await post(b); form = null; filter = "ges"; say(b.aktion === "umfrage" ? "Abstimmung gestartet ✓" : b.pin ? "Angepinnt ✓" : "Gesendet ✓"); }
        catch (e) { say(e.message); q("#auSend").disabled = false; return; }
        paint();
      };
    }
    view.querySelectorAll("[data-done]").forEach(b => b.onclick = () => act(b, { aktion: "erledigt", id: +b.dataset.done }, "Abgehakt ✓"));
    view.querySelectorAll("[data-like]").forEach(b => b.onclick = () => act(b, { aktion: "reaktion", id: +b.dataset.like, r: "👍" }));
    view.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => {
      const m = data.nachrichten.find(x => x.id === +b.dataset.id); if (!m) return;
      const nr = +b.dataset.vote, mine = m.umfrage.meine;
      const nrs = m.umfrage.mehrfach ? (mine.includes(nr) ? mine.filter(x => x !== nr) : [...mine, nr]) : (mine.includes(nr) ? [] : [nr]);
      act(b, { aktion: "abstimmen", id: m.id, nrs }, "Abgestimmt ✓");
    });
    view.querySelectorAll("[data-reply]").forEach(b => b.onclick = () => { offenAntwort = offenAntwort === +b.dataset.reply ? null : +b.dataset.reply; paint(); const t = q("#auRepText"); if (t) t.focus(); });
    view.querySelectorAll("[data-send-reply]").forEach(b => b.onclick = () => {
      const text = q("#auRepText").value.trim(); if (!text) return q("#auRepText").focus();
      act(b, { aktion: "antworten", id: +b.dataset.sendReply, text }, "Antwort gesendet ✓", () => { offenAntwort = null; });
    });
    view.querySelectorAll("[data-stat]").forEach(b => b.onclick = () => { offenStatus = offenStatus === +b.dataset.stat ? null : +b.dataset.stat; paint(); });
    view.querySelectorAll("[data-alle]").forEach(b => b.onclick = () => { alleAntworten.add(+b.dataset.alle); paint(); });
    view.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich löschen?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Löschen"; } }, 4000); return; }
      act(b, { aktion: "loeschen", id: +b.dataset.del }, "Gelöscht");
    });
  }
  async function act(btn, body, msg, vorher) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try { await post(body); if (vorher) vorher(); if (msg) say(msg); } catch (e) { say(e.message); }
    busy = false; if (!view.classList.contains("hide")) paint();
  }

  // Ungelesene als gelesen melden, sobald sie im Austausch angezeigt wurden (angepinnte mit Erinnerung nicht – die brauchen „Zur Kenntnis“)
  let readTimer = null;
  function gelesenMelden() {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (view.classList.contains("hide") || !data) return;
      const ids = data.nachrichten.filter(m => m.neu && (filter === "mir" ? m.anMich && !m.eigene : m.eigene) && !(m.pin && m.erinnerung > 0 && !m.erledigt)).map(m => m.id);
      if (!ids.length) return;
      try { const d = await AT.api("austausch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "gelesen", ids }) });
        // Markierung „neu“ bleibt in der aktuellen Ansicht sichtbar, nur der Zähler geht zurück
        data.ungelesen = d.ungelesen; ls.set(cacheKey(), d); punkt(); tell(); } catch (e) {}
    }, 1500);
  }

  // ---------- Erinnerung (angepinnte Nachrichten) ----------
  const rem = document.createElement("div");
  rem.className = "modal"; rem.id = "auRem"; rem.innerHTML = `<div class="box"></div>`;
  document.body.appendChild(rem);
  let remGezeigt = 0;
  function erinnern() {
    if (!data || !data.erinnern || !data.erinnern.length || rem.classList.contains("show") || Date.now() - remGezeigt < 60000) return;
    const list = data.nachrichten.filter(m => data.erinnern.includes(m.id));
    if (!list.length) return;
    remGezeigt = Date.now();
    rem.querySelector(".box").innerHTML = `<h3>📌 Erinnerung</h3>${list.map(m => `<div class="card au ${m.prio} pin" style="margin:10px 0">
      <div class="auhead"><b>${esc(m.von)}</b><span>${m.bis ? "gilt bis " + dd(m.bis) : ""}</span></div><div class="autext">${esc(m.text)}</div>
      <div class="auacts"><button class="ok" data-rem-ok="${m.id}">Zur Kenntnis genommen ✓</button></div></div>`).join("")}
      <div class="btns"><button class="secondary" id="auRemLater">Später erinnern</button></div>`;
    rem.classList.add("show");
    rem.querySelectorAll("[data-rem-ok]").forEach(b => b.onclick = async () => {
      b.disabled = true; try { await post({ aktion: "erledigt", id: +b.dataset.remOk }); } catch (e) { say(e.message); }
      b.closest(".card").remove(); if (!rem.querySelector("[data-rem-ok]")) rem.classList.remove("show");
      if (!view.classList.contains("hide")) paint();
    });
    rem.querySelector("#auRemLater").onclick = async () => {
      rem.classList.remove("show");
      const ids = [...rem.querySelectorAll("[data-rem-ok]")].map(b => +b.dataset.remOk);
      try { await post({ aktion: "erinnert", ids }); } catch (e) {}
    };
  }

  // ---------- für die Startseite ----------
  AT.austausch = {
    get data() { person(); return data; },
    load, post,
    onChange(f) { horcher.push(f); },
    oeffnen(id) { filter = "mir"; AT.tab("austausch"); if (id) setTimeout(() => { const el = view.querySelector(`[data-m="${id}"]`); if (el) el.scrollIntoView({ block: "center" }); }, 300); },
    schreiben(an) { form = "nachricht"; prio = "normal"; AT.tab("austausch"); setTimeout(() => { if (an) { const c = view.querySelector(`[data-an="${an}"]`); if (c) c.checked = true; } const t = view.querySelector("#auText"); if (t) t.focus(); }, 300); },
  };
  // je Person eigener Zwischenspeicher – nach Abmelden/Anmelden nie die Nachrichten der vorherigen Person zeigen
  let fuer = null;
  function person() { const n = AT.user && AT.user.name; if (n !== fuer) { fuer = n; data = n ? ls.get(cacheKey()) : null; filter = "mir"; form = null; offenAntwort = null; offenStatus = null; punkt(); } }
  AT.modules.austausch = { show() { person(); filter = "mir"; form = null; paint(); load(); gelesenMelden(); } };
  punkt();
  setInterval(() => { if (!document.hidden && AT.user) load(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && AT.user) load(); });
})();
