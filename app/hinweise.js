/* Airtec App – Startseite: Begrüßung mit dem heutigen Einsatz und darunter die Hinweise:
   • Maschinen: zu lange ausgeliehen (Monteur) / überfällig verliehen (Büro)
   • Büro-Hinweise an einzelne Monteure oder alle – zum Abhaken
   • Büro: neuen Hinweis schreiben (auch am PC im Browser) und sehen, wer abgehakt hat */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const short = s => String(s || "").replace(/^(\d{2}\.\d{2}\.)\d{4}/, "$1");
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const office = () => !!(AT.user && AT.user.schreiben);

  const root = document.getElementById("stView");
  root.innerHTML = `<section class="card sthello"><div class="hi" id="stHi"></div><div class="me" id="stMe"></div>
      <button class="mehint" id="stToPlan">Wochenplan ansehen →</button></section>
    <div id="hiBox"></div>
    <section class="card stmsg hide" id="stMsg">
      <button class="add" id="stMsgBtn" style="margin:0">✉️ Hinweis ans Büro</button>
      <div id="stMsgForm" class="hide"><textarea id="stMsgText" rows="3" placeholder="z. B. Brauche neue Arbeitshandschuhe / Firmenwagen hat eine Warnleuchte …"></textarea>
        <button class="bigbtn primary" id="stMsgSend" style="margin-top:10px">An das Büro senden</button></div>
      <div id="stSent"></div>
    </section>`;
  const box = root.querySelector("#hiBox");
  let msgOpen = false;

  async function hello() {
    const W = AT.wp;
    root.querySelector("#stHi").textContent = W.greet();
    try {
      const t = W.todayIso(), d = await W.week(t);
      const txt = W.sentence(d, t);
      root.querySelector("#stMe").innerHTML = txt || (office() ? "Schönen Tag im Büro!" : "");
    } catch (e) { root.querySelector("#stMe").textContent = navigator.onLine ? "" : "Offline – Wochenplan nicht geladen."; }
  }

  let hin = ls.get("hi_cache"), ma = ls.get("ma_cache"), busy = false, formOpen = false, listOpen = false;

  async function load() {
    const [h, m, lg] = await Promise.allSettled([AT.api("hinweise"), AT.api("maschinen"), office() ? AT.api("lager") : Promise.reject()]);
    if (h.status === "fulfilled") { hin = h.value; ls.set("hi_cache", hin); }
    if (lg.status === "fulfilled") { ls.set("lg_cache", lg.value); }
    if (m.status === "fulfilled") { ma = m.value; ma.geladen = Date.now(); ls.set("ma_cache", ma); }
    paint();
  }

  function paint() {
    const me = norm(AT.user && AT.user.name);
    const items = [];
    // Maschinen
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
        items.push(`<section class="card hicard hima"><div class="hihead">🔧 Maschine</div><b>Hast du „${esc(m.name)}“ noch?</b>
          <div>Bei dir seit ${esc(short(a.seit))} (${a.tage} Tage).</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="bestaetigen" data-id="${esc(m.id)}">Ja, noch bei mir</button>
          <button class="mabtn back" data-ma="zurueck" data-id="${esc(m.id)}">Zurückgelegt</button></div></section>`);
      if (office() && a.extern && a.erinnern)
        items.push(`<section class="card hicard hima"><div class="hihead">⏰ Verliehen – überfällig</div><b>${esc(m.name)}</b>
          <div>an ${esc(a.an)}${a.kontakt ? " (" + esc(a.kontakt) + ")" : ""}, Rückgabe war bis ${esc(String(a.frist).slice(0, 6))}</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="zurueck" data-id="${esc(m.id)}">Ist zurück</button>
          <button class="mabtn back" data-ma="erinnern" data-id="${esc(m.id)}">In ${(ma && ma.erinnerung_tage) || 3} Tagen erinnern</button></div></section>`);
    }
    // Büro-Hinweise an mich
    const dshort = s => String(s || "").slice(0, 6);
    // Geburtstage ganz oben
    const isCongrats = h => /^🎉/.test(h.text || "");
    const wishes = ((hin && hin.meine) || []).filter(isCongrats);
    const first = n => String(n || "").split(" ")[0];
    const today = new Date().toISOString().slice(0, 10);
    for (const g of (hin && hin.geburtstage) || []) {
      if (g.ich) {
        items.unshift(`<section class="card hicard higeb"><div class="higebbig">🎂</div><b>Alles Gute zum Geburtstag, ${esc(first(g.name))}!</b>
          <div>${g.wann === "heute" ? "Wir wünschen dir einen schönen Tag!" : `Schon mal vorab für ${esc(g.wann)} – schönes Wochenende!`}</div>
          ${wishes.length ? `<div class="hiwish">🎉 Glückwünsche von ${wishes.map(w => esc(first(w.von))).join(", ")}</div>` : ""}</section>`);
      } else {
        const k = "grat_" + g.name + "_" + today, done = ls.get(k);
        items.unshift(`<section class="card hicard higeb"><div class="hihead">🎂 Geburtstag</div>
          <b>${g.wann === "heute" ? `Heute hat ${esc(g.name)} Geburtstag!` : `${esc(g.wann[0].toUpperCase() + g.wann.slice(1))} hat ${esc(g.name)} Geburtstag.`}</b>
          ${done ? `<div class="hiwish">✓ Glückwunsch gesendet</div>` : `<button class="hidone higrat" data-grat="${esc(g.name)}">🎉 Gratulieren</button>`}</section>`);
      }
    }
    // angepinnte Hinweise zuerst – ohne Abhaken, bis zum Ablaufdatum
    for (const h of ((hin && hin.meine) || []).filter(h => h.pin))
      items.push(`<section class="card hicard hipin"><div class="hihead">📌 Angepinnt${h.bis ? " · bis " + esc(dshort(h.bis)) : ""}</div>
        <div class="hitext">${esc(h.text)}</div>${h.von ? `<div class="hivon">${esc(h.von)}</div>` : ""}</section>`);
    for (const h of ((hin && hin.meine) || []).filter(h => !h.pin && !isCongrats(h)))
      items.push(`<section class="card hicard ${h.buero ? "hiin" : "hibuero"}"><div class="hihead">${h.buero ? "✉️ Nachricht von " + esc(h.von || "Monteur") : "📋 Hinweis vom Büro" + (h.von ? " · " + esc(h.von.split(" ")[0]) : "")}${h.erstellt ? " · " + esc(short(h.erstellt).slice(0, 6)) : ""}</div>
        <div class="hitext">${esc(h.text)}</div>
        <button class="hidone" data-done="${esc(h.id)}">Erledigt ✓</button></section>`);
    // Büro: Hinweis schreiben + Übersicht
    let ofc = "";
    if (office()) {
      const all = (hin && hin.alle) || [];
      const open = all.filter(h => h.alle || !h.done.length);
      ofc = `<section class="card hiofc">
        <div class="hirow"><button class="add" id="hiNew">＋ Hinweis an Monteur</button><button class="add" id="hiList">Gesendete (${open.length} offen)</button></div>
        <div id="hiForm" class="${formOpen ? "" : "hide"}">
          <label>An</label><select id="hiAn"><option>Alle</option></select>
          <label>Hinweis</label><textarea id="hiText" rows="3" placeholder="z. B. Im Büro liegen Unterlagen der Versicherung für dich."></textarea>
          <label class="hichk"><input type="checkbox" id="hiPin"> 📌 Anpinnen – bleibt oben stehen, kein Abhaken</label>
          <div class="row"><div><label>Sichtbar ab (optional)</label><input type="date" id="hiAb"></div><div id="hiBisBox" class="hide"><label>Anzeigen bis *</label><input type="date" id="hiBis"></div></div>
          <button class="bigbtn primary" id="hiSend">Hinweis senden</button>
        </div>
        <div id="hiSent" class="${listOpen ? "" : "hide"}">${all.length ? all.map(h => {
          const st = h.pin ? (h.abgelaufen ? "abgelaufen" : "📌 angepinnt bis " + esc(String(h.bis).slice(0, 6))) : h.alle
            ? (h.done.length ? `✓ ${h.done.length}× abgehakt: ${h.done.map(d => esc(d.wer.split(" ")[0])).join(", ")}` : "noch von niemandem abgehakt")
            : (h.done.length ? `✓ erledigt ${esc(short(h.done[0].am))}` : "offen");
          return `<div class="hisent${!h.alle && h.done.length ? " ok" : ""}"><div><b>an ${esc(h.an)}</b>${h.ab ? ` <small>ab ${esc(h.ab)}</small>` : ""}<div>${esc(h.text)}</div>
            <small>${h.von ? "von " + esc(h.von) + ", " : ""}${esc(short(h.erstellt))} · ${st}</small></div>
            <button class="hidel" data-del="${esc(h.id)}">Löschen</button></div>`;
        }).join("") : '<div class="hint">Noch keine Hinweise.</div>'}</div>
      </section>`;
    }
    // Büro: Lager – was muss bestellt werden?
    if (office()) {
      const lgd = ls.get("lg_cache");
      const open = [...((lgd && lgd.arts) || []).filter(a => a.offen), ...((lgd && lgd.frei) || [])];
      const byL = {};
      for (const a of open) { const k = a.lief || (a.frei ? "🆕 nicht in der Liste" : "ohne Lieferant"); byL[k] = (byL[k] || 0) + 1; }
      items.push(`<section class="card hicard hilager"><div class="hihead">📦 Lager</div>
        <b>${open.length ? `${open.length} Artikel zu bestellen` : "Nichts zu bestellen"}</b>
        ${open.length ? `<div class="hivon">${Object.entries(byL).map(([l, n]) => esc(l) + ": " + n).join(" · ")}</div>` : ""}
        <button class="hidone" id="hiLager" style="background:var(--blue)">${open.length ? "Bestellliste öffnen" : "Lager ansehen"}</button></section>`);
    }
    box.innerHTML = items.join("") + ofc;
    const hl = box.querySelector("#hiLager");
    if (hl) hl.onclick = () => { const d = ls.get("lg_cache"); if (d && ((d.arts || []).some(a => a.offen) || (d.frei || []).length) && AT.lagerOrders) AT.lagerOrders(); else AT.tab("lager"); };
    // Monteure: Hinweis ans Büro + Status der eigenen Nachrichten
    const msg = root.querySelector("#stMsg");
    msg.classList.toggle("hide", office());
    root.querySelector("#stMsgForm").classList.toggle("hide", !msgOpen);
    const sent = (hin && hin.gesendet) || [];
    root.querySelector("#stSent").innerHTML = sent.length ? `<div class="stsent">${sent.slice(0, 5).map(x =>
      `<div>${x.done.length ? "✓" : "⏳"} „${esc(x.text.length > 50 ? x.text.slice(0, 50) + "…" : x.text)}“ – ${x.done.length ? "erledigt von " + esc(x.done[0].wer.split(" ")[0]) : "noch offen"}</div>`).join("")}</div>` : "";
    if (office()) fillNames();
    bind();
  }

  async function fillNames() {
    const sel = box.querySelector("#hiAn"); if (!sel) return;
    let names = ls.get("at_names") || [];
    if (!names.length) try { names = (await AT.api("login?liste=1")).namen || []; ls.set("at_names", names); } catch (e) {}
    const keep = sel.value;
    sel.innerHTML = "<option>Alle</option>" + names.filter(n => norm(n) !== norm(AT.user.name)).map(n => `<option ${n === keep ? "selected" : ""}>${esc(n)}</option>`).join("");
  }

  async function post(path, body) {
    return AT.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  function bind() {
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
        hin = await post("hinweise", { aktion: "gratulieren", an: b.dataset.grat }); ls.set("hi_cache", hin);
        ls.set("grat_" + b.dataset.grat + "_" + new Date().toISOString().slice(0, 10), true);
        toast2("🎉 Glückwunsch an " + b.dataset.grat.split(" ")[0] + " gesendet");
      } catch (e) { toast2(e.message); }
      busy = false; paint();
    });
    box.querySelectorAll("[data-done]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      const card = b.closest(".hicard"); if (card) card.classList.add("gone");
      try { hin = await post("hinweise", { aktion: "erledigt", id: b.dataset.done }); ls.set("hi_cache", hin); toast2("Abgehakt ✓"); }
      catch (e) { toast2(e.message); }
      busy = false; setTimeout(paint, 250);
    });
    const R = s => root.querySelector(s);
    R("#stToPlan").onclick = () => AT.tab("wochenplan");
    R("#stMsgBtn").onclick = () => { msgOpen = !msgOpen; paint(); if (msgOpen) setTimeout(() => R("#stMsgText").focus(), 50); };
    R("#stMsgSend").onclick = async () => {
      const text = R("#stMsgText").value.trim();
      if (!text) { R("#stMsgText").focus(); return; }
      R("#stMsgSend").disabled = true; R("#stMsgSend").textContent = "Wird gesendet …";
      try { hin = await post("hinweise", { aktion: "neu", an: "Büro", text }); ls.set("hi_cache", hin); msgOpen = false; toast2("An das Büro gesendet ✓"); }
      catch (e) { toast2(e.message); R("#stMsgSend").disabled = false; R("#stMsgSend").textContent = "An das Büro senden"; return; }
      paint();
    };
    const $ = s => box.querySelector(s);
    if (!$("#hiNew")) return;
    $("#hiNew").onclick = () => { formOpen = !formOpen; listOpen = false; paint(); if (formOpen) setTimeout(() => $("#hiText") && $("#hiText").focus(), 50); };
    $("#hiPin").onchange = e => { $("#hiBisBox").classList.toggle("hide", !e.target.checked); $("#hiSend").textContent = e.target.checked ? "Hinweis anpinnen" : "Hinweis senden"; };
    $("#hiList").onclick = () => { listOpen = !listOpen; formOpen = false; paint(); };
    $("#hiSend").onclick = async () => {
      const text = $("#hiText").value.trim(), an = $("#hiAn").value, abIso = $("#hiAb").value, pin = $("#hiPin").checked, bisIso = $("#hiBis").value;
      if (!text) { $("#hiText").focus(); return; }
      if (pin && !bisIso) { $("#hiBis").focus(); toast2("Bitte „Anzeigen bis“ angeben"); return; }
      const de = iso => iso ? iso.split("-").reverse().join(".") : "";
      const ab = de(abIso), bis = pin ? de(bisIso) : "";
      $("#hiSend").disabled = true; $("#hiSend").textContent = "Wird gesendet …";
      try { hin = await post("hinweise", { aktion: "neu", an, text, ab, pin, bis }); ls.set("hi_cache", hin); formOpen = false; listOpen = true; toast2(pin ? `Hinweis angepinnt bis ${bis}` : `Hinweis an ${an} gesendet`); }
      catch (e) { toast2(e.message); }
      paint();
    };
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Löschen"; } }, 4000); return; }
      b.disabled = true;
      try { hin = await post("hinweise", { aktion: "loeschen", id: b.dataset.del }); ls.set("hi_cache", hin); toast2("Gelöscht"); }
      catch (e) { toast2(e.message); }
      paint();
    });
  }

  // bei jedem Öffnen der Startseite aktualisieren
  AT.modules.start = { show() { paint(); hello(); if (navigator.onLine) load(); } };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !root.classList.contains("hide")) AT.modules.start.show();
  });
})();
