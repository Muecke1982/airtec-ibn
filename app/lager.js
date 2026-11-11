/* Airtec App – Modul „Lager“.
   Monteure: Hauptkategorien unten (wischen), Unterkategorien oben, Artikel mit „Fast leer“ / „Leer“. Häufig gemeldete oben.
   Büro: Bestellliste nach Lieferant – abhaken oder „Bei … bestellen“ mit Mail-Vorschau. Daten: /api/lager (Airtec_Lager.xlsx). */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const office = () => !!(AT.user && AT.user.schreiben);
  const short = s => String(s || "").replace(/^(\d{2}\.\d{2}\.)\d{4}/, "$1");
  const first = n => String(n || "").split(",")[0].trim().split(" ")[0];

  const root = document.getElementById("laView");
  root.innerHTML = `
    <div class="lgtop">
      <input id="lgQ" type="search" placeholder="Artikel suchen (Name, Größe, Bestellnr.) …" autocomplete="off">
      <button class="lgorders hide" id="lgOrd">📋 Bestellliste <b id="lgOrdN"></b></button>
    </div>
    <div class="lgsubs" id="lgSubs"></div>
    <div id="lgList"><div class="hint">Wird geladen …</div></div>
    <div id="lgOrder" class="hide"></div>
    <nav class="lgkats" id="lgKats"></nav>`;
  const $ = s => root.querySelector(s);
  let data = ls.get("lg_cache"), kat = ls.get("lg_kat") || "fav", sub = "", mode = "list", busy = false, groupBy = "lief";

  async function load(fresh) {
    try {
      const d = await AT.api("lager" + (fresh ? "?t=" + Date.now() : ""));
      data = d; ls.set("lg_cache", d);
    } catch (e) {
      if (!data) { $("#lgList").innerHTML = `<div class="card"><div class="lerr">${esc(e.message)}</div></div>`; return; }
      if (navigator.onLine) toast2(e.message);
    }
    paint();
  }

  const freiList = () => (data && data.frei) || [];
  const openList = () => [...((data && data.arts) || []).filter(a => a.offen), ...freiList()];
  const findArt = nr => (data.arts || []).find(x => x.nr === nr) || freiList().find(x => x.nr === nr);
  const stLabel = st => st === "Leer" ? "⛔ leer" : st === "Benötigt" ? "🆕 benötigt" : "⚠ fast leer";
  const EINH = ["Stk", "m", "Rolle", "Ring", "Karton", "Paket", "Flasche", "Dose", "Kartusche", "Satz", "kg", "l"];
  const post = body => AT.api("lager", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // Sortierung: häufig gemeldet zuerst, dann „Häufig (x)“, dann Reihenfolge der Excel
  const byUse = (a, b) => (b.n - a.n) || ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)) || (a.pos - b.pos);

  function paint() {
    if (!data) return;
    $("#lgOrd").classList.toggle("hide", !office());
    const n = openList().length;
    $("#lgOrdN").textContent = n ? n : "";
    $("#lgOrd").classList.toggle("on", mode === "order");
    if (mode === "order") return paintOrder();
    $("#lgOrder").classList.add("hide"); $("#lgList").classList.remove("hide"); $("#lgSubs").classList.remove("hide"); $("#lgKats").classList.remove("hide");
    // Hauptkategorien unten
    const kats = [{ id: "fav", name: "Häufig", sym: "⭐" }, ...data.kats];
    if (!kats.some(k => k.id === kat)) kat = "fav";
    $("#lgKats").innerHTML = kats.map(k => {
      const open = k.id === "fav" ? 0 : data.arts.filter(a => a.kat === k.id && a.offen).length;
      return `<button data-k="${k.id}" class="${k.id === kat ? "on" : ""}"><span>${esc(k.sym)}</span>${esc(k.name)}${open ? `<i>${open}</i>` : ""}</button>`;
    }).join("");
    // Unterkategorien oben
    const K = data.kats.find(k => k.id === kat);
    const q = norm($("#lgQ").value.trim());
    if (q) $("#lgSubs").innerHTML = `<span class="lgsubinfo">Suche in allen Kategorien</span>`;
    else if (!K) $("#lgSubs").innerHTML = `<span class="lgsubinfo">⭐ Am häufigsten gemeldet</span>`;
    else {
      const used = K.subs.filter(s => data.arts.some(a => a.kat === K.id && a.sub === s));
      if (sub && !used.includes(sub)) sub = "";
      $("#lgSubs").innerHTML = `<button data-s="" class="${sub ? "" : "on"}">Alle</button>` + used.map(s => `<button data-s="${esc(s)}" class="${s === sub ? "on" : ""}">${esc(s)}</button>`).join("");
    }
    // Artikel
    let list;
    if (q) {
      const words = q.split(/\s+/);
      list = data.arts.filter(a => { const t = norm([a.bez, a.gr, a.sub, a.herst, a.best, a.such, a.nr].join(" ")); return words.every(w => t.includes(w)); }).sort(byUse).slice(0, 80);
    } else if (!K) list = data.arts.filter(a => a.n > 0 || a.fav).sort(byUse).slice(0, 40);
    else list = data.arts.filter(a => a.kat === K.id && (!sub || a.sub === sub)).sort(byUse);
    $("#lgList").innerHTML = (list.length ? `<ul class="lglist">${list.map(row).join("")}</ul>`
      : `<div class="card"><div class="hint" style="margin:0">${q ? "Nichts gefunden – fehlt das Material in der Liste? Dann unten eintragen." : !K ? "Noch nichts gemeldet – hier erscheinen später die Artikel, die am häufigsten knapp werden." : "In dieser Kategorie sind noch keine Artikel eingetragen."}</div></div>`) + freiBox(q);
  }

  // Material, das nicht in der Liste steht: schon gemeldete + Formular
  let neuOpen = false;
  function freiBox(q) {
    const me = norm(AT.user && AT.user.name), fr = freiList();
    return `<section class="card lgneu">
      ${fr.length ? `<div class="lgneuh">🆕 Gemeldet, nicht in der Liste</div><ul class="lgneul">${fr.map(f => `<li><div class="lginfo"><b>${esc(f.bez)}</b>${f.gr ? `<small>${esc(f.gr)}</small>` : ""}
        <span class="lgst">${esc(first(f.offen.von))} ${esc(short(f.offen.am).slice(0, 6))}${f.notiz ? " · " + esc(f.notiz) : ""}${norm(f.offen.von).includes(me) ? ` <button class="lgback" data-fz="${esc(f.nr)}">zurücknehmen</button>` : ""}</span></div></li>`).join("")}</ul>` : ""}
      <button class="add" id="lgNeuBtn"${neuOpen ? ' style="display:none"' : ""}>＋ Material, das nicht in der Liste ist</button>
      <div id="lgNeuForm"${neuOpen ? "" : ' class="hide"'}>
        <div class="lgneuh">Material melden, das nicht in der Liste ist</div>
        <label>Was fehlt?</label><input id="lnBez" placeholder="z. B. Kabelkanal" value="${esc(q ? $("#lgQ").value.trim() : "")}">
        <label>Größe / Typ</label><input id="lnGr" placeholder="z. B. 40 × 60 mm, grau">
        <label>Notiz (Menge, Hersteller, Baustelle …)</label><input id="lnNotiz" placeholder="optional">
        <button class="bigbtn primary" id="lnOk">Melden</button><button class="add" id="lnX">Abbrechen</button>
      </div></section>`;
  }

  async function neuMelden() {
    const bez = $("#lnBez").value.trim();
    if (!bez) { $("#lnBez").focus(); toast2("Bitte eintragen, was fehlt"); return; }
    if (busy) return; busy = true; $("#lnOk").disabled = true;
    try {
      data = await post({ aktion: "neu", bez, gr: $("#lnGr").value.trim(), notiz: $("#lnNotiz").value.trim() });
      ls.set("lg_cache", data); neuOpen = false; $("#lgQ").value = ""; toast2(`„${bez}“ ans Büro gemeldet ✓`);
    } catch (e) { toast2(e.message); }
    busy = false; paint();
  }

  function row(a) {
    const o = a.offen, st = o && o.status;
    const sub = [a.gr, a.ve && "VE " + a.ve, a.ort].filter(Boolean).map(esc).join(" · ");
    return `<li class="${st === "Leer" ? "leer" : st ? "wenig" : ""}" data-nr="${esc(a.nr)}">
      <div class="lginfo"><b>${esc(a.bez)}</b>${sub ? `<small>${sub}</small>` : ""}
        ${o ? `<span class="lgst">${st === "Leer" ? "⛔ leer" : "⚠ fast leer"} · ${esc(first(o.von))} ${esc(short(o.am).slice(0, 6))} <button class="lgback" data-a="zurueck">wieder da</button></span>` : ""}</div>
      <div class="lgbtns"><button class="lgw${st === "Fast leer" ? " on" : ""}" data-a="Fast leer">Fast leer</button><button class="lgl${st === "Leer" ? " on" : ""}" data-a="Leer">Leer</button></div></li>`;
  }

  async function melden(nr, a) {
    if (busy) return;
    if (!navigator.onLine) { toast2("Keine Internetverbindung"); return; }
    const art = data.arts.find(x => x.nr === nr); if (!art) return;
    if (a !== "zurueck" && art.offen && art.offen.status === a) { toast2("Ist schon als „" + a + "“ gemeldet"); return; }
    busy = true;
    // sofort anzeigen, dann speichern
    const prev = art.offen;
    art.offen = a === "zurueck" ? null : { status: a === "Leer" || (prev && prev.status === "Leer") ? "Leer" : "Fast leer", von: AT.user.name, am: new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) };
    paint();
    try {
      data = await AT.api("lager", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a === "zurueck" ? { aktion: "zurueck", nr } : { aktion: "melden", nr, status: a }) });
      ls.set("lg_cache", data);
      toast2(a === "zurueck" ? "Zurückgenommen" : `${art.bez}: „${a}“ gemeldet ✓`);
    } catch (e) { art.offen = prev; toast2(e.message); }
    busy = false; paint();
  }

  /* ---------- Büro: Bestellliste ---------- */
  function paintOrder() {
    $("#lgList").classList.add("hide"); $("#lgSubs").classList.add("hide"); $("#lgKats").classList.add("hide");
    const box = $("#lgOrder"); box.classList.remove("hide");
    const all = openList();
    const neu = all.filter(a => a.frei && !a.lief), items = all.filter(a => !(a.frei && !a.lief));
    const imp = `<button class="add" id="lgImp">📥 Artikel aus Excel in die Liste importieren</button>`;
    if (!all.length) { box.innerHTML = `<section class="card"><h2>Bestellliste</h2><div class="hint" style="margin:0">Nichts zu bestellen – alles da. 👍</div>${imp}</section>`; return; }
    const keyOf = a => groupBy === "lief" ? (a.lief || "Ohne Lieferant") : (data.kats.find(k => k.id === a.kat) || {}).name || "–";
    const groups = new Map();
    for (const a of items.sort((x, y) => (x.offen.status === "Leer" ? 0 : 1) - (y.offen.status === "Leer" ? 0 : 1) || x.bez.localeCompare(y.bez)))
      { const k = keyOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    const keyOf2 = a => a.frei && groupBy !== "lief" ? "🆕 Nicht in der Liste" : keyOf(a);
    groups.clear();
    for (const a of items.sort((x, y) => (x.offen.status === "Leer" ? 0 : 1) - (y.offen.status === "Leer" ? 0 : 1) || x.bez.localeCompare(y.bez)))
      { const k = keyOf2(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    box.innerHTML = `<section class="card lgohead"><h2>Bestellliste</h2>
        <div class="machips"><button data-g="lief" class="${groupBy === "lief" ? "on" : ""}">nach Lieferant</button><button data-g="kat" class="${groupBy === "kat" ? "on" : ""}">nach Kategorie</button></div>${imp}</section>` +
      (neu.length ? `<section class="card lgogroup lgonew"><div class="lgogh"><h3>🆕 Nicht in der Liste <small>${neu.length} Meldung${neu.length === 1 ? "" : "en"}</small></h3></div>
        <div class="hint" style="margin-top:2px">In die Lager-Liste aufnehmen (mit Kategorie und Lieferant) oder nur einmalig bei einem Lieferanten bestellen.</div>
        <ul class="lgolist">${neu.map(a => `<li data-nr="${esc(a.nr)}" class="lgnewli"><div class="lgnewrow">
            <div class="lginfo"><b>${esc(a.bez)}</b>${a.gr ? `<small>${esc(a.gr)}</small>` : ""}${a.notiz ? `<small>„${esc(a.notiz)}“</small>` : ""}
              <span class="lgst">${esc(a.offen.von)} · ${esc(short(a.offen.am).slice(0, 6))}</span></div>
            <button class="lgdone" data-done="${esc(a.nr)}" title="ohne Bestellung abhaken">✓</button></div>
            <div class="lgnewbtns"><button class="add" data-auf="${esc(a.nr)}">📋 In Liste aufnehmen</button><button class="add" data-once="${esc(a.nr)}">Nur einmalig bestellen</button></div>
            <div class="lgnewform hide"></div></li>`).join("")}</ul></section>` : "") +
      [...groups].map(([g, list]) => {
        const L = groupBy === "lief" && (data.lieferanten || []).find(l => norm(l.name) === norm(g));
        return `<section class="card lgogroup" data-g="${esc(g)}"><div class="lgogh"><h3>${esc(g)} <small>${list.length} Artikel</small></h3></div>
          <ul class="lgolist">${list.map(a => `<li data-nr="${esc(a.nr)}">
            <label class="lgochk"><input type="checkbox" checked></label>
            <div class="lginfo"><b>${esc(a.bez)}</b><small>${[a.gr, a.best && "Best.-Nr. " + a.best, a.ve && "VE " + a.ve, groupBy !== "lief" && a.lief].filter(Boolean).map(esc).join(" · ")}</small>
              <span class="lgst">${a.frei ? "🆕 nicht in der Liste" : stLabel(a.offen.status)} · ${esc(a.offen.von)} · ${esc(short(a.offen.am).slice(0, 6))}</span></div>
            <div class="lgoqty"><input type="number" min="1" inputmode="numeric" value="${esc(parseInt(a.menge) || 1)}"><small>${esc(a.einh || "")}</small></div>
            <button class="lgdone" data-done="${esc(a.nr)}" title="ohne Bestellung abhaken">✓</button></li>`).join("")}</ul>
          ${groupBy === "lief" && g !== "Ohne Lieferant" ? `<button class="bigbtn primary lgobuy" data-buy="${esc(g)}">✉️ Bei ${esc(g)} bestellen</button>${L && !L.mail ? `<div class="hint">Für ${esc(g)} ist noch keine Bestell-E-Mail in der Excel (Blatt „Lieferanten“) hinterlegt.</div>` : ""}` : groupBy === "lief" ? `<div class="hint">Diesen Artikeln ist in der Excel kein Lieferant zugeordnet.</div>` : ""}
        </section>`;
      }).join("");
  }

  function liefField(id) {
    return `<select id="${id}"><option value="">– Lieferant wählen –</option>${(data.lieferanten || []).map(l => `<option>${esc(l.name)}</option>`).join("")}<option value="+">＋ Neuer Lieferant …</option></select>
      <input id="${id}N" class="hide" placeholder="Name des neuen Lieferanten"><input id="${id}M" class="hide" placeholder="Bestell-E-Mail (optional)" type="email">`;
  }
  const liefVal = (f, id) => { const s = f.querySelector("#" + id); return s.value === "+" ? f.querySelector("#" + id + "N").value.trim() : s.value; };

  function openForm(li, kind) {
    const f = li.querySelector(".lgnewform"), a = findArt(li.dataset.nr);
    root.querySelectorAll(".lgnewform").forEach(x => { if (x !== f) { x.classList.add("hide"); x.innerHTML = ""; } });
    if (!f.classList.contains("hide") && f.dataset.kind === kind) { f.classList.add("hide"); f.innerHTML = ""; return; }
    f.dataset.kind = kind; f.classList.remove("hide");
    if (kind === "once") {
      f.innerHTML = `<label>Lieferant</label>${liefField("nfL")}
        <div class="hint">Der Artikel erscheint dann einmalig in der Bestellliste bei diesem Lieferanten – ohne in die Excel-Liste aufgenommen zu werden.</div>
        <button class="bigbtn primary" data-save="once">Lieferant zuordnen</button>`;
    } else {
      const kopts = data.kats.map(k => `<option value="${k.id}">${esc(k.sym)} ${esc(k.name)}</option>`).join("");
      f.innerHTML = `<label>Kategorie</label><select id="nfK"><option value="">– wählen –</option>${kopts}</select>
        <label>Unterkategorie</label><select id="nfS"><option value="">– erst Kategorie wählen –</option></select><input id="nfSN" class="hide" placeholder="Name der neuen Unterkategorie">
        <label>Bezeichnung</label><input id="nfB" value="${esc(a.bez)}">
        <label>Größe / Typ</label><input id="nfG" value="${esc(a.gr)}">
        <label>Lieferant</label>${liefField("nfL")}
        <label>Bestellnummer beim Lieferanten</label><input id="nfBn" placeholder="optional">
        <div class="lgnf2"><div><label>Einheit</label><select id="nfE">${EINH.map(x => `<option>${x}</option>`).join("")}</select></div>
          <div><label>VE</label><input id="nfV" placeholder="z. B. Ring 50 m"></div></div>
        <label>Hersteller</label><input id="nfH" placeholder="optional">
        <label class="lgnfchk"><input type="checkbox" id="nfF"> Häufig gebraucht (⭐)</label>
        <div class="hint">Wird mit der nächsten Art.-Nr. in die Lager-Excel in SharePoint geschrieben und steht danach bei den Monteuren in der Liste.</div>
        <button class="bigbtn primary" data-save="auf">In Liste aufnehmen</button>`;
      const subs = () => {
        const K = data.kats.find(k => k.id === f.querySelector("#nfK").value);
        f.querySelector("#nfS").innerHTML = K ? `<option value="">– keine –</option>${K.subs.map(s => `<option>${esc(s)}</option>`).join("")}<option value="+">＋ Neue Unterkategorie …</option>` : `<option value="">– erst Kategorie wählen –</option>`;
        f.querySelector("#nfSN").classList.add("hide");
      };
      f.querySelector("#nfK").onchange = subs;
      f.querySelector("#nfS").onchange = e => f.querySelector("#nfSN").classList.toggle("hide", e.target.value !== "+");
    }
    const ls2 = f.querySelector("#nfL");
    ls2.onchange = () => { const n = ls2.value === "+"; f.querySelector("#nfLN").classList.toggle("hide", !n); f.querySelector("#nfLM").classList.toggle("hide", !n); };
    f.querySelector("[data-save]").onclick = async e => {
      const btn = e.target, lief = liefVal(f, "nfL");
      let body;
      if (kind === "once") {
        if (!lief) { toast2("Bitte einen Lieferanten wählen"); return; }
        body = { aktion: "lieferant", nr: a.nr, lief };
      } else {
        const kat = f.querySelector("#nfK").value, sv = f.querySelector("#nfS").value;
        const sub = sv === "+" ? f.querySelector("#nfSN").value.trim() : sv;
        if (!kat) { toast2("Bitte eine Kategorie wählen"); return; }
        if (sv === "+" && !sub) { toast2("Bitte die neue Unterkategorie benennen"); return; }
        if (!f.querySelector("#nfB").value.trim()) { toast2("Bezeichnung fehlt"); return; }
        body = { aktion: "aufnehmen", nr: a.nr, kat, sub, lief, liefMail: f.querySelector("#nfLM").value.trim(), bez: f.querySelector("#nfB").value.trim(), gr: f.querySelector("#nfG").value.trim(),
          best: f.querySelector("#nfBn").value.trim(), einh: f.querySelector("#nfE").value, ve: f.querySelector("#nfV").value.trim(), herst: f.querySelector("#nfH").value.trim(), fav: f.querySelector("#nfF").checked };
      }
      btn.disabled = true; const t = btn.textContent; btn.textContent = "Wird gespeichert …";
      try {
        data = await post(body); ls.set("lg_cache", data);
        toast2(kind === "once" ? `Bei ${lief} in die Bestellliste ✓` : `In die Lager-Liste aufgenommen ✓`); paint();
      } catch (err) { toast2(err.message); btn.disabled = false; btn.textContent = t; }
    };
  }

  /* ---------- Büro: Artikel aus Excel importieren ---------- */
  let impItems = null;
  function openImport() {
    const box = $("#lgOrder");
    box.innerHTML = `<section class="card lgimp"><h2>Artikel importieren</h2>
      <div class="hint" style="margin-top:0">Excel-Datei wählen: entweder im Lager-Format (Spalten Kategorie, Unterkategorie, Bezeichnung, Größe / Typ, Hersteller, Lieferant, Bestellnummer, Einheit, VE …)
      oder ein Artikel-Export vom Lieferanten (z. B. Mosecker). Danach siehst du eine Vorschau und kannst Kategorie und Unterkategorie je Artikel festlegen.</div>
      <input type="file" id="liFile" accept=".xlsx">
      <div id="liPrev"></div>
      <button class="add" id="liX">Zurück zur Bestellliste</button></section>`;
    window.scrollTo(0, 0);
  }

  function paintImport() {
    const P = $("#liPrev"), it = impItems;
    const kopt = sel => `<option value="">– Kategorie –</option>` + data.kats.map(k => `<option value="${k.id}"${k.id === sel ? " selected" : ""}>${esc(k.sym)} ${esc(k.name)}</option>`).join("");
    const sopt = x => { const K = data.kats.find(k => k.id === x.kat); if (!K) return `<option value="">–</option>`;
      const subs = [...K.subs]; if (x.sub && !subs.includes(x.sub)) subs.push(x.sub);
      return `<option value="">– keine –</option>` + subs.map(s => `<option${s === x.sub ? " selected" : ""}>${esc(s)}${K.subs.includes(s) ? "" : " (neu)"}</option>`).join(""); };
    const n = it.filter(x => x.on).length;
    P.innerHTML = `<div class="lgimpall"><label>Kategorie für alle markierten</label><select id="liAllK">${kopt("")}</select></div>
      <ul class="lgimpl">${it.map((x, i) => `<li data-i="${i}" class="${x.doppelt ? "dup" : ""}">
        <label class="lgochk"><input type="checkbox" data-on${x.on ? " checked" : ""}></label>
        <div class="lgimpb"><input data-f="bez" value="${esc(x.bez)}"><input data-f="gr" value="${esc(x.gr)}" placeholder="Größe / Typ">
          <small>${[x.best && "Best.-Nr. " + x.best, x.lief, x.herst, x.einh].filter(Boolean).map(esc).join(" · ")}${x.doppelt ? ` · <b>schon in der Liste</b>` : ""}</small>
          <div class="lgimpk"><select data-f="kat">${kopt(x.kat)}</select><select data-f="sub">${sopt(x)}</select></div></div></li>`).join("")}</ul>
      <button class="bigbtn primary" id="liGo">${n} Artikel importieren</button>`;
  }

  async function importFile(f) {
    const P = $("#liPrev"); P.innerHTML = `<div class="hint">Datei wird gelesen …</div>`;
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
    try {
      const d = await post({ aktion: "vorschau", datei: b64 });
      impItems = d.vorschau.map(x => ({ ...x, on: !x.doppelt }));
      paintImport();
    } catch (e) { P.innerHTML = `<div class="lerr">${esc(e.message)}</div>`; }
  }

  async function importGo(btn) {
    const sel = impItems.filter(x => x.on);
    if (!sel.length) { toast2("Bitte Artikel anhaken"); return; }
    const ohne = sel.filter(x => !x.kat).length;
    if (ohne) { toast2(`${ohne} Artikel ohne Kategorie – bitte zuordnen`); return; }
    btn.disabled = true; btn.textContent = "Wird in die Excel geschrieben …";
    try {
      data = await post({ aktion: "importieren", items: sel.map(({ on, doppelt, katName, subNeu, ...x }) => x) });
      ls.set("lg_cache", data);
      toast2(`${data.importiert.length} Artikel importiert ✓${data.uebersprungen ? ` (${data.uebersprungen} schon vorhanden)` : ""}`);
      impItems = null; paint();
    } catch (e) { toast2(e.message); btn.disabled = false; btn.textContent = sel.length + " Artikel importieren"; }
  }

  root.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "liFile" && t.files[0]) { importFile(t.files[0]); return; }
    if (!impItems) return;
    if (t.id === "liAllK") { impItems.forEach(x => { if (x.on) { x.kat = t.value; x.sub = ""; } }); paintImport(); return; }
    const li = t.closest(".lgimpl li"); if (!li) return;
    const x = impItems[+li.dataset.i];
    if (t.hasAttribute("data-on")) { x.on = t.checked; $("#liGo").textContent = impItems.filter(y => y.on).length + " Artikel importieren"; return; }
    const f = t.dataset.f; if (!f) return;
    x[f] = t.value;
    if (f === "kat") { x.sub = ""; paintImport(); }
  });

  function selected(groupEl) {
    const out = [];
    groupEl.querySelectorAll("li").forEach(li => {
      if (li.querySelector("input[type=checkbox]").checked)
        out.push({ a: findArt(li.dataset.nr), menge: li.querySelector(".lgoqty input").value || "1" });
    });
    return out;
  }

  function mailText(lief, pos) {
    const L = (data.lieferanten || []).find(l => norm(l.name) === norm(lief)) || {};
    const lines = pos.map(({ a, menge }) => `${menge} ${a.einh || "x"}  ${a.best || "(ohne Best.-Nr.)"}  ${a.bez}${a.gr ? " – " + a.gr : ""}${a.ve ? " (VE " + a.ve + ")" : ""}`);
    return {
      an: L.mail || "", cc: L.cc || "",
      betreff: `Bestellung Airtec Kältetechnik${L.kd ? " – Kd.-Nr. " + L.kd : ""}`,
      text: `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie uns folgende Artikel:\n\n${lines.join("\n")}\n\n` +
        (L.kd ? `Kundennummer: ${L.kd}\n` : "") +
        `Lieferanschrift: Airtec Kältetechnik GmbH, Max-Planck-Str. 2, 48599 Gronau\n\nBitte bestätigen Sie uns kurz den Liefertermin.\n\nVielen Dank und freundliche Grüße\n${AT.user.name}\nAirtec Kältetechnik GmbH`,
    };
  }

  function openMail(lief, pos) {
    const m = mailText(lief, pos);
    const box = $("#lgOrder");
    box.innerHTML = `<section class="card lgmail"><h2>Bestellung an ${esc(lief)}</h2>
      <div class="hint" style="margin-top:0">${pos.length} Position${pos.length === 1 ? "" : "en"} – bitte prüfen und bei Bedarf ändern.</div>
      <label>An</label><input id="lmTo" value="${esc(m.an)}" placeholder="E-Mail des Lieferanten">
      <label>Kopie (CC)</label><input id="lmCc" value="${esc(m.cc)}">
      <label>Betreff</label><input id="lmSub" value="${esc(m.betreff)}">
      <label>Text</label><textarea id="lmText" rows="${Math.min(24, 14 + pos.length)}">${esc(m.text)}</textarea>
      ${data.direktSenden ? `<button class="bigbtn primary" id="lmSend">Absenden</button><button class="add" id="lmApp">Stattdessen im Mail-Programm öffnen</button>`
        : `<button class="bigbtn primary" id="lmApp">Im Mail-Programm öffnen</button><div class="hint">Nach dem Senden im Mail-Programm hier bestätigen:</div><button class="add" id="lmDone">✓ Bestellung ist raus – als bestellt markieren</button>`}
      <button class="add" id="lmX">Zurück zur Bestellliste</button></section>`;
    const g = s => box.querySelector(s);
    const payload = senden => ({ aktion: "bestellt", lieferant: lief, nrs: pos.map(p => p.a.nr), mengen: Object.fromEntries(pos.map(p => [p.a.nr, p.menge])),
      senden, an: g("#lmTo").value.trim(), cc: g("#lmCc").value.trim(), betreff: g("#lmSub").value.trim(), text: g("#lmText").value });
    const done = async (senden, btn) => {
      if (senden && !g("#lmTo").value.trim()) { g("#lmTo").focus(); toast2("Bitte E-Mail-Adresse eintragen"); return; }
      btn.disabled = true; const t = btn.textContent; btn.textContent = senden ? "Wird gesendet …" : "Wird gespeichert …";
      try {
        data = await AT.api("lager", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(senden)) });
        ls.set("lg_cache", data); toast2(senden ? `Bestellung an ${lief} gesendet ✓` : `Als bestellt markiert ✓`); paint();
      } catch (e) { toast2(e.message); btn.disabled = false; btn.textContent = t; }
    };
    if (g("#lmSend")) g("#lmSend").onclick = e => done(true, e.target);
    g("#lmApp").onclick = () => {
      const href = `mailto:${encodeURIComponent(g("#lmTo").value.trim())}?${g("#lmCc").value.trim() ? "cc=" + encodeURIComponent(g("#lmCc").value.trim()) + "&" : ""}subject=${encodeURIComponent(g("#lmSub").value)}&body=${encodeURIComponent(g("#lmText").value)}`;
      location.href = href;
      if (data.direktSenden) {   // beim Umweg über das Mail-Programm danach bestätigen lassen
        g("#lmApp").insertAdjacentHTML("afterend", `<button class="add" id="lmDone">✓ Bestellung ist raus – als bestellt markieren</button>`);
        g("#lmDone").onclick = e => done(false, e.target);
      }
    };
    if (g("#lmDone")) g("#lmDone").onclick = e => done(false, e.target);
    g("#lmX").onclick = paint;
    window.scrollTo(0, 0);
  }

  /* ---------- Bedienung ---------- */
  root.addEventListener("click", async e => {
    const t = e.target;
    const kb = t.closest("#lgKats button");
    if (kb) { kat = kb.dataset.k; sub = ""; ls.set("lg_kat", kat); $("#lgQ").value = ""; paint(); window.scrollTo(0, 0); return; }
    const sb = t.closest("#lgSubs button");
    if (sb) { sub = sb.dataset.s; paint(); return; }
    const ab = t.closest(".lglist [data-a]");
    if (ab) { melden(ab.closest("li").dataset.nr, ab.dataset.a); return; }
    const gb = t.closest("[data-g]");
    if (gb && gb.tagName === "BUTTON") { groupBy = gb.dataset.g; paint(); return; }
    const dn = t.closest("[data-done]");
    if (dn) {
      if (!dn.classList.contains("sure")) { dn.classList.add("sure"); dn.textContent = "abhaken?"; setTimeout(() => { if (dn.isConnected) { dn.classList.remove("sure"); dn.textContent = "✓"; } }, 4000); return; }
      dn.disabled = true;
      try { data = await AT.api("lager", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "abhaken", nrs: [dn.dataset.done] }) }); ls.set("lg_cache", data); toast2("Abgehakt ✓"); }
      catch (err) { toast2(err.message); }
      paint(); return;
    }
    if (t.closest("#lgNeuBtn")) { neuOpen = true; $("#lgNeuForm").classList.remove("hide"); $("#lgNeuBtn").style.display = "none"; $("#lnBez").focus(); return; }
    if (t.closest("#lnX")) { neuOpen = false; paint(); return; }
    if (t.closest("#lnOk")) { neuMelden(); return; }
    const fz = t.closest("[data-fz]");
    if (fz) {
      if (!fz.classList.contains("sure")) { fz.classList.add("sure"); fz.textContent = "wirklich?"; return; }
      try { data = await post({ aktion: "zurueck", nr: fz.dataset.fz }); ls.set("lg_cache", data); toast2("Zurückgenommen"); } catch (err) { toast2(err.message); }
      paint(); return;
    }
    const nf = t.closest("[data-auf],[data-once]");
    if (nf) { openForm(nf.closest("li"), nf.dataset.auf ? "auf" : "once"); return; }
    if (t.closest("#lgImp")) { openImport(); return; }
    if (t.closest("#liX")) { impItems = null; paint(); return; }
    if (t.closest("#liGo")) { importGo(t.closest("#liGo")); return; }
    const buy = t.closest("[data-buy]");
    if (buy) {
      const pos = selected(buy.closest(".lgogroup"));
      if (!pos.length) { toast2("Bitte mindestens einen Artikel anhaken"); return; }
      openMail(buy.dataset.buy, pos); return;
    }
  });
  $("#lgQ").oninput = paint;
  $("#lgOrd").onclick = () => { mode = mode === "order" ? "list" : "order"; paint(); window.scrollTo(0, 0); };

  AT.modules.lager = { show() { if (mode !== "order") mode = "list"; paint(); load(); } };
  AT.lagerOrders = () => { mode = "order"; AT.tab("lager"); };
})();
