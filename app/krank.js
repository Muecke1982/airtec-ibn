/* Airtec App – Modul „Änderungen“ (nur Büro): einen Tag im Wochenplan schnell neu einteilen.
   Tagesbrett mit allen Baustellen; Monteur antippen → Ziel antippen = umsetzen (auch auf „Krank“).
   Baustellen streichen / neu anlegen / zweite Baustelle für ein Team. Tage mit ‹ › wechseln.
   Je Einsatz Angaben (Baustelle/Kundendienst/nur Info, Projekt-/KD-Nummer, Info, fester Termin → Hinweis vor Änderungen),
   gespeichert in D1 (lib/einsaetze.js). „Auf weitere Tage“ kopiert ein Team samt Angaben (z. B. ganze Woche).
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
  const teile = v => String(v || "").split(/\s+[·\/]\s+/).filter(Boolean);
  const label = s => WT[wd(s)] + ", " + dShort(s) + (s === todayIso() ? " · heute" : "");

  /* ---------- Einsatz-Angaben: Art, Projekt-/KD-Nummer, Info, fester Termin (je Tag und Überschrift) ---------- */
  const ART = { baustelle: ["🏗", "Baustelle"], kd: ["🔧", "Kundendienst"], info: ["ℹ️", "Nur Info"] };
  const leer = m => !m || ((m.art || "baustelle") === "baustelle" && !m.nummer && !m.info && !m.fix);
  const metaFor = o => st.meta[norm(o)] || null;
  // gespeicherte Angaben je Überschrift, wie sie im Plan stehen (Krank/Urlaub/Frei-Felder zählen nicht)
  function einsatzListe(werte) {
    const titel = new Map();
    for (const n of st.data.spalten || []) { const v = werte[n]; if (v && !fixOf(v)) titel.set(norm(v), v); }
    return [...titel].map(([k, v]) => st.meta[k] && !leer(st.meta[k]) ? { datum: st.day, titel: v, art: st.meta[k].art || "baustelle",
      nummer: st.meta[k].nummer || "", info: st.meta[k].info || "", fix: !!st.meta[k].fix } : null).filter(Boolean);
  }
  const sig = m => leer(m) ? "" : JSON.stringify([m.art || "baustelle", m.nummer || "", m.info || "", !!m.fix]);
  // Überschriften, deren Angaben sich geändert haben (nur solche, die noch im Plan stehen)
  function metaChanges() {
    const out = [];
    for (const e of einsatzListe(st.cur)) if (sig(e) !== sig(st.origMeta[norm(e.titel)])) out.push(e.titel);
    for (const [k, m] of Object.entries(st.origMeta)) {
      if (leer(m) || out.some(t => norm(t) === k)) continue;
      const da = (st.data.spalten || []).some(n => norm(st.cur[n]) === k);
      if (da && leer(st.meta[k])) out.push(m.titel || k);
    }
    return out;
  }

  // Fester Termin: vor jeder Änderung einmal nachfragen
  async function fixOk(orte) {
    const hit = orte.filter(Boolean).map(o => [o, metaFor(o)]).find(([o, m]) => m && m.fix && !st.fixOk.has(norm(o)));
    if (!hit) return true;
    const ok = await frage2("📌 Fester Termin", `<p style="font-size:15px">„<b>${esc(hit[0])}</b>“ ist als <b>fester Termin</b> eingetragen und sollte nur nach Rücksprache geändert werden.</p><p style="font-size:15px">Wurde das abgesprochen?</p>`, "Ja, ändern");
    if (ok) orte.filter(Boolean).forEach(o => st.fixOk.add(norm(o)));
    return ok;
  }
  const frage2 = (t, h, ok) => typeof ask === "function" ? ask(t, h, ok) : Promise.resolve(confirm(t));

  // Formular für einen Einsatz: { titel, art, nummer, info, fix } oder null (abgebrochen)
  function einsatzForm(init, kopf) {
    return new Promise(res => {
      let art = (init && init.art) || "baustelle";
      const sh = document.createElement("div");
      sh.className = "bssheet";
      sh.innerHTML = `<div class="bsbox efbox"><h3>${esc(kopf)}</h3>
        <div class="efart">${Object.entries(ART).map(([k, [ic, l]]) => `<button type="button" data-a="${k}">${ic} ${l}</button>`).join("")}</div>
        <div class="eflist">
          <label id="efTL"></label><input id="efT" autocomplete="off" value="${esc((init && init.titel) || "")}">
          <div id="efNB"><label id="efNL"></label><input id="efN" autocomplete="off" value="${esc((init && init.nummer) || "")}"></div>
          <label>Info <small style="color:var(--mut)">(z. B. Krantermin 7 Uhr, Schlüssel beim Hausmeister)</small></label><input id="efI" autocomplete="off" value="${esc((init && init.info) || "")}">
          <label class="bschk"><input type="checkbox" id="efF" ${init && init.fix ? "checked" : ""}><span>📌 Fester Termin<small>Wer das später ändern will, bekommt den Hinweis: nur nach Rücksprache ändern.</small></span></label>
          <div class="hint" id="efH" style="margin:4px 0 0"></div>
        </div>
        <div class="efbtns"><button class="bigbtn primary" id="efOk">Übernehmen</button><button class="add" id="efX" style="margin:0">Abbrechen</button></div></div>`;
      document.body.appendChild(sh);
      const q = s => sh.querySelector(s);
      const malen = () => {
        sh.querySelectorAll("[data-a]").forEach(b => b.classList.toggle("on", b.dataset.a === art));
        q("#efTL").textContent = art === "kd" ? "Kunde / Einsatzort *" : art === "info" ? "Überschrift * (z. B. Schule, Krank, TÜV)" : "Bauvorhaben * (so wie wir es nennen)";
        q("#efNL").textContent = art === "kd" ? "Kundendienstnummer" : "Projektnummer (falls schon vorhanden)";
        q("#efNB").classList.toggle("hide", art === "info");
        q("#efH").textContent = art === "info" ? "Nur eine Info – erscheint nicht als Baustelle in den Vorschlägen."
          : "Erscheint mit Nummer und Info als Vorschlag beim Bauvorhaben in Protokollen und Aufmaß.";
      };
      malen();
      sh.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { art = b.dataset.a; malen(); });
      if (AT.baustellen) {
        AT.baustellen.feld(q("#efT"));
        q("#efT").addEventListener("change", () => {
          const v = AT.baustellen.finde && AT.baustellen.finde(q("#efT").value);
          if (!v) return;
          if (v.nummer && !q("#efN").value) q("#efN").value = v.nummer;
          if (v.art === "kd" && art === "baustelle") { art = "kd"; malen(); }
        });
      }
      const fertig = v => { sh.remove(); res(v); };
      q("#efOk").onclick = () => {
        const titel = q("#efT").value.trim().replace(/\s+/g, " ");
        if (!titel) { q("#efT").focus(); toast2("Bitte eine Überschrift eingeben"); return; }
        if (/\s[·\/]\s/.test(titel)) { toast2("„ / “ und „ · “ bitte nicht in der Überschrift verwenden"); return; }
        fertig({ titel, art, nummer: art === "info" ? "" : q("#efN").value.trim(), info: q("#efI").value.trim(), fix: q("#efF").checked });
      };
      q("#efX").onclick = () => fertig(null);
      sh.addEventListener("click", e => { if (e.target === sh) fertig(null); });
      if (!(init && init.titel)) setTimeout(() => q("#efT").focus(), 60);
    });
  }

  const css = document.createElement("style");
  css.textContent = `
    .efbox{max-height:92vh} .efbox .eflist{overflow:auto;flex:1;padding-bottom:4px}
    .efart{display:flex;gap:6px;margin:4px 0 6px}
    .efart button{flex:1;border:1.5px solid #d8dee5;background:#fff;border-radius:10px;padding:9px 4px;font:inherit;font-size:13.5px;font-weight:600;color:var(--ink)}
    .efart button.on{border-color:var(--blue);background:#e8f6fc;color:var(--blue)}
    .efbtns{display:flex;flex-direction:column;gap:8px;margin-top:8px} .efbtns .bigbtn{margin:0}
    .krmeta{font-size:13px;color:var(--mut);margin-top:3px}
    .krfix{display:inline-block;background:#fdecea;color:#b3261e;border-radius:6px;padding:0 6px;font-size:12px;font-weight:700;margin-left:6px;vertical-align:2px}
    .krzone.fixed{border-color:#f3c4c0}
    .kracts{flex-wrap:wrap;gap:8px 14px;justify-content:flex-start}
    .kpdays{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:6px 0 10px}
    .kpdays label{display:flex;flex-direction:column;align-items:center;border:1.5px solid #d8dee5;border-radius:10px;padding:6px 2px;font-size:12.5px;color:var(--ink);margin:0}
    .kpdays label.on{border-color:var(--blue);background:#e8f6fc}
    .kpdays label.off{opacity:.45}
    .kpdays input{display:none} .kpdays b{font-size:14px}
    .kpleute{display:flex;flex-wrap:wrap;gap:6px 14px;margin:4px 0 8px} .kpleute label{display:flex;gap:6px;align-items:center;margin:0;color:var(--ink);font-size:14.5px}
    .kpwk{font-size:12.5px;font-weight:700;color:var(--mut);margin-top:6px}`;
  document.head.appendChild(css);

  async function open(day) {
    day = day || todayIso();
    show(true);
    if (!st) view.innerHTML = `<section class="card"><div class="hint">Wird geladen …</div></section>`;
    try {
      const data = await W.week(day, true);
      const t = W.dayOf(data, day);
      const orig = {};
      for (const n of data.spalten || []) orig[n] = (t && t.e[n]) || "";
      const meta = {};
      for (const [k, m] of Object.entries((data.einsaetze || {})[day] || {})) meta[k] = { ...m };
      const zeigeAus = !!(st && st.day === day && st.zeigeAus);
      st = { day, data, orig, cur: { ...orig }, extra: [], gone: [], sel: null, fehlt: data.fehlt,
        meta, origMeta: JSON.parse(JSON.stringify(meta)), fixOk: new Set(), zeigeAus };
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

  const chip = n => `<button class="krchip${st.sel === n ? " sel" : ""}${(st.cur[n] || "") !== (st.orig[n] || "") ? " moved" : ""}" data-n="${esc(n)}">${W.tagged(st.data, n)}</button>`;
  // Kennzeichen oben rechts an der Baustelle: allein / Zusammensetzung / ohne Fachkraft
  function badge(t, off) {
    const n = t.leute.length;
    if (off) return { txt: String(n), cls: "" };
    if (!n) return { txt: "unbesetzt", cls: " empty" };
    if (W.ohneFach(st.data, t.leute)) return { txt: "ohne Fachkraft · " + W.besetzung(st.data, t.leute), cls: " alone" };
    if (n === 1) { const a = W.artOf(st.data, t.leute[0]); return { txt: "allein" + (a && a !== "Monteur" ? " · " + a : ""), cls: " alone" }; }
    return { txt: W.besetzung(st.data, t.leute), cls: "" };
  }

  function paint() {
    const G = groups(), ch = changes(), mch = metaChanges(), names = st.data.spalten || [], hol = holiday(st.day);
    const hid = W.hiddenOf(st.data), freiSicht = G.free.filter(n => st.zeigeAus || !hid.has(n) || n === st.sel), ausZahl = G.free.length - freiSicht.length;
    const kopf = t => { const m = metaFor(t.ort); return `${m && m.art && m.art !== "baustelle" ? ART[m.art][0] + " " : ""}${esc(t.ort)}${m && m.fix ? '<span class="krfix">📌 fix</span>' : ""}`; };
    const metaZeile = t => { const s = W.metaText(metaFor(t.ort)); return s ? `<div class="krmeta">${esc(s)}</div>` : ""; };
    view.innerHTML = `
      <section class="card krhead">
        <h2>Änderungen</h2>
        <div class="wpnav krnav">
          <button id="krPrev" aria-label="Tag zurück">‹</button>
          <label class="wpday"><b>${esc(WT[wd(st.day)] + ", " + dShort(st.day))}</b><small>${st.day === todayIso() ? "heute · " : ""}KW ${W.isoWeek(st.day).week} · Datum wählen</small><input type="date" id="krDay" value="${st.day}"></label>
          <button id="krNext" aria-label="Tag vor">›</button>
        </div>
        <div class="hint">Mitarbeiter antippen, dann das Ziel antippen – eine Baustelle, „Nicht eingeplant“, „Krank“, „Urlaub“ oder „Frei“.</div>
        ${hol ? `<div class="krhol">🎉 Feiertag: <b>${esc(hol)}</b>${names.some(n => W.absence(st.cur[n]) !== "Feiertag") ? `<button class="krholbtn" id="krHol">Alle auf „Feiertag“ setzen</button>` : ""}</div>` : ""}
      </section>
      ${st.fehlt ? `<section class="card"><div class="lerr">Für KW ${st.data.kw} gibt es noch kein Blatt in der Tabelle.</div></section>` : ""}
      <div class="krhint${st.sel ? "" : " hide"}">${st.sel ? `<b>${esc(st.sel)}</b> ausgewählt – jetzt Ziel antippen <button id="krDesel">✕</button>` : ""}</div>
      ${G.teams.map(t => {
        const off = isOffice(t.ort), bd = badge(t, off);
        const lost = names.filter(x => st.orig[x] && norm(st.orig[x]) === norm(t.ort) && !t.leute.includes(x));
        const fx = metaFor(t.ort) && metaFor(t.ort).fix;
        return `<section class="card krzone${bd.cls}${fx ? " fixed" : ""}" data-to="${esc(t.ort)}">
          <div class="krtop"><h3>${kopf(t)}</h3><span class="krbadge">${esc(bd.txt)}</span></div>
          ${metaZeile(t)}
          <div class="krchips">${t.leute.map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div>
          ${lost.length ? `<div class="krlost">vorher auch: ${lost.map(esc).join(", ")}</div>` : ""}
          <div class="kracts"><button class="krlink" data-edit="${esc(t.ort)}">✎ Angaben</button>${t.leute.length ? `<button class="krlink" data-copy="${esc(t.ort)}">📋 auf weitere Tage</button>` : ""}
            ${off ? "" : `<button class="krlink" data-add="${esc(t.ort)}">+ 2. Baustelle am Tag</button><button class="krdel" data-del="${esc(t.ort)}">streichen</button>`}</div>
        </section>`;
      }).join("")}
      <button class="add" id="krNew">+ neue Baustelle / Einsatz</button>
      <section class="card krzone krfree" data-to="${OFF}"><h3>Nicht eingeplant</h3><div class="krchips">${freiSicht.map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div>
        ${ausZahl || (st.zeigeAus && G.free.some(n => hid.has(n))) ? `<div class="kracts"><button class="krlink" id="krAus">${st.zeigeAus ? "Ausgeblendete wieder ausblenden" : `+ ${ausZahl} ausgeblendete zeigen (z. B. Praktikant)`}</button></div>` : ""}</section>
      ${FIX.map(([to, name, ic, cls]) => `<section class="card krzone ${cls}" data-to="${to}"><h3>${ic} ${name}</h3><div class="krchips">${G.fixed[to].map(chip).join("") || `<span class="krempty">${st.sel ? "hierher tippen" : "niemand"}</span>`}</div></section>`).join("")}
      ${G.abs.length ? `<section class="card krabs"><h3>Abwesend</h3><div class="krchips">${G.abs.map(a => `<button class="krchip abs${st.sel === a.n ? " sel" : ""}" data-n="${esc(a.n)}">${esc(a.n)} <small>${esc(a.v)}</small></button>`).join("")}</div></section>` : ""}
      <section class="card krsave">
        <h3>Änderungen (${ch.length + mch.length})</h3>
        ${ch.length + mch.length ? `<ul class="krlist">${ch.map(c => `<li><b>${esc(c.name)}</b>: ${esc(c.von || "–")} → <b>${esc(c.nach || "nicht eingeplant")}</b></li>`).join("")}${mch.map(t => `<li><b>${esc(t)}</b>: Angaben geändert</li>`).join("")}</ul>` : '<div class="hint" style="margin-top:0">Noch keine Änderungen.</div>'}
        <button class="bigbtn primary" id="krSave" ${ch.length + mch.length ? "" : "disabled"}>In Wochenplan speichern</button>
        <div class="krrow"><button class="add" id="krReset">Zurücksetzen</button><button class="add" id="krClose">Schließen</button></div>
      </section>`;
    bind();
  }

  async function moveTo(n, to) {
    const fx = FIX.find(f => f[0] === to);
    const von = st.cur[n] && !fixOf(st.cur[n]) ? st.cur[n] : "", nach = !fx && to !== OFF ? to : "";
    if (norm(von) === norm(nach)) { st.sel = null; paint(); return; }
    if (!(await fixOk([von, nach]))) { st.sel = null; paint(); return; }
    if (fx) st.cur[n] = fx[1];
    else if (to === OFF) st.cur[n] = "";
    else { st.cur[n] = to; st.gone = st.gone.filter(k => k !== norm(to)); }
    st.sel = null;
    paint();
  }

  async function save() {
    const ch = changes(), mch = metaChanges(); if (!ch.length && !mch.length) return true;
    const stamp = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
    const list = ch.map(c => {
      const a = { datum: st.day, name: c.name, wert: c.nach };
      const fx = fixOf(c.nach);
      if (fx && (!fixOf(c.von) || fixOf(c.von)[1] !== fx[1]))
        a.notiz = (c.von ? `vorher: ${c.von} – ` : "") + (fx[1] === "Krank" ? "Krank gemeldet" : fx[1] + " eingetragen") + ` von ${AT.user.name} am ${stamp}`;
      return a;
    });
    await AT.api("plan", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aenderungen: list, einsaetze: einsatzListe(st.cur), ersetzen: [st.day] }) });
    W.forget(st.day);
    const n = list.length + mch.length;
    toast2(`${n} Änderung${n === 1 ? "" : "en"} gespeichert`);
    return true;
  }
  const offen = () => changes().length + metaChanges().length;

  /* ---------- Team auf weitere Tage kopieren (z. B. ganze Woche einplanen) ---------- */
  async function kopieren(ort) {
    const team = groups().teams.find(t => norm(t.ort) === norm(ort));
    if (!team || !team.leute.length) return;
    const m = metaFor(ort), leute0 = team.leute.slice();
    if (offen()) {
      if (!(await frage2("Erst speichern?", `<p style="font-size:15px">Vor dem Kopieren werden die Änderungen für ${esc(label(st.day))} gespeichert.</p>`, "Speichern & weiter"))) return;
      try { await save(); } catch (e) { toast2(e.message); return; }
    }
    const mon = W.monOf(st.day), tage = [];
    for (let w = 0; w < 2; w++) for (let i = 0; i < 5; i++) { const d = addDays(mon, 7 * w + i); if (d !== st.day) tage.push(d); }
    const wahl = new Set(tage.filter(d => d > st.day && d < addDays(mon, 5) && !holiday(d)));
    const leute = new Set(leute0);
    const auswahl = await new Promise(res => {
      const sh = document.createElement("div");
      sh.className = "bssheet";
      const tagHtml = (w) => `<div class="kpwk">KW ${W.isoWeek(addDays(mon, 7 * w)).week}${w ? " (nächste Woche)" : ""}</div><div class="kpdays">${[0, 1, 2, 3, 4].map(i => {
        const d = addDays(mon, 7 * w + i), hol = holiday(d);
        if (d === st.day) return `<label class="off"><span>${WT[i].slice(0, 2)}</span><b>${dShort(d).slice(0, 3)}</b><small>dieser</small></label>`;
        return `<label class="${wahl.has(d) ? "on" : ""}" title="${esc(hol)}"><input type="checkbox" data-d="${d}" ${wahl.has(d) ? "checked" : ""}><span>${WT[i].slice(0, 2)}</span><b>${dShort(d).slice(0, 3)}</b>${hol ? "<small>🎉</small>" : ""}</label>`;
      }).join("")}</div>`;
      sh.innerHTML = `<div class="bsbox efbox"><h3>📋 „${esc(ort)}“ auf weitere Tage</h3>
        <div class="eflist">
          <div class="hint" style="margin:0 0 4px">Dieselben Leute${m && m.nummer ? " (mit " + (m.art === "kd" ? "KD-Nr. " : "Projekt ") + esc(m.nummer) + ")" : ""} an den gewählten Tagen eintragen.</div>
          ${tagHtml(0)}${tagHtml(1)}
          <div class="kpwk">Wer?</div>
          <div class="kpleute">${leute0.map(n => `<label><input type="checkbox" data-n="${esc(n)}" checked> ${esc(n)}</label>`).join("")}</div>
          ${m && (m.info || m.fix) ? `<div class="kpwk">Angaben</div><div class="kpleute">
            ${m.info ? `<label><input type="checkbox" id="kpInfo"> Info „${esc(m.info)}“ mit übernehmen</label>` : ""}
            ${m.fix ? `<label><input type="checkbox" id="kpFix" checked> 📌 auch dort fester Termin</label>` : ""}</div>` : ""}
          <div class="hint" style="margin:0">Urlaub, Krank, Schule usw. an den Tagen bleiben stehen. Andere Einträge werden ersetzt – das wird vorher angezeigt.</div>
        </div>
        <div class="efbtns"><button class="bigbtn primary" id="kpOk">Weiter</button><button class="add" id="kpX" style="margin:0">Abbrechen</button></div></div>`;
      document.body.appendChild(sh);
      sh.querySelectorAll("[data-d]").forEach(c => c.onchange = () => { c.checked ? wahl.add(c.dataset.d) : wahl.delete(c.dataset.d); c.parentNode.classList.toggle("on", c.checked); });
      sh.querySelectorAll("[data-n]").forEach(c => c.onchange = () => { c.checked ? leute.add(c.dataset.n) : leute.delete(c.dataset.n); });
      const fertig = v => { sh.remove(); res(v); };
      sh.querySelector("#kpOk").onclick = () => {
        if (!wahl.size) return toast2("Bitte mindestens einen Tag wählen");
        if (!leute.size) return toast2("Bitte mindestens eine Person wählen");
        const ki = sh.querySelector("#kpInfo"), kf = sh.querySelector("#kpFix");
        fertig({ tage: [...wahl].sort(), leute: leute0.filter(n => leute.has(n)), info: !!(ki && ki.checked), fix: !!(kf && kf.checked) });
      };
      sh.querySelector("#kpX").onclick = () => fertig(null);
      sh.addEventListener("click", e => { if (e.target === sh) fertig(null); });
    });
    if (!auswahl) return;
    // Zieltage einlesen und prüfen
    const aend = [], ersetzt = [], fest = [], bleibt = [], fehlt = [];
    for (const d of auswahl.tage) {
      let data;
      try { data = await W.week(d, true); } catch (e) { toast2(e.message); return; }
      if (data.fehlt) { fehlt.push(`KW ${data.kw}`); continue; }
      const t = W.dayOf(data, d);
      for (const n of auswahl.leute) {
        const prev = (t && t.e[n]) || "";
        if (norm(prev) === norm(ort)) continue;
        const kurz = `${WT[wd(d)].slice(0, 2)} ${dShort(d)} ${n}`;
        if (W.absence(prev)) { bleibt.push(`${kurz}: ${prev}`); continue; }
        if (prev) { ersetzt.push(`${kurz}: ${prev}`); const pm = W.metaOf(data, d, prev); if (pm && pm.fix) fest.push(`${kurz}: ${prev}`); }
        aend.push({ datum: d, name: n, wert: ort });
      }
    }
    const fehltTxt = [...new Set(fehlt)];
    if (!aend.length) { toast2(fehltTxt.length ? `Kein Blatt für ${fehltTxt.join(", ")}` : "Nichts zu ändern – steht schon so im Plan"); return; }
    if (aend.length > 80) { toast2("Zu viele auf einmal – bitte weniger Tage wählen"); return; }
    const liste = l => `<ul style="margin:4px 0 8px;padding-left:18px;font-size:14px">${l.map(x => `<li>${esc(x)}</li>`).join("")}</ul>`;
    const nTage = new Set(aend.map(a => a.datum)).size;
    const html = `<p style="font-size:15px"><b>${aend.length}</b> Eintr${aend.length === 1 ? "ag" : "äge"} „${esc(ort)}“ an ${nTage} Tag${nTage === 1 ? "" : "en"}.</p>`
      + (fest.length ? `<p style="font-size:15px;color:#b3261e"><b>📌 Feste Termine werden ersetzt – nur nach Rücksprache!</b></p>${liste(fest)}` : "")
      + (ersetzt.length ? `<p style="font-size:14px;margin-bottom:0">Wird ersetzt:</p>${liste(ersetzt)}` : "")
      + (bleibt.length ? `<p style="font-size:14px;margin-bottom:0">Bleibt stehen:</p>${liste(bleibt)}` : "")
      + (fehltTxt.length ? `<p style="font-size:14px">⚠ Kein Blatt in der Tabelle für ${esc(fehltTxt.join(", "))} – diese Tage werden übersprungen.</p>` : "");
    if (!(await frage2("Auf weitere Tage kopieren?", html, fest.length ? "Ja, abgesprochen" : "Eintragen"))) return;
    const tageMit = [...new Set(aend.map(a => a.datum))];
    const mk = m ? { art: m.art || "baustelle", nummer: m.nummer || "", info: auswahl.info ? m.info || "" : "", fix: auswahl.fix } : null;
    const einsaetze = mk && !leer(mk) ? tageMit.map(d => ({ datum: d, titel: ort, ...mk })) : [];
    try {
      await AT.api("plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aenderungen: aend, einsaetze }) });
    } catch (e) { toast2(e.message); return; }
    tageMit.forEach(d => W.forget(d));
    toast2(`📋 ${aend.length} Eintr${aend.length === 1 ? "ag" : "äge"} kopiert`);
    open(st.day);
  }

  // Tag wechseln: bei ungespeicherten Änderungen erst fragen
  async function goDay(day) {
    if (offen()) {
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
    view.querySelectorAll(".krdel").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const o = b.dataset.del;
      if (b.classList.contains("sure")) {
        for (const n of st.data.spalten || []) if (norm(st.cur[n]) === norm(o)) st.cur[n] = "";
        st.extra = st.extra.filter(x => norm(x) !== norm(o));
        st.gone.push(norm(o)); st.sel = null; paint();
        toast2(`${o} gestrichen – die Mitarbeiter stehen unter „Nicht eingeplant“`);
      } else {
        if (!(await fixOk([o]))) return;
        b.classList.add("sure"); b.textContent = "Wirklich streichen?";
        setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "streichen"; } }, 4000);
      }
    });
    // Angaben zur Baustelle / zum Einsatz bearbeiten (auch umbenennen)
    view.querySelectorAll("[data-edit]").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const o = b.dataset.edit, k = norm(o);
      if (!(await fixOk([o]))) return;
      const r = await einsatzForm({ ...(st.meta[k] || {}), titel: o }, "Angaben ändern");
      if (!r) return;
      const nk = norm(r.titel);
      if (nk !== k) {
        for (const n of st.data.spalten || []) if (norm(st.cur[n]) === k) st.cur[n] = r.titel;
        st.extra = st.extra.map(x => norm(x) === k ? r.titel : x);
        st.gone = st.gone.filter(x => x !== nk);
        delete st.meta[k];
        st.fixOk.add(nk);
      }
      st.meta[nk] = r;
      st.sel = null; paint();
    });
    view.querySelectorAll("[data-copy]").forEach(b => b.onclick = e => { e.stopPropagation(); kopieren(b.dataset.copy); });
    if ($("#krAus")) $("#krAus").onclick = e => { e.stopPropagation(); st.zeigeAus = !st.zeigeAus; paint(); };
    // zweite Baustelle für dieses Team am selben Tag: Eintrag wird z. B. „Bochum / Münster“
    // Auswahl aus den Baustellen des Wochenplans (letzte 5 Monate), Eingabe eines neuen Namens geht auch
    const frage = (titel, ohne) => AT.baustellen ? AT.baustellen.waehlen({ titel, ohne }) : Promise.resolve(prompt(titel));
    view.querySelectorAll("[data-add]").forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const o = b.dataset.add;
      if (!(await fixOk([o]))) return;
      const add = ((await frage(`Weitere Baustelle für „${o}“ am selben Tag`, teile(o))) || "").trim();
      if (!add) return;
      const neu = o + " / " + add;
      for (const n of st.data.spalten || []) if (norm(st.cur[n]) === norm(o)) st.cur[n] = neu;
      if (st.extra.some(x => norm(x) === norm(o))) st.extra = st.extra.map(x => norm(x) === norm(o) ? neu : x);
      if (st.meta[norm(o)]) { st.meta[norm(neu)] = { ...st.meta[norm(o)], titel: neu }; delete st.meta[norm(o)]; st.fixOk.add(norm(neu)); }
      st.sel = null; paint();
    });
    $("#krNew").onclick = async () => {
      const r = await einsatzForm({ art: "baustelle" }, st.sel ? `Neuer Einsatz für ${st.sel}` : "Neue Baustelle / Einsatz");
      if (!r) return;
      const o = r.titel, k = norm(o);
      const da = groups().teams.find(t => norm(t.ort) === k);
      if (da && !(await fixOk([da.ort]))) return;
      if (!da && !st.extra.some(x => norm(x) === k)) st.extra.push(o);
      st.gone = st.gone.filter(x => x !== k);
      st.meta[k] = r; st.fixOk.add(k);
      if (st.sel) moveTo(st.sel, da ? da.ort : o); else paint();
    };
    $("#krReset").onclick = () => { st.cur = { ...st.orig }; st.extra = []; st.gone = []; st.sel = null; st.meta = JSON.parse(JSON.stringify(st.origMeta)); paint(); };
    $("#krClose").onclick = () => {
      if (offen() && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
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
    btnCard.classList.toggle("hide", !AT.darf("plan_aendern"));
    if (!view.classList.contains("hide")) return;
    return prev.apply(this, arguments);
  };
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.tab !== "wochenplan" && !view.classList.contains("hide")) { view.classList.add("hide"); root.classList.remove("hide"); }
  }));
})();
