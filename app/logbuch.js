/* Airtec KApp – Reiter „Logbuch“ (Anlagen-Logbuch, im Aufbau)
   • QR-Code an der Anlage scannen → Zuordnung anzeigen (die Anlagen stellt später der Service bereit)
   • Suchfeld: Platzhalter – die Suche läuft später in der Anlagendatenbank des Service
   Hinweis: Das Logbuch der Verwaltung (wer hat was geändert) ist etwas anderes und bleibt unter ⚙︎ → Verwaltung. */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const tabBtn = document.createElement("button");
  tabBtn.dataset.tab = "logbuch"; tabBtn.textContent = "Logbuch";
  tabBtn.onclick = () => AT.tab("logbuch");
  const lager = document.querySelector('#tabs button[data-tab="lager"]');
  if (lager) lager.after(tabBtn); else document.getElementById("tabs").appendChild(tabBtn);

  const view = document.createElement("main");
  view.id = "lbView"; view.dataset.mod = "logbuch"; view.className = "hide";
  view.innerHTML = `<section class="card">
      <h2>Anlagen-Logbuch</h2>
      <button class="bigbtn primary qrbtn" id="lbScan">📷 QR-Code an der Anlage scannen</button>
      <label style="margin-top:14px">Anlage suchen</label>
      <input id="lbSuch" type="search" placeholder="Kunde, Ort, Anlagen-Nr. …" autocomplete="off">
      <div class="hint" id="lbHint">Die Suche in der Anlagendatenbank des Service wird noch angebunden.</div>
    </section>
    <div id="lbErg"></div>`;
  document.getElementById("app").before(view);
  const hdr = document.querySelector("#hdrType");
  if (hdr) { const s = document.createElement("small"); s.dataset.mod = "logbuch"; s.className = "hide"; s.textContent = "Anlagen-Logbuch"; hdr.parentNode.appendChild(s); }
  const erg = view.querySelector("#lbErg");

  function ergebnis(r) {
    const z = r && r.zuordnung, code = r && r.code;
    let inhalt;
    if (!z) {
      inhalt = `<b>Dieser QR-Code ist noch nicht zugeordnet.</b>
        <div class="hint" style="margin:6px 0 0">Gelesen: <span class="qrcode">${esc(code)}</span></div>
        ${AT.darf("qr") ? `<button class="bigbtn primary" id="lbZu" style="margin-top:12px">Jetzt zuordnen</button>` : `<div class="hint">Zuordnen kann das Büro unter Allgemeines → QR-Codes.</div>`}`;
    } else if (z.art === "anlage") {
      inhalt = `<div class="hint" style="margin:0 0 4px">Anlage${z.ziel ? " Nr. " + esc(z.ziel) : ""}</div><b style="font-size:17px">${esc(z.bezeichnung || z.ziel)}</b>
        <div class="hint" style="margin:10px 0 0">Das Logbuch dieser Anlage folgt, sobald die Anlagendatenbank des Service angebunden ist.</div>`;
    } else if (z.art === "maschine") {
      inhalt = `<div class="hint" style="margin:0 0 4px">Maschine</div><b style="font-size:17px">${esc(z.bezeichnung || z.ziel)}</b>
        ${AT.darf("maschinen") || AT.darf("maschinen_buero") ? `<button class="bigbtn primary" id="lbMa" style="margin-top:12px">Zur Maschine (ausleihen / zurückgeben)</button>` : ""}`;
    } else if (z.art === "artikel") {
      inhalt = `<div class="hint" style="margin:0 0 4px">Lagerartikel</div><b style="font-size:17px">${esc(z.bezeichnung || z.ziel)}</b>
        <button class="bigbtn primary" id="lbLa" style="margin-top:12px">Zum Artikel im Lager</button>`;
    } else {
      inhalt = `<div class="hint" style="margin:0 0 4px">Sonstiges</div><b style="font-size:17px">${esc(z.bezeichnung)}</b>`;
    }
    erg.innerHTML = `<section class="card">${inhalt}<button class="add" id="lbNochmal" style="margin-top:10px">📷 Nächsten Code scannen</button></section>`;
    const q = s => erg.querySelector(s);
    if (q("#lbZu")) q("#lbZu").onclick = () => { AT.qrTab.zuordnen(code, "anlage"); AT.allgemeinZeigen("qr"); };
    if (q("#lbLa")) q("#lbLa").onclick = () => AT.lagerScan(code, r);
    if (q("#lbMa")) q("#lbMa").onclick = () => { AT.tab("maschinen"); AT.maschineScan(code, r); };
    q("#lbNochmal").onclick = scannen;
  }

  async function scannen() {
    const code = await AT.qr.scan("QR-Code an der Anlage scannen");
    if (!code) return;
    erg.innerHTML = `<section class="card"><div class="hint" style="margin:0">Wird gesucht …</div></section>`;
    try { ergebnis(await AT.qr.suchen(code)); }
    catch (e) { erg.innerHTML = `<section class="card"><div class="warn">${esc(navigator.onLine ? e.message : "Keine Internetverbindung")}</div></section>`; }
  }
  view.querySelector("#lbScan").onclick = scannen;
  view.querySelector("#lbSuch").onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); const h = view.querySelector("#lbHint"); h.textContent = "Die Suche folgt – die Anlagendatenbank des Service ist noch nicht angebunden."; h.style.color = "var(--bad)"; }
  };

  AT.logbuch = { ergebnis };
  AT.modules.logbuch = { show() {} };
})();
