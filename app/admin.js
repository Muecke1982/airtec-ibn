/* Airtec KApp – Verwaltung (nur Büro)
   • Mitarbeiter: anlegen, ändern, Passwort setzen, Büro-Recht, aktiv/inaktiv, löschen
   • Stammdaten: Auswahllisten, Nachfüllmengen, GWP, Dokumente, Upload-Link
   • Datenbank: Überblick und Einmal-Import aus den Excel-Dateien
   Geöffnet über ⚙︎ → „Verwaltung öffnen“. */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = m => { if (typeof toast === "function") toast(m); };
  // Rechte – gleiche Schlüssel wie lib/rechte.js
  const RECHTE = [
    ["Bereiche", [["wochenplan", "Wochenplan"], ["protokolle", "Protokolle"], ["maschinen", "Maschinen"], ["lager", "Lager (Material melden)"], ["autos", "Autos"]]],
    ["Zusatzrechte", [["hinweise", "Büro"], ["plan_aendern", "Wochenplan ändern (Tagesbrett, krank)"], ["urlaub", "Urlaub im Team sehen"],
      ["maschinen_buero", "Maschinen (Büro)"], ["lager_bestellen", "Lager bestellen"], ["autos_verwalten", "Autos verwalten"], ["leitern", "Leitern prüfen (befähigte Person)"],["personal", "Mitarbeiter-Infos (Führerschein, Urlaubstage)"], ["qr", "QR-Codes zuordnen"], ["stammdaten", "Stammdaten pflegen"], ["mitarbeiter", "Mitarbeiter verwalten"], ["mappen", "Baustellenmappen schließen & archivieren"]]],
  ];
  const ALLE = RECHTE.flatMap(g => g[1].map(r => r[0])), MONTEUR = RECHTE[0][1].map(r => r[0]), ZUSATZ = RECHTE[1][1].map(r => r[0]);
  const darf = r => !!(AT && AT.darf && AT.darf(r));
  const ichAdmin = () => !!(AT.user && AT.user.admin);
  const office = () => darf("mitarbeiter") || darf("stammdaten");
  const TEILE = [["mitarbeiter", "Mitarbeiter", "mitarbeiter"], ["stamm", "Stammdaten", "stammdaten"], ["db", "Datenbank", "mitarbeiter"], ["log", "Logbuch", "admin"]];
  const teile = () => TEILE.filter(x => x[2] === "admin" ? ichAdmin() : darf(x[2]));
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
  #vwView .vwlday{font-size:12.5px;font-weight:700;color:var(--mut);margin:12px 0 4px;border-bottom:1px solid #e6eaef;padding-bottom:3px}
  #vwView .vwlog{display:flex;gap:10px;padding:5px 0;font-size:14px;border-bottom:1px dashed #eef1f4} #vwView .vwlog small{display:block;color:var(--mut);font-size:12.5px;word-break:break-word}
  #vwView .vwlog.warn b{color:var(--bad)} #vwView .vwlt{color:var(--mut);font-variant-numeric:tabular-nums;min-width:38px}
  #vwView .vwgrid{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px}
  #vwView .vwr{display:flex;gap:7px;align-items:flex-start;margin:4px 0;color:var(--ink);font-size:14.5px} #vwView .vwr input{margin-top:3px}
  #vwView .vwr.lock{color:var(--mut)}
  @media (max-width:380px){#vwView .vwgrid{grid-template-columns:1fr}}
  #vwView .vwback{border:0;background:none;color:var(--blue);font:inherit;font-weight:600;padding:4px 0 10px}`;
  document.head.appendChild(style);

  let teil = "mitarbeiter", offen = null, ma = null, st = null, db = null, sub = "listen", log = null, sich = null;
  const logQ = { tage: 7, wer: "", bereich: "" };

  function paint() {
    if (!office()) { view.innerHTML = `<section class="card"><div class="warn">Dafür fehlt das Recht.</div></section>`; return; }
    if (!teile().some(x => x[0] === teil)) teil = teile()[0][0];
    view.innerHTML = `<button class="vwback" id="vwBack">‹ Zurück zur App</button>
      <div class="seg" style="margin-bottom:12px">${teile()
        .map(([k, l]) => `<button data-teil="${k}" class="${teil === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="vwBody">${teil === "mitarbeiter" ? paintMa() : teil === "stamm" ? paintSt() : teil === "log" ? paintLog() : paintDb()}</div>`;
    view.querySelector("#vwBack").onclick = () => AT.tab("start");
    view.querySelectorAll("[data-teil]").forEach(b => b.onclick = () => { teil = b.dataset.teil; offen = null; paint(); load(); });
    bind();
  }

  // ---------- Mitarbeiter ----------
  const ARTEN_MA = ["Meister", "Techniker", "Monteur", "Helfer", "Azubi", "Praktikant"];   // wie lib/verwaltung.js
  // Häkchen für die Rechte. Gesperrt: beim Admin alles; „Mitarbeiter verwalten“ darf nur der Admin ändern.
  const rechteForm = m => {
    const hat = m.id ? (m.rechte || []) : MONTEUR;
    return RECHTE.map(([titel, list]) => `<label style="margin-top:12px">${titel}</label><div class="vwgrid">${list.map(([k, l]) => {
      const lock = m.admin || (k === "mitarbeiter" && !ichAdmin());
      return `<label class="vwr${lock ? " lock" : ""}"><input type="checkbox" data-recht="${k}" ${hat.includes(k) || m.admin ? "checked" : ""} ${lock ? "disabled" : ""}> ${l}</label>`;
    }).join("")}</div>`).join("") +
    (m.admin ? `<div class="hint">Admin – hat immer alle Rechte.</div>` : `<div class="vwbtns" style="margin-top:6px"><button class="secondary" data-preset="monteur">Monteur</button><button class="secondary" data-preset="buero">Büro (alles)</button></div>
      ${ichAdmin() ? "" : `<div class="hint">„Mitarbeiter verwalten“ kann nur der Admin vergeben.</div>`}`);
  };
  // Handy-Mitteilungen – gleiche Schlüssel wie lib/push.js (Häkchen = bekommt diese Art)
  const MITTEILUNGEN = [["direkt", "Direkte Nachrichten und Antworten"], ["hinweis", "Neue Hinweise und angepinnte Nachrichten (Startseite)"],
    ["alle", "Nachrichten an alle und Abstimmungen"], ["buero", "Nachrichten ans Büro (nur mit Recht „Büro“)"]];
  const mitteilungenForm = m => `<label style="margin-top:14px">🔔 Handy-Mitteilungen</label><div class="vwgrid">${MITTEILUNGEN.map(([k, l]) =>
      `<label class="vwr"><input type="checkbox" data-mitt="${k}" ${(m.mitteilungenAus || []).includes(k) ? "" : "checked"}> ${l}</label>`).join("")}</div>
    <div class="hint">${m.id ? (m.handys ? `📱 ${m.handys === 1 ? "1 Gerät" : m.handys + " Geräte"} angemeldet.` : "Noch kein Handy angemeldet – die Person muss in der App einmal „Mitteilungen erlauben“ tippen.") : "Die Person muss in der App einmal „Mitteilungen erlauben“ tippen."}</div>`;
  const maForm = (m = {}) => {
    const fremderAdmin = m.admin && !ichAdmin();
    if (fremderAdmin) return `<div class="hint" style="margin:8px 0 2px">Der Admin kann nur von sich selbst geändert werden.</div>`;
    return `
    <label>Name (so meldet sich die Person an)</label><input id="fName" value="${esc(m.name)}" autocomplete="off">
    <div class="row"><div><label>E-Mail</label><input id="fMail" type="email" value="${esc(m.mail)}"></div>
      <div><label>Geburtstag (TT.MM.)</label><input id="fGeb" value="${esc(m.geb)}" placeholder="24.03." inputmode="decimal"></div></div>
    <div class="row"><div><label>Art</label><select id="fArt">${ARTEN_MA.map(a => `<option ${(m.art || "Monteur") === a ? "selected" : ""}>${a}</option>`).join("")}</select></div>
      <div><label>Name im Wochenplan (leer = wie oben)</label><input id="fPlan" value="${esc(m.plan)}"></div></div>
    <div class="vwchk"><label><input type="checkbox" id="fImPlan" ${m.imPlan === false ? "" : "checked"}> Wird im Wochenplan angezeigt</label>
      <div class="hint" style="margin:2px 0 0">Ohne Haken (z. B. Praktikant) steht die Person nicht unter „Noch nicht eingeplant“ und nicht in der Wochenübersicht – nur, wenn sie eingeplant ist.</div></div>
    <label>Telefon</label><input id="fTel" type="tel" value="${esc(m.telefon)}" inputmode="tel" autocomplete="off">
    <label>Adresse</label><textarea id="fAdr" rows="2" style="min-height:58px" placeholder="Straße Nr., PLZ Ort">${esc(m.adresse)}</textarea>
    <div class="row"><div><label>Schlüssel-Nr.</label><input id="fSchl" value="${esc(m.schluessel)}" autocomplete="off"></div>
      <div><label>Alarmanlagen-Schlüssel</label><input id="fAlarm" value="${esc(m.alarm)}" autocomplete="off"></div></div>
    ${m.id ? "" : `<label>Startpasswort (mind. 6 Zeichen – die Person wählt beim ersten Anmelden ein eigenes)</label><input id="fPw" type="text" autocomplete="off">`}
    ${rechteForm(m)}
    ${mitteilungenForm(m)}
    <div class="vwchk"><label><input type="checkbox" id="fAktiv" ${m.aktiv === false ? "" : "checked"} ${m.admin ? "disabled" : ""}> Aktiv (kann sich anmelden)</label></div>
    <div class="vwbtns"><button class="primary" id="fSave">${m.id ? "Speichern" : "Anlegen"}</button><button class="secondary" id="fCancel">Abbrechen</button></div>
    ${m.id ? `${m.gesperrt ? `<div class="warn" style="margin-top:16px">Anmeldung gerade gesperrt (zu viele falsche Passwörter). Ein neues Passwort hebt die Sperre sofort auf – sonst endet sie nach 15 Minuten von selbst.</div>` : ""}
      <label style="margin-top:16px">Neues Passwort setzen${m.name === (AT.user && AT.user.name) ? "" : " (Startpasswort – die Person wählt danach ein eigenes)"}</label>
      <div style="display:flex;gap:8px"><input id="fNewPw" type="text" autocomplete="off" placeholder="mind. 6 Zeichen"><button class="secondary" id="fPwSave" style="border:0;border-radius:10px;padding:0 14px;font:inherit;font-weight:600">Setzen</button></div>
      ${m.admin ? "" : `<div class="vwbtns">${ichAdmin() && m.aktiv && m.hatPw ? `<button class="secondary" id="fAdmin">Zum Admin machen</button>` : ""}<button class="vwdel" id="fDel">Mitarbeiter löschen</button></div>`}` : ""}`;
  };
  const zusatzZahl = m => m.admin ? ZUSATZ.length : (m.rechte || []).filter(r => ZUSATZ.includes(r)).length;
  const tags = m => `<span class="vwtag">${esc(m.art || "Monteur")}</span>` + (m.imPlan === false ? '<span class="vwtag">nicht im Wochenplan</span>' : "") + (m.admin ? '<span class="vwtag b">Admin</span>' : zusatzZahl(m) ? `<span class="vwtag b">${zusatzZahl(m) === ZUSATZ.length ? "Büro" : zusatzZahl(m) + " Zusatzrechte"}</span>` : "")
    + (m.aktiv ? "" : '<span class="vwtag">inaktiv</span>') + (m.hatPw ? "" : '<span class="vwtag w">kein Passwort</span>')
    + (m.gesperrt ? '<span class="vwtag w">gesperrt</span>' : m.pwNeu ? '<span class="vwtag">Startpasswort</span>' : "");

  function paintMa() {
    if (!ma) return `<section class="card">Lade …</section>`;
    if (!ma.length) return `<section class="card"><div class="warn">Noch keine Mitarbeiter in der Datenbank. Bitte zuerst unter „Datenbank“ die Mitarbeiter aus Excel importieren – bis dahin gilt die Excel-Zugangsliste.</div></section>`;
    return `<section class="card"><h2>Mitarbeiter (${ma.filter(m => m.aktiv).length} aktiv)</h2>
      ${offen === "neu" ? `<div class="vwrow">${maForm()}</div>` : `<button class="add" id="maNew" style="margin-top:0">+ Neuer Mitarbeiter</button>`}
      ${ma.map(m => `<div class="vwrow ${m.aktiv ? "" : "off"}"><div class="vwhead" data-open="${m.id}"><b>${esc(m.name)}</b><span>${tags(m)}</span></div>
        ${offen === m.id ? maForm(m) : ""}</div>`).join("")}
      <div class="hint">Passwörter werden verschlüsselt gespeichert und können nicht angezeigt, nur neu gesetzt werden. Ein hier gesetztes Passwort ist ein Startpasswort: Die Person meldet sich damit an und muss sofort ein eigenes wählen („Startpasswort“ = noch nicht geändert). Nach 5 falschen Versuchen ist die Anmeldung 15 Minuten gesperrt.</div></section>`;
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
  // Datensicherung (nur Admin)
  function paintSich() {
    if (!ichAdmin()) return "";
    if (!sich) return `<section class="card"><h2>Datensicherung</h2>Lade …</section>`;
    const L = sich.letzte, kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
    return `<section class="card"><h2>Datensicherung</h2>
      ${L ? (L.fehler ? `<div class="warn">⚠ Letzte Sicherung am ${esc(fmt(L.am))} fehlgeschlagen: ${esc(L.fehler)}</div>`
        : `<div style="font-size:14.5px">✅ Letzte Sicherung: <b>${esc(fmt(L.am))}</b> (${esc(L.von)}) · ${L.zeilen} Einträge · ${kb(L.groesse)}</div>`)
        : `<div class="warn">Noch keine Sicherung erstellt.</div>`}
      <div class="hint">Täglich automatisch nach SharePoint, Ordner <b>${esc(sich.ordner)}</b>. Aufbewahrt werden die letzten 30 Tage, danach je Monat eine Sicherung für 12 Monate.</div>
      ${sich.fehler ? `<div class="warn">Ordner nicht lesbar: ${esc(sich.fehler)}</div>` : ""}
      <div class="vwbtns"><button class="primary" id="siJetzt">Jetzt sichern</button></div>
      ${sich.dateien.length ? `<label style="margin-top:16px">Zurückspielen – Sicherung wählen (${sich.dateien.length} vorhanden)</label>
        <select id="siDatei">${sich.dateien.map(f => `<option value="${esc(f.id)}">${esc(f.name.replace(/^KApp_Sicherung_|\.json$/g, ""))} · ${kb(f.groesse)}</option>`).join("")}</select>
        <label>Bereiche</label><div class="vwgrid">${sich.bereiche.map(b => `<label class="vwr"><input type="checkbox" data-sib="${esc(b.id)}"> ${esc(b.titel)}</label>`).join("")}</div>
        <div class="hint">Die gewählten Bereiche werden durch den Stand der Sicherung <b>ersetzt</b>. Vorher wird der aktuelle Stand automatisch gesichert.</div>
        <div class="vwbtns"><button class="vwdel" id="siZurueck">Zurückspielen</button></div>` : ""}</section>`;
  }

  function paintDb() {
    if (!db) return `<section class="card">Lade …</section>`;
    if (!db.verbunden) return `<section class="card"><div class="warn">Die Datenbank ist noch nicht mit der App verbunden.</div></section>`;
    return paintSich() + `<section class="card"><h2>Import aus Excel</h2><div class="hint" style="margin-top:0">Übernimmt die Daten aus den Excel-Dateien in SharePoint.
      Ein erneuter Import <b>ersetzt</b> die Daten dieses Bereichs in der Datenbank – auch Änderungen, die hier in der Verwaltung gemacht wurden.</div>
      ${db.bereiche.map(b => {
        const n = Object.values(b.zahlen).reduce((a, x) => a + x, 0);
        const imp = b.import ? `Importiert am ${esc(fmt(b.import.am))} von ${esc(b.import.von)}: ${esc(b.import.anzahl)}` : "Noch nicht importiert";
        return `<div class="vwrow"><b>${esc(b.titel)}</b> <span style="color:var(--mut)">· ${n} Einträge</span>
          <div class="hint" style="margin:2px 0 6px">${imp}</div>
          ${b.id === "mitarbeiter" && !ichAdmin() && db.adminDa ? `<div class="hint">Nur der Admin kann die Mitarbeiter neu importieren (überschreibt alle Rechte).</div>`
            : `<button class="add" data-imp="${esc(b.id)}" style="margin:0">${b.import ? "Erneut importieren" : "Aus Excel importieren"}</button>`}</div>`;
      }).join("")}</section>`;
  }

  // ---------- Logbuch (nur Admin) ----------
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const tagTitel = iso => { const d = new Date(iso + "T12:00:00Z"); return `${WT[d.getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`; };
  function paintLog() {
    if (!log) return `<section class="card">Lade …</section>`;
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
    let tag = "", rows = "";
    for (const e of log.eintraege) {
      const d = e.zeit.slice(0, 10);
      if (d !== tag) { tag = d; rows += `<div class="vwlday">${tagTitel(d)}</div>`; }
      const warn = /fehlgeschlagen/.test(e.aktion);
      rows += `<div class="vwlog${warn ? " warn" : ""}"><span class="vwlt">${esc(e.zeit.slice(11, 16))}</span><div><b>${esc(e.wer)}</b> · ${esc(e.aktion)}
        <small>${esc(e.bereich)}${e.details ? " · " + esc(e.details) : ""}</small></div></div>`;
    }
    return `<section class="card"><h2>Logbuch</h2>
      <div class="row"><div><label>Zeitraum</label><select id="lgTage" data-nodirty>${[[1, "Heute"], [7, "7 Tage"], [30, "30 Tage"], [90, "90 Tage"]].map(([v, l]) => opt(v, l, logQ.tage)).join("")}</select></div>
        <div><label>Bereich</label><select id="lgBer" data-nodirty>${opt("", "Alle", logQ.bereich)}${log.bereiche.map(b => opt(b, b, logQ.bereich)).join("")}</select></div></div>
      <label>Person</label><select id="lgWer" data-nodirty>${opt("", "Alle", logQ.wer)}${log.personen.map(p => opt(p, p, logQ.wer)).join("")}</select>
      <div class="vwbtns"><button class="secondary" id="lgCsv" ${log.eintraege.length ? "" : "disabled"}>Als Excel-Datei (CSV) speichern</button></div>
      <div class="hint">${log.eintraege.length} Einträge${log.eintraege.length >= 2000 ? " (die neuesten 2000)" : ""}. Aufgezeichnet werden Änderungen und Anmeldungen, kein reines Ansehen. Einträge werden nach ${log.aufbewahrung} Tagen gelöscht.</div>
      <div style="margin-top:8px">${rows || '<div class="hint">Keine Einträge im gewählten Zeitraum.</div>'}</div></section>`;
  }
  function csv() {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Datum", "Uhrzeit", "Person", "Bereich", "Aktion", "Details"].map(q).join(";"),
      ...log.eintraege.map(e => [e.zeit.slice(8, 10) + "." + e.zeit.slice(5, 7) + "." + e.zeit.slice(0, 4), e.zeit.slice(11, 16), e.wer, e.bereich, e.aktion, e.details].map(q).join(";"))];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `KApp_Logbuch_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
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
        const rechte = [...view.querySelectorAll("[data-recht]")].filter(c => c.checked).map(c => c.dataset.recht);
        const mitteilungenAus = [...view.querySelectorAll("[data-mitt]")].filter(c => !c.checked).map(c => c.dataset.mitt);
        const r = await post({ aktion: "ma_speichern", id: m && m.id, name: val("fName"), mail: val("fMail"), plan: val("fPlan"), art: val("fArt"), imPlan: val("fImPlan"), geb: val("fGeb"),
          rechte, mitteilungenAus, aktiv: val("fAktiv"), passwort: val("fPw"), telefon: val("fTel"), adresse: val("fAdr"), schluessel: val("fSchl"), alarm: val("fAlarm") });
        ma = r.mitarbeiter; offen = null; paint(); say("Gespeichert");
      });
      view.querySelectorAll("[data-preset]").forEach(p => p.onclick = () => {
        const set = p.dataset.preset === "buero" ? ALLE : MONTEUR;
        view.querySelectorAll("[data-recht]").forEach(c => { if (!c.disabled) c.checked = set.includes(c.dataset.recht); });
      });
      const adm = q("#fAdmin");
      if (adm) adm.onclick = () => {
        if (!sure(adm, `${m.name} wirklich zum Admin machen? Du verlierst den Admin.`)) return;
        busy(adm, async () => {
          ma = (await post({ aktion: "ma_admin", id: m.id })).mitarbeiter; offen = null; say(`${m.name} ist jetzt Admin`);
          try { const r = await AT.api("login"); AT.session.user = r.user; localStorage.setItem("at_session", JSON.stringify(AT.session)); AT.reiter(); } catch (e) {}
          paint();
        });
      };
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

    if (teil === "log" && log) {
      const f = () => { logQ.tage = +val("lgTage"); logQ.bereich = val("lgBer"); logQ.wer = val("lgWer"); log = null; paint(); load(); };
      ["lgTage", "lgBer", "lgWer"].forEach(id => { const el = q("#" + id); if (el) el.onchange = f; });
      const c = q("#lgCsv"); if (c) c.onclick = csv;
    }

    if (teil === "db" && sich) {
      const j = q("#siJetzt");
      const neuLaden = async () => { sich = await get("sicherung").catch(() => sich); paint(); };
      if (j) j.onclick = () => busy(j, async () => {
        j.textContent = "Sichere …";
        try { const r = await post({ aktion: "sichern" }); sich = r.status; paint(); say("Gesichert ✓ " + r.ergebnis.datei); }
        catch (e) { await neuLaden(); throw e; }
      });
      const z = q("#siZurueck");
      if (z) z.onclick = () => {
        const bereiche = [...view.querySelectorAll("[data-sib]:checked")].map(c => c.dataset.sib);
        if (!bereiche.length) return say("Bitte mindestens einen Bereich wählen");
        if (!sure(z, "Wirklich? Ersetzt die gewählten Bereiche")) return;
        busy(z, async () => {
          z.textContent = "Spiele zurück …";
          try { const r = await post({ aktion: "zurueckspielen", datei: val("siDatei"), bereiche }); sich = r.status; ma = null; st = null; paint(); say("Zurückgespielt: " + r.ergebnis.zurueckgespielt.join(", ")); }
          catch (e) { await neuLaden(); throw e; }
        });
      };
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
      else if (teil === "log") log = await get(`logbuch&tage=${logQ.tage}&wer=${encodeURIComponent(logQ.wer)}&bereich=${encodeURIComponent(logQ.bereich)}`);
      else { db = await get(""); if (ichAdmin()) sich = await get("sicherung").catch(e => ({ letzte: null, dateien: [], ordner: "", fehler: e.message, bereiche: [] })); }
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
