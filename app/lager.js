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

  const openList = () => ((data && data.arts) || []).filter(a => a.offen);
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
    if (!list.length) {
      $("#lgList").innerHTML = `<div class="card"><div class="hint" style="margin:0">${q ? "Nichts gefunden." : !K ? "Noch nichts gemeldet – hier erscheinen später die Artikel, die am häufigsten knapp werden." : "In dieser Kategorie sind noch keine Artikel eingetragen."}</div></div>`;
      return;
    }
    $("#lgList").innerHTML = `<ul class="lglist">${list.map(row).join("")}</ul>`;
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
    const items = openList();
    if (!items.length) { box.innerHTML = `<section class="card"><h2>Bestellliste</h2><div class="hint" style="margin:0">Nichts zu bestellen – alles da. 👍</div></section>`; return; }
    const keyOf = a => groupBy === "lief" ? (a.lief || "Ohne Lieferant") : (data.kats.find(k => k.id === a.kat) || {}).name || "–";
    const groups = new Map();
    for (const a of items.sort((x, y) => (x.offen.status === "Leer" ? 0 : 1) - (y.offen.status === "Leer" ? 0 : 1) || x.bez.localeCompare(y.bez)))
      { const k = keyOf(a); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
    box.innerHTML = `<section class="card lgohead"><h2>Bestellliste</h2>
        <div class="machips"><button data-g="lief" class="${groupBy === "lief" ? "on" : ""}">nach Lieferant</button><button data-g="kat" class="${groupBy === "kat" ? "on" : ""}">nach Kategorie</button></div></section>` +
      [...groups].map(([g, list]) => {
        const L = groupBy === "lief" && (data.lieferanten || []).find(l => norm(l.name) === norm(g));
        return `<section class="card lgogroup" data-g="${esc(g)}"><div class="lgogh"><h3>${esc(g)} <small>${list.length} Artikel</small></h3></div>
          <ul class="lgolist">${list.map(a => `<li data-nr="${esc(a.nr)}">
            <label class="lgochk"><input type="checkbox" checked></label>
            <div class="lginfo"><b>${esc(a.bez)}</b><small>${[a.gr, a.best && "Best.-Nr. " + a.best, a.ve && "VE " + a.ve, groupBy !== "lief" && a.lief].filter(Boolean).map(esc).join(" · ")}</small>
              <span class="lgst">${a.offen.status === "Leer" ? "⛔ leer" : "⚠ fast leer"} · ${esc(a.offen.von)} · ${esc(short(a.offen.am).slice(0, 6))}</span></div>
            <div class="lgoqty"><input type="number" min="1" inputmode="numeric" value="${esc(parseInt(a.menge) || 1)}"><small>${esc(a.einh || "")}</small></div>
            <button class="lgdone" data-done="${esc(a.nr)}" title="ohne Bestellung abhaken">✓</button></li>`).join("")}</ul>
          ${groupBy === "lief" && g !== "Ohne Lieferant" ? `<button class="bigbtn primary lgobuy" data-buy="${esc(g)}">✉️ Bei ${esc(g)} bestellen</button>${L && !L.mail ? `<div class="hint">Für ${esc(g)} ist noch keine Bestell-E-Mail in der Excel (Blatt „Lieferanten“) hinterlegt.</div>` : ""}` : groupBy === "lief" ? `<div class="hint">Diesen Artikeln ist in der Excel kein Lieferant zugeordnet.</div>` : ""}
        </section>`;
      }).join("");
  }

  function selected(groupEl) {
    const out = [];
    groupEl.querySelectorAll("li").forEach(li => {
      if (li.querySelector("input[type=checkbox]").checked)
        out.push({ a: data.arts.find(x => x.nr === li.dataset.nr), menge: li.querySelector(".lgoqty input").value || "1" });
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
