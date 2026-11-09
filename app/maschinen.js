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
    <div id="maAsk"></div>
    <section class="card hide" id="maMineCard"><h2>Bei dir</h2><ul class="malist" id="maMine"></ul></section>
    <section class="card">
      <h2>Maschinen</h2>
      <input id="maQ" type="search" placeholder="Suchen (Name, Nr., Monteur) …" autocomplete="off">
      <div class="machips"><button data-f="alle" class="on">Alle</button><button data-f="frei">Im Lager</button><button data-f="weg">Unterwegs</button></div>
      <div class="wptools" style="margin:6px 0 0"><span id="maState"></span><button id="maReload">⟳ aktualisieren</button></div>
      <div id="maList"><div class="hint">Wird geladen …</div></div>
    </section>`;
  const $ = s => root.querySelector(s);
  let data = ls.get("ma_cache"), filter = "alle", busy = false, offline = false, open = null;
  const me = () => (AT.user && AT.user.name) || "";
  const isMine = m => m.aus && norm(m.aus.wer) === norm(me());
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
    if (!out) btn = `<button class="mabtn take" data-a="nehmen" data-id="${esc(m.id)}">Mitnehmen</button>`;
    else if (mine) btn = `<button class="mabtn back" data-a="zurueck" data-id="${esc(m.id)}">Zurücklegen</button>`;
    else btn = `<button class="mabtn over" data-a="uebernehmen" data-id="${esc(m.id)}">Übernehmen</button>` +
      (office() ? `<button class="mabtn back small" data-a="zurueck" data-id="${esc(m.id)}">Ist zurück</button>` : "");
    const status = out
      ? `<span class="mast out">${mine ? "bei dir" : "bei " + esc(m.aus.wer)} · seit ${esc(short(m.aus.seit))}${m.aus.faellig && (mine || office()) ? ` <b class="mafaellig">${m.aus.tage} Tage</b>` : ""}</span>`
      : `<span class="mast in">im Lager</span>`;
    const sub = [m.nr, m.typ].filter(Boolean).map(esc).join(" · ");
    const hist = office() && open === m.id && m.verlauf ? `<div class="mahist">${m.verlauf.length ? m.verlauf.map(v =>
      `<div><b>${esc(v.wer)}</b> ${esc(short(v.von))} → ${v.bis ? esc(short(v.bis)) : "<i>noch unterwegs</i>"}${v.bem ? ` <small>(${esc(v.bem)})</small>` : ""}</div>`).join("") : "<div>Noch keine Ausleihe.</div>"}</div>` : "";
    return `<li class="${out ? (mine ? "mine" : "out") : "in"}" data-id="${esc(m.id)}">
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
    // Liste
    const q = norm($("#maQ").value.trim());
    const list = all.filter(m => (filter === "alle" || (filter === "frei" ? !m.aus : !!m.aus)) &&
      (!q || norm([m.name, m.nr, m.typ, m.kat, m.sn, m.aus && m.aus.wer].join(" ")).includes(q)));
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
    if (a === "zurueck" && m && m.aus && !isMine(m) && !btn.classList.contains("sure")) {
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
      toast2({ nehmen: name + " mitgenommen", uebernehmen: name + " übernommen", zurueck: name + " zurückgelegt", bestaetigen: "Danke – wir fragen in 10 Tagen nochmal" }[a] || "Gespeichert");
    } catch (e) {
      toast2(e.message);
      await load(true);
    } finally { busy = false; paint(); }
  }

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
      const due = (d.maschinen || []).some(m => isMine(m) && m.aus.faellig);
      const t = document.querySelector('#tabs button[data-tab="maschinen"]');
      if (t) t.classList.toggle("dot", due);
      if (due) toast2("Bitte kurz bestätigen: Hast du deine Maschine noch? → Reiter Maschinen");
      paint();
    } catch (e) {}
  };
})();
