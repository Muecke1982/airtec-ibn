/* Airtec KApp – Allgemeines → „Autos“:Autos und Anhänger mit nächstem TÜV, Leasing und Fahrer.
   Pflegen (anlegen, ändern, „TÜV erledigt“, löschen) mit dem Recht „Autos verwalten“. */
(function () {
  const AT = window.AT;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const de = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";

  // Unterreiter im Reiter „Allgemeines“ (app/allgemein.js legt den Platz an)
  const view = document.getElementById("autView");

  const css = document.createElement("style");
  css.textContent = `
  .auto{display:flex;gap:12px;align-items:flex-start}
  .auto .kz{flex:0 0 auto;font:700 15px/1 ui-monospace,Consolas,monospace;letter-spacing:.5px;border:2px solid #1a1a1a;border-left:9px solid #1f4fa8;border-radius:5px;padding:6px 8px;background:#fff;white-space:nowrap}
  .auto .inf{flex:1;min-width:0} .auto .inf b{font-size:15.5px} .auto .inf small{display:block;color:var(--mut);font-size:13px;margin-top:2px}
  .tuev{display:inline-block;margin-top:6px;font-size:13.5px;font-weight:700;border-radius:7px;padding:3px 8px;background:#eaf6e6;color:#2d6a12}
  .tuev.bald,.tuev.faellig{background:#fff1d6;color:#8a5a00} .tuev.ueberfaellig{background:#fdecec;color:var(--bad)} .tuev.leer{background:#eef1f4;color:var(--mut);font-weight:600}
  .auto.meins{outline:2px solid var(--blue)}
  #autView .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}`;
  document.head.appendChild(css);

  let data = null, offen = null, busy = false, filter = "";
  const kann = () => !!(data && data.verwalten);

  async function load() {
    try { data = await AT.api("autos"); } catch (e) { if (!data) view.innerHTML = `<section class="card"><div class="warn">${esc(e.message)}</div></section>`; return; }
    if (offen === null || offen === undefined) paint();
  }
  async function post(body) { data = await AT.api("autos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return data; }

  const tuevBadge = a => !a.tuevNaechster ? `<span class="tuev leer">TÜV: nicht eingetragen</span>`
    : `<span class="tuev ${a.tuev}">TÜV ${a.tuev === "ueberfaellig" ? "überfällig seit" : a.tuev === "faellig" ? "fällig" : "bis"} ${esc(a.tuevText)}</span>`;

  function form(a = {}) {
    const P = data.personen || [];
    const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${esc(l)}</option>`;
    return `<div style="margin-top:10px">
      <label>Art</label><div class="seg" id="faArt">${[["auto", "🚐 Auto"], ["anhaenger", "🛞 Anhänger"]].map(([k, l]) => `<button data-art="${k}" class="${(a.art || "auto") === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="row"><div><label>Marke</label><input id="faMarke" value="${esc(a.marke)}" placeholder="z. B. VW"></div><div><label>Modell</label><input id="faModell" value="${esc(a.modell)}" placeholder="z. B. Crafter"></div></div>
      <label>Nummernschild</label><input id="faKz" value="${esc(a.kennzeichen)}" placeholder="z. B. BOR-AT 123" autocapitalize="characters">
      <div class="row"><div><label>Kaufdatum</label><input type="date" id="faKauf" value="${esc(a.kaufdatum)}"></div>
        <div><label>Leasingdauer</label><select id="faLm">${opt(0, "kein Leasing", a.leasingMonate || 0)}${[12, 24, 36, 48, 60, 72].map(n => opt(n, n + " Monate", a.leasingMonate)).join("")}</select></div></div>
      <label>Erinnern vor Leasingende</label><select id="faLe">${[1, 2, 3, 4, 6, 9, 12].map(n => opt(n, n + (n === 1 ? " Monat" : " Monate") + " vorher", a.leasingErinnerung || 3)).join("")}</select>
      <div class="row"><div><label>TÜV-Intervall</label><select id="faTi">${[[1, "jährlich"], [2, "alle 2 Jahre"], [3, "alle 3 Jahre"]].map(([v, l]) => opt(v, l, a.tuevIntervall || 2)).join("")}</select></div>
        <div><label>Nächster TÜV (Monat)</label><input type="month" id="faTn" value="${esc(a.tuevNaechster)}"></div></div>
      <label>Mitarbeiter (Fahrer)</label><select id="faMa">${opt("", "– keine Zuordnung –", a.mitarbeiterId || "")}${P.map(p => opt(p.id, p.name, a.mitarbeiterId)).join("")}</select>
      <label>Bemerkung</label><input id="faBem" value="${esc(a.bem)}">
      <div class="vwbtns" style="display:flex;gap:8px;margin-top:12px"><button class="bigbtn primary" id="faSave" style="flex:2">${a.id ? "Speichern" : "Anlegen"}</button>
        <button class="bigbtn secondary" id="faCancel" style="flex:1">Abbrechen</button></div>
      ${a.id ? `<div class="vwbtns" style="display:flex;gap:8px;margin-top:8px"><button class="bigbtn secondary" id="faTuev" style="flex:1">✓ TÜV erledigt (nächster in ${a.tuevIntervall} J.)</button>
        <button class="bigbtn" id="faDel" style="flex:0 0 auto;background:#fdecec;color:var(--bad)">Löschen</button></div>` : ""}</div>`;
  }

  function paint() {
    if (!data) { view.innerHTML = `<section class="card">Lade …</section>`; return; }
    const q = filter.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, ""), ql = filter.toLowerCase();
    const list = data.autos.filter(a => !filter || a.kennzeichen.toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, "").includes(q) || `${a.marke} ${a.modell} ${a.fahrer}`.toLowerCase().includes(ql));
    const karte = a => `<section class="card"><div class="auto ${a.meins ? "meins" : ""}" ${kann() ? `data-open="${a.id}" style="cursor:pointer"` : ""}>
        <span class="kz">${esc(a.kennzeichen)}</span>
        <div class="inf"><b>${a.art === "anhaenger" ? "🛞 " : "🚐 "}${esc([a.marke, a.modell].filter(Boolean).join(" ") || (a.art === "anhaenger" ? "Anhänger" : "Auto"))}</b>
          <small>${a.fahrer ? `👤 ${esc(a.fahrer)}${a.fahrerTel ? ` · <a href="tel:${esc(a.fahrerTel.replace(/[^\d+]/g, ""))}">${esc(a.fahrerTel)}</a>` : ""}` : "keinem Mitarbeiter zugeordnet"}${a.meins ? " · <b>dein Auto</b>" : ""}</small>
          ${a.leasingEnde ? `<small>Leasing bis ${de(a.leasingEnde)}${a.leasing === "bald" ? " · <b style=\"color:#8a5a00\">läuft bald aus</b>" : a.leasing === "abgelaufen" ? " · <b style=\"color:var(--bad)\">abgelaufen</b>" : ""}</small>` : ""}
          ${a.bem ? `<small>${esc(a.bem)}</small>` : ""}
          ${tuevBadge(a)}</div></div>
        ${offen === a.id ? form(a) : ""}</section>`;
    const autos = list.filter(a => a.art !== "anhaenger"), anh = list.filter(a => a.art === "anhaenger");
    view.innerHTML = `${kann() ? (offen === "neu" ? `<section class="card"><h2>Neues Fahrzeug</h2>${form()}</section>` : `<button class="add" id="faNew" style="margin:0 0 12px">+ Auto oder Anhänger eintragen</button>`) : ""}
      ${data.autos.length > 4 ? `<input id="faFilter" data-nodirty placeholder="🔍 Kennzeichen, Marke oder Fahrer" value="${esc(filter)}" style="margin-bottom:12px">` : ""}
      ${autos.length ? `<h3 style="margin:4px 2px 8px;font-size:14px;color:var(--mut)">Autos (${autos.length})</h3>` + autos.map(karte).join("") : ""}
      ${anh.length ? `<h3 style="margin:14px 2px 8px;font-size:14px;color:var(--mut)">Anhänger (${anh.length})</h3>` + anh.map(karte).join("") : ""}
      ${!list.length ? `<section class="card"><div class="hint" style="margin:0">${data.autos.length ? "Nichts gefunden." : "Noch keine Fahrzeuge eingetragen."}</div></section>` : ""}`;
    bind();
  }

  function bind() {
    const q = s => view.querySelector(s);
    const f = q("#faFilter"); if (f) f.oninput = () => { filter = f.value; const pos = f.selectionStart; paint(); const g = q("#faFilter"); g.focus(); g.setSelectionRange(pos, pos); };
    const nw = q("#faNew"); if (nw) nw.onclick = () => { offen = "neu"; paint(); q("#faKz").focus(); };
    view.querySelectorAll("[data-open]").forEach(el => el.onclick = () => { offen = offen === +el.dataset.open ? null : +el.dataset.open; paint(); });
    if (!q("#faSave")) return;
    let art = (view.querySelector("[data-art].on") || {}).dataset?.art || "auto";
    view.querySelectorAll("[data-art]").forEach(b => b.onclick = () => { art = b.dataset.art; view.querySelectorAll("[data-art]").forEach(x => x.classList.toggle("on", x === b)); });
    // neues Auto: nächster TÜV aus Kaufdatum + Intervall vorschlagen
    const vorschlag = () => { if (offen !== "neu" || q("#faTn").value || !q("#faKauf").value) return; const d = q("#faKauf").value; q("#faTn").value = `${+d.slice(0, 4) + +q("#faTi").value}-${d.slice(5, 7)}`; };
    q("#faKauf").onchange = vorschlag; q("#faTi").onchange = vorschlag;
    q("#faCancel").onclick = () => { offen = null; paint(); };
    q("#faSave").onclick = () => act(q("#faSave"), { aktion: "speichern", id: offen === "neu" ? undefined : offen, art, marke: q("#faMarke").value, modell: q("#faModell").value,
      kennzeichen: q("#faKz").value, kaufdatum: q("#faKauf").value, leasingMonate: +q("#faLm").value, leasingErinnerung: +q("#faLe").value,
      tuevIntervall: +q("#faTi").value, tuevNaechster: q("#faTn").value, mitarbeiterId: q("#faMa").value || null, bem: q("#faBem").value }, "Gespeichert ✓");
    const tu = q("#faTuev"); if (tu) tu.onclick = () => { if (!sure(tu, "Wirklich? TÜV als erledigt eintragen")) return; act(tu, { aktion: "tuev", id: offen }, "TÜV eingetragen ✓"); };
    const del = q("#faDel"); if (del) del.onclick = () => { if (!sure(del, "Wirklich löschen?")) return; act(del, { aktion: "loeschen", id: offen }, "Gelöscht"); };
  }
  function sure(btn, text) {
    if (btn.classList.contains("sure")) return true;
    btn.classList.add("sure"); const old = btn.textContent; btn.textContent = text;
    setTimeout(() => { if (btn.isConnected) { btn.classList.remove("sure"); btn.textContent = old; } }, 4000);
    return false;
  }
  async function act(btn, body, msg) {
    if (busy) return; busy = true; btn.disabled = true;
    try { await post(body); offen = null; say(msg); } catch (e) { say(e.message); btn.disabled = false; busy = false; return; }
    busy = false; paint();
  }

  AT.modules.autos = { show() { offen = null; filter = ""; paint(); load(); } };
})();
