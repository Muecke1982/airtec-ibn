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
    <button class="bigbtn primary qrbtn" id="maScanBtn" style="margin:0 0 12px">📷 QR-Code scannen – ausleihen / zurückgeben</button>
    <div id="maScan"></div>
    <div id="maRem"></div>
    <div id="maAsk"></div>
    <section class="card hide" id="maMineCard"><h2>Bei dir</h2><ul class="malist" id="maMine"></ul></section>
    <section class="card">
      <h2>Maschinen</h2>
      <div class="maopts" id="maOpts"><button class="add" id="maLendBtn">↗ Maschine verleihen</button><button class="add" id="maSiteBtn">📍 Auf Baustelle gelassen</button><button class="add" id="maResBtn">📅 Reservieren</button></div>
      <div id="maLend" class="hide"></div>
      <input id="maQ" type="search" placeholder="Suchen (Name, Nr., Monteur) …" autocomplete="off">
      <div class="machips"><button data-f="alle" class="on">Alle</button><button data-f="frei">Im Lager</button><button data-f="weg">Unterwegs</button></div>
      <div class="makats" id="maKats"></div>
      <div class="wptools" style="margin:6px 0 0"><span id="maState"></span><button id="maReload">⟳ aktualisieren</button></div>
      <div id="maList"><div class="hint">Wird geladen …</div></div>
    </section>`;
  const $ = s => root.querySelector(s);
  let data = ls.get("ma_cache"), filter = "alle", kat = ls.get("ma_kat") || "", busy = false, offline = false, open = null;
  const me = () => (AT.user && AT.user.name) || "";
  const isMine = m => m.aus && !m.aus.extern && !m.aus.baustelle && norm(m.aus.wer) === norm(me());
  const isLender = m => m.aus && m.aus.extern && norm(m.aus.wer) === norm(me());
  const dd = s => String(s || "").slice(0, 6);
  const office = () => AT.darf("maschinen_buero");

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

  // Kollegen mit Vornamen, Firmen/Externe mit vollem Namen
  const who = n => (ls.get("at_names") || []).some(x => norm(x) === norm(n)) ? String(n).split(" ")[0] : n;
  const span = r => { const a = String(r.von).slice(0, 6), b = String(r.bis).slice(0, 6); return a === b ? a : a + " – " + b; };
  function row(m, inMine) {
    const mine = isMine(m), out = !!m.aus;
    let btn = "";
    if (out && m.aus.baustelle) btn = `<button class="mabtn take" data-a="nehmen" data-id="${esc(m.id)}">Mitnehmen</button><button class="mabtn back small" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>`;
    else if (out && m.aus.extern) btn = (office() || isLender(m)) ? `<button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>` : "";
    else if (!out) btn = `<button class="mabtn take" data-a="nehmen" data-id="${esc(m.id)}">Mitnehmen</button>`;
    else if (mine) btn = `<button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Zurücklegen</button>`;
    else btn = `<button class="mabtn over" data-a="uebernehmen" data-id="${esc(m.id)}">Übernehmen</button>` +
      (office() ? `<button class="mabtn back small" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>` : "");
    const status = out && m.aus.baustelle
      ? `<span class="mast site">📍 Baustelle ${esc(m.aus.baustelle)} · seit ${esc(short(m.aus.abgestellt))}</span>`
      : out && m.aus.extern
      ? `<span class="mast lent">verliehen an ${esc(m.aus.an)}${m.aus.kontakt ? " (" + esc(m.aus.kontakt) + ")" : ""} · bis ${esc(dd(m.aus.frist))}${m.aus.ueberfaellig ? ' <b class="mafaellig">überfällig</b>' : ""}</span>`
      : out
      ? `<span class="mast out">${mine ? "bei dir" : "bei " + esc(m.aus.wer)} · seit ${esc(short(m.aus.seit))}${m.aus.frist ? " · bis " + esc(dd(m.aus.frist)) : ""}${m.aus.wiederDa && (mine || office()) ? ` <b class="mafaellig">Rückgabe fällig</b>` : m.aus.faellig && (mine || office()) ? ` <b class="mafaellig">${m.aus.tage} Tage</b>` : ""}</span>`
      : `<span class="mast in">im Lager</span>`;
    const sub = [m.nr, m.typ].filter(Boolean).map(esc).join(" · ");
    const res = m.res || [];
    const forMe = r => norm(r.fuer) === norm(me());
    const resNow = res.find(r => r.jetzt);
    const resLine = res.length ? `<span class="mares${resNow ? (forMe(resNow) ? " me" : " now") : ""}">📅 ${res.slice(0, 2).map(r =>
      `${r.jetzt ? "heute " : ""}${forMe(r) ? "für dich" : esc(who(r.fuer))} ${esc(span(r))}`).join(" · ")}${res.length > 2 ? ` · +${res.length - 2}` : ""}</span>` : "";
    // Warnung für den, der sie hat, wenn bald jemand anderes reserviert hat
    const warn = mine && res.find(r => r.bald && !forMe(r)) ? `<small class="mawarn">⚠ ab ${esc(span(res.find(r => r.bald && !forMe(r))).split(" – ")[0])} für ${esc(res.find(r => r.bald && !forMe(r)).fuer)} reserviert – bitte rechtzeitig zurücklegen</small>` : "";
    const hist = office() && open === m.id && m.verlauf ? `<div class="mahist">${m.verlauf.length ? m.verlauf.map(v =>
      `<div><b>${v.an ? "an " + esc(v.an) + (v.kontakt ? " (" + esc(v.kontakt) + ")" : "") + "</b> <small>durch " + esc(v.wer) + ", bis " + esc(dd(v.frist)) + "</small><b>" : esc(v.wer)}</b> ${esc(short(v.von))} → ${v.bis ? esc(short(v.bis)) : "<i>noch unterwegs</i>"}${v.bem ? ` <small>(${esc(v.bem)})</small>` : ""}</div>`).join("") : "<div>Noch keine Ausleihe.</div>"}${res.length ? `<div class="mahres"><b>Reservierungen</b>${res.map(r =>
      `<div>${esc(r.fuer)}: ${esc(span(r))}${r.notiz ? " · " + esc(r.notiz) : ""} <button class="mastorno" data-storno="${esc(r.rid)}" data-id="${esc(m.id)}">stornieren</button></div>`).join("")}</div>` : ""}</div>` : "";
    return `<li class="${out ? (m.aus.baustelle ? "site" : m.aus.extern ? "lent" : mine ? "mine" : "out") : resNow && !forMe(resNow) ? "in resv" : "in"}" data-id="${esc(m.id)}">
      <div class="mainfo"${office() && !inMine ? ' data-hist="1"' : ""}><b>${esc(m.name)}</b>${sub ? `<small>${sub}</small>` : ""}${status}${resLine}${warn}${m.bem && !/^beispiel/i.test(m.bem) ? `<small class="mabem">${esc(m.bem)}</small>` : ""}</div>
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
    $("#maAsk").innerHTML = due.map(m => m.aus.wiederDa
      ? `<section class="card maask"><b>Wieder da? „${esc(m.name)}“</b>
      <div>Reserviert und bei dir bis ${esc(dd(m.aus.frist))} – ist die Maschine wieder im Lager?</div>
      <div class="maaskbtn"><button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Ja, zurückgelegt</button>
      <button class="mabtn take" data-a="bestaetigen" data-id="${esc(m.id)}">Brauche sie noch</button></div></section>`
      : `<section class="card maask"><b>Hast du „${esc(m.name)}“ noch?</b>
      <div>Bei dir seit ${esc(short(m.aus.seit))} (${m.aus.tage} Tage).</div>
      <div class="maaskbtn"><button class="mabtn take" data-a="bestaetigen" data-id="${esc(m.id)}">Ja, noch bei mir</button>
      <button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Nein, zurückgelegt</button></div></section>`).join("");
    // Büro: Erinnerung an überfällige Verleihe (+ was zuletzt erledigt wurde)
    const rem = office() ? all.filter(m => m.aus && m.aus.extern && m.aus.erinnern) : [];
    $("#maRem").innerHTML = rem.map(m => `<section class="card maask"><b>⏰ Wieder da? ${esc(m.name)}</b>
      <div>Verliehen an <b>${esc(m.aus.an)}</b>${m.aus.kontakt ? " (" + esc(m.aus.kontakt) + ")" : ""} durch ${esc(m.aus.wer)} am ${esc(short(m.aus.seit))} – Rückgabe war bis <b>${esc(dd(m.aus.frist))}</b></div>
      <div class="maaskbtn"><button class="mabtn take" data-a="zurueck" data-id="${esc(m.id)}">Ja, ist zurück</button>
      <button class="mabtn back" data-a="erinnern" data-id="${esc(m.id)}">In ${data.erinnerung_tage || 3} Tagen erinnern</button></div></section>`).join("") +
      (office() && data.erledigt && data.erledigt.length ? `<section class="card madone">${data.erledigt.map(e =>
        `<div>✓ <b>${esc(e.name)}</b> von ${esc(e.an)} zurück – eingetragen von ${esc(e.von)}, ${esc(short(e.bis))}</div>`).join("")}</section>` : "");
    if ($("#maLend").innerHTML && !$("#maLend").classList.contains("hide") && $("#mlM")) fillLend();
    // Liste
    const q = norm($("#maQ").value.trim());
    const kats = [...new Set(all.map(m => m.kat))];
    if (kat && !kats.includes(kat)) kat = "";
    $("#maKats").innerHTML = kats.length > 1 ? `<button data-k="" class="${kat ? "" : "on"}">Alle Kategorien</button>` + kats.map(k => {
      const l = all.filter(m => m.kat === k); return `<button data-k="${esc(k)}" class="${k === kat ? "on" : ""}">${esc(k)} <small>${l.filter(m => !m.aus).length}/${l.length}</small></button>`; }).join("") : "";
    const list = all.filter(m => (!kat || q || m.kat === kat) && (filter === "alle" || (filter === "frei" ? !m.aus : !!m.aus)) &&
      (!q || norm([m.name, m.nr, m.typ, m.kat, m.sn, m.aus && m.aus.wer, m.aus && m.aus.an, m.aus && m.aus.kontakt, m.aus && m.aus.baustelle].join(" ")).includes(q)));
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
    const rn = m && (m.res || []).find(r => r.jetzt && norm(r.fuer) !== norm(me()));
    if ((a === "nehmen" || a === "uebernehmen") && rn && !btn.classList.contains("sure2")) {
      btn.classList.add("sure", "sure2"); btn.textContent = "Für " + rn.fuer.split(" ")[0] + " reserviert – trotzdem?";
      setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure", "sure2"); btn.textContent = a === "nehmen" ? "Mitnehmen" : "Übernehmen"; } }, 4000);
      return;
    }
    if (a === "zurueck" && m && m.aus && !isMine(m) && !isLender(m) && !m.aus.baustelle && !btn.closest(".maask") && !btn.classList.contains("sure")) {
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
      toast2({ storno: "Reservierung storniert", baustelle: "Eingetragen", erinnern: `Okay – Erinnerung in ${data.erinnerung_tage || 3} Tagen`, nehmen: name + " mitgenommen", uebernehmen: name + " übernommen", zurueck: name + " zurückgelegt", bestaetigen: m && m.aus && m.aus.wiederDa ? "Okay – bleibt bei dir" : "Danke – wir fragen in 10 Tagen nochmal" }[a] || "Gespeichert");
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
    lend.classList.remove("hide"); $("#maOpts").classList.add("hide");
  }
  function closeLend() { lend.classList.add("hide"); lend.innerHTML = ""; $("#maOpts").classList.remove("hide"); }

  /* ---------- Auf Baustelle gelassen ---------- */
  async function openSite() {
    const mine = (data.maschinen || []).filter(m => isMine(m) || (office() && m.aus && !m.aus.extern && !m.aus.baustelle));
    if (!mine.length) { toast2("Du hast gerade keine Maschine mitgenommen – zuerst „Mitnehmen“ tippen"); return; }
    // Vorschläge: eigene Baustelle laut Wochenplan heute, dann zuletzt benutzte Baustellen
    const sugg = [];
    try {
      const W = AT.wp, t = W.todayIso(), wk = await W.week(t), day = W.dayOf(wk, t), col = wk.ich;
      const ort = day && col && day.e[col];
      if (ort && !W.absence(ort)) sugg.push(ort);
    } catch (e) {}
    for (const b of (data.baustellen || [])) if (!sugg.some(x => norm(x) === norm(b))) sugg.push(b);
    lend.innerHTML = `<div class="malend">
      <label>Maschine</label><select id="msM">${mine.map(m => `<option value="${esc(m.id)}">${esc(m.name)}${m.nr ? " (" + esc(m.nr) + ")" : ""}${isMine(m) ? "" : " – bei " + esc(m.aus.wer)}</option>`).join("")}</select>
      <label>Steht jetzt auf Baustelle</label>
      ${sugg.length ? `<div class="machips mlchips">${sugg.slice(0, 8).map(b => `<button data-b="${esc(b)}">${esc(b)}</button>`).join("")}</div>` : ""}
      <input id="msB" placeholder="z. B. Bochum DRV" autocomplete="off">
      <div class="hint">Danach steht bei der Maschine die Baustelle statt deines Namens. Zurückstellen oder abholen kann dann jeder.</div>
      <button class="bigbtn primary" id="msGo">Eintragen</button>
      <button class="add" id="msX">Abbrechen</button></div>`;
    lend.querySelectorAll(".mlchips button").forEach(b => b.onclick = () => { lend.querySelector("#msB").value = b.dataset.b;
      lend.querySelectorAll(".mlchips button").forEach(x => x.classList.toggle("on", x === b)); });
    lend.querySelector("#msX").onclick = closeLend;
    lend.querySelector("#msGo").onclick = async () => {
      const id = lend.querySelector("#msM").value, baustelle = lend.querySelector("#msB").value.trim();
      if (!baustelle) { lend.querySelector("#msB").focus(); toast2("Bitte die Baustelle angeben"); return; }
      if (!navigator.onLine) { toast2("Keine Internetverbindung"); return; }
      const go = lend.querySelector("#msGo"); go.disabled = true; go.textContent = "Wird gespeichert …";
      try {
        const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "baustelle", id, baustelle }) });
        d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
        const m = d.maschinen.find(x => x.id === id);
        toast2(`${m ? m.name : "Maschine"} steht auf Baustelle ${baustelle}`);
        closeLend(); paint();
      } catch (e) { toast2(e.message); go.disabled = false; go.textContent = "Eintragen"; }
    };
    lend.classList.remove("hide"); $("#maOpts").classList.add("hide");
  }
  $("#maSiteBtn").onclick = () => { if (data) openSite(); else toast2("Liste wird noch geladen"); };

  /* ---------- Reservieren ---------- */
  const isoToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const isoAdd = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const de = iso => iso.split("-").reverse().join(".");
  async function openRes(preId) {
    const all = data.maschinen || [];
    let names = [];
    if (office()) { names = ls.get("at_names") || []; if (!names.length) try { names = (await AT.api("login?liste=1")).namen || []; ls.set("at_names", names); } catch (e) {} }
    const t = isoToday();
    lend.innerHTML = `<div class="malend">
      <label>Maschine</label><select id="mrM">${all.map(m => `<option value="${esc(m.id)}" ${m.id === preId ? "selected" : ""}>${esc(m.name)}${m.nr ? " (" + esc(m.nr) + ")" : ""}</option>`).join("")}</select>
      <div id="mrInfo" class="mrinfo"></div>
      <label>Für</label>
      <div class="machips mlchips mrfor"><button data-f="${esc(me())}" class="on">Mich</button>${((data && data.empfaenger) || []).map(x => `<button data-f="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      ${office() && names.length ? `<select id="mrFP"><option value="">– oder Mitarbeiter wählen –</option>${names.filter(n => norm(n) !== norm(me())).map(n => `<option>${esc(n)}</option>`).join("")}</select>` : ""}
      <input id="mrF" value="${esc(me())}" placeholder="oder Name / Firma eintragen" autocomplete="off">
      <div class="row"><div><label>von</label><input type="date" id="mrV" value="${t}" min="${t}"></div><div><label>bis einschließlich</label><input type="date" id="mrB" value="${t}" min="${t}"></div></div>
      <div class="machips mldays"><button data-q="0">1 Tag</button><button data-q="1">2 Tage</button><button data-q="fr">bis Freitag</button><button data-q="7">1 Woche</button></div>
      <label>Notiz (optional)</label><input id="mrN" placeholder="z. B. Baustelle Bochum" autocomplete="off">
      <button class="bigbtn primary" id="mrGo">Reservieren</button>
      <button class="add" id="mrX">Abbrechen</button>
      <div id="mrMine"></div></div>`;
    const $$ = s => lend.querySelector(s);
    const info = () => {
      const m = all.find(x => x.id === $$("#mrM").value), res = (m && m.res) || [];
      const st = !m ? "" : m.aus ? (m.aus.baustelle ? "steht auf Baustelle " + esc(m.aus.baustelle) : m.aus.extern ? "verliehen an " + esc(m.aus.an) + " bis " + esc(dd(m.aus.frist)) : "gerade bei " + esc(m.aus.wer)) : "im Lager";
      $$("#mrInfo").innerHTML = m ? `Jetzt: <b>${st}</b>${res.length ? `<br>Schon reserviert: ${res.map(r => esc(r.fuer.split(" ")[0]) + " " + esc(span(r))).join(", ")}` : "<br>Noch keine Reservierung."}` : "";
      if ($$("#mrB").value < $$("#mrV").value) $$("#mrB").value = $$("#mrV").value;
      $$("#mrB").min = $$("#mrV").value;
    };
    info();
    $$("#mrM").onchange = info; $$("#mrV").onchange = info; $$("#mrB").onchange = info;
    const markFor = () => lend.querySelectorAll(".mrfor button").forEach(x => x.classList.toggle("on", norm(x.dataset.f) === norm($$("#mrF").value)));
    lend.querySelectorAll(".mrfor button").forEach(b => b.onclick = () => { $$("#mrF").value = b.dataset.f; if ($$("#mrFP")) $$("#mrFP").value = ""; markFor(); });
    if ($$("#mrFP")) $$("#mrFP").onchange = e => { if (e.target.value) { $$("#mrF").value = e.target.value; markFor(); } };
    $$("#mrF").oninput = markFor;
    lend.querySelectorAll(".mldays button").forEach(b => b.onclick = () => {
      const v = $$("#mrV").value || t, q = b.dataset.q, wdv = (new Date(v + "T12:00:00Z").getUTCDay() + 6) % 7;
      $$("#mrB").value = q === "fr" ? isoAdd(v, Math.max(0, 4 - wdv)) : isoAdd(v, +q);
      lend.querySelectorAll(".mldays button").forEach(x => x.classList.toggle("on", x === b)); info();
    });
    // eigene Reservierungen mit Stornieren
    const mineRes = all.flatMap(m => (m.res || []).filter(r => norm(r.fuer) === norm(me()) || norm(r.by) === norm(me())).map(r => ({ m, r })));
    $$("#mrMine").innerHTML = mineRes.length ? `<div class="mrlist"><b>Deine Reservierungen</b>${mineRes.map(({ m, r }) =>
      `<div>${esc(m.name)}: ${esc(span(r))}${norm(r.fuer) !== norm(me()) ? " (für " + esc(r.fuer) + ")" : ""} <button class="mastorno" data-storno="${esc(r.rid)}" data-id="${esc(m.id)}">stornieren</button></div>`).join("")}</div>` : "";
    $$("#mrX").onclick = closeLend;
    $$("#mrGo").onclick = async () => {
      const id = $$("#mrM").value, von = $$("#mrV").value, bis = $$("#mrB").value || von, fuer = $$("#mrF").value.trim();
      if (!id || !von) return;
      if (!fuer) { $$("#mrF").focus(); toast2("Bitte angeben, für wen"); return; }
      if (!navigator.onLine) { toast2("Keine Internetverbindung"); return; }
      const go = $$("#mrGo"); go.disabled = true; go.textContent = "Wird gespeichert …";
      try {
        const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ aktion: "reservieren", id, von: de(von), bis: de(bis), notiz: $$("#mrN").value.trim(), fuer }) });
        d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
        const m = d.maschinen.find(x => x.id === id);
        toast2(`${m ? m.name : "Maschine"} reserviert${norm(fuer) !== norm(me()) ? " für " + fuer : ""} ${von === bis ? "für " + de(von).slice(0, 6) : de(von).slice(0, 6) + " – " + de(bis).slice(0, 6)}`);
        closeLend(); paint();
      } catch (e) { toast2(e.message); go.disabled = false; go.textContent = "Reservieren"; }
    };
    lend.classList.remove("hide"); $("#maOpts").classList.add("hide");
  }
  $("#maResBtn").onclick = () => { if (data) openRes(); else toast2("Liste wird noch geladen"); };
  AT.reserve = id => { AT.tab("maschinen"); if (data) openRes(id); };
  $("#maLendBtn").onclick = () => { if (data) openLend(); else toast2("Liste wird noch geladen"); };

  root.addEventListener("click", async e => {
    const st = e.target.closest(".mastorno");
    if (st) {
      e.stopPropagation();
      if (!st.classList.contains("sure")) { st.classList.add("sure"); st.textContent = "wirklich?"; setTimeout(() => { if (st.isConnected) { st.classList.remove("sure"); st.textContent = "stornieren"; } }, 4000); return; }
      st.disabled = true;
      try {
        const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "storno", id: st.dataset.id, rid: st.dataset.storno }) });
        d.geladen = Date.now(); data = d; ls.set("ma_cache", d); toast2("Reservierung storniert");
        if (st.closest("#mrMine")) openRes(); else paint();
      } catch (err) { toast2(err.message); st.disabled = false; }
      return;
    }
    const b = e.target.closest(".mabtn");
    if (b) { doAct(b); return; }
    const h = e.target.closest(".mainfo[data-hist]");
    if (h) { const id = h.closest("li").dataset.id; open = open === id ? null : id; paint(); }
  });
  $("#maQ").oninput = paint;
  $("#maKats").onclick = e => { const b = e.target.closest("button"); if (!b) return; kat = b.dataset.k; ls.set("ma_kat", kat); paint(); };
  root.querySelectorAll(".machips button").forEach(b => b.onclick = () => {
    filter = b.dataset.f; root.querySelectorAll(".machips button").forEach(x => x.classList.toggle("on", x === b)); paint();
  });
  $("#maReload").onclick = () => load(true).then(() => !offline && toast2("Aktualisiert"));

  /* ---------- QR-Code scannen: passende Frage je nach Status ---------- */
  const scanBox = $("#maScan");
  const vorname = n => String(n || "").split(" ")[0];
  const deIso = s => { const m = String(s || "").match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };
  const isoHeute = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const isoPlus = n => { const d = new Date(isoHeute() + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function scanZu() { scanBox.innerHTML = ""; }

  async function scanStart() {
    const code = await AT.qr.scan("QR-Code der Maschine scannen");
    if (!code) return;
    scanBox.innerHTML = `<section class="card maask"><div class="hint" style="margin:0">Wird gesucht …</div></section>`;
    let r;
    try { r = await AT.qr.suchen(code); } catch (e) { scanBox.innerHTML = `<section class="card maask"><div class="warn">${esc(navigator.onLine ? e.message : "Keine Internetverbindung")}</div></section>`; return; }
    zeigeScan(code, r);
  }

  // code + Ergebnis von /api/qr?code=… (r) → Frage anzeigen
  async function zeigeScan(code, r) {
    if (!data || !data.maschinen) await load(true);
    const z = r && r.zuordnung;
    const m = z && z.art === "maschine" && data && (data.maschinen || []).find(x => x.id === z.ziel);
    const kopf = t => `<section class="card maask" id="maScanCard"><button class="add" id="msZu" style="float:right;width:auto;margin:0;padding:4px 10px">✕</button>${t}</section>`;
    if (!m) {
      const frei = !z;
      scanBox.innerHTML = kopf(frei
        ? `<b>Dieser QR-Code ist keiner Maschine zugeordnet.</b><div class="hint" style="margin:6px 0 0">Gelesen: <span class="qrcode">${esc(code)}</span></div>
          ${AT.darf("qr") && data ? `<label>Maschine zuordnen</label><select id="msZiel"><option value="">– Maschine wählen –</option>${(data.maschinen || []).map(x =>
            `<option value="${esc(x.id)}">${esc(x.name)}${x.nr ? " (" + esc(x.nr) + ")" : ""}</option>`).join("")}</select>
          <button class="bigbtn primary" id="msZuord" style="margin-top:10px">Zuordnen</button>` : `<div class="hint">Zuordnen kann das Büro unter Allgemeines → QR-Codes.</div>`}`
        : z.art === "maschine"
        ? `<b>Die Maschine zu diesem Code ist nicht mehr in der Liste.</b><div class="hint" style="margin:6px 0 0">${esc(z.bezeichnung || z.ziel)}</div>`
        : `<b>Dieser Code gehört nicht zu einer Maschine.</b><div class="hint" style="margin:6px 0 0">${esc(AT.qr.ART[z.art] || "")}: ${esc(z.bezeichnung || z.ziel)}</div>`);
      bindScan(code, null);
      return;
    }
    // Status + Reservierungen der nächsten 7 Tage
    const a = m.aus, mine = isMine(m);
    const status = !a ? "steht im Lager" : a.baustelle ? `steht auf Baustelle <b>${esc(a.baustelle)}</b>` : a.extern
      ? `ist verliehen an <b>${esc(a.an)}</b>${a.kontakt ? " (" + esc(a.kontakt) + ")" : ""}` : mine ? "ist bei <b>dir</b>" : `ist bei <b>${esc(a.wer)}</b>`;
    const bis = isoPlus(7);
    const res = (m.res || []).filter(x => { const v = deIso(x.von); return v && v <= bis; });
    const forMe = x => norm(x.fuer) === norm(me());
    const fremd = res.find(x => !forMe(x));
    const warnt = fremd && (!a || a.baustelle || !mine);   // dann steht die fremde Reservierung in der Warnung unten
    const resText = res.filter(x => forMe(x) || !warnt).map(x => `<div class="${forMe(x) ? "" : "mawarn"}" style="margin-top:6px">📅 ${x.jetzt ? "Heute" : "Ab " + esc(String(x.von).slice(0, 6))} reserviert für <b>${forMe(x) ? "dich" : esc(x.fuer)}</b>${x.bis && x.bis !== x.von ? " bis " + esc(String(x.bis).slice(0, 6)) : ""}${x.notiz ? " · " + esc(x.notiz) : ""}</div>`).join("");
    let frage, knoepfe;
    const k = (akt, text, cls) => `<button class="mabtn ${cls}" data-sa="${akt}">${text}</button>`;
    if (!a) { frage = "Ausleihen?"; knoepfe = k("nehmen", "Ja, ausleihen", "take") + k("", "Nein", "back"); }
    else if (a.baustelle) { frage = "Mitnehmen oder zurück ins Lager?"; knoepfe = k("nehmen", "Mitnehmen", "take") + k("zurueck", "Ins Lager zurück", "back"); }
    else if (a.extern) { frage = `Rückgabe von ${esc(a.an)}?`; knoepfe = k("zurueck", "Ja, ist zurück im Lager", "take") + k("", "Nein", "back"); }
    else if (mine) { frage = "Zurückgeben?"; knoepfe = k("zurueck", "Ja, zurückgeben", "take") + k("", "Nein, behalte sie", "back"); }
    else { frage = `${esc(vorname(a.wer))} hat sie – was möchtest du tun?`; knoepfe = k("zurueck", `Rückgabe für ${esc(vorname(a.wer))}`, "back") + k("uebernehmen", "Übernehmen (ich nehme sie)", "over"); }
    // wer ausleiht, obwohl jemand anderes in den nächsten Tagen reserviert hat: deutlich warnen
    const warnAus = warnt ? `<div class="warn" style="margin-top:8px">Achtung: ${fremd.jetzt ? "heute" : "ab " + esc(String(fremd.von).slice(0, 6))} für ${esc(fremd.fuer)} reserviert – bitte vorher absprechen.</div>` : "";
    scanBox.innerHTML = kopf(`<b style="font-size:17px">${esc(m.name)}</b>${m.nr ? `<small style="display:block;color:var(--mut)">Nr. ${esc(m.nr)}${m.typ ? " · " + esc(m.typ) : ""}</small>` : ""}
      <div style="margin-top:6px">Die Maschine ${status}.</div>${resText}${warnAus}
      <div style="margin-top:10px;font-weight:700">${frage}</div>
      <div class="maaskbtn">${knoepfe}</div>`);
    bindScan(code, m);
    root.scrollIntoView({ block: "start" }); window.scrollTo(0, 0);
  }

  function bindScan(code, m) {
    const x = scanBox.querySelector("#msZu"); if (x) x.onclick = scanZu;
    const zo = scanBox.querySelector("#msZuord");
    if (zo) zo.onclick = async () => {
      const id = scanBox.querySelector("#msZiel").value, mm = (data.maschinen || []).find(y => y.id === id);
      if (!mm) { toast2("Bitte Maschine wählen"); return; }
      zo.disabled = true;
      try {
        await AT.api("qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "zuordnen", code, art: "maschine", ziel: id, bezeichnung: mm.name + (mm.nr ? ` (${mm.nr})` : "") }) });
        toast2("QR-Code zugeordnet ✓");
        zeigeScan(code, await AT.qr.suchen(code));
      } catch (e) { toast2(e.message); zo.disabled = false; }
    };
    scanBox.querySelectorAll("[data-sa]").forEach(b => b.onclick = async e => {
      e.stopPropagation();   // nicht zusätzlich die normale Liste-Aktion (doAct) auslösen
      const a = b.dataset.sa;
      if (!a) { scanZu(); return; }
      if (!navigator.onLine) { toast2("Keine Internetverbindung – bitte später nochmal"); return; }
      scanBox.querySelectorAll("[data-sa]").forEach(y => { y.disabled = true; }); b.textContent = "…";
      try {
        const d = await AT.api("maschinen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: a, id: m.id, scan: true }) });
        d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
        toast2({ nehmen: m.name + " ausgeliehen ✓", zurueck: m.name + " zurückgegeben ✓", uebernehmen: m.name + " übernommen ✓" }[a] || "Gespeichert");
        scanZu(); paint();
      } catch (e) { toast2(e.message); await load(true); zeigeScan(code, { code, zuordnung: { art: "maschine", ziel: m.id } }); }
    });
  }
  $("#maScanBtn").onclick = scanStart;
  AT.maschineScan = (code, r) => zeigeScan(code, r);

  AT.modules.maschinen = { show() { paint(); load(); } };
  // Beim Start im Hintergrund prüfen, ob eine Nachfrage fällig ist – dann Hinweis auf dem Reiter
  AT.checkMaschinen = async () => {
    try {
      const d = await AT.api("maschinen"); d.geladen = Date.now(); data = d; ls.set("ma_cache", d);
      const due = (d.maschinen || []).some(m => (isMine(m) && m.aus.faellig) || (office() && m.aus && m.aus.extern && m.aus.erinnern));
      const t = document.querySelector('#tabs button[data-tab="maschinen"]');
      if (t) t.classList.toggle("dot", due);
      // Hinweis erscheint auf der Startseite – hier nur der rote Punkt am Reiter
      paint();
    } catch (e) {}
  };
})();
