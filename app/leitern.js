/* Airtec KApp – Allgemeines → Leitern (Leiter-Prüfbuch, lib/leitern.js)
   • alle sehen die Leitern und ob sie geprüft sind
   • Recht „leitern“ (befähigte Person): Leitern anlegen/ändern, jährliche Prüfung mit Prüfpunkten abhaken, aussondern, Export */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const de = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
  const ERG = { ok: "✅ Ohne Mängel", maengel: "⛔ Mängel – gesperrt", aussondern: "🗑 Ausgesondert" };

  const css = document.createElement("style");
  css.textContent = `
  #leView h3{margin:0 0 8px;font-size:15px} #leView .lesum{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 2px}
  #leView .leli{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid var(--line,#e6e9ee);cursor:pointer}
  #leView .leli:last-child{border-bottom:0} #leView .leli small{display:block;color:var(--mut);font-size:12.5px;margin-top:2px}
  #leView .tuev{white-space:nowrap} #leView .tuev.gesp{background:#fde2e2;color:#a61b1b}
  #leView .pez{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--line,#e6e9ee);font-size:14.5px}
  #leView .pez b{text-align:right}
  #leView .lepu{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line,#e6e9ee);font-size:14px}
  #leView .lepu button{flex:none;min-width:86px;border:1px solid #cfd6de;border-radius:9px;padding:7px 8px;background:#eaf7ee;color:#17733a;font-weight:700;cursor:pointer}
  #leView .lepu button.m{background:#fde2e2;color:#a61b1b;border-color:#f3b4b4}
  #leView .lehist{padding:7px 0;border-bottom:1px solid var(--line,#e6e9ee);font-size:13.5px}
  #leView .lehist:last-child{border-bottom:0} #leView .lehist .x{border:0;background:none;color:var(--bad);font-size:15px;padding:2px 6px;cursor:pointer;float:right}
  #leView .lehist ul{margin:4px 0 0 18px;padding:0;color:#a61b1b}
  #leView textarea{width:100%;min-height:60px;font:inherit;padding:10px;border:1px solid #cfd6de;border-radius:10px;box-sizing:border-box}
  #leView .back{border:0;background:none;color:var(--blue);font-weight:700;padding:4px 0 10px;cursor:pointer;font-size:15px}`;
  document.head.appendChild(css);

  let el = null, data = null, fehler = "", wahl = null, modus = "", busy = false, suche = "", zeigAus = false;
  let pf = null;   // Prüfformular: { datum, pruefer, maengel:Set, ergebnis, bem }
  let scan = null;     // gescannter Aufkleber ohne Leiter: { code, z }
  let zuCode = "";     // neue Leiter erfassen und danach diesen Aufkleber zuordnen
  let warteScan = null; // von außen (Logbuch, Handy-Kamera): { code, r } nach dem Öffnen anwenden

  /* ---------- QR-Aufkleber ---------- */
  async function scanStart() {
    if (!AT.qr) return;
    const code = await AT.qr.scan("QR-Code an der Leiter scannen");
    if (!code) return;
    try { zeigeScan(code, await AT.qr.suchen(code)); } catch (e) { say(e.message); }
  }
  function zeigeScan(code, r) {
    const z = r && r.zuordnung;
    modus = "";
    if (z && z.art === "leiter") { scan = null; wahl = +z.ziel; }
    else { scan = { code, z }; wahl = null; }
    paint(); window.scrollTo(0, 0);
  }
  async function zuordnen(l, code, btn) {
    try {
      await AT.api("qr", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aktion: "zuordnen", code, art: "leiter", ziel: String(l.id), bezeichnung: "Leiter " + l.nr, ersetzen: true }) });
      say(`QR-Aufkleber ist jetzt Leiter ${l.nr} ✓`); scan = null;
      data = await AT.api("leitern"); wahl = l.id; modus = "";
    } catch (e) { say(e.message); if (btn) btn.disabled = false; }
    paint();
  }
  // Detail: Aufkleber scannen und dieser Leiter zuordnen
  async function aufkleber(l, btn) {
    const code = await AT.qr.scan(`Aufkleber für Leiter ${l.nr} scannen`);
    if (!code) return;
    let r; try { r = await AT.qr.suchen(code); } catch (e) { return say(e.message); }
    const z = r.zuordnung;
    if (z && z.art === "leiter" && +z.ziel === l.id) return say("Dieser Aufkleber gehört schon zu dieser Leiter ✓");
    if (z && !confirm(`Dieser Aufkleber gehört schon zu „${z.bezeichnung || z.ziel}“ (${(AT.qr.ART || {})[z.art] || z.art}).\nTrotzdem Leiter ${l.nr} zuordnen?`)) return;
    if (btn) btn.disabled = true;
    zuordnen(l, code, btn);
  }
  function scanKarte() {
    if (!scan) return "";
    const z = scan.z;
    let h;
    if (z) h = `<b>Dieser Code gehört nicht zu einer Leiter.</b><div class="hint" style="margin:6px 0 0">${esc((AT.qr.ART || {})[z.art] || z.art)}: ${esc(z.bezeichnung || z.ziel)}</div>
      <button class="bigbtn primary" id="leScOpen" style="margin-top:10px">Öffnen</button>`;
    else {
      const frei = L().filter(l => l.status !== "aus" && !l.qr);
      h = `<b>Dieser QR-Code ist noch keiner Leiter zugeordnet.</b> <span class="qrcode">${esc(scan.code)}</span>`;
      if (data.pflegen) h += `<div class="hint" style="margin:8px 0 4px">Zu welcher Leiter gehört der Aufkleber?</div>
        ${frei.length ? frei.map(l => `<div class="leli" data-zu="${l.id}"><div><b>🪜 ${esc(l.nr)}</b> ${esc(kurz(l))}<small>${esc(l.standort || "")}</small></div><span class="tuev">Zuordnen</span></div>`).join("")
          : `<div class="hint" style="margin:0">Alle erfassten Leitern haben schon einen Aufkleber.</div>`}
        <button class="add" id="leScNeu" style="margin-top:8px;width:100%">＋ Neue Leiter mit diesem Aufkleber erfassen</button>`;
      else h += `<div class="hint" style="margin:8px 0 0">Den Aufkleber ordnet das Büro bzw. der Leiter-Prüfer zu.</div>`;
    }
    return `<section class="card">${h}<button class="add" id="leScX" style="margin-top:8px;width:100%">Schließen</button></section>`;
  }

  const L = () => (data && data.leitern) || [];
  const artName = k => ((data && data.arten) || []).find(a => a[0] === k)?.[1] || k || "";
  const punkteFuer = l => data.punkte.filter(p => !p.arten || p.arten.includes(l.art) || l.art === "sonstige");
  const punktText = k => (data.punkte.find(p => p.k === k) || {}).t || k;
  const badge = l => l.status === "aus" ? `<span class="tuev leer">Ausgesondert ${de(l.ausgesondert)}</span>`
    : l.status === "leer" ? `<span class="tuev leer">Noch nicht geprüft</span>`
    : l.status === "gesperrt" ? `<span class="tuev gesp">⛔ Gesperrt – Mängel</span>`
    : l.status === "faellig" ? `<span class="tuev ueberfaellig">Überfällig seit ${de(l.naechste)}</span>`
    : l.status === "bald" ? `<span class="tuev bald">Prüfen bis ${de(l.naechste)}</span>`
    : `<span class="tuev">Geprüft bis ${de(l.naechste)}</span>`;
  const kurz = l => [artName(l.art), l.material, l.groesse].filter(Boolean).join(" · ");

  async function load() {
    try { data = await AT.api("leitern"); fehler = ""; } catch (e) { fehler = e.message; }
    paint();
  }
  async function post(body, msg, btn) {
    if (busy) return false; busy = true; if (btn) btn.disabled = true;
    let ok = false;
    try { data = await AT.api("leitern", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); say(msg); ok = true; }
    catch (e) { say(e.message); if (btn) btn.disabled = false; }
    busy = false; return ok;
  }

  function uebersicht() {
    const aktiv = L().filter(l => l.status !== "aus"), aus = L().filter(l => l.status === "aus");
    const n = s => aktiv.filter(l => l.status === s).length;
    const q = suche.toLowerCase();
    const treffer = aktiv.filter(l => !q || [l.nr, l.standort, artName(l.art), l.hersteller, l.groesse].join(" ").toLowerCase().includes(q));
    const rang = { gesperrt: 0, faellig: 1, leer: 2, bald: 3, ok: 4 };
    treffer.sort((a, b) => rang[a.status] - rang[b.status] || a.nr.localeCompare(b.nr, "de", { numeric: true }));
    const zeile = l => `<div class="leli" data-le="${l.id}"><div><b>🪜 ${esc(l.nr)}</b> ${esc(kurz(l))}<small>${esc(l.standort || "ohne Standort")}</small></div>${badge(l)}</div>`;
    return `<section class="card"><h3>🪜 Leiter-Prüfbuch</h3>
      <div class="lesum">${n("ok") ? `<span class="tuev">✓ ${n("ok")} in Ordnung</span>` : ""}${n("bald") ? `<span class="tuev bald">${n("bald")} bald fällig</span>` : ""}${n("faellig") ? `<span class="tuev ueberfaellig">${n("faellig")} überfällig</span>` : ""}${n("gesperrt") ? `<span class="tuev gesp">${n("gesperrt")} gesperrt</span>` : ""}${n("leer") ? `<span class="tuev leer">${n("leer")} noch nicht geprüft</span>` : ""}${aktiv.length ? "" : `<span class="hint" style="margin:0">Noch keine Leitern erfasst.</span>`}</div>
      <div class="hint" style="margin:8px 0 0">Prüfung alle ${data.intervall} Monate durch eine befähigte Person (BetrSichV § 14, DGUV Information 208-016). Zusätzlich vor jeder Benutzung kurz selbst ansehen – beschädigte Leitern nicht benutzen und dem Büro melden.</div>
      <button class="bigbtn${data.pflegen ? "" : " primary"}" id="leScan" style="margin-top:10px">📷 QR-Code an der Leiter scannen</button>
      ${data.pflegen ? `<div class="row" style="margin-top:10px"><div><button class="bigbtn primary" id="leNeu" style="margin:0">＋ Leiter erfassen</button></div>
        <div><button class="add" id="leCsv" style="margin:0;width:100%">📄 Prüfbuch exportieren</button></div></div>` : ""}
    </section>
    ${scanKarte()}
    ${aktiv.length > 6 ? `<input id="leSuch" data-nodirty placeholder="Suchen: Nr., Standort, Art …" value="${esc(suche)}" style="margin-bottom:10px">` : ""}
    ${treffer.length ? `<section class="card">${treffer.map(zeile).join("")}</section>` : ""}
    ${aus.length ? `<section class="card"><button class="back" id="leAus" style="padding:0">${zeigAus ? "▾" : "▸"} Ausgesonderte Leitern (${aus.length})</button>${zeigAus ? aus.map(zeile).join("") : ""}</section>` : ""}`;
  }

  function formular(l) {
    l = l || { art: "steh" };
    return `<button class="back" id="leZur">‹ Zurück</button><section class="card"><h3>${l.id ? "Leiter " + esc(l.nr) + " ändern" : "Neue Leiter erfassen"}</h3>
      ${!l.id && zuCode ? `<div class="hint" style="margin:0 0 6px">📷 Der gescannte Aufkleber <span class="qrcode">${esc(zuCode)}</span> wird nach dem Speichern dieser Leiter zugeordnet.</div>` : ""}
      <div class="row"><div><label>Leiter-Nr. *</label><input id="fNr" value="${esc(l.nr || "")}" placeholder="z. B. L-01 (steht auf dem Aufkleber)"></div>
        <div><label>Art</label><select id="fArt">${data.arten.map(a => `<option value="${a[0]}" ${a[0] === l.art ? "selected" : ""}>${a[1]}</option>`).join("")}</select></div></div>
      <div class="row"><div><label>Material</label><select id="fMat"><option value="">–</option>${data.material.map(m => `<option ${m === l.material ? "selected" : ""}>${m}</option>`).join("")}</select></div>
        <div><label>Größe</label><input id="fGr" value="${esc(l.groesse || "")}" placeholder="z. B. 2×9 Sprossen, 6 Stufen"></div></div>
      <div class="row"><div><label>Hersteller / Typ</label><input id="fHe" value="${esc(l.hersteller || "")}" placeholder="z. B. Hymer 4045"></div>
        <div><label>Angeschafft am</label><input type="date" id="fAn" value="${esc(l.anschaffung || "")}"></div></div>
      <label>Standort</label><input id="fSo" value="${esc(l.standort || "")}" placeholder="z. B. Lager, Auto BOR-AT 123, Baustelle …">
      <label>Bemerkung</label><textarea id="fBe">${esc(l.bem || "")}</textarea>
      <button class="bigbtn primary" id="fSave" style="margin-top:10px">Speichern</button>
      ${l.id ? `<button class="add" id="fDel" style="margin-top:10px;width:100%;color:var(--bad)">Leiter ganz löschen (nur bei Fehleingabe)</button>` : ""}
    </section>`;
  }

  function pruefFormular(l) {
    const ps = punkteFuer(l);
    return `<section class="card" id="lePf"><h3>✓ Prüfung eintragen</h3>
      <div class="row"><div><label>Prüfdatum</label><input type="date" id="pDat" value="${pf.datum}" max="${data.heute}"></div>
        <div><label>Geprüft von</label><input id="pWer" value="${esc(pf.pruefer)}"></div></div>
      <div class="hint" style="margin:8px 0 2px">Alles ist auf „i. O.“ – nur antippen, was einen Mangel hat.</div>
      ${ps.map(p => `<div class="lepu"><span>${esc(p.t)}</span><button data-pk="${p.k}" class="${pf.maengel.has(p.k) ? "m" : ""}">${pf.maengel.has(p.k) ? "✗ Mangel" : "✓ i. O."}</button></div>`).join("")}
      <label>Bemerkung / Mangel beschreiben</label><textarea id="pBem" placeholder="z. B. Fußkappe hinten links fehlt">${esc(pf.bem)}</textarea>
      <label>Ergebnis</label><div class="seg" id="pErg">${Object.entries(ERG).map(([k, t]) => `<button data-erg="${k}" class="${pf.ergebnis === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="hint" style="margin:6px 0 0">${pf.ergebnis === "ok" ? `Nächste Prüfung dann bis ${de(naechste(pf.datum))}.` : pf.ergebnis === "maengel" ? "Die Leiter gilt als gesperrt, bis sie repariert und erneut geprüft ist." : "Die Leiter wird ausgesondert und erscheint nicht mehr in der Liste – bitte unbrauchbar machen."}</div>
      <button class="bigbtn primary" id="pSave" style="margin-top:10px">Prüfung speichern</button>
    </section>`;
  }
  function naechste(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number), z = new Date(Date.UTC(y, m - 1 + data.intervall, 1));
    z.setUTCDate(Math.min(d, new Date(Date.UTC(z.getUTCFullYear(), z.getUTCMonth() + 1, 0)).getUTCDate()));
    return z.toISOString().slice(0, 10);
  }

  function detail(l) {
    const h = l.pruefungen;
    return `<button class="back" id="leZur">‹ Alle Leitern</button>
    <section class="card"><h3>🪜 ${esc(l.nr)} <span style="font-weight:400">${esc(artName(l.art))}</span></h3>
      <div style="margin:2px 0 8px">${badge(l)}</div>
      ${[["Material", l.material], ["Größe", l.groesse], ["Hersteller / Typ", l.hersteller], ["Standort", l.standort], ["Angeschafft", de(l.anschaffung)],
        ["Letzte Prüfung", h[0] ? `${de(h[0].datum)} · ${h[0].pruefer}` : ""], ["QR-Aufkleber", l.qr ? "✓ " + l.qr : "noch keiner"]].filter(x => x[1]).map(x => `<div class="pez"><span>${x[0]}</span><b>${esc(x[1])}</b></div>`).join("")}
      ${l.bem ? `<div class="hint" style="margin:8px 0 0">${esc(l.bem)}</div>` : ""}
      ${data.pflegen ? `<div class="row" style="margin-top:10px">${l.status !== "aus" && modus !== "pruefen" ? `<div><button class="bigbtn primary" id="lePr" style="margin:0">✓ Prüfung eintragen</button></div>` : ""}
        <div><button class="add" id="leEd" style="margin:0;width:100%">✎ Angaben ändern</button></div></div>
        ${l.status !== "aus" ? `<button class="add" id="leQr" style="margin-top:8px;width:100%">📷 ${l.qr ? "Anderen QR-Aufkleber zuordnen" : "QR-Aufkleber zuordnen"}</button>` : ""}` : ""}
    </section>
    ${modus === "pruefen" ? pruefFormular(l) : ""}
    <section class="card"><h3>📋 Prüfnachweise</h3>${h.length ? h.map(p => `<div class="lehist">${data.pflegen ? `<button class="x" data-pdel="${p.id}" title="Eintrag löschen">✕</button>` : ""}
        <b>${de(p.datum)}</b> · ${esc(p.pruefer)} · ${ERG[p.ergebnis] || esc(p.ergebnis)}
        ${p.maengel.length ? `<ul>${p.maengel.map(k => `<li>${esc(punktText(k))}</li>`).join("")}</ul>` : ""}
        ${p.bem ? `<div style="color:var(--mut);margin-top:3px">${esc(p.bem)}</div>` : ""}</div>`).join("")
      : `<div class="hint" style="margin:0">Noch keine Prüfung eingetragen.</div>`}</section>`;
  }

  function paint() {
    if (!el) return;
    if (fehler && !data) { el.innerHTML = `<section class="card"><div class="warn">${esc(fehler)}</div></section>`; return; }
    if (!data) { el.innerHTML = `<section class="card">Lade …</section>`; return; }
    const l = L().find(x => x.id === wahl);
    if (modus === "neu") el.innerHTML = formular(null);
    else if (l && modus === "bearbeiten") el.innerHTML = formular(l);
    else if (l) el.innerHTML = detail(l);
    else { wahl = null; modus = ""; el.innerHTML = uebersicht(); }
    bind(l);
  }

  function bind(l) {
    const q = s => el.querySelector(s);
    const zur = q("#leZur"); if (zur) zur.onclick = () => { if (modus === "bearbeiten") modus = ""; else { wahl = null; modus = ""; } paint(); window.scrollTo(0, 0); };
    el.querySelectorAll("[data-le]").forEach(x => x.onclick = () => { wahl = +x.dataset.le; modus = ""; paint(); window.scrollTo(0, 0); });
    const s = q("#leSuch"); if (s) s.oninput = () => { suche = s.value; const pos = s.selectionStart; paint(); const n = q("#leSuch"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    const au = q("#leAus"); if (au) au.onclick = () => { zeigAus = !zeigAus; paint(); };
    const neu = q("#leNeu"); if (neu) neu.onclick = () => { zuCode = ""; modus = "neu"; paint(); };
    const sc = q("#leScan"); if (sc) sc.onclick = scanStart;
    const sx = q("#leScX"); if (sx) sx.onclick = () => { scan = null; paint(); };
    const so = q("#leScOpen"); if (so) so.onclick = () => { const c = scan.code; scan = null; AT.qr.oeffnen(c); };
    const sn = q("#leScNeu"); if (sn) sn.onclick = () => { zuCode = scan.code; scan = null; modus = "neu"; paint(); window.scrollTo(0, 0); };
    el.querySelectorAll("[data-zu]").forEach(x => x.onclick = () => { const z = L().find(y => y.id === +x.dataset.zu); if (z && scan) zuordnen(z, scan.code); });
    const qb = q("#leQr"); if (qb && l) qb.onclick = () => aufkleber(l, qb);
    const csv = q("#leCsv"); if (csv) csv.onclick = exportieren;
    const ed = q("#leEd"); if (ed) ed.onclick = () => { modus = "bearbeiten"; paint(); };
    const pr = q("#lePr"); if (pr) pr.onclick = () => {
      pf = { datum: data.heute, pruefer: (AT.user && AT.user.name) || "", maengel: new Set(), ergebnis: "ok", bem: "" };
      modus = "pruefen"; paint(); const f = q("#lePf"); if (f) f.scrollIntoView({ behavior: "smooth" });
    };
    // Formular Leiter
    const sv = q("#fSave");
    if (sv) sv.onclick = async () => {
      const b = { aktion: "speichern", id: modus === "bearbeiten" ? wahl : undefined, nr: q("#fNr").value, art: q("#fArt").value, material: q("#fMat").value,
        groesse: q("#fGr").value, hersteller: q("#fHe").value, anschaffung: q("#fAn").value, standort: q("#fSo").value, bem: q("#fBe").value };
      b.leiter = b.nr;
      const mitCode = modus === "neu" ? zuCode : "";
      if (await post(b, "Leiter gespeichert ✓", sv)) {
        const neuL = L().find(x => x.nr.toLowerCase() === b.nr.trim().toLowerCase());
        wahl = neuL ? neuL.id : null; modus = ""; zuCode = ""; paint(); window.scrollTo(0, 0);
        if (neuL && mitCode) zuordnen(neuL, mitCode);
      }
    };
    const del = q("#fDel");
    if (del) del.onclick = async () => {
      if (!del.classList.contains("sure")) { del.classList.add("sure"); del.textContent = "Wirklich löschen? Alle Prüfnachweise gehen verloren – nochmal tippen"; return; }
      if (await post({ aktion: "loeschen", id: wahl, leiter: l && l.nr }, "Leiter gelöscht", del)) { wahl = null; modus = ""; paint(); }
    };
    // Prüfformular
    if (modus === "pruefen" && l) {
      const merk = () => { pf.datum = q("#pDat").value; pf.pruefer = q("#pWer").value; pf.bem = q("#pBem").value; };
      el.querySelectorAll("[data-pk]").forEach(b => b.onclick = () => {
        merk(); const k = b.dataset.pk;
        if (pf.maengel.has(k)) pf.maengel.delete(k); else { pf.maengel.add(k); if (pf.ergebnis === "ok") pf.ergebnis = "maengel"; }
        if (!pf.maengel.size && pf.ergebnis === "maengel" && !pf.bem.trim()) pf.ergebnis = "ok";
        const y = window.scrollY; paint(); window.scrollTo(0, y);
      });
      el.querySelectorAll("[data-erg]").forEach(b => b.onclick = () => { merk(); pf.ergebnis = b.dataset.erg; const y = window.scrollY; paint(); window.scrollTo(0, y); });
      q("#pDat").onchange = () => { merk(); const y = window.scrollY; paint(); window.scrollTo(0, y); };
      const ps = q("#pSave");
      ps.onclick = async () => {
        merk();
        if (pf.ergebnis === "ok" && pf.maengel.size) return say("Es sind Mängel angetippt – bitte Ergebnis „Mängel“ oder „Ausgesondert“ wählen");
        const b = { aktion: "pruefung", id: l.id, leiter: l.nr, datum: pf.datum, pruefer: pf.pruefer, maengel: [...pf.maengel], ergebnis: pf.ergebnis, bem: pf.bem };
        if (await post(b, pf.ergebnis === "ok" ? "Prüfung eingetragen ✓" : pf.ergebnis === "maengel" ? "Eingetragen – Leiter ist gesperrt" : "Leiter ausgesondert", ps)) {
          modus = ""; if (pf.ergebnis === "aussondern") wahl = null; paint(); window.scrollTo(0, 0);
        }
      };
    }
    el.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Löschen?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "✕"; } }, 4000); return; }
      if (await post({ aktion: "pruefung_loeschen", pid: +b.dataset.pdel, leiter: l && l.nr }, "Eintrag gelöscht", b)) paint();
    });
  }

  // Prüfbuch als CSV (öffnet in Excel): eine Zeile je Prüfung, Leitern ohne Prüfung mit leerer Prüfung
  function exportieren() {
    const c = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const kopf = ["Leiter-Nr.", "Art", "Material", "Größe", "Hersteller/Typ", "Standort", "Angeschafft", "Status", "Nächste Prüfung", "Prüfdatum", "Prüfer", "Ergebnis", "Mängel", "Bemerkung"];
    const st = { ok: "in Ordnung", bald: "bald fällig", faellig: "überfällig", gesperrt: "gesperrt", leer: "nicht geprüft", aus: "ausgesondert" };
    const z = [];
    for (const l of L()) {
      const basis = [l.nr, artName(l.art), l.material, l.groesse, l.hersteller, l.standort, de(l.anschaffung), st[l.status], de(l.naechste)];
      if (!l.pruefungen.length) z.push([...basis, "", "", "", "", ""]);
      for (const p of l.pruefungen) z.push([...basis, de(p.datum), p.pruefer, (ERG[p.ergebnis] || p.ergebnis).replace(/^\S+ /, ""), p.maengel.map(punktText).join("; "), p.bem]);
    }
    const text = "﻿" + [kopf, ...z].map(r => r.map(c).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = `Leiter-Pruefbuch_${data.heute}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  let wer = null;
  AT.leiternTab = { show(ziel) {
    el = ziel; el.id = el.id || "leView";
    if (wer !== (AT.user && AT.user.name)) { wer = AT.user && AT.user.name; data = null; wahl = null; modus = ""; scan = null; }
    if (warteScan) { const w = warteScan; warteScan = null; const z = w.r && w.r.zuordnung; modus = "";
      if (z && z.art === "leiter") { scan = null; wahl = +z.ziel; } else { scan = { code: w.code, z }; wahl = null; } }
    paint(); load();
  } };
  // QR-Code einer Leiter (Logbuch-Scan, Link aus der Handy-Kamera)
  AT.leiterScan = (code, r) => { warteScan = { code, r }; if (AT.allgemeinZeigen) AT.allgemeinZeigen("leitern"); };
})();
