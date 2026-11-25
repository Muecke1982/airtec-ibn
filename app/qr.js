/* Airtec KApp – QR-Codes
   • AT.qr.scan(titel) → Kamera öffnen und QR-Code lesen (Live-Kamera, sonst Foto aufnehmen/auswählen, notfalls eintippen)
   • AT.qr.suchen(code) → Zuordnung vom Server (/api/qr?code=…)
   • AT.qr.oeffnen(code) → je nach Zuordnung zur Maschine oder ins Logbuch springen
   • AT.qrTab → Unterreiter „QR-Codes“ in „Allgemeines“: Aufkleber Maschinen, Anlagen oder Sonstigem zuordnen (Recht „qr“)
   Erkennung: eingebauter BarcodeDetector (Android/Chrome), sonst jsQR (/vendor/jsQR.js, wird erst bei Bedarf geladen).
   Steht im QR-Code ein Link auf die App (…/q/CODE oder …?qr=CODE), öffnet auch die normale Handy-Kamera direkt die App. */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

  // gleiche Regel wie lib/qr.js
  function codeAus(text) {
    let s = String(text ?? "").trim();
    const m = s.match(/[?&]qr=([^&#\s]+)/i) || s.match(/^https?:\/\/[^/]+\/q\/([^/?#\s]+)/i);
    if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
    return s.slice(0, 200);
  }

  const css = document.createElement("style");
  css.textContent = `
  #qrScan{position:fixed;inset:0;z-index:300;background:#0b0f14;color:#fff;display:flex;flex-direction:column}
  #qrScan.hide{display:none}
  #qrScan .qrtop{display:flex;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 10px}
  #qrScan .qrtop b{flex:1;font-size:17px} #qrScan .qrtop button{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:10px;padding:8px 12px;font:inherit;font-size:15px}
  #qrScan .qrcam{position:relative;flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center}
  #qrScan video{width:100%;height:100%;object-fit:cover}
  #qrScan .qrframe{position:absolute;width:min(68vw,300px);aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:18px;box-shadow:0 0 0 2000px rgba(0,0,0,.35)}
  #qrScan .qrmsg{position:absolute;left:16px;right:16px;bottom:16px;text-align:center;font-size:15px;background:rgba(0,0,0,.55);border-radius:12px;padding:10px}
  #qrScan .qrbot{display:flex;gap:8px;padding:12px 14px calc(14px + env(safe-area-inset-bottom))}
  #qrScan .qrbot button,#qrScan .qrbot label{flex:1;display:block;margin:0;line-height:1.3;border:0;border-radius:12px;padding:13px 8px;font:inherit;font-size:15px;font-weight:600;text-align:center;background:#fff;color:#0b0f14;cursor:pointer}
  #qrScan .qrbot .zweit{background:rgba(255,255,255,.14);color:#fff}
  #qrScan .qrtipp.hide{display:none}
  #qrScan .qrtipp{display:flex;gap:8px;padding:0 14px 12px} #qrScan .qrtipp input{flex:1;font-size:16px;padding:10px;border-radius:10px;border:0}
  #qrScan .qrtipp button{border:0;border-radius:10px;padding:0 14px;font:inherit;font-weight:600;background:var(--blue);color:#fff}
  .qrbtn{display:flex;align-items:center;justify-content:center;gap:8px}
  .qrli{display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--line,#e6e9ee)} .qrli:last-child{border-bottom:0}
  .qrli .qri{flex:1;min-width:0} .qrli .qri b{display:block;font-size:15px} .qrli .qri small{display:block;color:var(--mut);font-size:12.5px;overflow-wrap:anywhere}
  .qrli button{border:1px solid var(--line,#d6dbe1);background:#fff;border-radius:9px;padding:7px 10px;font:inherit;font-size:13.5px;white-space:nowrap}
  .qrli button.los{color:var(--bad);border-color:#f0c4c4} .qrli button.sure{background:var(--bad);color:#fff}
  .qrcode{display:inline-block;font-family:ui-monospace,Menlo,Consolas,monospace;background:#eef1f4;border-radius:6px;padding:1px 6px;font-size:12.5px}
  .qrok{color:#1d7a3a;font-weight:600} .qrnone{color:var(--mut)}
  #qrView .qrsub{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px} #qrView .qrsub button{border:1px solid var(--line,#d6dbe1);background:#fff;border-radius:999px;padding:7px 12px;font:inherit;font-size:14px}
  #qrView .qrsub button.on{background:var(--blue);border-color:var(--blue);color:#fff}
  .qrneu{background:#f0f8fd;border:1.5px solid var(--blue);border-radius:14px;padding:12px;margin-bottom:12px}`;
  document.head.appendChild(css);

  /* ---------- Scanner ---------- */
  const box = document.createElement("div");
  box.id = "qrScan"; box.className = "hide";
  box.innerHTML = `<div class="qrtop"><b id="qrT">QR-Code scannen</b><button id="qrX">Abbrechen</button></div>
    <div class="qrcam"><video id="qrV" playsinline muted></video><div class="qrframe"></div><div class="qrmsg" id="qrMsg">Kamera wird gestartet …</div></div>
    <div class="qrtipp hide" id="qrTipp"><input id="qrTI" placeholder="Code eintippen" autocomplete="off"><button id="qrTOk">OK</button></div>
    <div class="qrbot"><label class="zweit">📷 Foto<input type="file" accept="image/*" id="qrF" style="display:none"></label><button class="zweit" id="qrTBtn">⌨︎ Eintippen</button></div>`;
  document.body.appendChild(box);
  const $b = s => box.querySelector(s);
  const video = $b("#qrV");
  let stream = null, fertig = null, timer = 0, detector = null;

  let jsqrLaden = null;
  function jsqr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrLaden) jsqrLaden = new Promise((ok, fail) => {
      const s = document.createElement("script"); s.src = "/vendor/jsQR.js";
      s.onload = () => ok(window.jsQR); s.onerror = () => { jsqrLaden = null; fail(new Error("QR-Leser konnte nicht geladen werden")); };
      document.head.appendChild(s);
    });
    return jsqrLaden;
  }
  async function bauDetector() {
    if (detector !== null) return detector;
    detector = false;
    try {
      if ("BarcodeDetector" in window && (await window.BarcodeDetector.getSupportedFormats()).includes("qr_code"))
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) { detector = false; }
    return detector;
  }
  // Bild/Video → Text oder null
  const leinwand = document.createElement("canvas");
  async function lesen(quelle, w, h, gruendlich) {
    const det = await bauDetector();
    if (det) { try { const r = await det.detect(quelle); if (r && r[0] && r[0].rawValue) return r[0].rawValue; } catch (e) {} if (!gruendlich) return null; }
    const lib = await jsqr();
    const f = Math.min(1, (gruendlich ? 1400 : 720) / Math.max(w, h));
    leinwand.width = Math.round(w * f); leinwand.height = Math.round(h * f);
    const cx = leinwand.getContext("2d", { willReadFrequently: true });
    cx.drawImage(quelle, 0, 0, leinwand.width, leinwand.height);
    const d = cx.getImageData(0, 0, leinwand.width, leinwand.height);
    const r = lib(d.data, d.width, d.height, { inversionAttempts: gruendlich ? "attemptBoth" : "dontInvert" });
    return r && r.data ? r.data : null;
  }

  function stopp() {
    clearTimeout(timer); timer = 0;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    video.srcObject = null;
  }
  function ende(text) {
    stopp(); box.classList.add("hide");
    const f = fertig; fertig = null;
    if (text && navigator.vibrate) try { navigator.vibrate(60); } catch (e) {}
    if (f) f(text ? codeAus(text) || null : null);
  }
  async function schleife() {
    if (!stream || !fertig) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try { const t = await lesen(video, video.videoWidth, video.videoHeight, false); if (t) return ende(t); } catch (e) {}
    }
    timer = setTimeout(schleife, 180);
  }

  function scan(titel) {
    if (fertig) ende(null);
    return new Promise(async ok => {
      fertig = ok;
      $b("#qrT").textContent = titel || "QR-Code scannen";
      $b("#qrTipp").classList.add("hide"); $b("#qrTI").value = "";
      $b("#qrMsg").textContent = "Kamera wird gestartet …";
      box.classList.remove("hide");
      bauDetector(); if (!("BarcodeDetector" in window)) jsqr().catch(() => {});
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $b("#qrMsg").textContent = "Live-Kamera nicht verfügbar – bitte „📷 Foto“ tippen."; return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        // inzwischen abgebrochen oder neu gestartet: diese Kamera gleich wieder ausschalten
        if (fertig !== ok) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        video.srcObject = stream; await video.play().catch(() => {});
        $b("#qrMsg").textContent = "QR-Code in den Rahmen halten";
        schleife();
      } catch (e) {
        $b("#qrMsg").textContent = e && e.name === "NotAllowedError"
          ? "Kamera nicht erlaubt – bitte in den Einstellungen erlauben oder „📷 Foto“ tippen."
          : "Kamera nicht verfügbar – bitte „📷 Foto“ tippen.";
      }
    });
  }
  $b("#qrX").onclick = () => ende(null);
  $b("#qrTBtn").onclick = () => { $b("#qrTipp").classList.remove("hide"); $b("#qrTI").focus(); };
  const tippOk = () => { const v = $b("#qrTI").value.trim(); if (v) ende(v); };
  $b("#qrTOk").onclick = tippOk;
  $b("#qrTI").onkeydown = e => { if (e.key === "Enter") tippOk(); };
  $b("#qrF").onchange = async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    $b("#qrMsg").textContent = "Foto wird gelesen …";
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = async () => {
      let t = null; try { t = await lesen(img, img.naturalWidth, img.naturalHeight, true); } catch (err) {}
      URL.revokeObjectURL(url);
      if (t) ende(t); else $b("#qrMsg").textContent = "Auf dem Foto wurde kein QR-Code gefunden – bitte näher und scharf fotografieren.";
    };
    img.onerror = () => { URL.revokeObjectURL(url); $b("#qrMsg").textContent = "Foto konnte nicht geöffnet werden."; };
    img.src = url;
  };

  async function suchen(code) { return AT.api("qr?code=" + encodeURIComponent(code)); }

  const ART = { maschine: "Maschine", anlage: "Anlage", sonstiges: "Sonstiges", artikel: "Lagerartikel", leiter: "Leiter" };
  // nach dem Scannen (Logbuch, Link aus der Handy-Kamera): passend weiterleiten
  async function oeffnen(code) {
    let r;
    try { r = await suchen(code); } catch (e) { say(e.message); return; }
    const z = r.zuordnung;
    if (z && z.art === "maschine" && AT.maschineScan && (AT.darf("maschinen") || AT.darf("maschinen_buero"))) { AT.tab("maschinen"); AT.maschineScan(code, r); return; }
    if (z && z.art === "artikel" && AT.lagerScan) { AT.lagerScan(code, r); return; }
    if (z && z.art === "leiter" && AT.leiterScan) { AT.leiterScan(code, r); return; }
    AT.tab("logbuch");
    if (AT.logbuch) AT.logbuch.ergebnis(r);
  }

  AT.qr = { scan, suchen, oeffnen, codeAus, ART };

  // Link aus der normalen Handy-Kamera (…/q/CODE oder ?qr=CODE): nach der Anmeldung öffnen
  const start = codeAus(location.href.match(/[?&]qr=|\/q\//i) ? location.href : "");
  if (start) {
    try { history.replaceState(null, "", "/"); } catch (e) {}
    const warte = setInterval(() => { if (AT.user && !document.body.classList.contains("locked")) { clearInterval(warte); setTimeout(() => oeffnen(start), 600); } }, 400);
  }

  /* ---------- Allgemeines → QR-Codes (Zuordnung) ---------- */
  AT.qrTab = (function () {
    let el = null, data = null, ma = null, sub = "maschine", such = "", neu = null, busy = false;
    // neu = { code, art, ziel, bezeichnung, konflikt }

    async function laden() {
      try { data = await AT.api("qr"); } catch (e) { say(e.message); }
      if (!ma && (AT.darf("maschinen") || AT.darf("maschinen_buero"))) {
        try { ma = (await AT.api("maschinen")).maschinen || []; } catch (e) { ma = []; }
      }
      malen();
    }
    async function senden(body, msg) {
      if (busy) return; busy = true;
      try {
        data = await AT.api("qr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        say(msg); neu = null;
      } catch (e) {
        if (e.status === 409 && body.aktion === "zuordnen") {
          neu = Object.assign({}, body, { konflikt: e.message });
        } else say(e.message);
      }
      busy = false; malen();
    }
    const codeVon = (art, ziel) => (data && data.codes || []).find(c => c.art === art && c.ziel === ziel);
    const nameMa = m => m.name + (m.nr ? ` (${m.nr})` : "");

    async function scanFuer(art, ziel, bezeichnung) {
      const code = await scan(bezeichnung ? "Aufkleber für „" + bezeichnung + "“ scannen" : "Neuen Aufkleber scannen");
      if (!code) return;
      if (art) senden({ aktion: "zuordnen", code, art, ziel, bezeichnung }, "QR-Code zugeordnet ✓");
      else { neu = { code, art: sub === "alle" ? "maschine" : sub, ziel: "", bezeichnung: "" }; malen(); }
    }
    // von außen (Logbuch / Maschinen): Code ist schon gelesen
    function zuordnen(code, art) { neu = { code, art: art || "maschine", ziel: "", bezeichnung: "" }; sub = neu.art; }

    function neuFormular() {
      if (!neu) return "";
      const n = neu;
      const zielFeld = n.art === "maschine"
        ? (ma && ma.length ? `<label>Maschine</label><select id="qnZ"><option value="">– Maschine wählen –</option>${ma.map(m => {
            const c = codeVon("maschine", m.id);
            return `<option value="${esc(m.id)}" ${m.id === n.ziel ? "selected" : ""}>${esc(nameMa(m))}${c ? " – hat schon einen Code" : ""}</option>`; }).join("")}</select>`
          : `<div class="warn">Maschinenliste nicht verfügbar.</div>`)
        : n.art === "anlage"
        ? `<label>Anlagen-Nr. / Kennung</label><input id="qnZ" value="${esc(n.ziel)}" placeholder="z. B. Anlagen-Nr. aus dem Service" autocomplete="off">
           <label>Bezeichnung</label><input id="qnB" value="${esc(n.bezeichnung)}" placeholder="z. B. Kunde Müller, Bochum – VRF Dach" autocomplete="off">`
        : `<label>Bezeichnung</label><input id="qnB" value="${esc(n.bezeichnung)}" placeholder="z. B. Lagerregal 3, Werkzeugkiste Auto 4" autocomplete="off">`;
      return `<div class="qrneu"><b>Aufkleber <span class="qrcode">${esc(n.code)}</span> zuordnen</b>
        <div class="seg" style="margin:10px 0 2px">${Object.entries(ART).filter(([k]) => k !== "artikel" && k !== "leiter").map(([k, l]) => `<button data-na="${k}" class="${n.art === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${zielFeld}
        ${n.konflikt ? `<div class="warn" style="margin-top:10px">${esc(n.konflikt)}. Trotzdem hierher umhängen?</div>` : ""}
        <button class="bigbtn primary" id="qnGo" style="margin-top:12px">${n.konflikt ? "Ja, umhängen" : "Zuordnen"}</button>
        <button class="add" id="qnX">Abbrechen</button></div>`;
    }

    function zeile(titel, unter, code, knoepfe) {
      return `<div class="qrli"><div class="qri"><b>${esc(titel)}</b><small>${unter ? esc(unter) + " · " : ""}${code ? `<span class="qrok">QR ✓</span> <span class="qrcode">${esc(code.code)}</span>` : `<span class="qrnone">kein QR-Code</span>`}</small></div>${knoepfe}</div>`;
    }
    const losKnopf = c => c ? `<button class="los" data-los="${esc(c.code)}">Lösen</button>` : "";

    function liste() {
      const q = norm(such);
      const codes = (data && data.codes) || [];
      if (sub === "maschine") {
        if (!ma) return `<div class="hint">Lade Maschinen …</div>`;
        if (!ma.length) return `<div class="hint">Keine Maschinen gefunden (Recht „Maschinen“ nötig).</div>`;
        const L = ma.filter(m => !q || norm([m.name, m.nr, m.typ, m.kat, (codeVon("maschine", m.id) || {}).code].join(" ")).includes(q));
        const ohne = ma.filter(m => !codeVon("maschine", m.id)).length;
        return `<div class="hint" style="margin:0 0 6px">${ma.length - ohne} von ${ma.length} Maschinen haben einen QR-Code.</div>` +
          (L.map(m => { const c = codeVon("maschine", m.id);
            return zeile(m.name, [m.nr, m.kat].filter(Boolean).join(" · "), c,
              `<button data-scan="maschine" data-ziel="${esc(m.id)}" data-bez="${esc(nameMa(m))}">📷 ${c ? "Neu" : "Zuordnen"}</button>${losKnopf(c)}`); }).join("") || `<div class="hint">Nichts gefunden.</div>`);
      }
      const L = codes.filter(c => (sub === "alle" || c.art === sub) && (!q || norm([c.code, c.bezeichnung, c.ziel, ART[c.art]].join(" ")).includes(q)));
      const kopf = sub === "anlage" ? `<div class="hint" style="margin:0 0 8px">Die Anlagen kommen später aus der Datenbank des Service. Bis dahin können Aufkleber hier von Hand einer Anlagen-Nr. zugeordnet werden.</div>`
        : sub === "sonstiges" ? `<div class="hint" style="margin:0 0 8px">Für alles andere, z. B. Regale, Werkzeugkisten oder Räume.</div>` : "";
      return kopf + (L.map(c => zeile(c.bezeichnung || c.ziel || c.code, (sub === "alle" ? ART[c.art] : "") + (c.art === "anlage" && c.ziel ? (sub === "alle" ? " " : "") + "Nr. " + c.ziel : ""), c, losKnopf(c))).join("")
        || `<div class="hint">${sub === "alle" ? "Noch keine QR-Codes zugeordnet." : "Noch nichts zugeordnet."}</div>`);
    }

    function malen() {
      if (!el) return;
      if (!AT.darf("qr")) { el.innerHTML = `<section class="card"><div class="hint" style="margin:0">QR-Codes zuordnen darf nur, wer das Recht „QR-Codes zuordnen“ hat.</div></section>`; return; }
      const fokus = document.activeElement && document.activeElement.id;
      el.innerHTML = `<section class="card" id="qrView">
        <div class="qrsub">${[["maschine", "🛠 Maschinen"], ["anlage", "🏭 Anlagen"], ["sonstiges", "🏷 Sonstiges"], ["alle", "📋 Alle Codes"]].map(([k, l]) => `<button data-qsub="${k}" class="${sub === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${neuFormular()}
        ${neu ? "" : `<button class="bigbtn primary qrbtn" id="qrNeuScan">📷 Aufkleber scannen und zuordnen</button>
        <button class="add" id="qrPruef">🔍 Aufkleber prüfen – wozu gehört er?</button>`}
        <input id="qrSuch" type="search" placeholder="Suchen …" value="${esc(such)}" autocomplete="off" style="margin-top:12px">
        <div id="qrListe" style="margin-top:6px">${liste()}</div></section>`;
      binden();
      if (fokus === "qrSuch") { const s = el.querySelector("#qrSuch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }

    function binden() {
      const q = s => el.querySelector(s);
      el.querySelectorAll("[data-qsub]").forEach(b => b.onclick = () => { sub = b.dataset.qsub; if (neu && sub !== "alle") { neu.art = sub; neu.konflikt = ""; } malen(); });
      el.querySelectorAll("[data-na]").forEach(b => b.onclick = () => { merke(); neu.art = b.dataset.na; neu.ziel = ""; neu.konflikt = ""; malen(); });
      const s = q("#qrSuch"); if (s) s.oninput = () => { such = s.value; q("#qrListe").innerHTML = liste(); bindListe(); };
      const ns = q("#qrNeuScan"); if (ns) ns.onclick = () => scanFuer();
      const pr = q("#qrPruef"); if (pr) pr.onclick = async () => {
        const code = await scan("Aufkleber prüfen"); if (!code) return;
        try { const r = await suchen(code); const z = r.zuordnung;
          if (z) say(`${ART[z.art]}: ${z.bezeichnung || z.ziel}`); else { neu = { code, art: sub === "alle" ? "maschine" : sub, ziel: "", bezeichnung: "" }; say("Dieser Aufkleber ist noch frei"); malen(); }
        } catch (e) { say(e.message); }
      };
      const x = q("#qnX"); if (x) x.onclick = () => { neu = null; malen(); };
      const go = q("#qnGo"); if (go) go.onclick = () => {
        merke();
        const n = neu;
        if (n.art === "maschine") { const m = (ma || []).find(y => y.id === n.ziel); if (!m) { say("Bitte Maschine wählen"); return; } n.bezeichnung = nameMa(m); }
        senden({ aktion: "zuordnen", code: n.code, art: n.art, ziel: n.ziel, bezeichnung: n.bezeichnung, ersetzen: !!n.konflikt }, "QR-Code zugeordnet ✓");
      };
      bindListe();
    }
    function merke() {
      if (!neu || !el) return;
      const z = el.querySelector("#qnZ"), b = el.querySelector("#qnB");
      if (z) neu.ziel = z.value.trim(); if (b) neu.bezeichnung = b.value.trim();
    }
    function bindListe() {
      el.querySelectorAll("[data-scan]").forEach(b => b.onclick = () => scanFuer(b.dataset.scan, b.dataset.ziel, b.dataset.bez));
      el.querySelectorAll("[data-los]").forEach(b => b.onclick = () => {
        if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Lösen"; } }, 4000); return; }
        senden({ aktion: "loesen", code: b.dataset.los }, "Zuordnung gelöst");
      });
    }

    return { show(ziel) { el = ziel; malen(); laden(); }, zuordnen, neuLaden() { ma = null; } };
  })();
})();
