/* Airtec App – Modul „Krankmeldung“ (nur Büro): Monteur krank melden und den Tag neu einteilen.
   Tagesbrett mit allen Baustellen; Monteur antippen → Ziel antippen = umsetzen. Baustellen streichen / neu anlegen.
   Erst „Speichern“ schreibt die Änderungen in die Google-Tabelle (alter Eintrag des Kranken bleibt als Zellnotiz). */
(function () {
  const AT = window.AT, W = AT.wp;
  if (!W) return;
  const { esc, norm, todayIso, WT, wd, dShort } = W;
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const root = document.getElementById("wpView");

  const btnCard = document.createElement("section");
  btnCard.className = "card krcard hide";
  btnCard.innerHTML = `<button class="bigbtn krbtn" id="krOpen">🤒 Krankmeldung / Tag umplanen</button>`;
  root.querySelector(".wptools").after(btnCard);

  const view = document.createElement("main");
  view.id = "krView"; view.className = "hide";
  document.body.insertBefore(view, document.getElementById("maView"));

  let st = null;          // { day, data, sick, orig:{name:val}, cur:{name:val}, extra:[orte], sel }
  const OFF = "__frei__", SICK = "__krank__";

  const label = s => WT[wd(s)] + ", " + dShort(s) + (s === todayIso() ? " (heute)" : "");

  async function open(day) {
    day = day || todayIso();
    view.innerHTML = `<section class="card"><div class="hint">Wird geladen …</div></section>`;
    show(true);
    try {
      const data = await W.week(day, true);
      const t = W.dayOf(data, day);
      const orig = {};
      for (const n of data.spalten || []) orig[n] = (t && t.e[n]) || "";
      st = { day, data, sick: [], orig, cur: { ...orig }, extra: [], gone: [], sel: null, notes: {} };
      paint();
    } catch (e) {
      view.innerHTML = `<section class="card"><div class="lerr">${esc(e.message)}</div><button class="add" id="krX">Zurück</button></section>`;
      view.querySelector("#krX").onclick = () => show(false);
    }
  }

  function show(on) {
    view.classList.toggle("hide", !on);
    root.classList.toggle("hide", on);
    window.scrollTo(0, 0);
  }

  // aktueller Stand → Gruppen
  function groups() {
    const teams = new Map(), abs = [], free = [], sick = [];
    for (const o of st.extra) teams.set(norm(o), { ort: o, leute: [] });
    for (const n of st.data.spalten || []) {
      const v = st.cur[n];
      if (st.sick.includes(n)) { sick.push(n); continue; }
      if (!v) { free.push(n); continue; }
      const a = W.absence(v);
      if (a) { abs.push({ n, v }); continue; }
      const k = norm(v);
      if (!teams.has(k)) teams.set(k, { ort: v, leute: [] });
      teams.get(k).leute.push(n);
    }
    // gestrichene Baustellen nicht mehr zeigen, außer es ist wieder jemand drin
    for (const k of st.gone) if (teams.has(k) && !teams.get(k).leute.length) teams.delete(k);
    return { teams: [...teams.values()], abs, free, sick };
  }

  const chip = n => `<button class="krchip${st.sel === n ? " sel" : ""}${st.cur[n] !== st.orig[n] || st.sick.includes(n) ? " moved" : ""}" data-n="${esc(n)}">${esc(n)}</button>`;

  function changes() {
    const list = [];
    for (const n of st.data.spalten || []) {
      if (st.sick.includes(n)) {
        if (W.absence(st.orig[n]) !== "Krank") list.push({ name: n, von: st.orig[n], nach: "Krank" });
      } else if ((st.cur[n] || "") !== (st.orig[n] || "")) list.push({ name: n, von: st.orig[n], nach: st.cur[n] || "" });
    }
    return list;
  }

  function paint() {
    const G = groups(), ch = changes();
    const names = st.data.spalten || [];
    view.innerHTML = `
      <section class="card krhead">
        <h2>Krankmeldung</h2>
        <div class="row"><div><label>Tag</label><input type="date" id="krDay" value="${st.day}"></div>
        <div><label>Krank gemeldet</label><select id="krWho"><option value="">– Monteur wählen –</option>${names.filter(n => !st.sick.includes(n)).map(n => `<option>${esc(n)}</option>`).join("")}</select></div></div>
        <div class="hint">${label(st.day)} · Monteur antippen, dann die Baustelle, zu der er soll.</div>
      </section>
      <div class="krhint${st.sel ? "" : " hide"}" id="krSelHint">${st.sel ? `<b>${esc(st.sel)}</b> ausgewählt – jetzt Ziel antippen <button id="krDesel">✕</button>` : ""}</div>
      ${G.sick.length ? `<section class="card krzone krsick" data-to="${SICK}"><h3>🤒 Krank</h3><div class="krchips">${G.sick.map(chip).join("")}</div></section>` : ""}
      ${G.teams.map(t => {
        const n = t.leute.length, off = /^(buro|buero|werkstatt|lager)$/.test(norm(t.ort));
        const was = names.filter(x => st.orig[x] && norm(st.orig[x]) === norm(t.ort));
        const lost = was.filter(x => !t.leute.includes(x));
        return `<section class="card krzone${off ? "" : n === 0 ? " empty" : n === 1 ? " alone" : ""}" data-to="${esc(t.ort)}">
          <div class="krtop"><h3>${esc(t.ort)}</h3><span class="krbadge">${off ? n : n === 0 ? "unbesetzt" : n === 1 ? "allein" : n + " Monteure"}</span></div>
          <div class="krchips">${t.leute.map(chip).join("") || '<span class="krempty">niemand</span>'}</div>
          ${lost.length ? `<div class="krlost">vorher auch: ${lost.map(esc).join(", ")}</div>` : ""}
          ${off ? "" : `<button class="krdel" data-del="${esc(t.ort)}">Baustelle für den Tag streichen</button>`}
        </section>`;
      }).join("")}
      <button class="add" id="krNew">+ weitere Baustelle</button>
      <section class="card krzone krfree" data-to="${OFF}"><h3>Nicht eingeplant</h3><div class="krchips">${G.free.map(chip).join("") || '<span class="krempty">niemand</span>'}</div></section>
      ${G.abs.length ? `<section class="card krabs"><h3>Abwesend</h3>${G.abs.map(a => `<div><b>${esc(a.n)}</b> – ${esc(a.v)}</div>`).join("")}</section>` : ""}
      <section class="card krsave">
        <h3>Änderungen (${ch.length})</h3>
        ${ch.length ? `<ul class="krlist">${ch.map(c => `<li><b>${esc(c.name)}</b>: ${esc(c.von || "–")} → <b>${esc(c.nach || "nicht eingeplant")}</b></li>`).join("")}</ul>` : '<div class="hint" style="margin-top:0">Noch keine Änderungen.</div>'}
        <button class="bigbtn primary" id="krSave" ${ch.length ? "" : "disabled"}>In Wochenplan speichern</button>
        <div class="krrow"><button class="add" id="krReset">Zurücksetzen</button><button class="add" id="krClose">Schließen</button></div>
      </section>`;
    bind();
  }

  function moveTo(n, to) {
    st.sick = st.sick.filter(x => x !== n);
    if (to === SICK) st.sick.push(n);
    else if (to === OFF) st.cur[n] = "";
    else { st.cur[n] = to; st.gone = st.gone.filter(k => k !== norm(to)); }
    st.sel = null;
    paint();
  }

  function bind() {
    const $ = s => view.querySelector(s);
    $("#krDay").onchange = e => {
      if (changes().length && !confirm("Ungespeicherte Änderungen verwerfen?")) { e.target.value = st.day; return; }
      if (e.target.value) open(e.target.value);
    };
    $("#krWho").onchange = e => {
      const n = e.target.value; if (!n) return;
      st.notes[n] = st.orig[n];
      st.sick.push(n); st.sel = null; paint();
      toast2(`${n} ist krank – jetzt die Teams neu einteilen`);
    };
    if ($("#krDesel")) $("#krDesel").onclick = () => { st.sel = null; paint(); };
    view.querySelectorAll(".krchip").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const n = b.dataset.n;
      st.sel = st.sel === n ? null : n; paint();
    });
    view.querySelectorAll(".krzone").forEach(z => z.onclick = e => {
      if (!st.sel || e.target.closest(".krdel")) return;
      moveTo(st.sel, z.dataset.to);
    });
    view.querySelectorAll(".krdel").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const o = b.dataset.del;
      if (b.classList.contains("sure")) {
        for (const n of st.data.spalten || []) if (!st.sick.includes(n) && norm(st.cur[n]) === norm(o)) st.cur[n] = "";
        st.extra = st.extra.filter(x => norm(x) !== norm(o));
        st.gone.push(norm(o)); st.sel = null; paint();
        toast2(`${o} gestrichen – Monteure stehen jetzt unter „Nicht eingeplant“`);
      } else {
        b.classList.add("sure"); b.textContent = "Wirklich streichen?";
        setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Baustelle für den Tag streichen"; } }, 4000);
      }
    });
    $("#krNew").onclick = () => {
      const o = (prompt("Name der Baustelle") || "").trim();
      if (!o) return;
      if (!st.extra.some(x => norm(x) === norm(o))) st.extra.push(o);
      st.gone = st.gone.filter(k => k !== norm(o));
      if (st.sel) moveTo(st.sel, o); else paint();
    };
    $("#krReset").onclick = () => { st.cur = { ...st.orig }; st.sick = []; st.extra = []; st.gone = []; st.sel = null; paint(); };
    $("#krClose").onclick = () => {
      if (changes().length && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
      show(false); AT.modules.wochenplan.show();
    };
    $("#krSave").onclick = async () => {
      const ch = changes(); if (!ch.length) return;
      const btn = $("#krSave"); btn.disabled = true; btn.textContent = "Wird gespeichert …";
      const stamp = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
      const list = ch.map(c => {
        const a = { datum: st.day, name: c.name, wert: c.nach };
        if (c.nach === "Krank") a.notiz = (c.von ? `vorher: ${c.von} – ` : "") + `Krank gemeldet von ${AT.user.name} am ${stamp}`;
        return a;
      });
      try {
        await AT.api("plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aenderungen: list }) });
        W.forget(st.day);
        toast2(`${list.length} Änderung${list.length === 1 ? "" : "en"} gespeichert`);
        show(false);
        await W.refresh();
      } catch (e) {
        toast2(e.message); btn.disabled = false; btn.textContent = "In Wochenplan speichern";
      }
    };
  }

  btnCard.querySelector("#krOpen").onclick = () => open(W.cur);
  const prev = AT.modules.wochenplan.show;
  AT.modules.wochenplan.show = function () {
    btnCard.classList.toggle("hide", !(AT.user && AT.user.schreiben));
    if (!view.classList.contains("hide")) return;   // Brett ist offen → nicht überschreiben
    return prev.apply(this, arguments);
  };
  // Beim Wechsel auf andere Reiter das Brett schließen
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.tab !== "wochenplan" && !view.classList.contains("hide")) { view.classList.add("hide"); root.classList.remove("hide"); }
  }));
})();
