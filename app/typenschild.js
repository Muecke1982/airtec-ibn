/* Airtec KApp – Inbetriebnahmeprotokoll: Typenschild fotografieren (oder aus der Mediathek wählen),
   die KI liest Hersteller, Typ, Seriennummer und beim Außengerät Kältemittel, Füllmenge und Stromaufnahme.
   Übernommen werden nur Felder, die das gewählte Protokoll abfragt – vorher zeigt die App alles zum Prüfen an.
   Greift auf das Protokoll-Skript in index.html zu (S, DEV, renderList, save, fam …). Server: POST /api/typenschild */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const komma = v => String(v ?? "").replace(".", ",");

  // je Geräteliste: welche Schild-Angabe in welches Feld; aussen = auch Kältemittel/Füllmenge/Stromaufnahme
  const TEILE = {
    sig: [{ t: "Typenschild", f: { h: "hersteller", m: "modell", sn: "seriennummer" } }],
    sag: [{ t: "Typenschild", f: { m: "modell", sn: "seriennummer" }, aussen: true }],
    ag: [{ t: "Typenschild", f: { typ: "modell", sn: "seriennummer" }, aussen: true }],
    ig: [{ t: "Typenschild", f: { m: "modell", sn: "seriennummer" } }],
    dx: [{ t: "Typenschild Außengerät", f: { agTyp: "modell", sn: "seriennummer", vor: "fuellmenge_kg" }, aussen: true },
         { t: "Typenschild Verdampferkit", f: { kitTyp: "modell", kitSn: "seriennummer" } }],
    kws: [{ t: "Typenschild", f: { bez: "modell", sn: "seriennummer" }, aussen: true }],
  };
  const NAME = { hersteller: "Hersteller", modell: "Typ / Modell", seriennummer: "Seriennummer", kaeltemittel: "Kältemittel", fuellmenge_kg: "Füllmenge", stromaufnahme_a: "Stromaufnahme" };
  const EINHEIT = { fuellmenge_kg: "kg", stromaufnahme_a: "A" };

  // Knöpfe für renderList / renderKws (index.html)
  window.tsKnoepfe = (key, i) => (TEILE[key] || []).map((t, j) =>
    `<button type="button" class="tsbtn" data-ts="${key}" data-i="${i}" data-j="${j}">📷 ${t.t}</button>`).join("");

  const css = document.createElement("style");
  css.textContent = `
  .tsbtn{display:inline-flex;align-items:center;gap:6px;border:1.5px dashed var(--blue);background:#f0f8fd;color:var(--blue);border-radius:10px;padding:8px 12px;font:inherit;font-size:14.5px;font-weight:600;margin:8px 8px 2px 0;cursor:pointer}
  #mTs .box{max-height:92vh;overflow:auto} #mTs img.tsfoto{width:100%;max-height:200px;object-fit:contain;border-radius:10px;background:#111;margin:6px 0 8px}
  #mTs .tsrow{display:grid;grid-template-columns:26px 1fr;gap:4px 8px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line,#e6e9ee)}
  #mTs .tsrow:last-child{border-bottom:0} #mTs .tsrow input[type=checkbox]{width:22px;height:22px;margin:6px 0 0}
  #mTs .tsrow label{margin:0;font-size:13px;color:var(--mut)} #mTs .tsrow .tsin{margin-top:3px} #mTs .tsrow small{display:block;color:var(--mut);font-size:12px;margin-top:2px}
  #mTs .tswait{display:flex;align-items:center;gap:10px;padding:14px 4px;font-size:15px}
  #mTs .tsspin{width:22px;height:22px;border:3px solid #cfe6f5;border-top-color:var(--blue);border-radius:50%;animation:tsdreh 0.9s linear infinite}
  @keyframes tsdreh{to{transform:rotate(360deg)}}`;
  document.head.appendChild(css);

  const modal = document.createElement("div");
  modal.className = "modal"; modal.id = "mTs";
  modal.innerHTML = `<div class="box"><h3 id="tsT">Typenschild</h3><div id="tsBody"></div><div class="btns" id="tsBtns"></div></div>`;
  document.body.appendChild(modal);
  const q = s => modal.querySelector(s);
  const zu = () => modal.classList.remove("show");
  modal.onclick = e => { if (e.target === modal && !laeuft) zu(); };

  const datei = document.createElement("input");
  datei.type = "file"; datei.accept = "image/*"; datei.style.display = "none";
  document.body.appendChild(datei);

  // Foto verkleinern (lange Seite 1600 px) – Seriennummern bleiben lesbar, Upload bleibt klein
  function verkleinern(file, max = 1600, qual = 0.85) {
    return new Promise((ok, fail) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * f); c.height = Math.round(img.naturalHeight * f);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL("image/jpeg", qual));
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(new Error("Foto konnte nicht geöffnet werden")); };
      img.src = url;
    });
  }

  let ziel = null, laeuft = false;
  document.addEventListener("click", e => {
    const b = e.target.closest(".tsbtn"); if (!b) return;
    e.preventDefault();
    ziel = { key: b.dataset.ts, i: +b.dataset.i, j: +b.dataset.j };
    datei.value = ""; datei.click();
  });
  datei.onchange = async () => {
    const f = datei.files && datei.files[0]; if (!f || !ziel) return;
    const teil = TEILE[ziel.key][ziel.j];
    const geraetName = ziel.key === "kws" ? "Kaltwassersatz" : DEV[ziel.key].title(ziel.i);
    q("#tsT").textContent = geraetName + " – " + teil.t;
    q("#tsBtns").innerHTML = "";
    let bild;
    try { bild = await verkleinern(f); } catch (e) { toast(e.message); return; }
    q("#tsBody").innerHTML = `<img class="tsfoto" src="${bild}" alt=""><div class="tswait"><span class="tsspin"></span><span>Die KI liest das Typenschild …</span></div>`;
    modal.classList.add("show");
    if (!navigator.onLine) { fehler("Keine Internetverbindung – bitte später nochmal oder von Hand eintragen.", bild); return; }
    laeuft = true;
    // Abbrechen (z. B. bei schlechtem Netz auf dem Dach) – und spätestens nach 60 s von selbst
    const ab = new AbortController(), uhr = setTimeout(() => ab.abort(), 60000);
    let abgebrochen = false;
    q("#tsBtns").innerHTML = `<button class="secondary" id="tsAb">Abbrechen</button>`;
    q("#tsAb").onclick = () => { abgebrochen = true; ab.abort(); laeuft = false; zu(); };
    try {
      const d = await AT.api("typenschild", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bild }), signal: ab.signal });
      laeuft = false; clearTimeout(uhr);
      if (!abgebrochen) zeigen(d, bild);
    } catch (e) {
      laeuft = false; clearTimeout(uhr);
      if (!abgebrochen) fehler(e.name === "AbortError" ? "Keine Antwort (schlechtes Netz?) – bitte nochmal versuchen oder von Hand eintragen." : e.message, bild);
    }
  };

  function fehler(text, bild) {
    q("#tsBody").innerHTML = `<img class="tsfoto" src="${bild}" alt=""><div class="warn">${esc(text)}</div>`;
    q("#tsBtns").innerHTML = `<button class="secondary" id="tsX">Schließen</button><button class="primary" id="tsNeu">Neues Foto</button>`;
    q("#tsX").onclick = zu; q("#tsNeu").onclick = () => { zu(); datei.value = ""; datei.click(); };
  }

  // aktuelle Werte und Ziel-Felder ermitteln
  function vorschlaege(d) {
    const { key, i, j } = ziel, teil = TEILE[key][j], F = fam();
    const geraet = key === "kws" ? (S.k = S.k || {}) : S[key][i];
    const out = [];
    const add = (feld, wert, label, jetzt, setzen, global) => { if (!wert) return; out.push({ feld, wert, label, jetzt: String(jetzt ?? ""), setzen, global }); };
    for (const [f, quelle] of Object.entries(teil.f)) {
      const lbl = (key === "kws" ? { bez: "Bezeichnung / Typ", sn: "Seriennummer" }[f] : (DEV[key].fields.find(x => x[0] === f) || [])[1]) || NAME[quelle];
      add(quelle, d[quelle], lbl + (EINHEIT[quelle] ? ` (${EINHEIT[quelle]})` : ""), geraet[f], v => { geraet[f] = v; if (key === "dx" && f === "vor") renderDxKm(); }, false);
    }
    // Split: Hersteller steht beim Innengerät (Außengerät übernimmt ihn)
    if (key === "sag" && !(S.sig[0].h || "").trim()) add("hersteller", d.hersteller, "Hersteller (Innen- und Außengerät)", "", v => { S.sig[0].h = v; }, true);
    // Hersteller oben im Protokoll (VRF, Multisplit, DX, Kaltwassersatz)
    if (["vrf", "dx", "kws"].includes(F)) add("hersteller", d.hersteller, "Hersteller (Bauvorhaben)", S.herst, v => { S.herst = v; }, true);
    if (teil.aussen) {
      add("kaeltemittel", kmName(d.kaeltemittel), "Kältemittel", S.km, v => { S.km = v; }, true);
      if (["split", "vrf", "kws"].includes(F) && d.fuellmenge_kg) {
        // mehrere Außengeräte (VRF/Multisplit): vorgefüllt = Summe der abgelesenen Füllmengen
        const liste = key === "ag" ? S.ag : null;
        let wert = d.fuellmenge_kg, label = "Kältemittel vorgefüllt (kg)";
        if (liste && liste.length > 1) {
          const summe = liste.reduce((s, a, k) => s + (k === i ? +d.fuellmenge_kg : (+a._fm || 0)), 0);
          wert = String(Math.round(summe * 1000) / 1000); label = "Kältemittel vorgefüllt – Summe aller Außengeräte (kg)";
        }
        out.push({ feld: "fuellmenge_kg", wert, label, jetzt: String(S.km_vor ?? ""), setzen: v => { S.km_vor = v; if (liste) liste[i]._fm = d.fuellmenge_kg; }, global: true });
      }
      if (["split", "vrf", "dx"].includes(F) && (i === 0 || !String(S.inenn || "").trim()))
        add("stromaufnahme_a", d.stromaufnahme_a, "Nennstromaufnahme Verdichter (A)", S.inenn, v => { S.inenn = v; }, true);
    }
    return out;
  }
  // Kältemittel in der Schreibweise der Auswahlliste
  function kmName(km) {
    if (!km) return "";
    const hit = (typeof listOf === "function" ? listOf("Kältemittel") : []).find(x => normKm(x) === normKm(km));
    return hit || km;
  }

  function zeigen(d, bild) {
    const L = vorschlaege(d);
    const zahlFeld = f => f === "fuellmenge_kg" || f === "stromaufnahme_a";
    q("#tsBody").innerHTML = `<img class="tsfoto" src="${bild}" alt="">` +
      (d.hinweis ? `<div class="warn" style="margin:4px 0 8px">${esc(d.hinweis)}</div>` : "") +
      (L.length ? `<div class="hint" style="margin:0 0 4px">Bitte prüfen – vor allem die Seriennummer. Angehakte Werte werden übernommen.</div>` + L.map((r, k) => {
        const ander = r.jetzt.trim() && r.jetzt.trim() !== String(zahlFeld(r.feld) ? komma(r.wert) : r.wert).trim();
        return `<div class="tsrow"><input type="checkbox" data-k="${k}" ${ander && r.global ? "" : "checked"}><div><label>${esc(r.label)}</label>
          <input class="tsin" data-v="${k}" value="${esc(zahlFeld(r.feld) ? komma(r.wert) : r.wert)}" ${zahlFeld(r.feld) ? 'inputmode="decimal"' : ""}>
          ${ander ? `<small>Bisher: ${esc(r.jetzt)}</small>` : ""}</div></div>`;
      }).join("")
      : `<div class="warn">Auf dem Foto wurden keine passenden Angaben gefunden. Bitte das Typenschild gerade und scharf fotografieren.</div>`);
    q("#tsBtns").innerHTML = L.length ? `<button class="secondary" id="tsX">Abbrechen</button><button class="primary" id="tsOk">Übernehmen</button>`
      : `<button class="secondary" id="tsX">Schließen</button><button class="primary" id="tsNeu">Neues Foto</button>`;
    q("#tsX").onclick = zu;
    if (q("#tsNeu")) q("#tsNeu").onclick = () => { zu(); datei.value = ""; datei.click(); };
    if (q("#tsOk")) q("#tsOk").onclick = () => {
      let n = 0;
      L.forEach((r, k) => { if (!q(`[data-k="${k}"]`).checked) return; const v = q(`[data-v="${k}"]`).value.trim(); if (!v) return; r.setzen(v); n++; });
      save(); neuZeichnen();
      zu(); toast(n ? `${n} ${n === 1 ? "Angabe" : "Angaben"} übernommen – bitte kurz prüfen` : "Nichts übernommen");
    };
  }

  function neuZeichnen() {
    const key = ziel.key;
    if (key === "kws") { renderKws(); }
    else {
      if (key === "sig" || key === "sag") syncSplitH();
      renderList(key);
      if (key === "sag") renderList("sig");
      if (key === "sig") renderList("sag");
      if (key === "dx") renderDxKm();
    }
    bindInputs(); gwpCalc(); if (fam() === "dx") dxCalc(); if (fam() === "vrf") calc();
    if (typeof renderDocs === "function") renderDocs();
  }

  // Knöpfe in die schon gezeichneten Gerätelisten einsetzen
  try { ["sig", "sag", "ag", "ig", "dx"].forEach(k => renderList(k)); renderKws(); } catch (e) { console.error("Typenschild:", e); }
})();
