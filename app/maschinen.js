/* Airtec App – Modul „Maschinen“: Wer hat welche Maschine? Mit einem Tipp mitnehmen / zurücklegen.
   Daten: /api/maschinen (Excel „Airtec_Maschinen.xlsx“ in SharePoint, Blatt „Protokoll“ schreibt die App). */
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

  const root = document.getElementById("maView");
  root.innerHTML = `
    <div id="maRem"></div>
    <div id="maAsk"></div>
    <section class="card hide" id="maMineCard"><h2>Bei dir</h2><ul class="malist" id="maMine"></ul></section>
    <section class="card">
      <h2>Maschinen</h2>
      <button class="add" id="maLendBtn" style="margin:0 0 10px">↗ Maschine verleihen</button>
      <div id="maLend" class="hide"></div>
      <input id="maQ" type="search" placeholder="Suchen (Name, Nr., Monteur) …" autocomplete="off">
      <div class="machips"><button data-f="alle" class="on">Alle</button><button data-f="frei">Im Lager</button><button data-f="weg">Unterwegs</button></div>
      <div class="wptools" style="margin:6px 0 0"><span id="maState"></span><button id="maReload">⟳ aktualisieren</button></div>
      <div id="maList"><div class="hint">Wird geladen …</div></div>
    </section>`;
  const $ = s => root.querySelector(s);
  let data = ls.get("ma_cache"), filter = "alle", busy = false, offline = false, open = null;
  const me = () => (AT.user && AT.user.name) || "";
  const isMine = m => m.aus && !m.aus.extern && norm(m.aus.wer) === norm(me());
  const isLender = m => m.aus && m.aus.extern && norm(m.aus.wer) === norm(me());
  const dd = s => String(s || "").slice(0, 6);
  const office = () => !!(AT.user && AT.user.schreiben);

  async function load(force) {
    try {
      const d = await AT.api("maschinen" + (force ? "?t=" + Date.now() : ""));
      d.geladen = Date.now(); data = d; offline = false; ls.set("ma_cache", d);
    } catch (e) {
      if (e.status === 401) return;
      if (!data) { $("#maList").innerHTML = `<div class="lerr">${esc(e.message)}</div>`; return; }
      offline = true;
      if (navigator.onLine) toast2(e.message);
    }
    paint();
  }

  function row(m, inMine) {
    const mine = isMine(m), out = !!m.aus;
    let btn = "";
    if (out && m.aus.extern) btn = (office() || isLender(m)) ? `<button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>` : "";
    else if (!out) btn = `<button class="mabtn take" data-a="nehmen" data-id="${esc(m.id)}">Mitnehmen</button>`;
    else if (mine) btn = `<button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Zurücklegen</button>`;
    else btn = `<button class="mabtn over" data-a="uebernehmen" data-id="${esc(m.id)}">Übernehmen</button>` +
      (office() ? `<button class="mabtn back small" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>` : "");
    const status = out && m.aus.extern
      ? `<span class="mast lent">verliehen an ${esc(m.aus.an)}${m.aus.kontakt ? " (" + esc(m.aus.kontakt) + ")" : ""} · bis ${esc(dd(m.aus.frist))}${m.aus.ueberfaellig ? ' <b class="mafaellig">überfällig</b>' : ""}</span>`
      : out
      ? `<span class="mast out">${mine ? "bei dir" : "bei " + esc(m.aus.wer)} · seit ${esc(short(m.aus.seit))}${m.aus.faellig && (mine || office()) ? ` <b class="mafaellig">${m.aus.tage} Tage</b>` : ""}</span>`
      : `<span class="mast in">im Lager</span>`;
    const sub = [m.nr, m.typ].filter(Boolean).map(esc).join(" · ");
    const hist = office() && open === m.id && m.verlauf ? `<div class="mahist">${m.verlauf.length ? m.verlauf.map(v =>
      `<div><b>${v.an ? "an " + esc(v.an) + (v.kontakt ? " (" + esc(v.kontakt) + ")" : "") + "</b> <small>durch " + esc(v.wer) + ", bis " + esc(dd(v.frist)) + "</small><b>" : esc(v.wer)}</b> ${esc(short(v.von))} → ${v.bis ? esc(short(v.bis)) : "<i>noch unterwegs</i>"}${v.bem ? ` <small>(${esc(v.bem)})</small>` : ""}</div>`).join("") : "<div>Noch keine Ausleihe.</div>"}</div>` : "";
    return `<li class="${out ? (m.aus.extern ? "lent" : mine ? "mine" : "out") : "in"}" data-id="${esc(m.id)}">
      <div class="mainfo"${office() && !inMine ? ' data-hist="1"' : ""}><b>${esc(m.name)}</b>${sub ? `<small>${sub}</small>` : ""}${status}${m.bem && !/^beispiel/i.test(m.bem) ? `<small class="mabem">${esc(m.bem)}</small>` : ""}</div>
      <div class="maact">${btn}</div>${hist}</li>`;
  }

  function paint() {
    if (!data) return;
    const all = data.maschinen || [];
    $("#maState").textContent = offline ? "Offline – Stand " + new Date(data.geladen).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    // Bei dir
    const mine = all.filter(isMine);
    $("#maMineCard").classList.toggle("hide", !mine.length);
    $("#maMine").innerHTML = mine.map(m => row(m, true)).join("");
    // Nachfrage nach 10 Tagen
    const due = mine.filter(m => m.aus.faellig);
    $("#maAsk").innerHTML = due.map(m => `<section class="card maask"><b>Hast du „${esc(m.name)}“ noch?</b>
      <div>Bei dir seit ${esc(short(m.aus.seit))} (${m.aus.tage} Tage).</div>
      <div class="maaskbtn"><button class="mabtn take" data-a="bestaetigen" data-id="${esc(m.id)}">Ja, noch bei mir</button>
      <button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Nein, zurückgelegt</button></div></section>`).join("");
    // Büro: Erinnerung an überfällige Verleihe (+ was zuletzt erledigt wurde)
    const rem = office() ? all.filter(m => m.aus && m.aus.extern && m.aus.erinnern) : [];
    $("#maRem").innerHTML = rem.map(m => `<section class="card maask"><b>⏰ ${esc(m.name)} ist überfällig</b>
      <div>Verliehen an <b>${esc(m.aus.an)}</b>${m.aus.kontakt ? " (" + esc(m.aus.kontakt) + ")" : ""} durch ${esc(m.aus.wer)} am ${esc(short(m.aus.seit))} – Rückgabe war bis <b>${esc(dd(m.aus.frist))}</b></div>
      <div class="maaskbtn"><button class="mabtn take" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>
      <button class="mabtn back" data-a="erinnern" data-id="${esc(m.id)}">In ${data.erinnerung_tage || 3} Tagen erinnern</button></div></section>`).join("") +
      (office() && data.erledigt && data.erledigt.length ? `<section class="card madone">${data.erledigt.map(e =>
        `<div>✓ <b>${esc(e.name)}</b> von ${esc(e.an)} zurück – eingetragen von ${esc(e.von)}, ${esc(short(e.bis))}</div>`).join("")}</section>` : "");
    if ($("#maLend").innerHTML && !$("#maLend").classList.contains("hide")) fillLend();
    // Liste
    const q = norm($("#maQ").value.trim());
    const list = all.filter(m => (filter === "alle" || (filter === "frei" ? !m.aus : !!m.aus)) &&
      (!q || norm([m.name, m.nr, m.typ, m.kat, m.sn, m.aus && m.aus.wer, m.aus && m.aus.an, m.aus && m.aus.kontakt].join(" ")).includes(q)));
    if (!list.length) { $("#maList").innerHTML = `<div class="hint">${all.length ? "Keine Maschine passt zur Auswahl." : "Noch keine Maschinen in der Liste."}</div>`; return; }
    const groups = new Map();
    for (const m of list) { if (!groups.has(m.kat)) groups.set(m.kat, []); groups.get(m.kat).push(m); }
    const cnt = l => { const f = l.filter(m => !m.aus).length; return `${f} von ${l.length} im Lager`; };
    $("#maList").innerHTML = [...groups].map(([k, l]) => `<h3 class="makat">${esc(k)} <small>${cnt(l)}</small></h3><ul class="malist">${l.map(m => row(m)).join("")}</ul>`).join("");
  }

  async function doAct(btn) {
    if (busy) return;
    const a = btn.dataset.a, id = btn.dataset.id;
    const m = (data.maschinen || []).find(x => x.id === id);
    if (!navigator.onLine) { toast2("Keine Internetverbindung – bitte später nochmal"); return; }
    // Übernehmen von einem Kollegen: zweiter Tipp zur Bestätigung
    if (a === "uebernehmen" && !btn.classList.contains("sure")) {
      btn.classList.add("sure"); btn.textContent = "Von " + (m.aus.wer.split(" ")[0]) + " übernehmen?";
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure"); btn.textContent = "Übernehmen"; } }, 4000);
      return;
    }
    if (a === "zurueck" && m && m.aus && !isMine(m) && !isLender(m) && !btn.closest(".maask") && !btn.classList.contains("sure")) {
      btn.classList.add("sure"); btn.textContent = "Wirklich zurück?";
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure"); btn.textContent = "Ist zurück"; } }, 4000);
      return;
    }
    busy = true;
    root.querySelectorAll(`.mabtn[data-id="${CSS.escape(id)}"]`).forEach(b => { b.disabled = true; });
    btn.textContent = "…";
    try {
      const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: a, id }) });
      d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
      const name = m ? m.name : "Maschine";
      toast2({ erinnern: `Okay – Erinnerung in ${data.erinnerung_tage || 3} Tagen`, nehmen: name + " mitgenommen", uebernehmen: name + " übernommen", zurueck: name + " zurückgelegt", bestaetigen: "Danke – wir fragen in 10 Tagen nochmal" }[a] || "Gespeichert");
    } catch (e) {
      toast2(e.message);
      await load(true);
    } finally { busy = false; paint(); }
  }

  /* ---------- Maschine verleihen ---------- */
  const lend = $("#maLend");
  let lendTage = 7;
  function fillLend() {
    const keep = lend.querySelector("#mlM") ? lend.querySelector("#mlM").value : "";
    const avail = (data.maschinen || []).filter(m => !m.aus || isMine(m) || (office() && !m.aus.extern));
    const sel = lend.querySelector("#mlM");
    if (sel) sel.innerHTML = '<option value="">– Maschine wählen –</option>' + avail.map(m =>
      `<option value="${esc(m.id)}" ${m.id === keep ? "selected" : ""}>${esc(m.name)}${m.nr ? " (" + esc(m.nr) + ")" : ""}${m.aus ? " – bei " + esc(m.aus.wer) : ""}</option>`).join("");
  }
  function openLend() {
    const empf = (data && data.empfaenger) || [];
    lend.innerHTML = `<div class="malend">
      <label>Maschine</label><select id="mlM"></select>
      <label>Verliehen an</label>
      <div class="machips mlchips">${empf.map(e => `<button data-e="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      <input id="mlAn" list="mlAnL" placeholder="Firma / Empfänger" autocomplete="off"><datalist id="mlAnL">${empf.map(e => `<option value="${esc(e)}">`).join("")}</datalist>
      <label>Name (Ansprechpartner)</label><input id="mlK" placeholder="z. B. Herr Müller" autocomplete="off">
      <label>Wie lange?</label>
      <div class="machips mldays">${[1, 3, 7, 14, 30].map(t => `<button data-t="${t}" class="${t === lendTage ? "on" : ""}">${t} ${t === 1 ? "Tag" : "Tage"}</button>`).join("")}</div>
      <div class="row"><div><label>Tage</label><input id="mlT" type="number" min="1" max="365" inputmode="numeric" value="${lendTage}"></div><div><label>Rückgabe bis</label><div id="mlBis" class="mlbis"></div></div></div>
      <button class="bigbtn primary" id="mlGo">Verleihen</button>
      <button class="add" id="mlX">Abbrechen</button></div>`;
    fillLend();
    const bis = () => { const t = Math.max(1, +lend.querySelector("#mlT").value || 1); lendTage = t;
      const d = new Date(Date.now() + t * 864e5); lend.querySelector("#mlBis").textContent = d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
      lend.querySelectorAll(".mldays button").forEach(b => b.classList.toggle("on", +b.dataset.t === t)); };
    bis();
    lend.querySelectorAll(".mlchips button").forEach(b => b.onclick = () => { lend.querySelector("#mlAn").value = b.dataset.e;
      lend.querySelectorAll(".mlchips button").forEach(x => x.classList.toggle("on", x === b)); lend.querySelector("#mlK").focus(); });
    lend.querySelector("#mlAn").oninput = e => lend.querySelectorAll(".mlchips button").forEach(x => x.classList.toggle("on", x.dataset.e === e.target.value));
    lend.querySelectorAll(".mldays button").forEach(b => b.onclick = () => { lend.querySelector("#mlT").value = b.dataset.t; bis(); });
    lend.querySelector("#mlT").oninput = bis;
    lend.querySelector("#mlX").onclick = closeLend;
    lend.querySelector("#mlGo").onclick = async () => {
      const id = lend.querySelector("#mlM").value, an = lend.querySelector("#mlAn").value.trim(), kontakt = lend.querySelector("#mlK").value.trim(), tage = +lend.querySelector("#mlT").value;
      if (!id) { lend.querySelector("#mlM").focus(); toast2("Bitte Maschine wählen"); return; }
      if (!an) { lend.querySelector("#mlAn").focus(); toast2("Bitte angeben, an wen"); return; }
      if (!kontakt) { lend.querySelector("#mlK").focus(); toast2("Bitte einen Namen eintragen"); return; }
      if (!(tage >= 1)) { lend.querySelector("#mlT").focus(); return; }
      if (!navigator.onLine) { toast2("Keine Internetverbindung"); return; }
      const go = lend.querySelector("#mlGo"); go.disabled = true; go.textContent = "Wird gespeichert …";
      try {
        const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "verleihen", id, an, kontakt, tage }) });
        d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
        const m = d.maschinen.find(x => x.id === id);
        toast2(`${m ? m.name : "Maschine"} an ${an} verliehen bis ${m && m.aus ? dd(m.aus.frist) : ""}`);
        closeLend(); paint();
      } catch (e) { toast2(e.message); go.disabled = false; go.textContent = "Verleihen"; }
    };
    lend.classList.remove("hide"); $("#maLendBtn").classList.add("hide");
  }
  function closeLend() { lend.classList.add("hide"); lend.innerHTML = ""; $("#maLendBtn").classList.remove("hide"); }
  $("#maLendBtn").onclick = () => { if (data) openLend(); else toast2("Liste wird noch geladen"); };

  root.addEventListener("click", e => {
    const b = e.target.closest(".mabtn");
    if (b) { doAct(b); return; }
    const h = e.target.closest(".mainfo[data-hist]");
    if (h) { const id = h.closest("li").dataset.id; open = open === id ? null : id; paint(); }
  });
  $("#maQ").oninput = paint;
  root.querySelectorAll(".machips button").forEach(b => b.onclick = () => {
    filter = b.dataset.f; root.querySelectorAll(".machips button").forEach(x => x.classList.toggle("on", x === b)); paint();
  });
  $("#maReload").onclick = () => load(true).then(() => !offline && toast2("Aktualisiert"));

  AT.modules.maschinen = { show() { paint(); load(); } };
  // Beim Start im Hintergrund prüfen, ob eine Nachfrage fällig ist – dann Hinweis auf dem Reiter
  AT.checkMaschinen = async () => {
    try {
      const d = await AT.api("maschinen"); d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
      const due = (d.maschinen || []).some(m => (isMine(m) && m.aus.faellig) || (office() && m.aus && m.aus.extern && m.aus.erinnern));
      const t = document.querySelector('#tabs button[data-tab="maschinen"]');
      if (t) t.classList.toggle("dot", due);
      if (due) toast2(office() && (d.maschinen || []).some(m => m.aus && m.aus.extern && m.aus.erinnern)
        ? "⏰ Eine verliehene Maschine ist überfällig → Reiter Maschinen"
        : "Bitte kurz bestätigen: Hast du deine Maschine noch? → Reiter Maschinen");
      paint();
    } catch (e) {}
  };
})();
