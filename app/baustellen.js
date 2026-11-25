/* Airtec App – Baustellen:
   • Vorschlagsliste: Baustellen aus dem Wochenplan der letzten 5 Monate (aktuelle zuerst, ohne Krank/Urlaub/Frei …)
     → AT.baustellen.feld(input) hängt die Vorschläge an ein Eingabefeld, AT.baustellen.waehlen() öffnet eine Auswahl
   • Baustellen-Mappe: Infos/Aufgaben (mit „Reminder nächster Einsatz“), zugeordnete Protokolle und Aufmaße,
     „Mappe schließen“ legt eine Zusammenfassung als PDF in SharePoint ab
   • Startseite: Hinweis an den, der die Baustelle als Nächstes im Wochenplan hat (karten/binden/tickerLaden) */
(function () {
  const AT = window.AT, W = AT.wp;
  const ls = window.AT.ls;
  const esc = window.AT.esc;
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const toast2 = window.AT.say;
  const todayIso = () => W ? W.todayIso() : (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); })();
  const dd = iso => iso ? `${String(iso).slice(8, 10)}.${String(iso).slice(5, 7)}.` : "";
  const zeit = s => s ? dd(s) + (String(s).slice(0, 4) !== todayIso().slice(0, 4) ? String(s).slice(0, 4) : "") + (String(s).length > 10 ? " " + String(s).slice(11, 16) : "") : "";
  const teile = v => String(v || "").split(/\s+[·\/]\s+/).map(s => s.trim()).filter(Boolean);
  const zugang = () => !!AT.user;   // Mappen sehen alle; schließen/archivieren nur mit Recht „mappen“
  const post = body => AT.api("baustellen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const css = document.createElement("style");
  css.textContent = `
    .bsdd{border:1px solid #d8dee5;border-radius:10px;margin:-4px 0 10px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.08);overflow:hidden}
    .bsdd button,.bsrow{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-top:1px solid #eef1f4;background:none;padding:10px 12px;font:inherit;color:var(--ink)}
    .bsdd button:first-child{border-top:0} .bsdd small,.bsrow small{color:var(--mut);font-size:12px;white-space:nowrap}
    .bsrow{padding:11px 2px} .bsrow b{font-size:15px} .bsrow .bsmeta{display:block;color:var(--mut);font-size:12.5px;margin-top:2px;white-space:normal}
    .bsrow.neu b{color:var(--blue)} .bsrow .bsgo{color:#b0b8c1;font-size:20px}
    .bssheet{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:60;display:flex;align-items:flex-end;justify-content:center}
    .bssheet .bsbox{background:#fff;width:100%;max-width:560px;max-height:86vh;border-radius:16px 16px 0 0;padding:14px 14px 18px;display:flex;flex-direction:column}
    .bssheet h3{margin:0 0 8px} .bssheet .bslist{overflow:auto;flex:1;margin:4px 0 8px}
    #bsView h3{margin:0 0 6px} .bshead h2{margin:4px 0 2px} .bsback{border:0;background:none;color:var(--blue);font:inherit;font-weight:600;padding:0}
    .bsplan{color:var(--mut);font-size:13.5px;margin-top:4px}
    .bschk{display:flex;gap:10px;align-items:flex-start;font-weight:600;margin:10px 0 4px} .bschk input{width:22px;height:22px;margin:1px 0 0;flex:none}
    .bschk small{display:block;font-weight:400;color:var(--mut);font-size:12.5px}
    .bsein{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid #eef1f4;list-style:none}
    .bsein:first-child{border-top:0} .bsein .bstext{white-space:pre-wrap;word-break:break-word}
    .bsein small{display:block;color:var(--mut);font-size:12.5px;margin-top:3px}
    .bsein.erl .bstext{text-decoration:line-through;color:var(--mut)}
    .bscheck{flex:none;width:30px;height:30px;border:2px solid #b8c2cc;border-radius:8px;background:#fff;font-size:17px;line-height:1;color:#fff;padding:0}
    .bsein.erl .bscheck{background:#3c9a3c;border-color:#3c9a3c}
    .bsx{flex:none;border:0;background:none;font-size:17px;color:#9aa4ae;padding:4px}
    .bsrem{display:inline-block;background:#fff4d6;color:#8a5a00;border-radius:6px;padding:0 5px;font-weight:600;font-size:11.5px;margin-right:4px}
    .bslst{margin:0;padding:0} .bsdoc{display:block;padding:9px 0;border-top:1px solid #eef1f4;color:var(--ink);text-decoration:none}
    .bsdoc:first-child{border-top:0} .bsdoc b{color:var(--blue)} .bsdoc small{display:block;color:var(--mut);font-size:12.5px}
    .bstick ul{margin:6px 0 0;padding:0} .bstick li{list-style:none;display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-top:1px solid rgba(0,0,0,.07)}
    .bstick li div{flex:1} .bstick li small{display:block;color:var(--mut);font-size:12px}
    .bstick .bsok{flex:none;border:1.5px solid #3c9a3c;color:#3c9a3c;background:#fff;border-radius:8px;font:inherit;font-size:13px;font-weight:700;padding:5px 8px}
    .bstick{border-left:5px solid #f0a500}`;
  document.head.appendChild(css);

  /* ---------- Daten ---------- */
  let vor = ls.get("bs_vor") || { at: 0, list: [] };
  let M = ls.get("bs_mappen") || [];
  let vorP = null;
  function vorschlaege(frisch) {
    if (!frisch && vor.list.length && Date.now() - vor.at < 10 * 60 * 1000) return Promise.resolve(vor.list);
    if (vorP) return vorP;
    vorP = AT.api("baustellen?vorschlaege=1" + (frisch ? "&frisch=1" : ""))
      .then(r => { if (!r.fehler || !vor.list.length) { vor = { at: Date.now(), list: r.vorschlaege || [] }; ls.set("bs_vor", vor); } return vor.list; })
      .catch(() => vor.list).finally(() => { vorP = null; });
    return vorP;
  }
  async function ladeMappen() {
    const r = await AT.api("baustellen");
    M = r.mappen || []; ls.set("bs_mappen", M);
    return M;
  }
  const mappeVon = name => M.find(m => norm(m.name) === norm(name));
  const planVon = name => vor.list.find(v => norm(v.name) === norm(name));

  // Auswahl: Baustellen aus dem Plan (Sortierung vom Server), dazu offene Mappen, die nicht (mehr) im Plan stehen
  function alle() {
    const out = vor.list.map(v => ({ name: v.name, v, m: mappeVon(v.name) }));
    for (const m of M) if (!out.some(x => norm(x.name) === norm(m.name))) out.push({ name: m.name, m });
    return out;
  }
  // Suche auch in Projekt-/KD-Nummer und Info aus dem Wochenplan (z. B. „Krantermin“)
  function filter(q, list = alle()) {
    const w = norm(q).split(" ").filter(Boolean);
    return w.length ? list.filter(x => {
      const v = x.v || planVon(x.name), n = norm([x.name, v && v.nummer, v && v.info, x.m && x.m.projekt].filter(Boolean).join(" "));
      return w.every(t => n.includes(t));
    }) : list;
  }
  function info(x) {
    const v = x.v || planVon(x.name), t = todayIso(), out = [];
    if (v) {
      if (v.art === "kd") out.push("🔧 Kundendienst");
      if (v.nummer) out.push((v.art === "kd" ? "KD-Nr. " : "Projekt ") + v.nummer);
      else if (x.m && x.m.projekt) out.push("Projekt " + x.m.projekt);
      if (v.zuletzt === t) out.push("heute");
      else if (v.zuletzt) out.push("zuletzt " + dd(v.zuletzt));
      if (v.naechster) out.push("geplant " + dd(v.naechster));
      if (v.info) out.push((v.infoTag && v.infoTag !== t ? dd(v.infoTag) + " " : "") + v.info);
    }
    return out.join(" · ") || (x.m ? "Mappe" + (x.m.projekt ? " · Projekt " + x.m.projekt : "") : "");
  }
  const finde = name => planVon(name) || null;

  /* ---------- Vorschläge an einem Eingabefeld ---------- */
  function feld(inp) {
    if (!inp || inp._bs) return;
    inp._bs = true; inp.setAttribute("autocomplete", "off");
    const box = document.createElement("div");
    box.className = "bsdd hide";
    inp.after(box);
    let L = [];
    const zeigen = () => {
      const q = inp.value.trim();
      L = filter(q).slice(0, 8);
      if (!L.length || (L.length === 1 && norm(L[0].name) === norm(q))) { box.classList.add("hide"); return; }
      box.innerHTML = L.map((x, i) => `<button type="button" data-i="${i}"><b>${esc(x.name)}</b><small>${esc(info(x))}</small></button>`).join("");
      box.classList.remove("hide");
    };
    const auf = () => { zeigen(); vorschlaege().then(() => { if (document.activeElement === inp) zeigen(); }); };
    inp.addEventListener("focus", auf);
    inp.addEventListener("click", () => { if (box.classList.contains("hide")) auf(); });   // erneut antippen öffnet die Liste wieder
    inp.addEventListener("input", () => { if (document.activeElement === inp) zeigen(); });
    inp.addEventListener("blur", () => setTimeout(() => box.classList.add("hide"), 150));
    box.addEventListener("pointerdown", e => e.preventDefault());   // Feld behält den Fokus
    box.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const x = L[+b.dataset.i];
      inp.value = x.name;
      box.classList.add("hide"); inp.blur();
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
      // Projektnummer aus dem Wochenplan bzw. der Mappe ins Protokoll übernehmen (nur wenn das Feld noch leer ist)
      const nr = (x.v && x.v.art !== "kd" && x.v.nummer) || (x.m && x.m.projekt) || "";
      const sec = inp.closest("section"), kom = sec && sec.querySelector('[data-k="kom"]');
      if (nr && kom && !kom.value.trim()) {
        kom.value = nr;
        kom.dispatchEvent(new Event("input", { bubbles: true }));
        kom.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }

  /* ---------- Auswahlfenster (z. B. „+ neue Baustelle“ im Wochenplan) ---------- */
  function waehlen({ titel = "Baustelle wählen", ohne = [], neu = true } = {}) {
    return new Promise(res => {
      const raus = new Set(ohne.map(norm));
      const sh = document.createElement("div");
      sh.className = "bssheet";
      sh.innerHTML = `<div class="bsbox"><h3>${esc(titel)}</h3>
        <input type="search" id="bsWQ" placeholder="Suchen oder neuen Namen eingeben" autocomplete="off" enterkeyhint="done">
        <div class="hint" style="margin:2px 0 0">Baustellen aus dem Wochenplan der letzten 5 Monate – aktuelle zuerst.</div>
        <div class="bslist" id="bsWL"></div>
        <button class="add" id="bsWX" style="margin:0">Abbrechen</button></div>`;
      document.body.appendChild(sh);
      const q = sh.querySelector("#bsWQ"), list = sh.querySelector("#bsWL");
      const fertig = v => { sh.remove(); res(v); };
      const malen = () => {
        const t = q.value.trim(), L = filter(t).filter(x => !raus.has(norm(x.name))).slice(0, 60);
        const exakt = L.some(x => norm(x.name) === norm(t));
        list.innerHTML = (neu && t && !exakt ? `<button class="bsrow neu" data-v="${esc(t)}"><span><b>➕ „${esc(t)}“</b><span class="bsmeta">als neue Baustelle übernehmen</span></span></button>` : "")
          + L.map(x => `<button class="bsrow" data-v="${esc(x.name)}"><span><b>${esc(x.name)}</b><span class="bsmeta">${esc(info(x))}</span></span></button>`).join("")
          || `<div class="hint">${vor.list.length ? "Nichts gefunden." : "Wird geladen …"}</div>`;
      };
      malen();
      vorschlaege().then(malen);
      list.onclick = e => { const b = e.target.closest("[data-v]"); if (b) fertig(b.dataset.v); };
      q.oninput = malen;
      q.onkeydown = e => { if (e.key === "Enter" && q.value.trim()) { const L = filter(q.value).filter(x => !raus.has(norm(x.name))); fertig(L.length === 1 ? L[0].name : q.value.trim()); } };
      sh.querySelector("#bsWX").onclick = () => fertig(null);
      sh.addEventListener("click", e => { if (e.target === sh) fertig(null); });
      setTimeout(() => q.focus(), 60);
    });
  }

  /* ---------- Startseite: Reminder für den nächsten Einsatz ---------- */
  let tick = [];   // [{ m, datum, eintraege }]
  async function tickerLaden() {
    if (!zugang() || !W || !AT.user) { tick = []; return tick; }
    try { await ladeMappen(); } catch (e) { /* offline: gemerkte Mappen */ }
    const rem = M.filter(m => m.reminder && m.reminder.length);
    if (!rem.length) { tick = []; return tick; }
    const t = todayIso(), ich = norm(AT.user.name), neu = [], schon = new Set();
    for (let i = 0; i < 10; i++) {
      const s = W.addDays(t, i);
      let data; try { data = await W.week(s); } catch (e) { continue; }
      const col = W.myCol(data), tag = W.dayOf(data, s), v = col && tag && tag.e[col];
      if (!v || W.absence(v)) continue;
      for (const teil of teile(v)) {
        const m = rem.find(x => norm(x.name) === norm(teil));
        if (!m || schon.has(m.id)) continue;
        // eigene Notiz von heute nicht sofort wieder anzeigen (man steht ja noch auf der Baustelle)
        const ein = m.reminder.filter(e => !(norm(e.von) === ich && String(e.am).slice(0, 10) === t));
        if (ein.length) { schon.add(m.id); neu.push({ m, datum: s, eintraege: ein }); }
      }
    }
    tick = neu;
    return tick;
  }
  function wann(s) {
    const t = todayIso();
    return s === t ? "heute" : s === W.addDays(t, 1) ? "morgen" : W.WT[W.wd(s)] + ", " + W.dShort(s);
  }
  function karten() {
    return tick.map(k => `<section class="card hicard bstick"><div class="hihead">📌 Info zur Baustelle · ${esc(wann(k.datum))}</div>
      <b>${esc(k.m.name)}</b>
      <ul>${k.eintraege.map(e => `<li><div>${esc(e.text)}<small>${esc(e.von)} · ${esc(zeit(e.am))}</small></div>
        <button class="bsok" data-bsok="${e.id}">✓ Erledigt</button></li>`).join("")}</ul>
      <button class="hidone" data-bsopen="${k.m.id}" style="background:var(--blue)">Baustellen-Mappe öffnen</button></section>`).join("");
  }
  function binden(box, neuMalen) {
    box.querySelectorAll("[data-bsopen]").forEach(b => b.onclick = () => { AT.tab("baustellen"); oeffne(+b.dataset.bsopen); });
    box.querySelectorAll("[data-bsok]").forEach(b => b.onclick = async () => {
      b.disabled = true; b.textContent = "…";
      try {
        await post({ aktion: "erledigt", eintrag: +b.dataset.bsok });
        for (const k of tick) k.eintraege = k.eintraege.filter(e => e.id !== +b.dataset.bsok);
        tick = tick.filter(k => k.eintraege.length);
        toast2("Als erledigt abgehakt ✓");
        ladeMappen().catch(() => {});
      } catch (e) { toast2(e.message); }
      if (neuMalen) neuMalen();
    });
  }

  /* ---------- Reiter „Baustellen“ ---------- */
  const root = document.getElementById("bsView");
  let ansicht = null;   // null = Liste, sonst { id, name, mappe }
  let suche = "", zeigeZu = false, zu = null, erlOffen = false;

  function listeMalen() {
    const offen = filter(suche, M.map(m => ({ name: m.name, m, v: planVon(m.name) })));
    const plan = filter(suche, vor.list.map(v => ({ name: v.name, v }))).filter(x => !mappeVon(x.name));
    const t = suche.trim(), exakt = [...offen, ...plan].some(x => norm(x.name) === norm(t));
    const meta = m => [m.reminder && m.reminder.length ? `📌 ${m.reminder.length} Reminder` : "", m.offen ? `${m.offen} offen` : "",
      m.dokumente ? `📄 ${m.dokumente}` : "", info({ name: m.name })].filter(Boolean).join(" · ");
    root.innerHTML = `
      <section class="card"><h2>Baustellen</h2>
        <input type="search" id="bsQ" value="${esc(suche)}" placeholder="🔍 Baustelle suchen oder neu anlegen" autocomplete="off" enterkeyhint="search">
        <div class="hint" style="margin-top:2px">Je Baustelle gibt es eine Mappe: Infos und kleine Aufgaben, Reminder für den nächsten Einsatz, Protokolle und Aufmaße.</div>
        ${t && !exakt ? `<button class="bsrow neu" data-name="${esc(t)}"><span><b>➕ Mappe für „${esc(t)}“</b><span class="bsmeta">neue Baustelle</span></span><span class="bsgo">›</span></button>` : ""}
      </section>
      <section class="card"><h3>Offene Mappen (${offen.length})</h3>
        ${offen.map(x => `<button class="bsrow" data-id="${x.m.id}"><span><b>${esc(x.name)}</b><span class="bsmeta">${esc(meta(x.m)) || "noch leer"}</span></span><span class="bsgo">›</span></button>`).join("")
          || `<div class="hint" style="margin:0">${suche ? "Keine passende Mappe." : "Noch keine Mappen – Baustelle unten antippen und eine Info eintragen."}</div>`}
      </section>
      <section class="card"><h3>Aus dem Wochenplan · letzte 5 Monate</h3>
        ${plan.slice(0, 80).map(x => `<button class="bsrow" data-name="${esc(x.name)}"><span><b>${esc(x.name)}</b><span class="bsmeta">${esc(info(x))}${x.v && x.v.tage ? " · " + x.v.tage + " Tag" + (x.v.tage === 1 ? "" : "e") : ""}</span></span><span class="bsgo">›</span></button>`).join("")
          || `<div class="hint" style="margin:0">${vor.list.length ? "Nichts gefunden." : "Wird geladen …"}</div>`}
        ${plan.length > 80 ? `<div class="hint">… und ${plan.length - 80} weitere – bitte suchen.</div>` : ""}
      </section>
      <section class="card"><button class="add" id="bsZu" style="margin:0">${zeigeZu ? "Geschlossene Mappen ausblenden" : "Geschlossene Mappen anzeigen"}</button>
        ${zeigeZu ? (zu ? zu.map(m => `<button class="bsrow" data-id="${m.id}" data-zu="1"><span><b>${esc(m.name)}</b><span class="bsmeta">geschlossen ${esc(zeit(m.geschlossen && m.geschlossen.am))} von ${esc(m.geschlossen && m.geschlossen.von)}</span></span><span class="bsgo">›</span></button>`).join("") || '<div class="hint">Noch keine geschlossenen Mappen.</div>' : '<div class="hint">Wird geladen …</div>') : ""}
      </section>`;
    const q = root.querySelector("#bsQ");
    q.oninput = () => { suche = q.value; const pos = q.selectionStart; listeMalen(); const n = root.querySelector("#bsQ"); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    root.querySelectorAll(".bsrow").forEach(b => b.onclick = () => b.dataset.id ? oeffne(+b.dataset.id) : oeffneName(b.dataset.name));
    root.querySelector("#bsZu").onclick = async () => {
      zeigeZu = !zeigeZu; listeMalen();
      if (zeigeZu) { try { zu = (await AT.api("baustellen?geschlossen=1")).mappen || []; } catch (e) { zu = []; toast2(e.message); } if (zeigeZu && !ansicht) listeMalen(); }
    };
  }

  function oeffneName(name) {
    const m = mappeVon(name);
    if (m) return oeffne(m.id);
    ansicht = { id: null, name, mappe: { id: null, name, status: "offen", eintraege: [], dokumente: [] } };
    erlOffen = false; mappeMalen(); window.scrollTo(0, 0);
  }
  async function oeffne(id) {
    const m0 = M.find(m => m.id === id);
    ansicht = { id, name: m0 ? m0.name : "", mappe: null };
    erlOffen = false;
    mappeMalen(); window.scrollTo(0, 0);
    try { const r = await AT.api("baustellen?id=" + id); if (ansicht && ansicht.id === id) { ansicht.mappe = r.mappe; ansicht.name = r.mappe.name; mappeMalen(); } }
    catch (e) { if (ansicht && ansicht.id === id) root.innerHTML = `<section class="card"><button class="bsback" id="bsBack">‹ Alle Baustellen</button><div class="lerr">${esc(e.message)}</div></section>`; bindBack(); }
  }
  const bindBack = () => { const b = root.querySelector("#bsBack"); if (b) b.onclick = () => { ansicht = null; listeMalen(); window.scrollTo(0, 0); ladeMappen().then(() => { if (!ansicht) listeMalen(); }).catch(() => {}); }; };

  function planZeile(name) {
    const v = planVon(name), t = todayIso();
    if (!v) return "Nicht im Wochenplan der letzten 5 Monate.";
    const out = [];
    if (v.zuletzt === t) out.push(`Heute im Plan${v.heute && v.heute.length ? ": " + v.heute.map(esc).join(", ") : ""}`);
    else if (v.zuletzt) out.push("Zuletzt im Plan am " + dd(v.zuletzt));
    if (v.naechster) out.push("nächster Einsatz " + esc(wann(v.naechster)));
    return out.join(" · ");
  }

  function mappeMalen() {
    const a = ansicht, m = a.mappe;
    if (!m) { root.innerHTML = `<section class="card bshead"><button class="bsback" id="bsBack">‹ Alle Baustellen</button><h2>${esc(a.name)}</h2><div class="hint">Wird geladen …</div></section>`; bindBack(); return; }
    const zuM = m.status !== "offen";
    const offen = m.eintraege.filter(e => !e.erledigt), erl = m.eintraege.filter(e => e.erledigt);
    const ich = norm(AT.user && AT.user.name), buero = AT.darf("plan_aendern");
    const li = e => `<li class="bsein${e.erledigt ? " erl" : ""}">
        <button class="bscheck" data-erl="${e.id}" data-ja="${e.erledigt ? "0" : "1"}" ${zuM ? "disabled" : ""} aria-label="${e.erledigt ? "wieder öffnen" : "erledigt"}">${e.erledigt ? "✓" : ""}</button>
        <div style="flex:1"><div class="bstext">${e.reminder ? '<span class="bsrem">📌 Reminder</span>' : ""}${esc(e.text)}</div>
          <small>${esc(e.von)} · ${esc(zeit(e.am))}${e.erledigt ? ` · ✓ erledigt von ${esc(e.erledigt.von)}, ${esc(zeit(e.erledigt.am))}` : ""}</small></div>
        ${!zuM && (buero || norm(e.von) === ich) ? `<button class="bsx" data-del="${e.id}" aria-label="löschen">🗑</button>` : ""}</li>`;
    root.innerHTML = `
      <section class="card bshead"><button class="bsback" id="bsBack">‹ Alle Baustellen</button>
        <h2>📁 ${esc(m.name)}</h2>
        <div class="bsplan">${planZeile(m.name)}</div>
        ${m.projekt ? `<div class="bsplan">Projektnummer ${esc(m.projekt)}</div>` : ""}
        ${zuM && m.geschlossen ? `<div class="warn" style="margin-top:8px">Geschlossen am ${esc(zeit(m.geschlossen.am))} von ${esc(m.geschlossen.von)}${m.geschlossen.ordner ? ` – archiviert in SharePoint: ${m.geschlossen.url ? `<a href="${esc(m.geschlossen.url)}" target="_blank" rel="noopener">${esc(m.geschlossen.ordner)}</a>` : esc(m.geschlossen.ordner)}` : ""}</div>` : ""}
      </section>
      ${zuM ? "" : `<section class="card"><h3>Neue Info / Aufgabe</h3>
        <textarea id="bsText" rows="3" placeholder="z. B. Schlüssel beim Hausmeister holen · Kernbohrung 2. OG fehlt noch · Kunde will Rückruf"></textarea>
        <label class="bschk"><input type="checkbox" id="bsRem"><span>📌 Reminder für den nächsten Einsatz<small>Wer die Baustelle als Nächstes im Wochenplan hat, sieht die Info auf seiner Startseite – bis sie abgehakt ist.</small></span></label>
        <button class="bigbtn primary" id="bsAdd">Eintragen</button></section>`}
      <section class="card"><h3>Infos & Aufgaben${offen.length ? ` (${offen.length} offen)` : ""}</h3>
        ${offen.length ? `<ul class="bslst">${offen.map(li).join("")}</ul>` : `<div class="hint" style="margin:0">${erl.length ? "Alles erledigt ✓" : "Noch keine Einträge."}</div>`}
        ${erl.length ? `<button class="add" id="bsErl" style="margin-top:8px">${erlOffen ? "Erledigte ausblenden" : `${erl.length} erledigte anzeigen`}</button>${erlOffen ? `<ul class="bslst">${erl.map(li).join("")}</ul>` : ""}` : ""}
      </section>
      <section class="card"><h3>Protokolle & Aufmaße (${m.dokumente.length})</h3>
        ${m.dokumente.map(d => `<a class="bsdoc" ${d.url ? `href="${esc(d.url)}" target="_blank" rel="noopener"` : ""}><b>${esc(d.art)}</b> · ${esc(d.name)}<small>${esc(d.von)} · ${esc(zeit(d.am))}${d.ordner ? " · " + esc(d.ordner) : ""}</small></a>`).join("")
          || `<div class="hint" style="margin:0">Noch nichts abgelegt.</div>`}
        <div class="hint">Kommen automatisch hierher, wenn beim IBN-Protokoll, Abnahmeprotokoll oder Schnellaufmaß diese Baustelle als Bauvorhaben gewählt ist. Die PDFs selbst liegen in SharePoint.</div>
      </section>
      ${m.id && AT.darf("mappen") ? `<section class="card">${zuM
        ? `<button class="add" id="bsReopen" style="margin:0">Mappe wieder öffnen</button>`
        : `<button class="bigbtn" id="bsClose" style="margin:0">📦 Mappe schließen & archivieren</button>
           <div class="hint">Wenn die Baustelle fertig ist: Alle Infos, Aufgaben und die Liste der Protokolle werden als PDF in SharePoint abgelegt. Danach erscheint die Mappe unter „Geschlossene Mappen“.</div>`}</section>`
        : m.id && !zuM ? `<div class="hint" style="margin:0 4px 12px">Ist die Baustelle fertig? Schließen und archivieren macht das Büro.</div>` : ""}`;
    bindBack();
    const $ = s => root.querySelector(s);
    if ($("#bsAdd")) $("#bsAdd").onclick = async () => {
      const text = $("#bsText").value.trim();
      if (!text) { $("#bsText").focus(); toast2("Bitte einen Text eingeben"); return; }
      const btn = $("#bsAdd"); btn.disabled = true; btn.textContent = "Wird gespeichert …";
      try {
        const r = await post(m.id ? { aktion: "eintrag", id: m.id, text, reminder: $("#bsRem").checked } : { aktion: "eintrag", baustelle: m.name, text, reminder: $("#bsRem").checked });
        ansicht = { id: r.mappe.id, name: r.mappe.name, mappe: r.mappe };
        toast2($("#bsRem").checked ? "📌 Eingetragen – wird beim nächsten Einsatz angezeigt" : "Eingetragen ✓");
        mappeMalen(); ladeMappen().catch(() => {});
      } catch (e) { toast2(e.message); btn.disabled = false; btn.textContent = "Eintragen"; }
    };
    if ($("#bsErl")) $("#bsErl").onclick = () => { erlOffen = !erlOffen; mappeMalen(); };
    root.querySelectorAll("[data-erl]").forEach(b => b.onclick = () => aendern({ aktion: "erledigt", eintrag: +b.dataset.erl, ja: b.dataset.ja === "1" }));
    root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!(await frage("Eintrag löschen?", "Der Eintrag wird endgültig gelöscht.", "Löschen"))) return;
      aendern({ aktion: "loeschen", eintrag: +b.dataset.del });
    });
    if ($("#bsReopen")) $("#bsReopen").onclick = () => aendern({ aktion: "oeffnen", id: m.id });
    if ($("#bsClose")) $("#bsClose").onclick = () => schliessen(m);
  }

  const frage = (t, h, ok) => typeof ask === "function" ? ask(t, `<p style="font-size:15px">${h}</p>`, ok) : Promise.resolve(confirm(t + "\n\n" + h));
  async function aendern(body) {
    try {
      const r = await post(body);
      if (ansicht) { ansicht.mappe = r.mappe; ansicht.id = r.mappe.id; mappeMalen(); }
      ladeMappen().catch(() => {});
    } catch (e) { toast2(e.message); }
  }

  /* ---------- Mappe schließen: Zusammenfassung als PDF nach SharePoint ---------- */
  const clean = s => String(s || "").trim().replace(/[^\wäöüÄÖÜß\- ]+/g, "").replace(/\s+/g, "_").slice(0, 50);
  function pdfBauen(m) {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
    const Mg = 15, PW = 210, Wd = PW - 2 * Mg, blue = [0, 159, 218];
    const wer = (AT.user && AT.user.name) || "", jetzt = new Date();
    const base = { theme: "grid", margin: { left: Mg, right: Mg, top: 40, bottom: 32 }, styles: { fontSize: 9, cellPadding: 1.4, lineColor: [150, 150, 150], lineWidth: .15, textColor: [20, 20, 20] },
      headStyles: { fillColor: blue, textColor: 255, fontStyle: "bold" } };
    let y = 44;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("Baustellenmappe – " + m.name, Mg, y, { maxWidth: Wd }); y += 4;
    const v = planVon(m.name);
    doc.autoTable(Object.assign({}, base, { startY: y, body: [["Baustelle", m.name], ["Projektnummer", m.projekt || "–"],
      ["Angelegt", m.angelegt ? `${zeit(m.angelegt.am)} von ${m.angelegt.von}` : "–"], ["Im Wochenplan", v ? [v.zuletzt ? "zuletzt " + dd(v.zuletzt) : "", v.tage ? v.tage + " Tage (letzte 5 Monate)" : ""].filter(Boolean).join(" · ") : "–"],
      ["Geschlossen", `${jetzt.toLocaleDateString("de-DE")} von ${wer}`]],
      columnStyles: { 0: { cellWidth: 40, fontStyle: "bold", fillColor: [244, 246, 248] } } }));
    y = doc.lastAutoTable.finalY + 7;
    const titel = t => { if (y > 255) { doc.addPage(); y = 44; } doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...blue); doc.text(t, Mg, y); doc.setTextColor(20); y += 2; };
    titel("Infos & Aufgaben");
    const ein = m.eintraege.slice().reverse();
    doc.autoTable(Object.assign({}, base, { startY: y, head: [["Datum", "Von", "Info / Aufgabe", "Status"]],
      body: ein.length ? ein.map(e => [zeit(e.am), e.von, (e.reminder ? "[Reminder] " : "") + e.text, e.erledigt ? `erledigt ${zeit(e.erledigt.am)}\n${e.erledigt.von}` : "offen"]) : [[{ content: "keine Einträge", colSpan: 4 }]],
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 32 }, 3: { cellWidth: 32 } } }));
    y = doc.lastAutoTable.finalY + 7;
    titel("Protokolle & Aufmaße (in SharePoint)");
    doc.autoTable(Object.assign({}, base, { startY: y, head: [["Art", "Datei", "Von", "Datum"]],
      body: m.dokumente.length ? m.dokumente.slice().reverse().map(d => [d.art, d.name + (d.ordner ? "\n" + d.ordner : ""), d.von, zeit(d.am)]) : [[{ content: "keine Dokumente", colSpan: 4 }]],
      columnStyles: { 0: { cellWidth: 30 }, 2: { cellWidth: 32 }, 3: { cellWidth: 24 } } }));
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (typeof LOGO !== "undefined") doc.addImage(LOGO, "JPEG", PW - Mg - 50, 10, 50, 21.3, "logo");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.text("Baustellenmappe  ·  " + m.name + "  ·  " + jetzt.toLocaleDateString("de-DE"), Mg, 30, { maxWidth: 120 });
      doc.text("Seite " + i + "/" + n, PW - Mg, 36, { align: "right" }); doc.setTextColor(20);
      if (typeof FOOTER !== "undefined") doc.addImage(FOOTER, "JPEG", Mg, 297 - 27, Wd, Wd * 165 / 1597, "footer");
    }
    return doc;
  }
  async function schliessen(m) {
    const offen = m.eintraege.filter(e => !e.erledigt).length;
    if (!(await frage("Mappe schließen?", (offen ? `<b>${offen} Eintr${offen === 1 ? "ag ist" : "äge sind"} noch offen.</b><br>` : "")
      + `Die Mappe „${esc(m.name)}“ wird als PDF in SharePoint archiviert und geschlossen.`, "Schließen & archivieren"))) return;
    if (!navigator.onLine) { toast2("Keine Internetverbindung – bitte später schließen"); return; }
    if (!window.jspdf || typeof sendOne !== "function") { toast2("PDF-Modul nicht geladen"); return; }
    const btn = root.querySelector("#bsClose"); if (btn) { btn.disabled = true; btn.textContent = "Wird archiviert …"; }
    try {
      const blob = pdfBauen(m).output("blob");
      const name = ["Baustellenmappe", clean(m.projekt), clean(m.name), todayIso()].filter(Boolean).join("_") + ".pdf";
      const r = await sendOne({ name, blob, projekt: m.projekt || "", monteur: (AT.user && AT.user.name) || "", art: "mappe" });
      const x = await post({ aktion: "schliessen", id: m.id, ordner: (r.folder || "") + "/" + (r.name || name), url: r.webUrl || "" });
      ansicht.mappe = x.mappe; mappeMalen();
      toast2("📦 Mappe archiviert ✓");
      ladeMappen().catch(() => {}); zu = null;
    } catch (e) {
      toast2("Archivieren fehlgeschlagen: " + e.message);
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "📦 Mappe schließen & archivieren"; }
    }
  }

  function zeige() {
    if (!ansicht) listeMalen(); else mappeMalen();
    if (!navigator.onLine) return;
    Promise.all([ladeMappen().catch(() => {}), vorschlaege()]).then(() => { if (!ansicht) listeMalen(); });
  }
  AT.modules.baustellen = { show: zeige };
  // Reiter verlassen mit getipptem, aber noch nicht eingetragenem Text → „Eintragen?“
  if (AT.wache) AT.wache("baustellen", () => {
    const t = root.querySelector("#bsText"), m = ansicht && ansicht.mappe;
    if (!t || !m || !t.value.trim()) return null;
    const rem = !!(root.querySelector("#bsRem") || {}).checked;
    return { titel: "Info noch nicht eingetragen", text: `<p>In der Mappe „<b>${esc(m.name)}</b>“ steht noch ein Text, der nicht eingetragen ist.</p>`,
      ja: "Eintragen", nein: "Verwerfen", tun: async () => {
        const r = await post(m.id ? { aktion: "eintrag", id: m.id, text: t.value.trim(), reminder: rem } : { aktion: "eintrag", baustelle: m.name, text: t.value.trim(), reminder: rem });
        ansicht = { id: r.mappe.id, name: r.mappe.name, mappe: r.mappe }; mappeMalen(); toast2("Eingetragen ✓"); ladeMappen().catch(() => {});
      } };
  });

  // Bauvorhaben-Felder im IBN- und Abnahmeprotokoll
  document.querySelectorAll('#app [data-k="bv"]').forEach(feld);

  AT.baustellen = { feld, waehlen, vorschlaege, finde, tickerLaden, karten, binden, oeffne, oeffneName, get mappen() { return M; } };
})();
