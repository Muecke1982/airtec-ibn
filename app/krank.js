/* Airtec App – Modul „Änderungen“ (nur Büro): einen Tag im Wochenplan schnell neu einteilen.
   Tagesbrett mit allen Baustellen; Monteur antippen → Ziel antippen = umsetzen (auch auf „Krank“).
   Baustellen streichen / neu anlegen / zweite Baustelle für ein Team. Tage mit ‹ › wechseln.
   Erst „Speichern“ schreibt in die Google-Tabelle (bei „Krank“ bleibt der alte Eintrag als Zellnotiz). */
(function () {
  const AT = window.AT, W = AT.wp;
  if (!W) return;
  const { esc, norm, todayIso, WT, wd, dShort, addDays } = W;
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const root = document.getElementById("wpView");

  const btnCard = document.createElement("section");
  btnCard.className = "card krcard hide";
  btnCard.innerHTML = `<button class="bigbtn krbtn" id="krOpen">✏️ Änderungen</button>`;
  root.querySelector(".wptools").after(btnCard);

  const view = document.createElement("main");
  view.id = "krView"; view.className = "hide";
  document.body.insertBefore(view, document.getElementById("maView"));

  let st = null;   // { day, data, orig:{name:val}, cur:{name:val}, extra:[orte], gone:[keys], sel }
  const OFF = "__frei__", SICK = "__krank__", KRANK = "Krank";
  // feste Abwesenheits-Felder unten auf dem Brett: Ziel-Kennung → Eintrag in der Tabelle
  const FIX = [[SICK, "Krank", "🤒", "krsick"], ["__urlaub__", "Urlaub", "🌴", "krvac"], ["__freitag__", "Frei", "🏠", "krdayoff"]];
  const fixOf = v => { const a = W.absence(v); return FIX.find(f => f[1] === a) || null; };

  // gesetzliche Feiertage NRW (inkl. Ostern-abhängige)
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mon = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return `${y}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function holiday(iso) {
    const y = +iso.slice(0, 4), md = iso.slice(5), E = easter(y);
    const fix = { "01-01": "Neujahr", "05-01": "Tag der Arbeit", "10-03": "Tag der Deutschen Einheit", "11-01": "Allerheiligen", "12-25": "1. Weihnachtstag", "12-26": "2. Weihnachtstag" };
    if (fix[md]) return fix[md];
    const rel = { "-2": "Karfreitag", "1": "Ostermontag", "39": "Christi Himmelfahrt", "50": "Pfingstmontag", "60": "Fronleichnam" };
    for (const k in rel) if (addDays(E, +k) === iso) return rel[k];
    return "";
  }
  W.holiday = holiday;
  const isSick = v => W.absence(v) === "Krank";
  const isOffice = o => /^(buro|buero|werkstatt|lager)$/.test(norm(o));
  const label = s => WT[wd(s)] + ", " + dShort(s) + (s === todayIso() ? " · heute" : "");

  async function open(day) {
    day = day || todayIso();
    show(true);
    if (!st) view.innerHTML = `<section class="card"><div class="hint">Wird geladen …</div></section>`;
    try {
      const data = await W.week(day, true);
      const t = W.dayOf(data, day);
      const orig = {};
      for (const n of data.spalten || []) orig[n] = (t && t.e[n]) || "";
      st = { day, data, orig, cur: { ...orig }, extra: [], gone: [], sel: null, fehlt: data.fehlt };
      paint();
    } catch (e) {
      view.innerHTML = `<section class="card"><div class="lerr">${esc(e.message)}</div><button class="add" id="krX">Zurück</button></section>`;
      view.querySelector("#krX").onclick = () => show(false);
    }
  }

  function show(on) {
    view.classList.toggle("hide", !on);
    root.classList.toggle("hide", on);
    if (on) window.scrollTo(0, 0);
  }

  function groups() {
    const teams = new Map(), abs = [], free = [], fixed = {};
    FIX.forEach(f => fixed[f[0]] = []);
    for (const o of st.extra) teams.set(norm(o), { ort: o, leute: [] });
    for (const n of st.data.spalten || []) {
      const v = st.cur[n];
      if (!v) { free.push(n); continue; }
      const fx = fixOf(v);
      if (fx) { fixed[fx[0]].push(n); continue; }
      if (W.absence(v)) { abs.push({ n, v }); continue; }
      const k = norm(v);
      if (!teams.has(k)) teams.set(k, { ort: v, leute: [] });
      teams.get(k).leute.push(n);
    }
    for (const k of st.gone) if (teams.has(k) && !teams.get(k).leute.length) teams.delete(k);
    return { teams: [...teams.values()], abs, free, fixed };
  }

  function changes() {
    return (st.data.spalten || []).filter(n => (st.cur[n] || "") !== (st.orig[n] || ""))
      .map(n => ({ name: n, von: st.orig[n] || "", nach: st.cur[n] || "" }));
  }

  const chip = n => `<button class="krchip${st.sel === n ? " sel" : ""}${(st.cur[n] || "") !== (st.orig[n] || "") ? " moved" : ""}" data-n="${esc(n)}">${esc(n)}</button>`;

  function paint() {
    const G = groups(), ch = changes(), names = st.data.spalten || [], hol = holiday(st.day);
    view.innerHTML = `
      <section class="card krhead">
        <h2>Änderungen</h2>
        <div class="wpnav krnav">
          <button id="krPrev" aria-label="Tag zurück">‹</button>
          <label class="wpday"><b>${esc(WT[wd(st.day)] + ", " + dShort(st.day))}</b><small>${st.day === todayIso() ? "heute · " : ""}KW ${W.isoWeek(st.day).week} · Datum wählen</small><input type="date" id="krDay" value="${st.day}"></label>
          <button id="krNext" aria-label="Tag vor">›</button>
        </div>
        <div class="hint">Monteur antippen, dann das Ziel antippen – eine Baustelle, „Nicht eingeplant“, „Krank“, „Urlaub“ oder „Frei“.</div>
        ${hol ? `<div class="krhol">🎉 Feiertag: <b>${esc(hol)}</b>${names.some(n => W.absence(st.cur[n]) !== "Feiertag") ? `<button class="krholbtn" id="krHol">Alle auf „Feiertag“ setzen</button>` : ""}</div>` : ""}
      </section>
      ${st.fehlt ? `<section class="card"><div class="lerr">Für KW ${st.data.kw} gibt es noch kein Blatt in der Tabelle.</div></section>` : ""}
      <div class="krhint${st.sel ? "" : " hide"}">${st.sel ? `<b>${esc(st.sel)}</b> ausgewählt – jetzt Ziel antippen <button id="krDesel">✕</button>` : ""}</div>
      ${G.teams.map(t => {
        const n = t.leute.length, off = isOffice(t.ort);
        const lost = names.filter(x => st.orig[x] && norm(st.orig[x]) === norm(t.ort) && !t.leute.includes(x));
        return `<section class="card krzone${off ? "" : n === 0 ? " empty" : n === 1 ? " alone" : ""}" data-to="${esc(t.ort)}">
          <div class="krtop"><h3>${esc(t.ort)}</h3><span class="krbadge">${off ? n : n === 0 ? "unbesetzt" : n === 1 ? "allein" : n + " Monteure"}</span></div>
          <div class="krchips">${t.leute.map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div>
          ${lost.length ? `<div class="krlost">vorher auch: ${lost.map(esc).join(", ")}</div>` : ""}
          ${off ? "" : `<div class="kracts"><button class="krlink" data-add="${esc(t.ort)}">+ weitere Baustelle am selben Tag</button><button class="krdel" data-del="${esc(t.ort)}">Baustelle streichen</button></div>`}
        </section>`;
      }).join("")}
      <button class="add" id="krNew">+ neue Baustelle</button>
      <section class="card krzone krfree" data-to="${OFF}"><h3>Nicht eingeplant</h3><div class="krchips">${G.free.map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div></section>
      ${FIX.map(([to, name, ic, cls]) => `<section class="card krzone ${cls}" data-to="${to}"><h3>${ic} ${name}</h3><div class="krchips">${G.fixed[to].map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div></section>`).join("")}
      ${G.abs.length ? `<section class="card krabs"><h3>Abwesend</h3><div class="krchips">${G.abs.map(a => `<button class="krchip abs${st.sel === a.n ? " sel" : ""}" data-n="${esc(a.n)}">${esc(a.n)} <small>${esc(a.v)}</small></button>`).join("")}</div></section>` : ""}
      <section class="card krsave">
        <h3>Änderungen (${ch.length})</h3>
        ${ch.length ? `<ul class="krlist">${ch.map(c => `<li><b>${esc(c.name)}</b>: ${esc(c.von || "–")} → <b>${esc(c.nach || "nicht eingeplant")}</b></li>`).join("")}</ul>` : '<div class="hint" style="margin-top:0">Noch keine Änderungen.</div>'}
        <button class="bigbtn primary" id="krSave" ${ch.length ? "" : "disabled"}>In Wochenplan speichern</button>
        <div class="krrow"><button class="add" id="krReset">Zurücksetzen</button><button class="add" id="krClose">Schließen</button></div>
      </section>`;
    bind();
  }

  function moveTo(n, to) {
    const fx = FIX.find(f => f[0] === to);
    if (fx) st.cur[n] = fx[1];
    else if (to === OFF) st.cur[n] = "";
    else { st.cur[n] = to; st.gone = st.gone.filter(k => k !== norm(to)); }
    st.sel = null;
    paint();
  }

  async function save() {
    const ch = changes(); if (!ch.length) return true;
    const stamp = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    const list = ch.map(c => {
      const a = { datum: st.day, name: c.name, wert: c.nach };
      const fx = fixOf(c.nach);
      if (fx && (!fixOf(c.von) || fixOf(c.von)[1] !== fx[1]))
        a.notiz = (c.von ? `vorher: ${c.von} – ` : "") + (fx[1] === "Krank" ? "Krank gemeldet" : fx[1] + " eingetragen") + ` von ${AT.user.name} am ${stamp}`;
      return a;
    });
    await AT.api("plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aenderungen: list }) });
    W.forget(st.day);
    toast2(`${list.length} Änderung${list.length === 1 ? "" : "en"} gespeichert`);
    return true;
  }

  // Tag wechseln: bei ungespeicherten Änderungen erst fragen
  async function goDay(day) {
    if (changes().length) {
      if (!confirm(`Änderungen für ${label(st.day)} speichern?\n\nOK = speichern und weiter · Abbrechen = hierbleiben`)) return;
      try { await save(); } catch (e) { toast2(e.message); return; }
    }
    open(day);
  }
  const stepDay = dir => { let s = st.day; do { s = addDays(s, dir); } while (wd(s) >= 5); goDay(s); };

  function bind() {
    const $ = s => view.querySelector(s);
    $("#krPrev").onclick = () => stepDay(-1);
    $("#krNext").onclick = () => stepDay(1);
    $("#krDay").onchange = e => { if (e.target.value && e.target.value !== st.day) goDay(e.target.value); else e.target.value = st.day; };
    if ($("#krDesel")) $("#krDesel").onclick = () => { st.sel = null; paint(); };
    if ($("#krHol")) $("#krHol").onclick = () => { for (const n of st.data.spalten || []) st.cur[n] = "Feiertag"; st.sel = null; paint(); toast2("Alle auf „Feiertag“ gesetzt – zum Übernehmen speichern"); };
    view.querySelectorAll(".krchip").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const n = b.dataset.n;
      st.sel = st.sel === n ? null : n; paint();
    });
    view.querySelectorAll(".krzone").forEach(z => z.onclick = e => {
      if (!st.sel || e.target.closest(".kracts")) return;
      moveTo(st.sel, z.dataset.to);
    });
    view.querySelectorAll(".krdel").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const o = b.dataset.del;
      if (b.classList.contains("sure")) {
        for (const n of st.data.spalten || []) if (norm(st.cur[n]) === norm(o)) st.cur[n] = "";
        st.extra = st.extra.filter(x => norm(x) !== norm(o));
        st.gone.push(norm(o)); st.sel = null; paint();
        toast2(`${o} gestrichen – Monteure stehen unter „Nicht eingeplant“`);
      } else {
        b.classList.add("sure"); b.textContent = "Wirklich streichen?";
        setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Baustelle streichen"; } }, 4000);
      }
    });
    // zweite Baustelle für dieses Team am selben Tag: Eintrag wird z. B. „Bochum / Münster“
    view.querySelectorAll(".krlink").forEach(b => b.onclick = e => {
      e.stopPropagation();
      const o = b.dataset.add;
      const add = (prompt(`Weitere Baustelle für das Team „${o}“ am selben Tag:`) || "").trim();
      if (!add) return;
      const neu = o + " / " + add;
      for (const n of st.data.spalten || []) if (norm(st.cur[n]) === norm(o)) st.cur[n] = neu;
      if (st.extra.some(x => norm(x) === norm(o))) st.extra = st.extra.map(x => norm(x) === norm(o) ? neu : x);
      st.sel = null; paint();
    });
    $("#krNew").onclick = () => {
      const o = (prompt("Name der neuen Baustelle") || "").trim();
      if (!o) return;
      if (!st.extra.some(x => norm(x) === norm(o))) st.extra.push(o);
      st.gone = st.gone.filter(k => k !== norm(o));
      if (st.sel) moveTo(st.sel, o); else paint();
    };
    $("#krReset").onclick = () => { st.cur = { ...st.orig }; st.extra = []; st.gone = []; st.sel = null; paint(); };
    $("#krClose").onclick = () => {
      if (changes().length && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
      st = null; show(false); AT.modules.wochenplan.show();
    };
    $("#krSave").onclick = async () => {
      const btn = $("#krSave"); btn.disabled = true; btn.textContent = "Wird gespeichert …";
      try {
        await save();
        open(st.day);   // gespeicherten Stand neu laden – man kann direkt weiterarbeiten oder blättern
      } catch (e) {
        toast2(e.message); btn.disabled = false; btn.textContent = "In Wochenplan speichern";
      }
    };
  }

  btnCard.querySelector("#krOpen").onclick = () => { st = null; open(W.cur); };
  const prev = AT.modules.wochenplan.show;
  AT.modules.wochenplan.show = function () {
    btnCard.classList.toggle("hide", !(AT.user && AT.user.schreiben));
    if (!view.classList.contains("hide")) return;
    return prev.apply(this, arguments);
  };
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.tab !== "wochenplan" && !view.classList.contains("hide")) { view.classList.add("hide"); root.classList.remove("hide"); }
  }));
})();
