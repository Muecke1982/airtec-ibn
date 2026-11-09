/* Airtec App – Modul „Wochenplan“ (nur lesen).
   Zeigt dem angemeldeten Monteur seinen Tag, alle Teams des Tages und „Wo ist dein Kollege?“.
   Daten kommen über /api/wochenplan aus der Google-Tabelle und werden für den Offline-Fall auf dem Handy gemerkt. */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const WT = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

  /* ---------- Datum ---------- */
  const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const parse = iso => new Date(iso + "T12:00:00Z");
  const iso = d => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const wd = s => (parse(s).getUTCDay() + 6) % 7;
  function isoWeek(s) {
    const t = parse(s); t.setUTCDate(t.getUTCDate() + 3 - wd(s));
    const y = t.getUTCFullYear();
    return { year: y, week: Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7) };
  }
  const wkKey = s => { const w = isoWeek(s); return w.year + "-" + w.week; };
  const dShort = s => { const d = parse(s); return String(d.getUTCDate()).padStart(2, "0") + "." + String(d.getUTCMonth() + 1).padStart(2, "0") + "."; };
  function dayName(s) {
    const t = todayIso();
    if (s === t) return "Heute";
    if (s === addDays(t, 1)) return "Morgen";
    if (s === addDays(t, -1)) return "Gestern";
    return WT[wd(s)];
  }

  /* ---------- Art des Eintrags ---------- */
  const ABS = [["urlaub", "Urlaub"], ["berufsschule", "Schule"], ["schule", "Schule"], ["hbz", "HBZ"], ["krank", "krank"],
    ["feiertag", "Feiertag"], ["frei", "frei"], ["zeitausgleich", "Zeitausgleich"], ["uberstunden", "Überstundenabbau"], ["elternzeit", "Elternzeit"]];
  function absence(txt) {
    const n = norm(txt);
    for (const [k, label] of ABS) if (n === k || n.startsWith(k + " ") || n.split(" ").includes(k)) return label;
    return "";
  }

  /* ---------- Daten laden ---------- */
  const cache = ls.get("wp_cache") || {};
  const pending = {};
  let offline = false;
  function remember(key, data) {
    cache[key] = data;
    const keys = Object.keys(cache).sort((a, b) => (cache[b].geladen || 0) - (cache[a].geladen || 0));
    keys.slice(8).forEach(k => delete cache[k]);
    ls.set("wp_cache", cache);
  }
  function week(s, force) {
    const key = wkKey(s);
    const c = cache[key];
    if (!force && c && Date.now() - (c.geladen || 0) < 2 * 60 * 1000) return Promise.resolve(c);
    if (pending[key]) return pending[key];
    const w = isoWeek(s);
    return pending[key] = AT.api(`wochenplan?jahr=${w.year}&kw=${w.week}`)
      .then(d => { d.geladen = Date.now(); remember(key, d); offline = false; return d; })
      .catch(e => { if (c) { offline = true; return c; } throw e; })
      .finally(() => { delete pending[key]; });
  }
  const dayOf = (data, s) => (data.tage || []).find(t => t.datum === s);

  /* ---------- Teams eines Tages ---------- */
  function teams(data, s) {
    const t = dayOf(data, s);
    const groups = new Map(), abs = new Map(), free = [];
    for (const name of data.spalten || []) {
      const v = t && t.e[name];
      if (!v) { free.push(name); continue; }
      const a = absence(v);
      const map = a ? abs : groups, key = a || norm(v);
      if (!map.has(key)) map.set(key, { ort: a || v, leute: [] });
      map.get(key).leute.push(name);
    }
    return { teams: [...groups.values()], abs: [...abs.values()], free, hat: !!t };
  }
  function partnerOf(data, s, name) {
    const t = dayOf(data, s); if (!t) return null;
    const v = t.e[name]; if (!v) return { ort: "", mit: [] };
    const a = absence(v);
    if (a) return { ort: v, abs: a, mit: [] };
    return { ort: v, mit: (data.spalten || []).filter(n => n !== name && t.e[n] && norm(t.e[n]) === norm(v)) };
  }
  const names = l => l.length <= 1 ? (l[0] || "") : l.slice(0, -1).join(", ") + " und " + l[l.length - 1];

  /* ---------- Ansicht ---------- */
  const root = document.getElementById("wpView");
  root.innerHTML = `
    <section class="card wphello"><div class="hi" id="wpHi"></div><div class="me" id="wpMe"></div></section>
    <div class="wpnav">
      <button id="wpPrev" aria-label="Tag zurück">‹</button>
      <label class="wpday"><b id="wpDayT"></b><small id="wpDayS"></small><input type="date" id="wpDate"></label>
      <button id="wpNext" aria-label="Tag vor">›</button>
    </div>
    <div class="wptools"><button id="wpToday" class="hide">Zurück zu heute</button><span id="wpState"></span><button id="wpReload">⟳ aktualisieren</button></div>
    <section class="card"><h2>Wer ist wo?</h2><div id="wpTeams"></div></section>
    <section class="card"><h2>Wo ist dein Kollege?</h2>
      <div class="row"><div><label>Kollege</label><select id="wpWho"></select></div><div><label>Datum</label><input type="date" id="wpWhoDate"></div></div>
      <div id="wpWhoRes" class="wpres"></div>
    </section>`;
  const $ = s => root.querySelector(s);
  let cur = ls.get("wp_day_session") === todayIso() ? (ls.get("wp_day") || todayIso()) : todayIso();
  const me = () => (AT.user && (AT.user.plan || AT.user.name)) || "";
  const myCol = data => (data.spalten || []).find(n => norm(n) === norm(me())) || "";

  function greet() {
    const h = new Date().getHours();
    const first = (AT.user && (AT.user.plan || AT.user.name) || "").split(" ")[0];
    $("#wpHi").textContent = (h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend") + (first ? ", " + first : "") + "!";
  }

  function sentence(data, s) {
    const col = myCol(data);
    if (!col) return AT.user && AT.user.schreiben ? "" : "Dein Name wurde in der Tabelle nicht gefunden – bitte im Büro melden.";
    const p = partnerOf(data, s, col);
    const when = s === todayIso() ? "heute" : s === addDays(todayIso(), 1) ? "morgen" : "am " + WT[wd(s)] + ", " + dShort(s);
    const When = when[0].toUpperCase() + when.slice(1);
    if (!p || !p.ort) return `${When} ist für dich noch nichts eingetragen.`;
    if (p.abs) return `${When}: <b>${esc(p.ort)}</b>`;
    return p.mit.length
      ? `Du fährst ${when} mit <b>${esc(names(p.mit))}</b> nach <b>${esc(p.ort)}</b>.`
      : `Du bist ${when} in <b>${esc(p.ort)}</b> eingeplant.`;
  }

  function paint(data, s) {
    greet();
    $("#wpDayT").textContent = dayName(s) + ", " + dShort(s);
    $("#wpDayS").textContent = (dayName(s) !== WT[wd(s)] ? WT[wd(s)] + " · " : "") + "KW " + isoWeek(s).week + " · Datum wählen";
    $("#wpDate").value = s;
    $("#wpToday").classList.toggle("hide", s === todayIso());
    if (!data) { $("#wpMe").innerHTML = ""; $("#wpTeams").innerHTML = '<div class="hint">Wird geladen …</div>'; return; }
    const st = offline ? "Offline – Stand " + new Date(data.geladen).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    $("#wpState").textContent = st;
    if (data.fehlt) {
      $("#wpMe").innerHTML = "";
      $("#wpTeams").innerHTML = `<div class="hint">Für KW ${data.kw} gibt es noch kein Blatt in der Tabelle.</div>`;
      return;
    }
    const txt = sentence(data, s);
    $("#wpMe").innerHTML = txt; $("#wpMe").classList.toggle("hide", !txt);
    const T = teams(data, s);
    if (!T.hat) { $("#wpTeams").innerHTML = '<div class="hint">An diesem Tag steht nichts in der Tabelle.</div>'; return; }
    const mine = myCol(data);
    const li = (g, cls) => `<li class="${cls}${g.leute.includes(mine) ? " mine" : ""}"><b>${esc(g.ort)}</b><span>${g.leute.map(esc).join(", ")}</span></li>`;
    let h = T.teams.length ? `<ul class="wplist">${T.teams.map(g => li(g, "")).join("")}</ul>` : "";
    if (T.abs.length) h += `<ul class="wplist">${T.abs.map(g => li(g, "abs")).join("")}</ul>`;
    if (T.free.length && wd(s) < 5) h += `<ul class="wplist"><li class="open"><b>Noch nicht eingeplant</b><span>${T.free.map(esc).join(", ")}</span></li></ul>`;
    $("#wpTeams").innerHTML = h || '<div class="hint">Keine Einträge.</div>';
    fillWho(data);
  }

  function fillWho(data) {
    const sel = $("#wpWho"), keep = sel.value || ls.get("wp_who") || "";
    const list = (data.spalten || []).filter(n => n !== myCol(data));
    const html = '<option value="">– auswählen –</option>' + list.map(n => `<option ${n === keep ? "selected" : ""}>${esc(n)}</option>`).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    if (!$("#wpWhoDate").value) $("#wpWhoDate").value = cur;
  }

  async function who() {
    const n = $("#wpWho").value, s = $("#wpWhoDate").value, out = $("#wpWhoRes");
    ls.set("wp_who", n);
    if (!n || !s) { out.innerHTML = ""; return; }
    out.innerHTML = '<div class="hint">Wird gesucht …</div>';
    try {
      const data = await week(s);
      const p = data.fehlt ? null : partnerOf(data, s, n);
      const when = (s === todayIso() ? "heute" : s === addDays(todayIso(), 1) ? "morgen" : "am " + WT[wd(s)] + ", " + dShort(s));
      if (!p || !p.ort) out.innerHTML = `<b>${esc(n)}</b> hat ${when} keinen Eintrag.`;
      else if (p.abs) out.innerHTML = `<b>${esc(n)}</b> ist ${when}: <b>${esc(p.ort)}</b>`;
      else out.innerHTML = `<b>${esc(n)}</b> ist ${when} in <b>${esc(p.ort)}</b>` + (p.mit.length ? `, zusammen mit <b>${esc(names(p.mit))}</b>.` : ", allein eingeplant.");
    } catch (e) { out.innerHTML = `<span class="lerr">${esc(e.message)}</span>`; }
  }

  async function go(s, force) {
    cur = s; ls.set("wp_day", s); ls.set("wp_day_session", todayIso());
    const c = cache[wkKey(s)];
    paint(c || null, s);
    try {
      const d = await week(s, force);
      if (cur === s) paint(d, s);
      if (force) toast2("Aktualisiert");
      // nächste Woche schon im Hintergrund holen (für Blättern ohne Netz)
      if (wd(s) >= 3) week(addDays(s, 7)).catch(() => {});
    } catch (e) {
      if (cur === s) $("#wpTeams").innerHTML = `<div class="lerr">${esc(e.message)}</div>`;
    }
  }
  function toast2(t) { if (typeof toast === "function") toast(t); }

  // Blättern: Wochenende überspringen, außer dort ist etwas eingetragen
  function step(dir) {
    let s = cur;
    for (let i = 0; i < 7; i++) {
      s = addDays(s, dir);
      if (wd(s) < 5) break;
      const c = cache[wkKey(s)], t = c && dayOf(c, s);
      if (t && Object.keys(t.e).length) break;
    }
    go(s);
  }

  $("#wpPrev").onclick = () => step(-1);
  $("#wpNext").onclick = () => step(1);
  $("#wpToday").onclick = () => go(todayIso());
  $("#wpReload").onclick = () => go(cur, true);
  $("#wpDate").onchange = e => { if (e.target.value) go(e.target.value); };
  $("#wpWho").onchange = who;
  $("#wpWhoDate").onchange = who;
  // Wischen nach links/rechts zum Blättern
  let sx = null;
  root.addEventListener("touchstart", e => { sx = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  root.addEventListener("touchend", e => {
    if (!sx || e.target.closest("select,input")) return;
    const dx = e.changedTouches[0].clientX - sx[0], dy = e.changedTouches[0].clientY - sx[1];
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    sx = null;
  });

  let shownDay = "";
  AT.modules.wochenplan = {
    show() {
      // Nach Mitternacht oder neuem Öffnen wieder auf heute springen
      if (shownDay !== todayIso()) { shownDay = todayIso(); cur = ls.get("wp_day_session") === todayIso() ? cur : todayIso(); }
      go(cur);
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !root.classList.contains("hide")) AT.modules.wochenplan.show();
  });
})();
