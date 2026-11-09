/* Airtec App – Modul „Planung“ (nur mit Schreibrecht): Krankmeldung eintragen/verlängern und umplanen.
   Schreibt über /api/plan direkt in die Google-Tabelle. Der alte Eintrag bleibt als Zellnotiz erhalten. */
(function () {
  const AT = window.AT, W = AT.wp;
  if (!W) return;
  const { esc, norm, addDays, wd, dShort, WT, todayIso } = W;
  const root = document.getElementById("wpView");
  const card = document.createElement("section");
  card.className = "card plcard hide";
  card.innerHTML = `<h2>Planung (Büro)</h2>
    <div id="plStart" class="plbtns">
      <button class="bigbtn primary" id="plSick">🤒 Krankmeldung</button>
      <button class="bigbtn" id="plEdit">✏️ Eintrag ändern</button>
    </div>
    <div id="plBox"></div>`;
  root.querySelector(".wptools").after(card);
  const $ = s => card.querySelector(s);
  const box = $("#plBox");
  const isOffice = o => /^(buro|buero|werkstatt|lager)$/.test(norm(o));
  const fmt = s => WT[wd(s)].slice(0, 2) + ", " + dShort(s);
  const nowText = () => new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  const toast2 = t => { if (typeof toast === "function") toast(t); };

  function weekdaysBetween(a, b) {
    const out = [];
    for (let s = a; s <= b && out.length < 31; s = addDays(s, 1)) if (wd(s) < 5) out.push(s);
    return out;
  }
  async function namesFor(s) { try { return (await W.week(s)).spalten || []; } catch (e) { return []; } }
  async function entry(s, name) { const d = await W.week(s); const t = W.dayOf(d, s); return (t && t.e[name]) || ""; }

  async function save(list) {
    const r = await AT.api("plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aenderungen: list }) });
    for (const a of list) W.forget(a.datum);
    return r;
  }

  /* ---------- Krankmeldung ---------- */
  async function sickForm() {
    $("#plStart").classList.add("hide");
    const day = W.cur, names = await namesFor(day);
    box.innerHTML = `<div class="plform">
      <label>Monteur</label><select id="pkWho"><option value="">– auswählen –</option>${names.map(n => `<option>${esc(n)}</option>`).join("")}</select>
      <div class="row"><div><label>von</label><input type="date" id="pkFrom" value="${day}"></div><div><label>bis einschließlich</label><input type="date" id="pkTo" value="${day}"></div></div>
      <div class="plquick"><button data-q="0">nur 1 Tag</button><button data-q="1">+1 Tag</button><button data-q="fr">bis Freitag</button><button data-q="nfr">bis nächsten Fr</button></div>
      <div id="pkInfo" class="hint"></div>
      <button class="bigbtn primary" id="pkGo">Krank eintragen</button>
      <button class="add" id="plCancel">Abbrechen</button></div>`;
    const from = $("#pkFrom"), to = $("#pkTo");
    card.querySelectorAll(".plquick button").forEach(b => b.onclick = () => {
      const q = b.dataset.q, f = from.value || day;
      if (q === "0") to.value = f;
      else if (q === "1") to.value = addDays(to.value || f, wd(addDays(to.value || f, 1)) >= 5 ? 3 : 1);
      else if (q === "fr") to.value = addDays(f, 4 - Math.min(wd(f), 4));
      else to.value = addDays(f, 11 - Math.min(wd(f), 4));
      info();
    });
    async function info() {
      const n = $("#pkWho").value, el = $("#pkInfo");
      if (!n) { el.textContent = ""; return; }
      if (to.value < from.value) to.value = from.value;
      const days = weekdaysBetween(from.value, to.value);
      // schon krank? → Verlängerung vorschlagen
      let prev = addDays(from.value, -1); while (wd(prev) >= 5) prev = addDays(prev, -1);
      const before = await entry(prev, n).catch(() => "");
      const already = W.absence(before) === "Krank";
      $("#pkGo").textContent = already ? "Krankmeldung verlängern" : "Krank eintragen";
      el.innerHTML = (already ? `${esc(n)} ist am ${fmt(prev)} bereits krank – wird verlängert. ` : "") +
        `${days.length} Arbeitstag${days.length === 1 ? "" : "e"}: ${days.map(fmt).join(", ")}`;
    }
    $("#pkWho").onchange = info; from.onchange = info; to.onchange = info;
    $("#plCancel").onclick = reset;
    $("#pkGo").onclick = async () => {
      const n = $("#pkWho").value;
      if (!n) { $("#pkWho").focus(); return; }
      const days = weekdaysBetween(from.value, to.value);
      if (!days.length) { toast2("Kein Arbeitstag im Zeitraum"); return; }
      $("#pkGo").disabled = true; $("#pkGo").textContent = "Wird eingetragen …";
      try {
        const list = [], before = [];
        for (const s of days) {
          const old = await entry(s, n);
          if (W.absence(old) === "Krank") continue;
          before.push({ datum: s, ort: old });
          const note = (old ? `vorher: ${old} – ` : "") + `Krank gemeldet von ${AT.user.name} am ${nowText()}`;
          list.push({ datum: s, name: n, wert: "Krank", notiz: note });
        }
        if (list.length) await save(list);
        toast2(list.length ? `${n}: ${list.length} Tag(e) Krank eingetragen` : "War schon eingetragen");
        await W.refresh();
        replan(n, before);
      } catch (e) {
        toast2(e.message); $("#pkGo").disabled = false; $("#pkGo").textContent = "Krank eintragen";
      }
    };
  }

  /* ---------- Umplanen ---------- */
  async function replan(sick, before) {
    const days = before.filter(b => b.ort && !W.absence(b.ort) && !isOffice(b.ort));
    if (!days.length) {
      box.innerHTML = `<div class="pldone">✓ Eingetragen. ${esc(sick)} war an diesen Tagen auf keiner Baustelle eingeplant – nichts umzuplanen.</div>
        <button class="add" id="plCancel">Fertig</button>`;
      $("#plCancel").onclick = reset; return;
    }
    box.innerHTML = `<div class="pldone">✓ ${esc(sick)} ist eingetragen. Jetzt die Baustellen neu verteilen:</div><div id="plDays"></div>
      <button class="bigbtn primary" id="plCancel">Fertig</button>`;
    $("#plCancel").onclick = reset;
    for (const b of days) {
      const sec = document.createElement("div");
      sec.className = "plday";
      $("#plDays").appendChild(sec);
      await paintDay(sec, sick, b.datum, b.ort);
    }
  }

  async function paintDay(sec, sick, s, ort) {
    const data = await W.week(s);
    const T = W.teams(data, s);
    const here = T.teams.find(t => norm(t.ort) === norm(ort));
    const left = here ? here.leute : [];
    const others = T.teams.filter(t => norm(t.ort) !== norm(ort) && !isOffice(t.ort));
    const sugg = [];
    if (left.length === 1) for (const t of others) sugg.push({ name: left[0], to: t.ort, txt: `${left[0]} → ${t.ort} (zu ${W.names(t.leute)})` });
    if (left.length <= 1) {
      for (const t of others.filter(t => t.leute.length >= 3)) for (const p of t.leute)
        sugg.push({ name: p, to: ort, txt: `${p} (aus ${t.ort}) → ${ort}${left.length ? " zu " + left[0] : ""}` });
      for (const p of T.free) sugg.push({ name: p, to: ort, txt: `${p} (noch frei) → ${ort}${left.length ? " zu " + left[0] : ""}` });
    }
    const orte = [...new Set(T.teams.map(t => t.ort))];
    sec.innerHTML = `<h3>${fmt(s)}</h3>
      <div class="plsit">${esc(sick)} sollte nach <b>${esc(ort)}</b>${left.length ? ` – dort jetzt: <b>${esc(W.names(left))}</b>${left.length === 1 ? " (allein)" : ""}` : " – dort ist jetzt <b>niemand</b>"}.</div>
      ${sugg.length ? `<div class="plsugg">${sugg.slice(0, 8).map((x, i) => `<button data-i="${i}">${esc(x.txt)}</button>`).join("")}</div>` : `<div class="hint">Keine naheliegenden Vorschläge – unten selbst ändern.</div>`}
      <ul class="wplist plteams">${T.teams.map(t => `<li${norm(t.ort) === norm(ort) ? ' class="mine"' : ""}><b>${esc(t.ort)}</b><span>${t.leute.map(esc).join(", ")}</span></li>`).join("")}
        ${T.free.length ? `<li class="open"><b>Noch nicht eingeplant</b><span>${T.free.map(esc).join(", ")}</span></li>` : ""}</ul>
      <details class="plman"><summary>Selbst ändern</summary>
        <div class="row"><div><label>Person</label><select class="pmWho">${(data.spalten || []).map(n => `<option>${esc(n)}</option>`).join("")}</select></div>
        <div><label>neuer Eintrag</label><input class="pmTo" list="pmL-${s}" placeholder="Baustelle"><datalist id="pmL-${s}">${orte.map(o => `<option value="${esc(o)}">`).join("")}</datalist></div></div>
        <button class="add pmGo">Speichern</button></details>`;
    sec.querySelectorAll(".plsugg button").forEach(btn => btn.onclick = () => apply(sec, sick, s, ort, sugg[+btn.dataset.i].name, sugg[+btn.dataset.i].to, btn));
    sec.querySelector(".pmGo").onclick = e => {
      const to = sec.querySelector(".pmTo").value.trim();
      apply(sec, sick, s, ort, sec.querySelector(".pmWho").value, to, e.target);
    };
  }

  async function apply(sec, sick, s, ort, name, to, btn) {
    btn.disabled = true;
    try {
      await save([{ datum: s, name, wert: to }]);
      toast2(`${name} → ${to || "leer"} gespeichert`);
      await W.refresh();
      await paintDay(sec, sick, s, ort);
    } catch (e) { toast2(e.message); btn.disabled = false; }
  }

  /* ---------- Eintrag ändern (einzeln) ---------- */
  async function editForm() {
    $("#plStart").classList.add("hide");
    const day = W.cur, names = await namesFor(day);
    box.innerHTML = `<div class="plform">
      <label>Person</label><select id="peWho">${names.map(n => `<option>${esc(n)}</option>`).join("")}</select>
      <div class="row"><div><label>Datum</label><input type="date" id="peDay" value="${day}"></div><div><label>neuer Eintrag</label><input id="peTo" list="peL" placeholder="z. B. Bochum"><datalist id="peL"></datalist></div></div>
      <div id="peInfo" class="hint"></div>
      <button class="bigbtn primary" id="peGo">Speichern</button>
      <button class="add" id="plCancel">Abbrechen</button></div>`;
    async function info() {
      const n = $("#peWho").value, s = $("#peDay").value;
      if (!n || !s) return;
      const data = await W.week(s).catch(() => null);
      if (!data) return;
      const t = W.dayOf(data, s), old = (t && t.e[n]) || "";
      $("#peInfo").innerHTML = `Bisher: <b>${esc(old || "nichts eingetragen")}</b>`;
      $("#peL").innerHTML = [...new Set(W.teams(data, s).teams.map(x => x.ort).concat(["Urlaub", "Schule", "HBZ", "Krank"]))].map(o => `<option value="${esc(o)}">`).join("");
    }
    $("#peWho").onchange = info; $("#peDay").onchange = info; info();
    $("#plCancel").onclick = reset;
    $("#peGo").onclick = async () => {
      $("#peGo").disabled = true;
      try {
        await save([{ datum: $("#peDay").value, name: $("#peWho").value, wert: $("#peTo").value.trim() }]);
        toast2("Gespeichert"); await W.refresh(); reset();
      } catch (e) { toast2(e.message); $("#peGo").disabled = false; }
    };
  }

  function reset() { box.innerHTML = ""; $("#plStart").classList.remove("hide"); }
  $("#plSick").onclick = sickForm;
  $("#plEdit").onclick = editForm;

  const show = () => card.classList.toggle("hide", !(AT.user && AT.user.schreiben));
  const prev = AT.modules.wochenplan.show;
  AT.modules.wochenplan.show = function () { show(); return prev.apply(this, arguments); };
  show();
})();
