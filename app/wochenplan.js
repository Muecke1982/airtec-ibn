/* Airtec App – Modul „Wochenplan“ (nur lesen).
   Zeigt dem angemeldeten Monteur seinen Tag, alle Teams des Tages (mit Nummer/Info/fix) und die Wochenübersicht aller.
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
  const ABS = [["urlaub", "Urlaub"], ["berufsschule", "Schule"], ["schule", "Schule"], ["hbz", "HBZ"], ["krank", "Krank"],
    ["feiertag", "Feiertag"], ["frei", "Frei"], ["zeitausgleich", "Zeitausgleich"], ["uberstunden", "Überstundenabbau"], ["elternzeit", "Elternzeit"]];
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

  /* ---------- Einsatz-Angaben (Art, Nummer, Info, fest) und ausgeblendete Mitarbeiter ---------- */
  const ICON = { baustelle: "🏗", kd: "🔧", info: "ℹ️" };
  const metaOf = (data, s, v) => (((data && data.einsaetze) || {})[s] || {})[norm(v)] || null;
  const hiddenOf = data => new Set((data && data.ausgeblendet) || []);
  // „Projekt 4711 · Krantermin 7 Uhr“
  function metaText(m) {
    if (!m) return "";
    return [m.nummer ? (m.art === "kd" ? "KD-Nr. " : "Projekt ") + m.nummer : "", m.info || ""].filter(Boolean).join(" · ");
  }
  const fixPill = m => m && m.fix ? '<span class="wpfix">📌 fix</span>' : "";

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

  /* ---------- Art der Mitarbeiter (Meister, Azubi …) ---------- */
  const MEHRZAHL = { Monteur: "Monteure", Azubi: "Azubis", Praktikant: "Praktikanten" };
  const FACH = ["Meister", "Techniker", "Monteur"];
  const artOf = (data, n) => ((data && data.arten) || {})[n] || "";
  // Name mit kleinem Zusatz, wenn es kein Monteur ist (Monteur ist der Normalfall)
  const tagged = (data, n) => { const a = artOf(data, n); return esc(n) + (a && a !== "Monteur" ? ` <small class="wpart">${esc(a)}</small>` : ""); };
  // Zusammensetzung eines Teams, z. B. „2 Monteure · 1 Azubi“
  function besetzung(data, leute) {
    const z = new Map();
    for (const n of leute) { const a = artOf(data, n) || "Person"; z.set(a, (z.get(a) || 0) + 1); }
    const ord = [...FACH, "Helfer", "Azubi", "Praktikant", "Person"];
    return [...z].sort((a, b) => ord.indexOf(a[0]) - ord.indexOf(b[0]))
      .map(([a, k]) => k + " " + (k === 1 ? a : a === "Person" ? "Personen" : MEHRZAHL[a] || a)).join(" · ");
  }
  // Team ohne Meister/Techniker/Monteur (nur wenn alle Arten bekannt sind)
  const ohneFach = (data, leute) => leute.length > 0 && leute.every(n => artOf(data, n)) && !leute.some(n => FACH.includes(artOf(data, n)));

  /* ---------- Ansicht ---------- */
  const root = document.getElementById("wpView");
  root.innerHTML = `
    <section class="card wphello wpday1"><div class="me" id="wpMe"></div></section>
    <div class="wpnav">
      <button id="wpPrev" aria-label="Tag zurück">‹</button>
      <label class="wpday"><b id="wpDayT"></b><small id="wpDayS"></small><input type="date" id="wpDate"></label>
      <button id="wpNext" aria-label="Tag vor">›</button>
    </div>
    <div class="wptools"><button id="wpToday" class="hide">Zurück zu heute</button><span id="wpState"></span><button id="wpReload">⟳ aktualisieren</button></div>
    <section class="card"><h2>Wer ist wo?</h2><div id="wpTeams"></div></section>
    <section class="card" id="wkBox"><h2>Wochenübersicht</h2>
      <div class="wpnav wknav">
        <button id="wkPrev" aria-label="Woche zurück">‹</button>
        <div class="wpday"><b id="wkT"></b><small id="wkS"></small></div>
        <button id="wkNext" aria-label="Woche vor">›</button>
      </div>
      <div id="wkGrid" class="wkgrid"></div>
      <div class="hint" style="margin-bottom:0">Feld antippen = diesen Tag oben anzeigen.</div>
    </section>`;
  const css = document.createElement("style");
  css.textContent = `
    .wpmeta{display:block;font-size:12.5px;color:var(--mut);margin-top:2px;font-style:normal}
    .wpfix{display:inline-block;background:#fdecea;color:#b3261e;border-radius:6px;padding:0 5px;font-size:11.5px;font-weight:700;margin-left:6px;vertical-align:1px}
    .wkgrid{overflow-x:auto;margin:8px -4px 0}
    .wkgrid table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:11.5px;line-height:1.25}
    .wkgrid th{font-weight:700;color:var(--mut);padding:4px 2px;text-align:left;font-size:11px}
    .wkgrid th.tdy{color:var(--blue)}
    .wkgrid td{border-top:1px solid #e6eaee;padding:5px 3px;vertical-align:top;overflow-wrap:anywhere}
    .wkgrid td.n{font-weight:700;color:var(--ink);width:64px;padding-left:2px}
    .wkgrid td.c{cursor:pointer}
    .wkgrid td.c span{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .wkgrid td.leer{color:#c4cbd2}
    .wkgrid td.abs{color:#8a5a00;background:#fff8e6}
    .wkgrid td.kd{background:#eef6ff}
    .wkgrid td.tdy{box-shadow:inset 2px 0 0 var(--blue)}
    .wkgrid tr.ich td{background:#e8f6fc} .wkgrid tr.ich td.abs{background:#fff3d1}
    .wkgrid td.fx span::before{content:"📌";margin-right:1px}`;
  document.head.appendChild(css);
  const $ = s => root.querySelector(s);
  let cur = ls.get("wp_day_session") === todayIso() ? (ls.get("wp_day") || todayIso()) : todayIso();
  const me = () => (AT.user && (AT.user.plan || AT.user.name)) || "";
  const myCol = data => data.ich || (data.spalten || []).find(n => norm(n) === norm(me())) || "";

  function greet() {
    const h = new Date().getHours();
    const first = (AT.user && (AT.user.plan || AT.user.name) || "").split(" ")[0];
    AT.greeting = (h < 11 ? "Guten Morgen" : h < 18 ? "Hallo" : "Guten Abend") + (first ? ", " + first : "") + "!";
    return AT.greeting;
  }

  function sentence(data, s) {
    const col = myCol(data);
    if (!col) return AT.darf("plan_aendern") ? "" : "Dein Name wurde in der Tabelle nicht gefunden – bitte im Büro melden.";
    const p = partnerOf(data, s, col);
    const when = s === todayIso() ? "heute" : s === addDays(todayIso(), 1) ? "morgen" : "am " + WT[wd(s)] + ", " + dShort(s);
    const When = when[0].toUpperCase() + when.slice(1);
    if (!p || !p.ort) return `${When} ist für dich noch nichts eingetragen.`;
    const m = metaOf(data, s, p.ort), zusatz = metaText(m) ? `<span class="wpmeta">${m.art === "kd" ? "🔧 Kundendienst · " : ""}${esc(metaText(m))}${fixPill(m)}</span>` : (m && m.fix ? `<span class="wpmeta">${fixPill(m)}</span>` : "");
    if (p.abs || (m && m.art === "info")) return `${When}: <b>${esc(p.ort)}</b>${zusatz}`;
    if (/^(buro|buero)$/.test(norm(p.ort))) return `Du bist ${when} im <b>Büro</b>.${zusatz}`;
    return (p.mit.length
      ? `Du fährst ${when} mit <b>${esc(names(p.mit))}</b> nach <b>${esc(p.ort)}</b>.`
      : `Du bist ${when} in <b>${esc(p.ort)}</b> eingeplant.`) + zusatz;
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
    $("#wpMe").innerHTML = txt; $(".wpday1").classList.toggle("hide", !txt);
    const T = teams(data, s);
    if (!T.hat) { $("#wpTeams").innerHTML = '<div class="hint">An diesem Tag steht nichts in der Tabelle.</div>'; return; }
    const mine = myCol(data);
    const li = (g, cls) => {
      const m = metaOf(data, s, g.ort), mt = metaText(m);
      return `<li class="${cls}${g.leute.includes(mine) ? " mine" : ""}"><b>${m && m.art !== "baustelle" ? ICON[m.art] + " " : ""}${esc(g.ort)}${fixPill(m)}</b><span>${g.leute.map(n => tagged(data, n)).join(", ")}</span>${mt ? `<em class="wpmeta">${esc(mt)}</em>` : ""}</li>`;
    };
    let h = T.teams.length ? `<ul class="wplist">${T.teams.map(g => li(g, "")).join("")}</ul>` : "";
    if (T.abs.length) h += `<ul class="wplist">${T.abs.map(g => li(g, "abs")).join("")}</ul>`;
    const hid = hiddenOf(data), free = T.free.filter(n => !hid.has(n));
    if (free.length && wd(s) < 5) h += `<ul class="wplist"><li class="open"><b>Noch nicht eingeplant</b><span>${free.map(n => tagged(data, n)).join(", ")}</span></li></ul>`;
    $("#wpTeams").innerHTML = h || '<div class="hint">Keine Einträge.</div>';
  }

  async function go(s, force) {
    cur = s; ls.set("wp_day", s); ls.set("wp_day_session", todayIso());
    const c = cache[wkKey(s)];
    paint(c || null, s);
    try {
      const d = await week(s, force);
      if (cur === s) paint(d, s);
      if (force) toast2("Aktualisiert");
      if (monOf(s) !== wkMon || force) { wkMon = monOf(s); paintWeek(); }
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
  // Wischen nach links/rechts zum Blättern
  let sx = null;
  root.addEventListener("touchstart", e => { sx = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
  root.addEventListener("touchend", e => {
    if (!sx || e.target.closest("select,input,#wkBox,#krView")) return;
    const dx = e.changedTouches[0].clientX - sx[0], dy = e.changedTouches[0].clientY - sx[1];
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
    sx = null;
  });

  /* ---------- Wochenübersicht: alle Mitarbeiter × Mo–Fr ---------- */
  function monOf(s) { return addDays(s, -wd(s)); }
  let wkMon = monOf(cur);
  async function paintWeek() {
    const box = $("#wkGrid"), mon = wkMon;
    const w = isoWeek(mon);
    $("#wkT").textContent = "KW " + w.week;
    $("#wkS").textContent = (monOf(todayIso()) === mon ? "diese Woche · " : "") + dShort(mon) + " – " + dShort(addDays(mon, 4)) + w.year;
    if (!cache[wkKey(mon)]) box.innerHTML = '<div class="hint">Wird geladen …</div>';
    let data;
    try { data = await week(mon); } catch (e) { if (wkMon === mon) box.innerHTML = `<div class="lerr">${esc(e.message)}</div>`; return; }
    if (wkMon !== mon) return;
    if (data.fehlt) { box.innerHTML = `<div class="hint">Für KW ${data.kw} gibt es noch kein Blatt.</div>`; return; }
    const days = [0, 1, 2, 3, 4].map(i => addDays(mon, i)), t0 = todayIso(), own = myCol(data), hid = hiddenOf(data);
    const leute = (data.spalten || []).filter(n => !hid.has(n) || days.some(s => { const t = dayOf(data, s); return t && t.e[n]; }));
    const zelle = (n, s) => {
      const t = dayOf(data, s), v = t && t.e[n], td = s === t0 ? " tdy" : "";
      if (!v) return `<td class="c leer${td}" data-d="${s}"><span>–</span></td>`;
      const m = metaOf(data, s, v);
      const cls = (absence(v) || (m && m.art === "info") ? " abs" : m && m.art === "kd" ? " kd" : "") + (m && m.fix ? " fx" : "");
      const tip = [v, metaText(m)].filter(Boolean).join(" – ");
      return `<td class="c${cls}${td}" data-d="${s}" title="${esc(tip)}"><span>${esc(v)}</span></td>`;
    };
    box.innerHTML = `<table><thead><tr><th style="width:64px"></th>${days.map(s => `<th class="${s === t0 ? "tdy" : ""}">${WT[wd(s)].slice(0, 2)} ${dShort(s)}</th>`).join("")}</tr></thead>
      <tbody>${leute.map(n => `<tr class="${n === own ? "ich" : ""}"><td class="n">${esc(n)}</td>${days.map(s => zelle(n, s)).join("")}</tr>`).join("")}</tbody></table>`;
    box.querySelectorAll("td[data-d]").forEach(c => c.onclick = () => { go(c.dataset.d); window.scrollTo({ top: 0, behavior: "smooth" }); });
  }
  $("#wkPrev").onclick = () => { wkMon = addDays(wkMon, -7); paintWeek(); };
  $("#wkNext").onclick = () => { wkMon = addDays(wkMon, 7); paintWeek(); };

  // Hilfsfunktionen für andere Module (z. B. Planung/Krankmeldung)
  AT.wp = {
    sentence, greet, myCol,
    week, teams, partnerOf, absence, norm, addDays, wd, dShort, WT, todayIso, dayOf, isoWeek, esc, names,
    artOf, tagged, besetzung, ohneFach, metaOf, metaText, hiddenOf, ICON, monOf,
    get cur() { return cur; },
    forget(s) { delete cache[wkKey(s)]; },
    async refresh() { await go(cur, true); paintWeek(); },
  };

  let shownDay = "";
  AT.modules.wochenplan = {
    show() {
      // Nach Mitternacht oder neuem Öffnen wieder auf heute springen
      if (shownDay !== todayIso()) { shownDay = todayIso(); cur = ls.get("wp_day_session") === todayIso() ? cur : todayIso(); }
      go(cur);
      wkMon = monOf(cur); paintWeek();
    },
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !root.classList.contains("hide")) AT.modules.wochenplan.show();
  });
})();
