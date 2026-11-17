/* Airtec KApp – Verwaltung (nur Büro)
   • Mitarbeiter: anlegen, ändern, Passwort setzen, Büro-Recht, aktiv/inaktiv, löschen
   • Stammdaten: Auswahllisten, Nachfüllmengen, GWP, Dokumente, Upload-Link
   • Datenbank: Überblick und Einmal-Import aus den Excel-Dateien
   Geöffnet über ⚙︎ → „Verwaltung öffnen“. */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = m => { if (typeof toast === "function") toast(m); };
  const office = () => !!(AT && AT.user && AT.user.schreiben);
  const get = async teil => (await api("admin" + (teil ? "?teil=" + teil : ""))).json();
  const post = async body => (await api("admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

  // ---------- Ansicht anlegen ----------
  const view = document.createElement("main");
  view.id = "vwView"; view.dataset.mod = "verwaltung"; view.className = "hide";
  document.getElementById("app").before(view);
  const hdr = document.querySelector("#hdrType");
  if (hdr) { const s = document.createElement("small"); s.dataset.mod = "verwaltung"; s.className = "hide"; s.textContent = "Verwaltung"; hdr.parentNode.appendChild(s); }

  const style = document.createElement("style");
  style.textContent = `
  #vwView .vwrow{border:1px solid #dde3ea;border-radius:10px;padding:9px 11px;margin:6px 0;background:#fff}
  #vwView .vwrow.off{opacity:.55}
  #vwView .vwhead{display:flex;gap:8px;align-items:center;justify-content:space-between;cursor:pointer}
  #vwView .vwtag{font-size:11.5px;border-radius:6px;padding:1px 6px;background:#eef1f4;color:var(--mut);margin-left:4px;white-space:nowrap}
  #vwView .vwtag.b{background:#e3effc;color:var(--blue)} #vwView .vwtag.w{background:#fff1d6;color:#8a5a00}
  #vwView .vwchk{display:flex;gap:16px;margin-top:10px;font-size:15px} #vwView .vwchk label{display:flex;gap:6px;align-items:center;margin:0;color:var(--ink);font-size:15px}
  #vwView .vwbtns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap} #vwView .vwbtns button{flex:1;min-width:120px;border:0;border-radius:10px;padding:10px;font:inherit;font-weight:600}
  #vwView .vwdel{background:#fdecec;color:var(--bad)}
  #vwView .vwtab{overflow-x:auto;margin-top:6px} #vwView .vwtab table{border-collapse:collapse;min-width:100%}
  #vwView .vwtab th{font-size:12px;color:var(--mut);text-align:left;font-weight:600;padding:2px 4px}
  #vwView .vwtab td{padding:2px} #vwView .vwtab input{padding:7px 8px;font-size:15px;min-width:70px}
  #vwView .vwtab td.x button{border:0;background:none;color:var(--bad);font-size:18px;padding:4px 6px}
  #vwView .vwback{border:0;background:none;color:var(--blue);font:inherit;font-weight:600;padding:4px 0 10px}`;
  document.head.appendChild(style);

  let teil = "mitarbeiter", offen = null, ma = null, st = null, db = null, sub = "listen";

  function paint() {
    if (!office()) { view.innerHTML = `<section class="card"><div class="warn">Nur für das Büro.</div></section>`; return; }
    view.innerHTML = `<button class="vwback" id="vwBack">‹ Zurück zur App</button>
      <div class="seg" style="margin-bottom:12px">${[["mitarbeiter", "Mitarbeiter"], ["stamm", "Stammdaten"], ["db", "Datenbank"]]
        .map(([k, l]) => `<button data-teil="${k}" class="${teil === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="vwBody">${teil === "mitarbeiter" ? paintMa() : teil === "stamm" ? paintSt() : paintDb()}</div>`;
    view.querySelector("#vwBack").onclick = () => AT.tab("start");
    view.querySelectorAll("[data-teil]").forEach(b => b.onclick = () => { teil = b.dataset.teil; offen = null; paint(); load(); });
    bind();
  }

  // ---------- Mitarbeiter ----------
  const maForm = (m = {}) => `
    <label>Name (so meldet sich die Person an)</label><input id="fName" value="${esc(m.name)}" autocomplete="off">
    <div class="row"><div><label>E-Mail</label><input id="fMail" type="email" value="${esc(m.mail)}"></div>
      <div><label>Geburtstag (TT.MM.)</label><input id="fGeb" value="${esc(m.geb)}" placeholder="24.03." inputmode="decimal"></div></div>
    <label>Name im Wochenplan (leer = wie oben)</label><input id="fPlan" value="${esc(m.plan)}">
    ${m.id ? "" : `<label>Passwort (mind. 6 Zeichen)</label><input id="fPw" type="text" autocomplete="off">`}
    <div class="vwchk"><label><input type="checkbox" id="fBuero" ${m.schreiben ? "checked" : ""}> Büro (darf verwalten)</label>
      <label><input type="checkbox" id="fAktiv" ${m.aktiv === false ? "" : "checked"}> Aktiv</label></div>
    <div class="vwbtns"><button class="primary" id="fSave">${m.id ? "Speichern" : "Anlegen"}</button><button class="secondary" id="fCancel">Abbrechen</button></div>
    ${m.id ? `<label style="margin-top:16px">Neues Passwort setzen</label>
      <div style="display:flex;gap:8px"><input id="fNewPw" type="text" autocomplete="off" placeholder="mind. 6 Zeichen"><button class="secondary" id="fPwSave" style="border:0;border-radius:10px;padding:0 14px;font:inherit;font-weight:600">Setzen</button></div>
      <div class="vwbtns"><button class="vwdel" id="fDel">Mitarbeiter löschen</button></div>` : ""}`;

  function paintMa() {
    if (!ma) return `<section class="card">Lade …</section>`;
    if (!ma.length) return `<section class="card"><div class="warn">Noch keine Mitarbeiter in der Datenbank. Bitte zuerst unter „Datenbank“ die Mitarbeiter aus Excel importieren – bis dahin gilt die Excel-Zugangsliste.</div></section>`;
    return `<section class="card"><h2>Mitarbeiter (${ma.filter(m => m.aktiv).length} aktiv)</h2>
      ${offen === "neu" ? `<div class="vwrow">${maForm()}</div>` : `<button class="add" id="maNew" style="margin-top:0">+ Neuer Mitarbeiter</button>`}
      ${ma.map(m => `<div class="vwrow ${m.aktiv ? "" : "off"}"><div class="vwhead" data-open="${m.id}"><b>${esc(m.name)}</b><span>
        ${m.schreiben ? '<span class="vwtag b">Büro</span>' : ""}${m.aktiv ? "" : '<span class="vwtag">inaktiv</span>'}${m.hatPw ? "" : '<span class="vwtag w">kein Passwort</span>'}</span></div>
        ${offen === m.id ? maForm(m) : ""}</div>`).join("")}
      <div class="hint">Passwörter werden verschlüsselt gespeichert und können nicht angezeigt, nur neu gesetzt werden. Nach einer Passwort-Änderung muss sich die Person neu anmelden.</div></section>`;
  }

  // ---------- Stammdaten ----------
  const COLS = {
    nach: { titel: "Nachfüllmengen", cols: [["geraet", "Gerät"], ["km", "ab m"], ["f6", "6 mm"], ["f10", "10 mm"], ["f12", "12 mm"], ["f16", "16 mm"]] },
    gwp: { titel: "GWP je Kältemittel", cols: [["kaeltemittel", "Kältemittel"], ["wert", "GWP"]] },
    docs: { titel: "Dokumente (Links)", cols: [["hersteller", "Hersteller"], ["kit", "Kit/Typ"], ["name", "Bezeichnung"], ["url", "Link (https://…)"]] },
  };
  const tableEd = key => `<div class="vwtab"><table><tr>${COLS[key].cols.map(c => `<th>${c[1]}</th>`).join("")}<th></th></tr>
    ${(st[key] || []).map((r, i) => `<tr data-i="${i}">${COLS[key].cols.map(c => `<td><input data-c="${c[0]}" value="${esc(r[c[0]])}"></td>`).join("")}<td class="x"><button data-delrow="${i}" title="Zeile löschen">✕</button></td></tr>`).join("")}
    </table></div><button class="add" id="tAdd">+ Zeile</button>
    <div class="vwbtns"><button class="primary" id="tSave">${esc(COLS[key].titel)} speichern</button></div>`;

  function paintSt() {
    if (!st) return `<section class="card">Lade …</section>`;
    if (!st.listen.length) return `<section class="card"><div class="warn">Noch keine Stammdaten in der Datenbank. Bitte zuerst unter „Datenbank“ die Stammdaten importieren – bis dahin gilt die Excel-Datei.</div></section>`;
    const subs = [["listen", "Auswahllisten"], ["nach", "Nachfüllm."], ["gwp", "GWP"], ["docs", "Dokumente"], ["upload", "Upload"]];
    let body;
    if (sub === "listen") body = `${offen === "neu" ? `<div class="vwrow">${listForm({ name: "", frei: true, werte: [] })}</div>` : `<button class="add" id="lNew" style="margin-top:0">+ Neue Auswahlliste</button>`}
      ${st.listen.map((l, i) => `<div class="vwrow"><div class="vwhead" data-open="${i}"><b>${esc(l.name)}</b><span><span class="vwtag">${l.werte.length} Einträge</span>${l.frei ? "" : '<span class="vwtag w">nur Auswahl</span>'}</span></div>
        ${offen === i ? listForm(l) : ""}</div>`).join("")}`;
    else if (sub === "upload") body = `<label>Link zum SharePoint-Ordner für den manuellen PDF-Upload</label><input id="upVal" value="${esc(st.upload)}" placeholder="https://…">
      <div class="vwbtns"><button class="primary" id="upSave">Speichern</button></div>`;
    else body = tableEd(sub);
    return `<section class="card"><div class="seg" style="margin-bottom:10px">${subs.map(([k, l]) => `<button data-sub="${k}" class="${sub === k ? "on" : ""}" style="font-size:13px;padding:8px 2px">${l}</button>`).join("")}</div>${body}
      <div class="hint">Änderungen gelten sofort. Auf den Handys nach dem nächsten Öffnen der App bzw. über ⚙︎ → „Stammdaten neu laden“.</div></section>`;
  }
  const listForm = l => `<label>Name der Liste (= Feld im Protokoll)</label><input id="lName" value="${esc(l.name)}">
    <label>Einträge – einer pro Zeile</label><textarea id="lWerte" style="min-height:160px">${esc(l.werte.join("\n"))}</textarea>
    <div class="vwchk"><label><input type="checkbox" id="lFrei" ${l.frei ? "checked" : ""}> Freie Eingabe zusätzlich erlaubt</label></div>
    <div class="vwbtns"><button class="primary" id="lSave">Speichern</button><button class="secondary" id="fCancel">Abbrechen</button></div>
    ${l.name ? `<div class="vwbtns"><button class="vwdel" id="lDel">Liste löschen</button></div>` : ""}`;

  // ---------- Datenbank ----------
  const fmt = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : iso; };
  function paintDb() {
    if (!db) return `<section class="card">Lade …</section>`;
    if (!db.verbunden) return `<section class="card"><div class="warn">Die Datenbank ist noch nicht mit der App verbunden.</div></section>`;
    return `<section class="card"><h2>Import aus Excel</h2><div class="hint" style="margin-top:0">Übernimmt die Daten aus den Excel-Dateien in SharePoint.
      Ein erneuter Import <b>ersetzt</b> die Daten dieses Bereichs in der Datenbank – auch Änderungen, die hier in der Verwaltung gemacht wurden.</div>
      ${db.bereiche.map(b => {
        const n = Object.values(b.zahlen).reduce((a, x) => a + x, 0);
        const imp = b.import ? `Importiert am ${esc(fmt(b.import.am))} von ${esc(b.import.von)}: ${esc(b.import.anzahl)}` : "Noch nicht importiert";
        return `<div class="vwrow"><b>${esc(b.titel)}</b> <span style="color:var(--mut)">· ${n} Einträge</span>
          <div class="hint" style="margin:2px 0 6px">${imp}</div>
          <button class="add" data-imp="${esc(b.id)}" style="margin:0">${b.import ? "Erneut importieren" : "Aus Excel importieren"}</button></div>`;
      }).join("")}</section>`;
  }

  // ---------- Bedienung ----------
  const val = id => { const el = view.querySelector("#" + id); return el ? (el.type === "checkbox" ? el.checked : el.value) : undefined; };
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) { say(e.message); if (btn && btn.isConnected) btn.disabled = false; }
  }
  function sure(btn, text) {   // zweiter Tipp bestätigt
    if (btn.classList.contains("sure")) return true;
    btn.classList.add("sure"); const old = btn.textContent; btn.textContent = text;
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure"); btn.textContent = old; } }, 4000);
    return false;
  }

  function bind() {
    const q = s => view.querySelector(s);
    view.querySelectorAll("[data-open]").forEach(h => h.onclick = () => {
      const k = teil === "mitarbeiter" ? +h.dataset.open : +h.dataset.open;
      offen = offen === k ? null : k; paint();
    });
    const cancel = q("#fCancel"); if (cancel) cancel.onclick = () => { offen = null; paint(); };

    if (teil === "mitarbeiter" && ma) {
      const nw = q("#maNew"); if (nw) nw.onclick = () => { offen = "neu"; paint(); q("#fName").focus(); };
      const m = offen === "neu" ? {} : ma.find(x => x.id === offen);
      const save = q("#fSave");
      if (save) save.onclick = () => busy(save, async () => {
        const r = await post({ aktion: "ma_speichern", id: m && m.id, name: val("fName"), mail: val("fMail"), plan: val("fPlan"), geb: val("fGeb"),
          schreiben: val("fBuero"), aktiv: val("fAktiv"), passwort: val("fPw") });
        ma = r.mitarbeiter; offen = null; paint(); say("Gespeichert");
      });
      const pw = q("#fPwSave");
      if (pw) pw.onclick = () => busy(pw, async () => { ma = (await post({ aktion: "ma_passwort", id: m.id, passwort: val("fNewPw") })).mitarbeiter; paint(); say("Passwort gesetzt"); });
      const del = q("#fDel");
      if (del) del.onclick = () => { if (!sure(del, "Wirklich löschen?")) return; busy(del, async () => { ma = (await post({ aktion: "ma_loeschen", id: m.id })).mitarbeiter; offen = null; paint(); say("Gelöscht"); }); };
    }

    if (teil === "stamm" && st) {
      view.querySelectorAll("[data-sub]").forEach(b => b.onclick = () => { sub = b.dataset.sub; offen = null; paint(); });
      const after = async r => { st = r; paint(); say("Gespeichert"); if (typeof syncStamm === "function") syncStamm(false); };
      const ln = q("#lNew"); if (ln) ln.onclick = () => { offen = "neu"; paint(); q("#lName").focus(); };
      const ls = q("#lSave");
      if (ls) ls.onclick = () => busy(ls, async () => {
        const alt = offen === "neu" ? "" : st.listen[offen].name;
        const r = await post({ aktion: "liste_speichern", alt, name: val("lName"), frei: val("lFrei"), werte: val("lWerte").split("\n") });
        offen = null; await after(r);
      });
      const ld = q("#lDel");
      if (ld) ld.onclick = () => { if (!sure(ld, "Wirklich löschen?")) return; busy(ld, async () => { const r = await post({ aktion: "liste_loeschen", name: st.listen[offen].name }); offen = null; await after(r); }); };
      if (COLS[sub]) {
        const rows = () => [...view.querySelectorAll(".vwtab tr[data-i]")].map(tr => Object.fromEntries([...tr.querySelectorAll("input")].map(i => [i.dataset.c, i.value])));
        q("#tAdd").onclick = () => { st[sub] = [...rows(), {}]; paint(); const ins = view.querySelectorAll(".vwtab tr[data-i]:last-child input"); if (ins[0]) ins[0].focus(); };
        view.querySelectorAll("[data-delrow]").forEach(b => b.onclick = () => { const r = rows(); r.splice(+b.dataset.delrow, 1); st[sub] = r; paint(); });
        const ts = q("#tSave"); ts.onclick = () => busy(ts, async () => after(await post({ aktion: "tabelle_speichern", tabelle: sub, zeilen: rows() })));
      }
      const us = q("#upSave"); if (us) us.onclick = () => busy(us, async () => after(await post({ aktion: "tabelle_speichern", tabelle: "upload", wert: val("upVal") })));
    }

    if (teil === "db") view.querySelectorAll("[data-imp]").forEach(btn => btn.onclick = () => {
      if (!sure(btn, "Ersetzt die Daten – wirklich importieren?")) return;
      busy(btn, async () => {
        btn.textContent = "Importiere …";
        const body = { aktion: "import", bereich: btn.dataset.imp };
        if (body.bereich === "stammdaten") {   // die Excel liest die App selbst (wegen der Links im Blatt „Dokumente“)
          await syncStamm(false, true);
          if (!STAMM || STAMM.src === "eingebaut" || !/SharePoint/.test(STAMM.src || "")) throw new Error("Stammdaten-Excel konnte nicht geladen werden");
          body.stamm = STAMM;
        }
        const r = await post(body);
        db = r.status; ma = null; st = null; paint(); say("Importiert: " + r.anzahl);
        if (body.bereich === "stammdaten") syncStamm(false);
      });
    });
  }

  async function load() {
    try {
      if (teil === "mitarbeiter") ma = (await get("mitarbeiter")).mitarbeiter;
      else if (teil === "stamm") st = await get("stamm");
      else db = await get("");
    } catch (e) { say(e.message); }
    paint();
  }

  AT.modules.verwaltung = { show() { paint(); if (office()) load(); } };

  // Einstieg: Knopf in den Einstellungen (nur Büro)
  const box = document.querySelector("#mSettings .box");
  const btn = document.createElement("button");
  btn.className = "add hide"; btn.id = "vwOpen"; btn.style.marginTop = "14px"; btn.textContent = "Verwaltung öffnen (Mitarbeiter, Stammdaten, Datenbank)";
  box.insertBefore(btn, box.querySelector("h3:nth-of-type(2)") || box.querySelector(".btns"));
  btn.onclick = () => { document.getElementById("mSettings").classList.remove("show"); AT.tab("verwaltung"); };
  const modal = document.getElementById("mSettings");
  new MutationObserver(() => btn.classList.toggle("hide", !(modal.classList.contains("show") && office())))
    .observe(modal, { attributes: true, attributeFilter: ["class"] });
})();
