/* Airtec KApp – Reiter „Nachrichten“ (intern „austausch“)
   • Priorität: Normal (neueste oben) · Wichtig (ganz oben, muss bestätigt werden) · Anpinnen (Büro, erscheint auf der Startseite)
   • jede Nachricht ist ein Chat: antworten mit Verlauf, Fotos anhängen (kleine Vorschau, antippen = groß), Chat schließen
   • Ordner: Offen · Verlauf (geschlossen/abgelaufen, wiederherstellbar) · Papierkorb (30 Tage); im Verlauf nach Person filtern
   • Reiter zeigt die Anzahl offener Nachrichten: hellrot bei ungelesenen, kräftig rot bei unbestätigten wichtigen
   Die Startseite zeigt die angepinnten Chats (hinweise.js nutzt AT.austausch.karte / binden). */
(function () {
  const AT = window.AT;
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const buero = () => AT.darf("hinweise");
  const first = n => String(n || "").split(" ")[0];
  const lc = s => String(s || "").toLowerCase().trim();
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const dd = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "";
  const isoIn = n => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE");
  const wann = z => {   // „heute 07:12“, „gestern 16:30“, „Mo 12.11. 08:15“
    if (!z) return "";
    const d = z.slice(0, 10), uhr = z.slice(11, 16), heute = isoIn(0), gestern = isoIn(-1);
    return d === heute ? "heute " + uhr : d === gestern ? "gestern " + uhr : `${WT[new Date(d + "T12:00:00Z").getUTCDay()]} ${dd(d)} ${uhr}`;
  };
  const kuerzel = n => { const p = String(n || "?").trim().split(/\s+/); return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase(); };
  const farbe = n => { let h = 0; for (const c of String(n || "")) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h},50%,44%)`; };
  const MAX_FOTOS = 4;

  // ---------- Reiter + Ansicht ----------
  const tabBtn = document.createElement("button");
  tabBtn.dataset.tab = "austausch"; tabBtn.innerHTML = `Nachrichten<span class="aucnt hide"></span>`;
  document.querySelector('#tabs button[data-tab="protokolle"]').before(tabBtn);
  tabBtn.onclick = () => AT.tab("austausch");
  const view = document.createElement("main");
  view.id = "auView"; view.dataset.mod = "austausch"; view.className = "hide";
  document.getElementById("app").before(view);
  const hdr = document.querySelector("#hdrType");
  if (hdr) { const s = document.createElement("small"); s.dataset.mod = "austausch"; s.className = "hide"; s.textContent = "Nachrichten"; hdr.parentNode.appendChild(s); }
  const fileIn = document.createElement("input");
  fileIn.type = "file"; fileIn.accept = "image/*"; fileIn.multiple = true; fileIn.style.display = "none";
  document.body.appendChild(fileIn);

  const css = document.createElement("style");
  css.textContent = `
  .tabs button .aucnt{display:inline-block;min-width:18px;margin-left:6px;padding:0 5px;border-radius:9px;background:#fff;color:var(--ink);font-size:11.5px;line-height:18px;text-align:center}
  .tabs button.auneu:not(.on){background:#fde3e3;color:#a12a2a} .tabs button.auneu .aucnt{background:#d14343;color:#fff}
  .tabs button.auwichtig{background:var(--bad)!important;color:#fff!important} .tabs button.auwichtig .aucnt{background:#fff;color:var(--bad)}
  .tabs button.auwichtig.on{box-shadow:inset 0 0 0 3px #7d1d1d}
  .autop{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap} .autop .add{margin:0;flex:1}
  .auord{display:flex;gap:6px;margin-bottom:12px;overflow-x:auto;scrollbar-width:none} .auord::-webkit-scrollbar{display:none}
  .auord button{flex:1 0 auto;border:1.5px solid var(--line);background:#fff;border-radius:20px;padding:8px 13px;font:inherit;font-size:14px;font-weight:600;color:var(--ink);white-space:nowrap}
  .auord button.on{background:var(--ink);border-color:var(--ink);color:#fff}
  .auord button i{font-style:normal;margin-left:5px;background:#eef1f4;color:var(--ink);border-radius:9px;padding:0 6px;font-size:12px}
  .auord button.on i{background:#ffffff33;color:#fff}
  .auperson{margin:-4px 0 12px}
  .aupinhint{display:block;width:100%;text-align:left;border:1px dashed var(--blue);background:#f2fafe;color:var(--blue);border-radius:12px;padding:9px 12px;margin-bottom:12px;font:inherit;font-size:14px;font-weight:600}
  .auc{padding:12px 12px 10px;border-left:5px solid #d5dbe1}
  .auc.wichtig{border-left-color:#f08a00} .auc.pin{border:2px solid var(--blue);border-left-width:5px;box-shadow:0 2px 10px rgba(0,159,218,.13)}
  .auc.neu{border-left-color:var(--blue)} .auc.wichtig.neu{border-left-color:#f08a00}
  .auc.blink{animation:aublink 1.6s ease 2} @keyframes aublink{50%{box-shadow:0 0 0 4px var(--blue)}}
  .auc.zu{opacity:.92;background:#fafbfc}
  .aucop{display:flex;align-items:center;gap:10px}
  .ava{flex:0 0 36px;width:36px;height:36px;border-radius:50%;color:#fff;font-weight:700;font-size:13.5px;display:flex;align-items:center;justify-content:center;letter-spacing:.02em}
  .ava.sm{flex-basis:26px;width:26px;height:26px;font-size:10.5px}
  .auwho{flex:1;min-width:0} .auwho b{display:block;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .auwho small{display:block;color:var(--mut);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .aubadges{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
  .aubadge{font-size:11.5px;font-weight:700;border-radius:6px;padding:1px 7px;background:#eef1f4;color:var(--mut);white-space:nowrap}
  .aubadge.wichtig{background:#fff0d9;color:#9a5800} .aubadge.pin{background:#e3effc;color:var(--blue)} .aubadge.neu{background:var(--blue);color:#fff}
  .aubadge.ok{background:#e7f4e9;color:#2f7d43}
  .auchat{display:flex;flex-direction:column;gap:6px;margin:10px 0 2px}
  .aub{max-width:86%;align-self:flex-start;background:#f1f3f5;border-radius:4px 14px 14px 14px;padding:7px 10px 5px}
  .aub.me{align-self:flex-end;background:#dff1fa;border-radius:14px 4px 14px 14px}
  .aub.erst{max-width:100%;align-self:stretch;background:none;padding:2px 0 0;border-radius:0}
  .aub .wer{font-size:12px;font-weight:700;color:var(--mut);margin-bottom:1px}
  .aub .txt{white-space:pre-wrap;word-break:break-word;font-size:15.5px;line-height:1.38}
  .aub.erst .txt{font-size:16px}
  .aub .zeit{font-size:11px;color:var(--mut);text-align:right;margin-top:2px}
  .aufotos{display:flex;flex-wrap:wrap;gap:6px;margin:5px 0 2px}
  .aufotos img,.aufotos .ph{width:92px;height:92px;object-fit:cover;border-radius:10px;background:#e6eaee;display:block;cursor:zoom-in}
  .aufotos.gross img{width:132px;height:132px}
  .aumehr{align-self:center;border:0;background:#eef1f4;border-radius:12px;padding:4px 12px;font:inherit;font-size:12.5px;color:var(--mut)}
  .auok{display:block;width:100%;margin:10px 0 2px;border:0;border-radius:11px;padding:11px;font:inherit;font-size:15.5px;font-weight:700;color:#fff;background:#f08a00}
  .auok.pin{background:var(--blue)}
  .austat{font-size:12.5px;color:var(--mut);margin-top:8px} .austat button{border:0;background:none;color:var(--blue);font:inherit;padding:0;text-decoration:underline}
  .aunames{font-size:13px;margin-top:4px;color:var(--ink);columns:2;column-gap:12px}
  .aureply{display:flex;gap:6px;align-items:flex-end;margin-top:10px}
  .aureply textarea{flex:1;min-height:40px;max-height:150px;resize:none;padding:9px 12px;border-radius:20px;font-size:15.5px;line-height:1.3}
  .aureply button{flex:0 0 40px;height:40px;border:0;border-radius:50%;font-size:18px;display:flex;align-items:center;justify-content:center}
  .aureply .cam{background:#eef1f4} .aureply .snd{background:var(--blue);color:#fff}
  .auprev{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px} .auprev span{position:relative}
  .auprev img{width:64px;height:64px;object-fit:cover;border-radius:9px;display:block}
  .auprev button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:0;background:var(--ink);color:#fff;font-size:13px;line-height:22px;padding:0}
  .auacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;align-items:center}
  .auacts button{border:0;border-radius:9px;padding:7px 11px;font:inherit;font-size:13.5px;font-weight:600;background:#eef1f4;color:var(--ink)}
  .auacts .on{background:#e3effc;color:var(--blue)} .auacts .zu{margin-left:auto} .auacts .del{background:none;color:var(--bad);padding:7px 4px}
  .auacts .del.sure{background:var(--bad);color:#fff;padding:7px 11px} .auacts .back{background:var(--green);color:#fff}
  .auinfo{font-size:12.5px;color:var(--mut);margin-top:8px}
  .auform textarea{min-height:80px}
  .aupick{max-height:220px;overflow:auto;border:1px solid #cfd5dc;border-radius:10px;padding:4px 10px;background:#fff}
  .aupick label{display:flex;gap:8px;align-items:center;margin:6px 0;color:var(--ink);font-size:15px}
  .auprio{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .auprio button{border:1.5px solid var(--line);background:#fff;border-radius:11px;padding:9px 4px;font:inherit;font-size:14px;font-weight:600;color:var(--ink)}
  .auprio button.on[data-prio=normal]{background:var(--ink);border-color:var(--ink);color:#fff}
  .auprio button.on[data-prio=wichtig]{background:#f08a00;border-color:#f08a00;color:#fff}
  .auprio button.on[data-prio=pin]{background:var(--blue);border-color:var(--blue);color:#fff}
  .auprio-hint{font-size:13px;color:var(--mut);margin-top:6px}
  .aufotobtn{width:100%;margin-top:10px;border:1.5px dashed #b8c1cb;background:#fafbfc;border-radius:11px;padding:10px;font:inherit;font-size:15px;color:var(--ink)}
  .aupoll button{display:flex;justify-content:space-between;align-items:center;width:100%;position:relative;overflow:hidden;border:1.5px solid #cfd5dc;background:#fff;
    border-radius:10px;padding:9px 11px;margin:6px 0 0;font:inherit;font-size:15px;color:var(--ink);text-align:left}
  .aupoll button.mine{border-color:var(--blue);font-weight:700}
  .aupoll button i{position:absolute;left:0;top:0;bottom:0;background:#e3effc;z-index:0} .aupoll button span{position:relative;z-index:1}
  .auleer{text-align:center;color:var(--mut);padding:26px 10px} .auleer b{display:block;font-size:30px;margin-bottom:4px}
  #auRem .box{max-height:85vh;overflow:auto}
  #auLight{align-items:center;background:rgba(0,0,0,.88)} #auLight img{max-width:96vw;max-height:88vh;border-radius:6px;display:block}
  #auLight .x{position:absolute;top:calc(env(safe-area-inset-top) + 12px);right:14px;width:40px;height:40px;border-radius:50%;border:0;background:#ffffff26;color:#fff;font-size:20px}`;
  document.head.appendChild(css);

  const cacheKey = () => "au_cache_" + ((AT.user && AT.user.name) || "");
  let data = null, ordner = "offen", person = "", form = null, prio = "normal", offenStatus = null, busy = false;
  const aufgeklappt = new Set(), entwurf = {}, fotos = {};   // fotos: Ziel ("neu" oder Nachricht-ID) → [{klein, gross}]

  async function post(body) {
    data = await AT.api("austausch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    ls.set(cacheKey(), data); punkt(); tell(); return data;
  }
  const tippt = () => { const a = document.activeElement; return !!(a && a.classList && a.classList.contains("auin")); };
  async function load() {
    person_();
    if (!AT.user || !navigator.onLine) return;
    try { data = await AT.api("austausch"); ls.set(cacheKey(), data); } catch (e) { return; }
    punkt();
    if (tippt()) return;   // nicht neu zeichnen, während jemand schreibt
    tell();
    if (!view.classList.contains("hide") && !form) { paint(); gelesenMelden(); }
    erinnern();
  }
  const horcher = [];
  function tell() { horcher.forEach(f => { try { f(data); } catch (e) {} }); }
  function punkt() {
    const n = (data && data.offen) || 0, c = tabBtn.querySelector(".aucnt");
    c.textContent = n; c.classList.toggle("hide", !n);
    tabBtn.classList.toggle("auwichtig", !!(data && data.wichtigOffen));
    tabBtn.classList.toggle("auneu", !!(data && data.ungelesen) && !(data && data.wichtigOffen));
  }

  // ---------- Fotos ----------
  function verkleinern(file, max, q) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", q));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Das Foto konnte nicht gelesen werden")); };
      img.src = url;
    });
  }
  async function fotoAufbereiten(file) {
    let gross = await verkleinern(file, 1600, 0.72);
    if (gross.length > 1400000) gross = await verkleinern(file, 1200, 0.6);
    return { klein: await verkleinern(file, 420, 0.7), gross };
  }
  let fotoZiel = null, fotoFertig = null;
  function fotoWaehlen(ziel, fertig) { fotoZiel = ziel; fotoFertig = fertig; fileIn.value = ""; fileIn.click(); }
  fileIn.onchange = async () => {
    const list = fotos[fotoZiel] = fotos[fotoZiel] || [];
    const files = [...fileIn.files].slice(0, MAX_FOTOS - list.length);
    if (fileIn.files.length > files.length) say(`Höchstens ${MAX_FOTOS} Fotos je Nachricht`);
    for (const f of files) { try { list.push(await fotoAufbereiten(f)); } catch (e) { say(e.message); } }
    if (fotoFertig) fotoFertig();
  };
  const vorschau = ziel => (fotos[ziel] || []).length ? `<div class="auprev">${fotos[ziel].map((f, i) => `<span><img src="${f.klein}" alt=""><button data-fotoweg="${ziel}" data-i="${i}" aria-label="Foto entfernen">×</button></span>`).join("")}</div>` : "";

  const bildCache = new Map();
  function bildUrl(id, gross) {
    const k = id + (gross ? "g" : "k");
    if (!bildCache.has(k)) bildCache.set(k, fetch(`/api/austausch?bild=${id}${gross ? "&gross=1" : ""}`, { headers: { "x-app-code": (AT.session && AT.session.token) || "" } })
      .then(r => { if (!r.ok) throw new Error("Foto nicht verfügbar"); return r.blob(); }).then(b => URL.createObjectURL(b))
      .catch(e => { bildCache.delete(k); throw e; }));
    return bildCache.get(k);
  }
  function bilderEinsetzen(root) {
    root.querySelectorAll("img[data-bild]:not([src])").forEach(img => bildUrl(+img.dataset.bild, false).then(u => { img.src = u; }).catch(() => { img.alt = "📷"; }));
  }
  const light = document.createElement("div");
  light.className = "modal"; light.id = "auLight"; light.innerHTML = `<img alt=""><button class="x" aria-label="Schließen">✕</button>`;
  document.body.appendChild(light);
  light.onclick = () => { light.classList.remove("show"); light.querySelector("img").removeAttribute("src"); };
  function zeigeGross(id, klein) {
    const img = light.querySelector("img"); img.src = klein || ""; light.classList.add("show");
    bildUrl(id, true).then(u => { if (light.classList.contains("show")) img.src = u; }).catch(e => say(e.message));
  }
  const fotoReihe = (ids, gross) => ids && ids.length ? `<div class="aufotos ${gross ? "gross" : ""}">${ids.map(id => `<img data-bild="${id}" alt="Foto">`).join("")}</div>` : "";

  // ---------- Darstellung ----------
  const ich = () => (AT.user && AT.user.name) || "";
  function bubble(von, text, zeit, bilder, erst) {
    const meins = lc(von) === lc(ich());
    return `<div class="aub ${erst ? "erst" : meins ? "me" : ""}">${!erst && !meins ? `<div class="wer">${esc(first(von))}</div>` : ""}
      ${text ? `<div class="txt">${esc(text)}</div>` : ""}${fotoReihe(bilder, erst)}${erst ? "" : `<div class="zeit">${esc(wann(zeit))}</div>`}</div>`;
  }
  function karte(m) {
    const offenOrd = m.ordner === "offen";
    const anTxt = m.eigene ? "an " + m.an.join(", ") : m.an.includes("Alle") ? "an alle" : m.an.includes("Büro") ? "ans Büro" : "an dich";
    const badges = [
      m.neu ? `<span class="aubadge neu">neu</span>` : "",
      m.pin ? `<span class="aubadge pin">📌 ${m.bis && m.typ !== "auto" ? "bis " + dd(m.bis) : "angepinnt"}</span>` : "",
      m.prio === "wichtig" ? `<span class="aubadge wichtig">❗ Wichtig</span>` : "",
      m.typ === "umfrage" ? `<span class="aubadge">📊 Abstimmung</span>` : "",
      m.brauchtOk && m.bestaetigt ? `<span class="aubadge ok">✓ bestätigt</span>` : "",
    ].join("");
    const top = `<div class="aucop"><span class="ava" style="background:${farbe(m.von)}">${esc(kuerzel(m.von))}</span>
      <div class="auwho"><b>${esc(m.eigene ? "Du" : m.von)}</b><small>${esc(anTxt)} · ${esc(wann(m.erstellt))}${!m.pin && m.bis ? " · gilt bis " + dd(m.bis) : ""}${m.ab && m.eigene ? " · sichtbar ab " + dd(m.ab) : ""}</small></div>
      <div class="aubadges">${badges}</div></div>`;
    let poll = "";
    if (m.umfrage) {
      const u = m.umfrage, max = Math.max(1, ...u.optionen.map(o => o.stimmen));
      poll = `<div class="aupoll">${u.optionen.map(o => `<button data-vote="${o.nr}" data-id="${m.id}" class="${u.meine.includes(o.nr) ? "mine" : ""}" ${u.offen && offenOrd ? "" : "disabled"}>
        <i style="width:${Math.round(o.stimmen / max * 100)}%"></i><span>${u.meine.includes(o.nr) ? "✓ " : ""}${esc(o.text)}</span><span>${o.stimmen}</span></button>
        ${o.namen && o.namen.length ? `<div class="aunames" style="columns:1">${o.namen.map(n => esc(first(n))).join(", ")}</div>` : ""}`).join("")}
        <div class="austat">${u.teilnehmer} haben abgestimmt${u.mehrfach ? " · mehrere Antworten möglich" : ""}${u.offen ? (m.bis ? " · bis " + dd(m.bis) : "") : " · <b>beendet</b>"}</div></div>`;
    }
    const alle = aufgeklappt.has(m.id), ant = m.antworten || [];
    const zeig = alle ? ant : ant.slice(-3);
    const chat = `<div class="auchat">${bubble(m.von, m.text, m.erstellt, m.bilder, true)}${poll}
      ${ant.length > zeig.length ? `<button class="aumehr" data-alle="${m.id}">▴ ${ant.length - zeig.length} frühere Antwort${ant.length - zeig.length > 1 ? "en" : ""} anzeigen</button>` : ""}
      ${zeig.map(a => bubble(a.von, a.text, a.zeit, a.bilder)).join("")}</div>`;
    let stat = "";
    if (m.empfaenger && m.empfaenger.length && m.typ !== "umfrage") {
      const E = m.empfaenger, n = E.length, g = E.filter(e => e.gelesen).length, b = E.filter(e => e.bestaetigt).length, mitOk = m.prio === "wichtig" || m.pin;
      stat = `<div class="austat">👁 ${g}/${n} gelesen${mitOk ? ` · ✓ ${b}/${n} bestätigt` : ""} · <button data-stat="${m.id}">${offenStatus === m.id ? "weniger" : "wer?"}</button>
        ${offenStatus === m.id ? `<div class="aunames">${E.map(x => `${mitOk && x.bestaetigt ? "✅" : x.gelesen ? "👁" : "⏳"} ${esc(x.wer)}`).join("<br>")}</div>` : ""}</div>`;
    }
    let unten = "";
    if (m.typ === "gruss") unten = "";
    else if (offenOrd) {
      const ok = m.brauchtOk && !m.bestaetigt ? `<button class="auok ${m.pin ? "pin" : ""}" data-ok="${m.id}">✓ Gelesen und bestätigen</button>` : "";
      const daumen = (m.reaktionen || []).filter(r => r.r === "👍");
      const acts = [];
      if (!m.eigene) acts.push(`<button data-like="${m.id}" class="${m.meineReaktion === "👍" ? "on" : ""}">👍${daumen.length ? " " + daumen.length : ""}</button>`);
      else if (daumen.length) acts.push(`<button disabled>👍 ${daumen.length}</button>`);
      if (m.darfLoeschen) acts.push(`<button class="del" data-del="${m.id}">Löschen</button>`);
      acts.push(`<button class="zu" data-zu="${m.id}">Chat schließen ✓</button>`);
      unten = `${ok}<div class="aureply"><button class="cam" data-foto="${m.id}" aria-label="Foto anhängen">📷</button>
          <textarea class="auin" data-entwurf="${m.id}" rows="1" placeholder="Antworten …">${esc(entwurf[m.id] || "")}</textarea>
          <button class="snd" data-send="${m.id}" aria-label="Senden">➤</button></div>${vorschau(m.id)}
        <div class="auacts">${acts.join("")}</div>`;
    } else if (m.ordner === "verlauf") {
      unten = `<div class="auinfo">${m.geschlossen ? "🗂 Geschlossen " + esc(wann(m.geschlossen)) : ""}${m.abgelaufen ? (m.geschlossen ? " · " : "") + "⌛ Abgelaufen am " + dd(m.bis) : ""}</div>
        <div class="auacts"><button class="back" data-wieder="${m.id}">↩︎ Wiederherstellen</button>${m.darfLoeschen ? `<button class="del" data-del="${m.id}">Löschen</button>` : ""}</div>`;
    } else {
      unten = `<div class="auinfo">🗑 Gelöscht von ${esc(m.geloescht.von || "?")} ${esc(wann(m.geloescht.am))} – wird nach 30 Tagen endgültig entfernt</div>
        <div class="auacts"><button class="back" data-wieder="${m.id}">↩︎ Wiederherstellen</button></div>`;
    }
    const kl = ["card", "auc", m.prio, m.pin ? "pin" : "", m.neu ? "neu" : "", offenOrd ? "" : "zu"].join(" ");
    return `<section class="${kl}" data-m="${m.id}">${top}${chat}${stat}${unten}</section>`;
  }

  function formular() {
    const P = (data && data.personen) || [];
    const isU = form === "umfrage";
    const pick = `<label>An</label><div class="aupick">
      <label><input type="checkbox" data-an="*buero"> 🏢 Büro</label>
      ${buero() ? `<label><input type="checkbox" data-an="*alle" ${isU ? "checked" : ""}> 👥 Alle</label>` : ""}
      ${P.map(n => `<label><input type="checkbox" data-an="${esc(n)}"> ${esc(n)}</label>`).join("")}</div>`;
    const prioHint = { normal: "Erscheint unter „Nachrichten“, neueste oben.", wichtig: "Steht unter „Nachrichten“ ganz oben und muss vom Empfänger bestätigt werden. Bis dahin ist der Reiter rot.",
      pin: "Erscheint auf der Startseite bis zum Ablaufdatum und muss bestätigt werden." }[prio];
    return `<section class="card auform"><h2>${isU ? "Neue Abstimmung" : "Neue Nachricht"}</h2>${pick}
      <label>${isU ? "Frage" : "Nachricht"}</label><textarea id="auText" class="auin" rows="3" placeholder="${isU ? "z. B. Welcher Termin passt für die Weihnachtsfeier?" : "Nachricht …"}">${esc(entwurf.neu || "")}</textarea>
      ${isU ? `<label>Antwortmöglichkeiten</label><div id="auOpts">${[1, 2, 3].map(i => `<input class="auopt" placeholder="Antwort ${i}" style="margin-bottom:6px">`).join("")}</div>
        <button class="add" id="auOptAdd" style="margin-top:0">+ weitere Antwort</button>
        <label class="hichk" style="display:flex;gap:8px;align-items:center;color:var(--ink)"><input type="checkbox" id="auMehr"> mehrere Antworten erlaubt</label>`
        : `<button class="aufotobtn" data-foto="neu">📷 Foto anhängen</button><div id="auNeuPrev">${vorschau("neu")}</div>
        <label>Priorität</label><div class="auprio">
          <button data-prio="normal" class="${prio === "normal" ? "on" : ""}">Normal</button>
          <button data-prio="wichtig" class="${prio === "wichtig" ? "on" : ""}">❗ Wichtig</button>
          ${buero() ? `<button data-prio="pin" class="${prio === "pin" ? "on" : ""}">📌 Anpinnen</button>` : ""}</div>
        <div class="auprio-hint">${prioHint}</div>`}
      <div class="row"><div><label>${isU ? "Abstimmen bis" : prio === "pin" ? "Gilt bis (nötig)" : "Gilt bis (optional)"}</label><input type="date" id="auBis" value="${prio === "pin" && !isU ? isoIn(7) : ""}"></div>
        ${buero() && !isU ? `<div><label>Sichtbar ab (optional)</label><input type="date" id="auAb"></div>` : "<div></div>"}</div>
      ${prio === "pin" && !isU ? `<label>Erinnerung, bis bestätigt</label><select id="auErin">
          <option value="0">keine</option><option value="1" selected>täglich</option><option value="2">alle 2 Tage</option><option value="7">wöchentlich</option></select>` : ""}
      <div class="vwbtns" style="display:flex;gap:8px;margin-top:14px"><button class="bigbtn primary" id="auSend" style="flex:2">${isU ? "Abstimmung starten" : prio === "pin" ? "📌 Anpinnen" : "Senden"}</button>
        <button class="bigbtn secondary" id="auCancel" style="flex:1">Abbrechen</button></div></section>`;
  }

  // „Autoinfo an Büro“ – nur für Mitarbeiter mit zugeordnetem Auto
  const AUTO_GRUND = [["tuev", "Mein Auto muss zum TÜV – bitte Termin erstellen"], ["defekt", "Mein Auto ist defekt – bitte Termin erstellen"], ["sonst", "Sonstiges zum Auto"]];
  function autoFormular(autos) {
    return `<section class="card auform"><h2>🚐 Autoinfo an Büro</h2>
      ${autos.length > 1 ? `<label>Welches Fahrzeug?</label><select id="aiAuto">${autos.map(a => `<option value="${a.id}">${esc(a.kennzeichen)}${a.name ? " – " + esc(a.name) : ""}</option>`).join("")}</select>`
        : `<div class="hint" style="margin-top:0">${esc(autos[0].kennzeichen)}${autos[0].name ? " – " + esc(autos[0].name) : ""}</div>`}
      <label>Worum geht es?</label><div class="aupick" style="max-height:none">${AUTO_GRUND.map(([k, l], i) => `<label><input type="radio" name="aiGrund" value="${k}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}</div>
      <div id="aiWasBox" class="hide"><label id="aiWasL">Was ist defekt?</label><textarea id="aiWas" rows="3" placeholder="z. B. Warnleuchte Motor, Bremsen quietschen …"></textarea></div>
      <button class="aufotobtn" data-foto="neu">📷 Foto anhängen</button><div id="auNeuPrev">${vorschau("neu")}</div>
      <div class="vwbtns" style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn primary" id="aiSend" style="flex:2">An das Büro senden</button>
        <button class="bigbtn secondary" id="auCancel" style="flex:1">Abbrechen</button></div></section>`;
  }
  function bindAuto() {
    const q = s => view.querySelector(s);
    const autos = data.meineAutos || [];
    q("#auCancel").onclick = () => { form = null; delete fotos.neu; paint(); };
    const grund = () => (view.querySelector('[name="aiGrund"]:checked') || {}).value;
    view.querySelectorAll('[name="aiGrund"]').forEach(r => r.onchange = () => {
      q("#aiWasBox").classList.toggle("hide", grund() === "tuev");
      q("#aiWasL").textContent = grund() === "defekt" ? "Was ist defekt?" : "Worum geht es?";
      if (grund() !== "tuev") q("#aiWas").focus();
    });
    q("#aiSend").onclick = async () => {
      const a = autos.find(x => x.id === +(q("#aiAuto") ? q("#aiAuto").value : autos[0].id)) || autos[0];
      const g = grund(), was = q("#aiWas").value.trim();
      if (g !== "tuev" && !was) { q("#aiWas").focus(); return say(g === "defekt" ? "Bitte kurz beschreiben, was defekt ist" : "Bitte kurz beschreiben, worum es geht"); }
      const fz = `${a.kennzeichen}${a.name ? " (" + a.name + ")" : ""}`;
      const text = g === "tuev" ? `🚐 ${fz} muss zum TÜV – bitte Termin erstellen.`
        : g === "defekt" ? `🚐 ${fz} ist defekt – bitte Termin erstellen.\nDefekt: ${was}` : `🚐 ${fz}: ${was}`;
      q("#aiSend").disabled = true;
      try { await post({ aktion: "senden", an: ["*buero"], text, prio: g === "sonst" ? "normal" : "wichtig", bilder: fotos.neu || [] }); form = null; delete fotos.neu; ordner = "offen"; say("An das Büro gesendet ✓"); }
      catch (e) { say(e.message); q("#aiSend").disabled = false; return; }
      paint();
    };
  }

  function paint() {
    if (!AT.user) { view.innerHTML = ""; return; }
    if (!data) { view.innerHTML = `<section class="card">Lade …</section>`; return; }
    const alle = (data.nachrichten || []).filter(m => m.typ !== "gruss");
    const N = { offen: alle.filter(m => m.ordner === "offen" && !m.pin), verlauf: alle.filter(m => m.ordner === "verlauf"), geloescht: alle.filter(m => m.ordner === "geloescht") };
    const pins = alle.filter(m => m.ordner === "offen" && m.pin).length;
    let list = N[ordner] || [];
    if (ordner !== "offen" && person) list = list.filter(m => (m.beteiligt || []).some(n => lc(n) === lc(person)));
    const autos = data.meineAutos || [];
    const leute = [...new Set([...N.verlauf, ...N.geloescht].flatMap(m => m.beteiligt || []))].filter(n => lc(n) !== lc(ich())).sort((a, b) => a.localeCompare(b, "de"));
    const zeigPapierkorb = buero() || N.geloescht.length;
    const leer = { offen: ["💬", "Keine offenen Nachrichten."], verlauf: ["🗂", person ? "Keine geschlossenen Chats mit " + first(person) + "." : "Noch keine geschlossenen Chats."],
      geloescht: ["🗑", person ? "Keine gelöschten Nachrichten mit " + first(person) + "." : "Der Papierkorb ist leer."] }[ordner];
    view.innerHTML = `${form === "auto" ? autoFormular(autos) : form ? formular() : `<div class="autop">
        <button class="add" id="auNew">✉️ Neue Nachricht</button>${buero() ? `<button class="add" id="auPoll">📊 Abstimmung</button>` : ""}
        ${autos.length ? `<button class="add" id="auAuto" style="flex:1 1 100%">🚐 Autoinfo an Büro</button>` : ""}</div>`}
      <div class="auord"><button data-o="offen" class="${ordner === "offen" ? "on" : ""}">💬 Offen<i>${N.offen.length}</i></button>
        <button data-o="verlauf" class="${ordner === "verlauf" ? "on" : ""}">🗂 Verlauf<i>${N.verlauf.length}</i></button>
        ${zeigPapierkorb ? `<button data-o="geloescht" class="${ordner === "geloescht" ? "on" : ""}">🗑 Papierkorb<i>${N.geloescht.length}</i></button>` : ""}</div>
      ${ordner !== "offen" ? `<select class="auperson" id="auPerson"><option value="">👥 Alle Personen</option>${leute.map(n => `<option ${lc(n) === lc(person) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      ${ordner === "offen" && pins ? `<button class="aupinhint" id="auZurStart">📌 ${pins} angepinnte Mitteilung${pins > 1 ? "en" : ""} auf der Startseite →</button>` : ""}
      ${list.length ? list.map(karte).join("") : `<section class="card auleer"><b>${leer[0]}</b>${esc(leer[1])}</section>`}`;
    binden(view);
    bindForm();
  }

  // ---------- Bedienung ----------
  function bindForm() {
    const q = s => view.querySelector(s);
    const nn = q("#auNew"); if (nn) nn.onclick = () => { form = "nachricht"; prio = "normal"; paint(); const t = q("#auText"); if (t) t.focus(); };
    const np = q("#auPoll"); if (np) np.onclick = () => { form = "umfrage"; paint(); };
    const na = q("#auAuto"); if (na) na.onclick = () => { form = "auto"; paint(); };
    const zs = q("#auZurStart"); if (zs) zs.onclick = () => AT.tab("start");
    view.querySelectorAll("[data-o]").forEach(b => b.onclick = () => { ordner = b.dataset.o; paint(); gelesenMelden(); });
    const pe = q("#auPerson"); if (pe) pe.onchange = () => { person = pe.value; paint(); };
    if (form === "auto") return bindAuto();
    if (!form) return;
    q("#auCancel").onclick = () => { form = null; delete entwurf.neu; delete fotos.neu; paint(); };
    view.querySelectorAll("[data-prio]").forEach(b => b.onclick = () => { merkeForm(); prio = b.dataset.prio; paint(); stelleForm(); });
    const add = q("#auOptAdd"); if (add) add.onclick = () => { const i = document.createElement("input"); i.className = "auopt"; i.style.marginBottom = "6px"; i.placeholder = "Antwort " + (view.querySelectorAll(".auopt").length + 1); q("#auOpts").appendChild(i); i.focus(); };
    // „Alle“ schließt einzelne Häkchen aus
    view.querySelectorAll("[data-an]").forEach(c => c.onchange = () => { if (c.dataset.an === "*alle" && c.checked) view.querySelectorAll("[data-an]").forEach(x => { if (x !== c) x.checked = false; });
      else if (c.checked) { const a = q('[data-an="*alle"]'); if (a) a.checked = false; } });
    q("#auSend").onclick = async () => {
      const an = [...view.querySelectorAll("[data-an]:checked")].map(c => c.dataset.an);
      const text = q("#auText").value.trim();
      if (!an.length) return say("Bitte Empfänger wählen");
      if (!text && !(fotos.neu || []).length) { q("#auText").focus(); return; }
      const b = { aktion: form === "umfrage" ? "umfrage" : "senden", an, text, bis: q("#auBis").value };
      if (form === "umfrage") { b.optionen = [...view.querySelectorAll(".auopt")].map(i => i.value.trim()).filter(Boolean); b.mehrfach = q("#auMehr").checked; }
      else { b.prio = prio; b.bilder = fotos.neu || []; if (q("#auAb")) b.ab = q("#auAb").value; if (prio === "pin") b.erinnerung = +q("#auErin").value; }
      q("#auSend").disabled = true; q("#auSend").textContent = "Sende …";
      try { await post(b); form = null; delete entwurf.neu; delete fotos.neu; ordner = "offen";
        say(b.aktion === "umfrage" ? "Abstimmung gestartet ✓" : prio === "pin" ? "Angepinnt – steht auf der Startseite ✓" : "Gesendet ✓"); }
      catch (e) { say(e.message); q("#auSend").disabled = false; q("#auSend").textContent = "Senden"; return; }
      paint();
    };
  }
  // Eingaben im Formular über ein Neuzeichnen retten (Prioritäts-Wechsel)
  let formStand = null;
  function merkeForm() {
    formStand = { an: [...view.querySelectorAll("[data-an]:checked")].map(c => c.dataset.an), text: (view.querySelector("#auText") || {}).value || "",
      ab: (view.querySelector("#auAb") || {}).value || "", bis: (view.querySelector("#auBis") || {}).value || "" };
  }
  function stelleForm() {
    if (!formStand) return;
    formStand.an.forEach(a => { const c = view.querySelector(`[data-an="${CSS.escape(a)}"]`); if (c) c.checked = true; });
    const t = view.querySelector("#auText"); if (t) t.value = formStand.text;
    const ab = view.querySelector("#auAb"); if (ab) ab.value = formStand.ab;
    const bis = view.querySelector("#auBis"); if (bis && (formStand.bis || prio !== "pin")) bis.value = formStand.bis || bis.value;
    formStand = null;
  }

  // Bedienelemente einer Liste von Chat-Karten (Nachrichten-Reiter und Startseite)
  function binden(root) {
    const neu = () => { if (!view.classList.contains("hide")) paint(); tell(); };
    root.querySelectorAll("[data-entwurf]").forEach(t => {
      const groesse = () => { t.style.height = "auto"; t.style.height = Math.min(150, t.scrollHeight + 2) + "px"; };
      t.oninput = () => { entwurf[t.dataset.entwurf] = t.value; groesse(); };
      if (t.value) groesse();
    });
    const nt = root.querySelector("#auText"); if (nt) nt.oninput = () => { entwurf.neu = nt.value; };
    root.querySelectorAll("[data-foto]").forEach(b => b.onclick = () => {
      const ziel = b.dataset.foto;
      fotoWaehlen(ziel, () => {
        if (ziel === "neu") { const p = root.querySelector("#auNeuPrev"); if (p) { p.innerHTML = vorschau("neu"); binden(p); } return; }
        const karte = b.closest("[data-m]"); if (!karte) return;
        let p = karte.querySelector(".auprev"); const html = vorschau(ziel);
        if (p) p.outerHTML = html || ""; else karte.querySelector(".aureply").insertAdjacentHTML("afterend", html);
        binden(karte);
      });
    });
    root.querySelectorAll("[data-fotoweg]").forEach(b => b.onclick = () => {
      const z = b.dataset.fotoweg; (fotos[z] || []).splice(+b.dataset.i, 1);
      const sp = b.closest(".auprev"), parent = sp.parentNode; sp.outerHTML = vorschau(z); binden(parent);
    });
    root.querySelectorAll("img[data-bild]").forEach(img => img.onclick = () => zeigeGross(+img.dataset.bild, img.src));
    root.querySelectorAll("[data-send]").forEach(b => b.onclick = () => {
      const id = b.dataset.send, text = (entwurf[id] || "").trim();
      if (!text && !(fotos[id] || []).length) { const t = root.querySelector(`[data-entwurf="${id}"]`); if (t) t.focus(); return; }
      act(b, { aktion: "antworten", id: +id, text, bilder: fotos[id] || [] }, "", () => { delete entwurf[id]; delete fotos[id]; aufgeklappt.add(+id); }, neu);
    });
    root.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => act(b, { aktion: "bestaetigen", id: +b.dataset.ok }, "Bestätigt ✓", null, neu));
    root.querySelectorAll("[data-zu]").forEach(b => b.onclick = () => act(b, { aktion: "schliessen", id: +b.dataset.zu }, "Chat geschlossen – im Ordner „Verlauf“ nachzulesen", null, neu));
    root.querySelectorAll("[data-wieder]").forEach(b => b.onclick = () => act(b, { aktion: "wiederherstellen", id: +b.dataset.wieder }, "Wiederhergestellt ✓", null, neu));
    root.querySelectorAll("[data-like]").forEach(b => b.onclick = () => act(b, { aktion: "reaktion", id: +b.dataset.like, r: "👍" }, "", null, neu));
    root.querySelectorAll("[data-vote]").forEach(b => b.onclick = () => {
      const m = data.nachrichten.find(x => x.id === +b.dataset.id); if (!m) return;
      const nr = +b.dataset.vote, mine = m.umfrage.meine;
      const nrs = m.umfrage.mehrfach ? (mine.includes(nr) ? mine.filter(x => x !== nr) : [...mine, nr]) : (mine.includes(nr) ? [] : [nr]);
      act(b, { aktion: "abstimmen", id: m.id, nrs }, "Abgestimmt ✓", null, neu);
    });
    root.querySelectorAll("[data-stat]").forEach(b => b.onclick = () => { offenStatus = offenStatus === +b.dataset.stat ? null : +b.dataset.stat; neu(); });
    root.querySelectorAll("[data-alle]").forEach(b => b.onclick = () => { aufgeklappt.add(+b.dataset.alle); neu(); });
    root.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich löschen?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Löschen"; } }, 4000); return; }
      act(b, { aktion: "loeschen", id: +b.dataset.del }, "In den Papierkorb gelegt", null, neu);
    });
    bilderEinsetzen(root);
  }
  async function act(btn, body, msg, vorher, danach) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    try { await post(body); if (vorher) vorher(); if (msg) say(msg); } catch (e) { say(e.message); if (btn) btn.disabled = false; busy = false; return; }
    busy = false; if (danach) danach();
  }

  // Ungelesene als gelesen melden, sobald sie angezeigt wurden
  let readTimer = null;
  function gelesenMelden(ids) {
    clearTimeout(readTimer);
    readTimer = setTimeout(async () => {
      if (!data) return;
      if (!ids) { if (view.classList.contains("hide") || ordner !== "offen") return; ids = data.nachrichten.filter(m => m.neu && m.ordner === "offen" && !m.pin && m.typ !== "gruss").map(m => m.id); }
      if (!ids.length) return;
      try { const d = await AT.api("austausch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "gelesen", ids }) });
        // Markierung „neu“ bleibt in der aktuellen Ansicht sichtbar, nur der Zähler geht zurück
        data.ungelesen = d.ungelesen; data.wichtigOffen = d.wichtigOffen; data.offen = d.offen; ls.set(cacheKey(), d); punkt(); } catch (e) {}
    }, 1500);
  }

  // ---------- Erinnerung (angepinnte Nachrichten) ----------
  const rem = document.createElement("div");
  rem.className = "modal"; rem.id = "auRem"; rem.innerHTML = `<div class="box"></div>`;
  document.body.appendChild(rem);
  let remGezeigt = 0;
  function erinnern() {
    if (!data || !data.erinnern || !data.erinnern.length || rem.classList.contains("show") || Date.now() - remGezeigt < 60000) return;
    const list = data.nachrichten.filter(m => data.erinnern.includes(m.id));
    if (!list.length) return;
    remGezeigt = Date.now();
    rem.querySelector(".box").innerHTML = `<h3>📌 Erinnerung</h3>${list.map(m => `<div class="card auc pin" style="margin:10px 0">
      <div class="aucop"><span class="ava sm" style="background:${farbe(m.von)}">${esc(kuerzel(m.von))}</span><div class="auwho"><b>${esc(m.von)}</b><small>${m.bis && m.typ !== "auto" ? "gilt bis " + dd(m.bis) : ""}</small></div></div>
      <div class="auchat">${bubble(m.von, m.text, m.erstellt, m.bilder, true)}</div>
      <button class="auok pin" data-rem-ok="${m.id}">✓ Gelesen und bestätigen</button></div>`).join("")}
      <div class="btns"><button class="secondary" id="auRemLater">Später erinnern</button></div>`;
    rem.classList.add("show");
    bilderEinsetzen(rem);
    rem.querySelectorAll("[data-rem-ok]").forEach(b => b.onclick = async () => {
      b.disabled = true; try { await post({ aktion: "bestaetigen", id: +b.dataset.remOk }); } catch (e) { say(e.message); }
      b.closest(".card").remove(); if (!rem.querySelector("[data-rem-ok]")) rem.classList.remove("show");
      if (!view.classList.contains("hide")) paint();
    });
    rem.querySelector("#auRemLater").onclick = async () => {
      rem.classList.remove("show");
      const ids = [...rem.querySelectorAll("[data-rem-ok]")].map(b => +b.dataset.remOk);
      try { await post({ aktion: "erinnert", ids }); } catch (e) {}
    };
  }

  // ---------- für die Startseite ----------
  AT.austausch = {
    get data() { person_(); return data; },
    load, post,
    onChange(f) { horcher.push(f); },
    // angepinnte, offene Chats (für die Startseite)
    pins() { return ((data && data.nachrichten) || []).filter(m => m.pin && m.ordner === "offen" && m.typ !== "gruss"); },
    karte, binden,
    gelesen(ids) { if (ids && ids.length) gelesenMelden(ids); },
    oeffnen(id) {
      const m = id && data && data.nachrichten.find(x => x.id === id);
      if (m && m.pin && m.ordner === "offen") { AT.tab("start"); } else { ordner = m ? m.ordner : "offen"; person = ""; form = null; AT.tab("austausch"); }
      if (id) setTimeout(() => { const el = document.querySelector(`[data-m="${id}"]`); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("blink"); } }, 350);
    },
    schreiben(an) { form = "nachricht"; prio = "normal"; AT.tab("austausch"); setTimeout(() => { if (an) { const c = view.querySelector(`[data-an="${an}"]`); if (c) c.checked = true; } const t = view.querySelector("#auText"); if (t) t.focus(); }, 300); },
  };
  // je Person eigener Zwischenspeicher – nach Abmelden/Anmelden nie die Nachrichten der vorherigen Person zeigen
  let fuer = null;
  function person_() {
    const n = AT.user && AT.user.name;
    if (n !== fuer) { fuer = n; data = n ? ls.get(cacheKey()) : null; ordner = "offen"; person = ""; form = null; offenStatus = null;
      for (const k of Object.keys(entwurf)) delete entwurf[k]; for (const k of Object.keys(fotos)) delete fotos[k]; punkt(); }
  }
  AT.modules.austausch = { show() { person_(); ordner = "offen"; form = null; paint(); load(); gelesenMelden(); } };
  person_(); punkt();
  setInterval(() => { if (!document.hidden && AT.user) load(); }, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && AT.user) load(); });
})();
