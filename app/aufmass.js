/* Airtec App – „Schnellaufmaß“ (unter Protokolle).
   System wählen (Kälte / Wasser), Bauvorhaben + Bereich eintragen, Artikel aus dem Lager-Artikelstamm antippen und
   Mengen über ein eigenes Zahlenfeld eingeben – auch zusammengezählt („3+2,5“). Datum kommt automatisch.
   „PDF erstellen“ legt das Aufmaß in SharePoint im Protokoll-Ordner unter „Aufmaß“ ab (ohne Netz: Postausgang). */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const say = t => { if (typeof toast === "function") toast(t); };
  const heute = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const dDE = iso => iso ? iso.split("-").reverse().join(".") : "";
  const SYS = { kaelte: "Kältesystem", wasser: "Wassersystem" };

  /* ---------- Mengen: „3+2,5“ → 5,5 ---------- */
  function summe(expr) {
    const teile = String(expr || "").split("+").map(s => s.trim()).filter(Boolean);
    if (!teile.length) return 0;
    let n = 0;
    for (const t of teile) { const v = parseFloat(t.replace(",", ".")); if (!isFinite(v)) return NaN; n += v; }
    return Math.round(n * 1000) / 1000;
  }
  const zahl = n => n.toLocaleString("de-DE", { maximumFractionDigits: 3 });

  /* ---------- Zustand (auf dem Handy gemerkt) ---------- */
  const leer = () => ({ sys: null, bv: "", bereich: "", kom: "", pos: [] });   // pos: [{ id, nr, bez, gr, einh, kat, expr }]
  let A = Object.assign(leer(), ls.get("kapp_aufmass") || {});
  const merken = () => ls.set("kapp_aufmass", A);
  let lager = ls.get("lg_cache"), kat = "oft", sub = "", ansicht = "artikel", such = "", pad = null;

  async function laden() {
    try { lager = await AT.api("lager"); ls.set("lg_cache", lager); }
    catch (e) { if (!lager) { lagerFehler = e.message; } }
    lagerFehler = lager ? "" : lagerFehler;
    paint();
  }
  let lagerFehler = "";

  /* ---------- Ansicht ---------- */
  const box = document.createElement("div");
  box.id = "aufForm"; box.className = "hide";
  document.getElementById("docBar").after(box);
  const sheet = document.createElement("div");
  sheet.id = "aufPad"; sheet.className = "hide";
  document.body.appendChild(sheet);

  const css = document.createElement("style");
  css.textContent = `
  .aufsys{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .aufsys button{border:2px solid var(--line);background:#fff;border-radius:14px;padding:16px 8px;font:inherit;font-weight:700;font-size:16px;color:var(--ink)}
  .aufsys button span{display:block;font-size:28px;margin-bottom:4px}
  .aufsys button.on{border-color:var(--blue,#009ED5);background:#e8f6fc}
  .aufdate{font-size:14px;color:var(--mut);margin-top:10px}
  .aufseg{display:flex;gap:8px;margin:0 0 10px}
  .aufseg button{flex:1;border:1.5px solid var(--line);background:#fff;border-radius:12px;padding:11px 6px;font:inherit;font-weight:700;color:var(--ink)}
  .aufseg button.on{background:var(--ink,#1f2937);border-color:var(--ink,#1f2937);color:#fff}
  .aufseg i{font-style:normal;background:#8BBC39;color:#fff;border-radius:10px;padding:0 7px;margin-left:5px;font-size:13px}
  .aufchips{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;margin:0 -2px;scrollbar-width:none}
  .aufchips::-webkit-scrollbar{display:none}
  .aufchips button{flex:0 0 auto;border:1.5px solid var(--line);background:#fff;border-radius:20px;padding:7px 12px;font:inherit;font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap}
  .aufchips button.on{background:#e8f6fc;border-color:#009ED5;color:#00739c}
  .aufchips.sub button{font-size:13px;padding:5px 10px}
  .auflist{list-style:none;margin:0;padding:0}
  .auflist li{display:flex;align-items:center;gap:10px;padding:11px 4px;border-bottom:1px solid var(--line);cursor:pointer}
  .auflist li:last-child{border-bottom:0}
  .auflist li.hat{background:#f3f9ea}
  .auflist .ai{flex:1;min-width:0}
  .auflist .ai b{display:block;font-size:15px}
  .auflist .ai small{display:block;font-size:12.5px;color:var(--mut);margin-top:1px}
  .auflist .aq{flex:0 0 auto;min-width:64px;text-align:center;border-radius:10px;padding:8px 8px;font-weight:700;font-size:15px;background:#eef1f4;color:var(--mut)}
  .auflist li.hat .aq{background:#8BBC39;color:#fff}
  .auflist .aq small{display:block;font-size:10.5px;font-weight:600;opacity:.9}
  .aufkat{font-size:12.5px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.03em;margin:14px 0 2px}
  #aufPad{position:fixed;inset:0;z-index:40;background:rgba(15,23,42,.45);display:flex;align-items:flex-end}
  #aufPad.hide{display:none}
  .aufpad{background:#fff;width:100%;max-width:520px;margin:0 auto;border-radius:18px 18px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom))}
  .aufpad h3{margin:0;font-size:16px}
  .aufpad .pg{font-size:13px;color:var(--mut);margin-top:2px}
  .aufpad .disp{margin:12px 0 10px;background:#f4f6f8;border-radius:12px;padding:10px 12px;min-height:58px}
  .aufpad .ex{font-size:24px;font-weight:700;letter-spacing:.02em;word-break:break-all}
  .aufpad .eq{font-size:14px;color:var(--mut);margin-top:2px}
  .aufpad .keys{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .aufpad .keys button{border:0;border-radius:12px;padding:15px 0;font:inherit;font-size:22px;font-weight:700;background:#eef1f4;color:var(--ink)}
  .aufpad .keys button.op{background:#e3f4fb;color:#00739c}
  .aufpad .keys button.ok{background:#009ED5;color:#fff;grid-column:span 2;font-size:18px}
  .aufpad .keys button.del{background:#fdecec;color:#b42318;font-size:16px}
  .aufpad .unten{display:flex;justify-content:space-between;margin-top:10px}
  .aufpad .unten button{border:0;background:none;font:inherit;color:var(--mut);padding:6px 2px}
  .aufpad .unten button.weg{color:#b42318}
  .auffrei{display:none}
  .auffrei.on{display:block}
  `;
  document.head.appendChild(css);

  function arts() { return (lager && lager.arts) || []; }
  const katName = id => ((lager && lager.kats) || []).find(k => k.id === id)?.name || "";
  const posVon = nr => A.pos.find(p => p.nr && p.nr === nr);
  const nutzung = () => ls.get("auf_oft") || {};

  function paint() {
    if (box.classList.contains("hide")) return;
    const n = A.pos.length;
    let h = `<section class="card"><h2>System</h2><div class="aufsys">
        <button data-sys="kaelte" class="${A.sys === "kaelte" ? "on" : ""}"><span>❄️</span>Kältesystem</button>
        <button data-sys="wasser" class="${A.sys === "wasser" ? "on" : ""}"><span>💧</span>Wassersystem</button></div></section>`;
    if (!A.sys) { box.innerHTML = h + `<section class="card"><div class="hint" style="margin:0">Bitte zuerst wählen, ob es ein Kälte- oder ein Wassersystem wird.</div></section>`; bind(); return; }
    if (A.sys === "wasser") { box.innerHTML = h + `<section class="card"><h2>💧 Wassersystem</h2><p style="margin:0;font-size:15px">Das Aufmaß für Wassersysteme ist noch in Vorbereitung. Bitte vorerst das Kältesystem nutzen.</p></section>`; bind(); return; }
    h += `<section class="card"><h2>Bauvorhaben</h2>
        <label>Bauvorhaben *</label><input id="aBv" value="${esc(A.bv)}" autocomplete="off">
        <label>Bereich</label><input id="aBer" value="${esc(A.bereich)}" placeholder="z. B. 2. OG, Büro 2.14 / Dach / Technikraum" autocomplete="off">
        <label>Projektnummer</label><input id="aKom" value="${esc(A.kom)}" autocomplete="off">
        <div class="aufdate">📅 Datum: <b>${dDE(heute())}</b> (wird automatisch eingetragen)</div></section>`;
    h += `<div class="aufseg"><button data-ans="artikel" class="${ansicht === "artikel" ? "on" : ""}">Artikel erfassen</button><button data-ans="liste" class="${ansicht === "liste" ? "on" : ""}">Erfasst${n ? `<i>${n}</i>` : ""}</button></div>`;
    h += ansicht === "liste" ? liste() : katalog();
    box.innerHTML = h;
    bind();
  }

  function katalog() {
    if (!lager) return `<section class="card">${lagerFehler ? `<div class="lerr">Artikelstamm nicht geladen: ${esc(lagerFehler)}</div>` : "Artikel werden geladen …"}</section>`;
    return `<section class="card">
      <input id="aSuch" type="search" placeholder="🔍 Artikel suchen (z. B. Kupfer 12, Kabelkanal)" value="${esc(such)}" autocomplete="off">
      <div id="aufKatBody">${katBody()}</div>
      <button class="add" data-frei>＋ Artikel, der nicht in der Liste ist</button>
    </section>`;
  }

  function katBody() {
    const kats = [{ id: "oft", name: "Oft benutzt", sym: "⭐" }, ...lager.kats];
    if (!kats.some(k => k.id === kat)) kat = "oft";
    const K = lager.kats.find(k => k.id === kat);
    const q = norm(such);
    let list, subs = "";
    if (q) {
      const w = q.split(/\s+/);
      list = arts().filter(a => { const t = norm([a.bez, a.gr, a.sub, a.herst, a.best, a.such, a.nr].join(" ")); return w.every(x => t.includes(x)); }).slice(0, 100);
    } else if (!K) {
      const o = nutzung();
      list = arts().filter(a => o[a.nr] || a.fav || posVon(a.nr)).sort((a, b) => (o[b.nr] || 0) - (o[a.nr] || 0) || (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.pos - b.pos).slice(0, 60);
    } else {
      const used = K.subs.filter(s => arts().some(a => a.kat === K.id && a.sub === s));
      if (sub && !used.includes(sub)) sub = "";
      if (used.length) subs = `<div class="aufchips sub"><button data-sub="" class="${sub ? "" : "on"}">Alle</button>${used.map(s => `<button data-sub="${esc(s)}" class="${s === sub ? "on" : ""}">${esc(s)}</button>`).join("")}</div>`;
      list = arts().filter(a => a.kat === K.id && (!sub || a.sub === sub)).sort((a, b) => a.pos - b.pos);
    }
    return `<div class="aufchips" style="margin-top:10px">${kats.map(k => `<button data-kat="${k.id}" class="${!q && k.id === kat ? "on" : ""}">${esc(k.sym)} ${esc(k.name)}</button>`).join("")}</div>
      ${q ? "" : subs}
      ${list.length ? `<ul class="auflist">${list.map(zeile).join("")}</ul>`
        : `<div class="hint">${q ? "Nichts gefunden – dann unten als freien Artikel eintragen." : !K ? "Hier erscheinen die Artikel, die Sie am häufigsten erfassen – bitte oben eine Kategorie wählen oder suchen." : "In dieser Kategorie sind keine Artikel."}</div>`}`;
  }

  function zeile(a) {
    const p = posVon(a.nr), s = p ? summe(p.expr) : 0;
    const info = [a.gr, a.herst].filter(Boolean).map(esc).join(" · ");
    return `<li data-nr="${esc(a.nr)}" class="${p ? "hat" : ""}"><div class="ai"><b>${esc(a.bez)}</b>${info ? `<small>${info}</small>` : ""}</div>
      <div class="aq">${p ? esc(zahl(s)) : "＋"}<small>${esc(a.einh || "Stk")}</small></div></li>`;
  }

  function liste() {
    if (!A.pos.length) return `<section class="card"><div class="hint" style="margin:0">Noch nichts erfasst. Unter „Artikel erfassen“ einen Artikel antippen und die Menge eingeben.</div>
      <button class="add" data-frei>＋ Artikel, der nicht in der Liste ist</button></section>`;
    const gruppen = new Map();
    for (const p of A.pos) { const g = p.kat ? katName(p.kat) || "Sonstiges" : "Freie Artikel"; if (!gruppen.has(g)) gruppen.set(g, []); gruppen.get(g).push(p); }
    return `<section class="card"><h2>Erfasst (${A.pos.length} Positionen)</h2>
      ${[...gruppen].map(([g, L]) => `<div class="aufkat">${esc(g)}</div><ul class="auflist">${L.map(p => {
        const s = summe(p.expr);
        return `<li data-id="${esc(p.id)}" class="hat"><div class="ai"><b>${esc(p.bez)}</b><small>${[p.gr, p.expr.includes("+") ? p.expr : ""].filter(Boolean).map(esc).join(" · ")}</small></div>
          <div class="aq">${esc(zahl(s))}<small>${esc(p.einh)}</small></div></li>`;
      }).join("")}</ul>`).join("")}
      <button class="add" data-frei>＋ Artikel, der nicht in der Liste ist</button>
      <div class="hint">Antippen zum Ändern. Mit „PDF erstellen“ wird das Aufmaß in SharePoint abgelegt.</div></section>`;
  }

  /* ---------- Zahlenfeld ---------- */
  function padAuf(p) {
    pad = { id: p.id, expr: p.expr || "", neu: !!p.expr, p };
    sheet.classList.remove("hide");
    padPaint();
  }
  function padPaint() {
    const p = pad.p, s = summe(pad.expr);
    sheet.innerHTML = `<div class="aufpad" role="dialog" aria-label="Menge eingeben">
      <h3>${esc(p.bez)}</h3><div class="pg">${esc([p.gr, p.einh].filter(Boolean).join(" · "))}${pad.neu ? " · neue Zahl wird dazugezählt" : ""}</div>
      <div class="disp"><div class="ex">${esc(pad.expr) || "&nbsp;"}</div><div class="eq">${pad.expr ? (isNaN(s) ? "Eingabe prüfen" : "= " + esc(zahl(s)) + " " + esc(p.einh)) : "Menge eingeben – mit ＋ zusammenzählen"}</div></div>
      <div class="keys">
        ${["7", "8", "9"].map(k => `<button data-k="${k}">${k}</button>`).join("")}<button data-k="del" class="del" aria-label="Löschen">⌫</button>
        ${["4", "5", "6"].map(k => `<button data-k="${k}">${k}</button>`).join("")}<button data-k="+" class="op">＋</button>
        ${["1", "2", "3"].map(k => `<button data-k="${k}">${k}</button>`).join("")}<button data-k="," class="op">,</button>
        <button data-k="C" class="del">C</button><button data-k="0">0</button><button data-k="ok" class="ok">OK</button>
      </div>
      <div class="unten"><button data-k="x">Abbrechen</button>${A.pos.some(x => x.id === pad.id) ? `<button data-k="weg" class="weg">Position entfernen</button>` : ""}</div></div>`;
  }
  function padTaste(k) {
    let e = pad.expr;
    if (k === "x") { pad = null; sheet.classList.add("hide"); return; }
    if (k === "weg") { A.pos = A.pos.filter(x => x.id !== pad.id); merken(); pad = null; sheet.classList.add("hide"); paint(); return; }
    if (k === "ok") return padOk();
    if (k === "C") { e = ""; pad.neu = false; }
    else if (k === "del") { e = e.slice(0, -1); pad.neu = false; }
    else if (k === "+") { if (e && !/[+,]$/.test(e)) e += "+"; pad.neu = false; }
    else if (k === ",") {
      if (pad.neu) { e += "+"; pad.neu = false; }
      const last = e.split("+").pop();
      if (!last.includes(",")) e += last === "" ? "0," : ",";
    }
    else { if (pad.neu) { e += "+"; pad.neu = false; } e += k; }
    pad.expr = e.slice(0, 80);
    padPaint();
  }
  function padOk() {
    const e = pad.expr.replace(/[+,]+$/, ""), s = summe(e);
    if (isNaN(s)) { say("Bitte die Eingabe prüfen"); return; }
    const i = A.pos.findIndex(x => x.id === pad.id);
    if (!e || s === 0) { if (i >= 0) A.pos.splice(i, 1); }
    else if (i >= 0) A.pos[i].expr = e;
    else {
      A.pos.push(Object.assign({}, pad.p, { expr: e }));
      if (pad.p.nr) { const o = nutzung(); o[pad.p.nr] = (o[pad.p.nr] || 0) + 1; ls.set("auf_oft", o); }
    }
    merken(); pad = null; sheet.classList.add("hide"); paint();
  }
  sheet.addEventListener("click", e => {
    if (e.target === sheet) { pad = null; sheet.classList.add("hide"); return; }
    const b = e.target.closest("[data-k]"); if (b && pad) padTaste(b.dataset.k);
  });

  // Artikel, der nicht im Lager steht
  function frei() {
    const bez = (prompt("Bezeichnung des Artikels:") || "").trim();
    if (!bez) return;
    const gr = (prompt("Größe / Typ (optional):") || "").trim();
    const einh = (prompt("Einheit (z. B. Stk, m, kg):", "Stk") || "Stk").trim() || "Stk";
    padAuf({ id: "f" + Date.now(), nr: "", bez, gr, einh, kat: "", expr: "" });
  }

  function bind() {
    const feld = (id, k) => { const el = box.querySelector(id); if (el) el.oninput = () => { A[k] = el.value; merken(); }; };
    feld("#aBv", "bv"); feld("#aBer", "bereich"); feld("#aKom", "kom");
    if (AT.baustellen && box.querySelector("#aBv")) AT.baustellen.feld(box.querySelector("#aBv"));   // Baustellen aus dem Wochenplan vorschlagen
    // Suche: nur die Liste neu aufbauen, damit Eingabefeld und Tastatur bleiben
    const s = box.querySelector("#aSuch");
    if (s) s.oninput = () => { such = s.value; box.querySelector("#aufKatBody").innerHTML = katBody(); };
  }
  // Klicks zentral auswerten (die Liste wird bei der Suche neu aufgebaut)
  box.addEventListener("click", e => {
    const t = e.target.closest("[data-sys],[data-ans],[data-kat],[data-sub],[data-frei],li[data-nr],li[data-id]");
    if (!t) return;
    const d = t.dataset;
    if (d.sys) { A.sys = d.sys; merken(); paint(); if (A.sys === "kaelte" && !lager) laden(); }
    else if (d.ans) { ansicht = d.ans; paint(); }
    else if (d.kat) { kat = d.kat; sub = ""; such = ""; paint(); }
    else if (d.sub !== undefined && t.matches("[data-sub]")) { sub = d.sub; paint(); }
    else if (t.matches("[data-frei]")) frei();
    else if (d.nr) {
      const a = arts().find(x => x.nr === d.nr); if (!a) return;
      padAuf(posVon(a.nr) || { id: "a" + a.nr, nr: a.nr, bez: a.bez, gr: a.gr || "", einh: a.einh || "Stk", kat: a.kat, expr: "" });
    } else if (d.id) { const p = A.pos.find(x => x.id === d.id); if (p) padAuf(p); }
  });

  /* ---------- PDF ---------- */
  const clean = s => String(s || "").trim().replace(/[^\wäöüÄÖÜß\- ]+/g, "").replace(/\s+/g, "_").slice(0, 50);
  function dateiName() { return ["Aufmass", clean(A.kom), clean(A.bv), clean(A.bereich), heute()].filter(Boolean).join("_") + ".pdf"; }

  function baue() {
    const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
    const M = 15, PW = 210, W = PW - 2 * M, blue = [0, 159, 218], green = [141, 190, 60];
    const wer = (AT.user && AT.user.name) || (typeof monteur !== "undefined" && monteur && monteur.name) || "";
    let y = 44;
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("Schnellaufmaß – " + SYS[A.sys], M, y);
    y += 4;
    const base = { theme: "grid", margin: { left: M, right: M, top: 40, bottom: 32 }, styles: { fontSize: 9, cellPadding: 1.4, lineColor: [150, 150, 150], lineWidth: .15, textColor: [20, 20, 20] },
      headStyles: { fillColor: blue, textColor: 255, fontStyle: "bold" } };
    doc.autoTable(Object.assign({}, base, { startY: y, body: [["Bauvorhaben", A.bv.trim()], ["Bereich", A.bereich.trim() || "–"], ["Projektnummer", A.kom.trim() || "–"], ["Datum", dDE(heute())], ["Aufgenommen von", wer || "–"]],
      columnStyles: { 0: { cellWidth: 45, fontStyle: "bold", fillColor: [244, 246, 248] } } }));
    y = doc.lastAutoTable.finalY + 7;
    // Positionen nach Kategorie (Reihenfolge wie im Lager), freie Artikel am Ende
    const kats = ((lager && lager.kats) || []).map(k => k.id);
    const L = A.pos.map((p, i) => ({ p, i, k: p.kat ? kats.indexOf(p.kat) : 9999 })).sort((a, b) => (a.k < 0 ? 9998 : a.k) - (b.k < 0 ? 9998 : b.k) || a.i - b.i);
    const body = []; let g = null, nr = 0;
    for (const { p } of L) {
      const gn = p.kat ? katName(p.kat) || "Sonstiges" : "Freie Artikel";
      if (gn !== g) { g = gn; body.push([{ content: gn, colSpan: 5, styles: { fontStyle: "bold", halign: "left", fillColor: [232, 246, 252], textColor: [0, 115, 156] } }]); }
      const s = summe(p.expr);
      body.push([String(++nr), p.bez + (p.gr ? "\n" + p.gr : ""), p.expr.includes("+") ? p.expr : "", { content: zahl(s), styles: { fontStyle: "bold", halign: "right" } }, p.einh]);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...blue); doc.text("Material", M, y); doc.setTextColor(20); y += 2;
    doc.autoTable(Object.assign({}, base, { startY: y, head: [["Pos.", "Artikel", "Aufnahme", "Menge", "Einheit"]], body,
      columnStyles: { 0: { cellWidth: 11, halign: "center" }, 2: { cellWidth: 38, textColor: [90, 90, 90] }, 3: { cellWidth: 20 }, 4: { cellWidth: 17 } } }));
    y = doc.lastAutoTable.finalY + 6;
    if (y > 250) { doc.addPage(); y = 42; }
    const now = new Date();
    doc.setDrawColor(...green); doc.setLineWidth(.6); doc.line(M, y, M, y + 9);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(`${A.pos.length} Positionen · digital erfasst am ${now.toLocaleDateString("de-DE")} um ${now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr mit der Airtec KApp.`, M + 3, y + 5.5);
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (typeof LOGO !== "undefined") doc.addImage(LOGO, "JPEG", PW - M - 50, 10, 50, 21.3, "logo");
      doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
      doc.text("Schnellaufmaß  ·  " + A.bv.trim() + (A.bereich.trim() ? "  ·  " + A.bereich.trim() : "") + "  ·  " + dDE(heute()), M, 30, { maxWidth: 120 });
      doc.text("Seite " + i + "/" + n, PW - M, 36, { align: "right" }); doc.setTextColor(20);
      if (typeof FOOTER !== "undefined") doc.addImage(FOOTER, "JPEG", M, 297 - 27, W, W * 165 / 1597, "footer");
    }
    return doc;
  }

  async function pdf() {
    if (!A.sys) { say("Bitte zuerst das System wählen"); return; }
    if (A.sys === "wasser") { say("Das Wassersystem ist noch in Vorbereitung"); return; }
    if (!A.bv.trim()) { say("Bitte Bauvorhaben eintragen"); const f = box.querySelector("#aBv"); if (f) f.focus(); return; }
    if (!A.pos.length) { say("Noch keine Artikel erfasst"); return; }
    if (!window.jspdf) { say("PDF-Modul nicht geladen – Internetverbindung prüfen"); return; }
    let blob; const name = dateiName();
    try { blob = baue().output("blob"); } catch (e) { console.error(e); say("Fehler beim Erstellen: " + e.message); return; }
    const o = { name, blob, projekt: A.kom.trim(), monteur: (AT.user && AT.user.name) || "", art: "aufmass", bv: A.bv.trim(), ts: Date.now() };
    try {
      say("Wird in SharePoint gespeichert …");
      const r = await sendOne(o);
      if (await ask("Gespeichert ✓", `<p style="font-size:15px">Das Aufmaß liegt in SharePoint:</p><p style="font-size:14px"><b>${esc(r.folder)}/</b><br>${esc(r.name)}</p>`, "Neues Aufmaß")) neuLeer();
    } catch (e) {
      if (e.status === 401) { try { await outAdd(o); outBadge(); } catch (e3) { saveLocal(blob, name); } AT.logout(true); return; }
      try {
        await outAdd(o); outBadge();
        if (await ask(e.status ? "Fehler beim Speichern in SharePoint" : "Noch nicht hochgeladen",
          `<p style="font-size:15px">${e.status ? "Der Server meldet: " + esc(e.message) : "Keine Verbindung zum Server."}</p><p style="font-size:14px">Das Aufmaß ist auf dem Handy gesichert und wird automatisch hochgeladen, sobald wieder Internet da ist.</p>`, "PDF zusätzlich teilen")) saveLocal(blob, name);
      } catch (e2) { say("Upload fehlgeschlagen – PDF wird lokal gespeichert"); saveLocal(blob, name); }
    }
  }

  function neuLeer() { const sys = A.sys; A = leer(); A.sys = sys; ansicht = "artikel"; such = ""; merken(); paint(); window.scrollTo(0, 0); }
  async function neu() {
    if (!A.pos.length && !A.bv && !A.bereich) { neuLeer(); return; }
    if (await ask("Neues Aufmaß?", "Alle Eingaben dieses Aufmaßes werden gelöscht.", "Löschen")) neuLeer();
  }

  AT.aufmass = {
    show(on) {
      box.classList.toggle("hide", !on);
      if (!on) { sheet.classList.add("hide"); pad = null; return; }
      paint();
      if (A.sys === "kaelte") laden();
    },
    pdf, neu, summe,
  };
  if (typeof S !== "undefined" && S.docOk && S.doc === "aufm") AT.aufmass.show(true);
})();
