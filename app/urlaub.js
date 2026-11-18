/* Airtec KApp – Urlaub
   Quelle ist allein der Wochenplan (Google-Tabelle): jede Zelle „Urlaub“ zählt. Blick: ab heute ein Jahr voraus,
   so weit der Wochenplan reicht.
   • Startseite (ganz unten): „Mein Urlaub“ – nur der eigene, anstehende Urlaub
   • Reiter Allgemeines → Urlaub (AT.urlaubTab): Urlaub eintragen (→ Wochenplan + Infomail ans Büro), eigener Urlaub,
     Büro (Recht „urlaub“): für alle eintragen, Urlaub im Team, Empfänger der Infomail */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const say = t => { if (typeof toast === "function") toast(t); };
  const office = () => AT.darf("urlaub");
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const d1 = iso => iso ? `${WT[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "?";
  const dd = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
  const span = r => r.von === r.bis ? d1(r.von) : `${d1(r.von)} – ${d1(r.bis)}`;
  const zahl = n => String(n).replace(".", ",");
  const days = r => r.tage ? ` · ${r.tage === 0.5 ? "halber Tag" : zahl(r.tage) + " Arbeitstag" + (r.tage === 1 ? "" : "e")}` : "";
  const summe = z => z.reduce((s, r) => s + (+r.tage || 0), 0);

  const key = () => "ur3_cache_" + ((AT.user && AT.user.name) || "");
  let data = null, wer = null, fehler = "", busy = false, open = false;
  const views = new Set();   // Startseiten-Kasten + Reiter

  async function load(neu) {
    try { data = await AT.api("urlaub" + (neu ? "?neu=1" : "")); ls.set(key(), data); fehler = ""; }
    catch (e) { fehler = e.message || "Urlaub konnte nicht geladen werden"; if (neu) say(fehler); }
    paintAll();
  }
  async function post(body, btn) {
    if (busy) return null; busy = true; if (btn) btn.disabled = true;
    let r = null;
    try { r = await AT.api("urlaub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); data = r; ls.set(key(), data); }
    catch (e) { say(e.message); }
    busy = false; paintAll(); return r;
  }
  function pruefeWer() { if (AT.user && wer !== AT.user.name) { wer = AT.user.name; data = ls.get(key()); fehler = ""; open = false; } }
  function paintAll() { pruefeWer(); paintStart(); if (tabEl && !tabEl.closest(".hide")) paintTab(); }

  const meinKasten = (titel) => {
    const mine = (data && data.meine) || [], today = (data && data.heute) || "";
    const reicht = data && data.planBis ? `Wochenplan eingetragen bis ${dd(data.planBis)}` : "";
    return `<section class="card hicard urmine"><div class="hihead">${titel}</div>${mine.length ? mine.map(r =>
      `<div class="urline"><b>${esc(span(r))}</b>${esc(days(r))}${r.von <= today ? ' <span class="urnow">läuft gerade</span>' : ""}</div>`).join("")
      + (mine.length > 1 ? `<div class="hivon">zusammen ${zahl(summe(mine))} Arbeitstage</div>` : "")
      : '<div class="hivon" style="margin-top:0">Kein Urlaub im Wochenplan eingetragen.</div>'}
      ${reicht ? `<div class="hivon">${esc(reicht)}</div>` : ""}</section>`;
  };

  /* ---------- Startseite: nur eigener, anstehender Urlaub ---------- */
  const box = document.createElement("div");
  box.id = "urBox";
  document.getElementById("stView").appendChild(box);   // ganz unten auf der Startseite
  function paintStart() {
    if (!AT.user || !data) { box.innerHTML = ""; return; }
    box.innerHTML = (data.meine || []).length ? meinKasten("🌴 Mein Urlaub") : "";
  }
  const prev = AT.modules.start.show;
  AT.modules.start.show = function () { pruefeWer(); paintStart(); if (navigator.onLine) load(); return prev.apply(this, arguments); };

  /* ---------- Reiter Allgemeines → Urlaub ---------- */
  let tabEl = null, form = { name: "", von: "", bis: "", halb: false }, letztes = null;
  function paintTab() {
    if (!tabEl) return;
    if (!data) { tabEl.innerHTML = fehler ? `<section class="card"><div class="urerr">⚠ ${esc(fehler)}</div></section>` : `<section class="card">Lade …</section>`; return; }
    const today = data.heute;
    const max = data.bis || "";
    if (!form.von) form.von = today;
    const buero = office() && data.personen;
    const er = letztes;
    const out = [];
    out.push(`<section class="card"><h3 style="margin:0 0 8px;font-size:15px">🌴 Urlaub eintragen</h3>
      ${buero ? `<label style="margin-top:0">Mitarbeiter</label><select id="urName">${data.personen.map(n => `<option ${n === (form.name || AT.user.name) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
      <div class="row"><div><label${buero ? "" : ' style="margin-top:0"'}>Von</label><input type="date" id="urVon" min="${today}" max="${max}" value="${esc(form.von)}"></div>
        <div><label${buero ? "" : ' style="margin-top:0"'}>Bis</label><input type="date" id="urBis" min="${esc(form.von || today)}" max="${max}" value="${esc(form.bis)}"></div></div>
      <label class="hichk" style="display:${form.von && (!form.bis || form.bis === form.von) ? "flex" : "none"};gap:8px;align-items:center;color:var(--ink);font-size:15px;margin-top:10px"><input type="checkbox" id="urHalb" ${form.halb ? "checked" : ""}> nur halber Tag</label>
      <button class="bigbtn primary" id="urGo" style="margin-top:12px">${busy ? "Wird eingetragen …" : "In den Wochenplan eintragen"}</button>
      <div class="hint" style="margin:8px 0 0">Wird im Wochenplan als „Urlaub“ eingetragen (nur Mo–Fr, Feiertage bleiben frei). Das Büro bekommt automatisch eine Mail, damit der Urlaub in Label eingetragen wird.</div>
      ${er ? `<div class="${er.ok ? "hint" : "urerr"}" style="margin:10px 0 0;${er.ok ? "background:#eef7ee;color:#2c7a3f;border-radius:8px;padding:8px 10px" : ""}">${er.html}</div>` : ""}
    </section>`);
    out.push(meinKasten("🌴 Mein Urlaub"));
    if (buero) {
      const all = data.alle || [];
      const jetzt = all.filter(r => r.von <= today);
      out.push(`<section class="card hiofc urofc"><div class="hihead">👥 Urlaub im Team</div>
        ${fehler ? `<div class="urerr">⚠ ${esc(fehler)}</div>` : ""}
        <div class="hivon" style="margin-top:0">${jetzt.length ? `<b>Heute im Urlaub: ${jetzt.map(r => esc(r.name)).join(", ")}</b> · ` : "Heute niemand im Urlaub · "}aus dem Wochenplan${data.stand ? ", Stand " + esc(new Date(data.stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })) : ""}</div>
        <div class="hirow"><button class="add" id="urToggle">${open ? "Liste zuklappen" : `Anstehender Urlaub (${all.length})`}</button><button class="add" id="urSync">Neu einlesen</button></div>
        <div class="${open ? "" : "hide"}">${all.length ? all.map(r =>
          `<div class="hisent urok"><div><b>${esc(r.name)}</b>${r.von <= today ? ' <span class="urnow">läuft gerade</span>' : ""}
            <div>${esc(span(r))}${esc(days(r))}</div></div></div>`).join("") : '<div class="hint">Kein anstehender Urlaub im Wochenplan.</div>'}</div></section>`);
      const i = data.info || {};
      out.push(`<section class="card"><h3 style="margin:0 0 8px;font-size:15px">✉️ Infomail für Label</h3>
        <div class="hint" style="margin:0 0 6px">Sobald im Wochenplan Urlaub eingetragen oder gestrichen wird (in der App oder direkt in der Tabelle), geht eine Mail an:</div>
        <label style="margin-top:0">Empfänger</label><input id="urAn" type="email" value="${esc(i.an || "")}" placeholder="name@airtec-kaeltetechnik.de">
        <button class="bigbtn" id="urAnSave" style="margin-top:10px">Empfänger speichern</button>
        <div class="${i.von ? "hint" : "urerr"}" style="margin:8px 0 0">${i.von ? `Absender: ${esc(i.von)}` : "⚠ Absender fehlt noch – in Cloudflare die Variable MAIL_FROM eintragen (z. B. kapp@airtec-kaeltetechnik.de). Bis dahin werden keine Mails verschickt."}</div>
      </section>`);
    }
    tabEl.innerHTML = out.join("");
    bindTab();
  }

  function bindTab() {
    const q = s => tabEl.querySelector(s);
    const sync = () => { const n = q("#urName"); form.name = n ? n.value : ""; form.von = q("#urVon").value; form.bis = q("#urBis").value; const h = q("#urHalb"); form.halb = !!(h && h.checked); };
    ["#urVon", "#urBis", "#urName", "#urHalb"].forEach(s => { const el = q(s); if (el) el.onchange = () => {
      sync();
      if (s === "#urVon" && form.bis && form.bis < form.von) form.bis = form.von;
      paintTab();
    }; });
    q("#urGo").onclick = async () => {
      sync();
      if (!form.von) return say("Bitte „Von“ wählen");
      const bis = form.bis || form.von;
      const r = await post({ aktion: "eintragen", name: form.name || undefined, von: form.von, bis, halb: form.halb && bis === form.von }, q("#urGo"));
      if (!r) return;
      const e = r.ergebnis || {}, m = r.mail || {};
      const teile = [];
      teile.push(e.eingetragen ? `✓ ${e.eingetragen} ${e.eingetragen === 1 ? "Tag" : "Tage"} für ${esc(e.name)} im Wochenplan eingetragen.` : `Nichts eingetragen – im Zeitraum steht schon Urlaub oder frei.`);
      if (e.uebersprungen) teile.push(`${e.uebersprungen} ${e.uebersprungen === 1 ? "Tag war" : "Tage waren"} schon Urlaub oder frei.`);
      if (e.ueberschrieben && e.ueberschrieben.length) teile.push(`Überschrieben: ${e.ueberschrieben.map(x => `${dd(x.datum).slice(0, 6)} „${esc(x.vorher)}“`).join(", ")} (steht in der Notiz der Zelle).`);
      if (e.fehler && e.fehler.length) teile.push(`⚠ Nicht eingetragen: ${esc(e.fehler.join("; "))}`);
      teile.push(m.gesendet ? `✉️ Infomail an ${esc(m.an)} verschickt.` : m.fehler ? `⚠ ${esc(m.fehler)}` : m.aus ? `Keine Infomail: ${esc(m.aus)}.` : "");
      letztes = { ok: !!e.eingetragen && !(e.fehler && e.fehler.length) && !m.fehler, html: teile.filter(Boolean).join("<br>") };
      if (e.eingetragen) { form = { name: form.name, von: "", bis: "", halb: false }; say("Urlaub eingetragen ✓"); }
      paintTab();
    };
    const t = q("#urToggle"); if (t) t.onclick = () => { open = !open; paintTab(); };
    const s = q("#urSync"); if (s) s.onclick = async () => { s.disabled = true; s.textContent = "Wird geladen …"; await load(true); open = true; paintTab(); if (!fehler) say("Wochenplan neu eingelesen"); };
    const a = q("#urAnSave"); if (a) a.onclick = async () => { if (await post({ aktion: "infomail", an: q("#urAn").value }, a)) say("Empfänger gespeichert ✓"); };
  }

  AT.urlaubTab = {
    show(el) {
      if (tabEl !== el) { tabEl = el; }
      const vorher = wer; pruefeWer(); if (vorher !== wer) { letztes = null; form = { name: "", von: "", bis: "", halb: false }; }
      paintTab(); if (navigator.onLine) load();
    },
  };
})();
