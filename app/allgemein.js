/* Airtec KApp – Reiter „Allgemeines“ mit Unterreitern
   • Autos (app/autos.js) – mit Recht „Autos“
   • Urlaub (app/urlaub.js, AT.urlaubTab) – Urlaub eintragen, eigener Urlaub, Büro: Urlaub im Team
   • Mitarbeiter – Führerscheinprüfung, Urlaubstage, Notizen.
     Recht „personal“: alle Mitarbeiter auswählen und pflegen; sonst nur die eigenen Angaben ansehen.
   • Leitern (app/leitern.js, AT.leiternTab) – Leiter-Prüfbuch */
(function () {
  const AT = window.AT;
  const esc = window.AT.esc;
  const say = window.AT.say;
  const de = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
  const zahl = n => n === null || n === undefined ? "–" : String(Math.round(n * 2) / 2).replace(".", ",");
  const tg = n => n === null || n === undefined ? "–" : zahl(n) + (n === 1 ? " Tag" : " Tage");
  const ls = window.AT.ls;

  // Reiter + Ansicht
  const tabBtn = document.createElement("button");
  tabBtn.dataset.tab = "allgemein"; tabBtn.textContent = "Allgemeines";
  document.getElementById("tabs").appendChild(tabBtn);
  tabBtn.onclick = () => AT.tab("allgemein");
  const view = document.createElement("main");
  view.id = "agView"; view.dataset.mod = "allgemein"; view.className = "hide";
  view.innerHTML = `<div class="seg" id="agSeg" style="margin-bottom:12px"><button data-sub="autos">🚐 Autos</button><button data-sub="personal">👤 Mitarbeiter</button><button data-sub="urlaub">🌴 Urlaub</button><button data-sub="leitern">🪜 Leitern</button><button data-sub="qr">🔳 QR-Codes</button></div>
    <div id="autView"></div><div id="peView" class="hide"></div><div id="urView" class="hide"></div><div id="leView" class="hide"></div><div id="qrTabView" class="hide"></div>`;
  document.getElementById("app").before(view);
  const hdr = document.querySelector("#hdrType");
  if (hdr) { const s = document.createElement("small"); s.dataset.mod = "allgemein"; s.className = "hide"; s.textContent = "Allgemeines"; hdr.parentNode.appendChild(s); }
  const pe = view.querySelector("#peView");

  const css = document.createElement("style");
  css.textContent = `
  #peView h3{margin:0 0 8px;font-size:15px} #peView .pez{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--line,#e6e9ee);font-size:14.5px}
  #peView .pez:last-child{border-bottom:0} #peView .pez b{white-space:nowrap} #peView .rest b{font-size:16px;color:var(--blue)}
  #peView .hist{font-size:13px;color:var(--mut);display:flex;justify-content:space-between;align-items:center;padding:3px 0}
  #peView .hist button{border:0;background:none;color:var(--bad);font-size:15px;padding:2px 6px;cursor:pointer}
  #peView .peli{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 2px;border-bottom:1px solid var(--line,#e6e9ee);cursor:pointer}
  #peView .peli:last-child{border-bottom:0} #peView textarea{width:100%;min-height:80px;font:inherit;padding:10px;border:1px solid #cfd6de;border-radius:10px;box-sizing:border-box}`;
  document.head.appendChild(css);

  let sub = ls.get("ag_sub") || "autos";
  const darfAutos = () => AT.darf("autos") || AT.darf("autos_verwalten");
  const urv = view.querySelector("#urView");
  const qrv = view.querySelector("#qrTabView");
  const lev = view.querySelector("#leView");
  function zeige() {
    if (!darfAutos() && sub === "autos") sub = "personal";
    if (!AT.darf("qr") && sub === "qr") sub = "personal";
    view.querySelector('[data-sub="autos"]').classList.toggle("hide", !darfAutos());
    view.querySelector('[data-sub="qr"]').classList.toggle("hide", !AT.darf("qr"));
    view.querySelectorAll("#agSeg [data-sub]").forEach(b => b.classList.toggle("on", b.dataset.sub === sub));
    view.querySelector("#autView").classList.toggle("hide", sub !== "autos");
    pe.classList.toggle("hide", sub !== "personal");
    urv.classList.toggle("hide", sub !== "urlaub");
    qrv.classList.toggle("hide", sub !== "qr");
    lev.classList.toggle("hide", sub !== "leitern");
    if (sub === "autos") AT.modules.autos && AT.modules.autos.show();
    else if (sub === "leitern") AT.leiternTab && AT.leiternTab.show(lev);
    else if (sub === "urlaub") AT.urlaubTab && AT.urlaubTab.show(urv);
    else if (sub === "qr") AT.qrTab && AT.qrTab.show(qrv);
    else personal.show();
  }
  view.querySelectorAll("#agSeg [data-sub]").forEach(b => b.onclick = () => { sub = b.dataset.sub; ls.set("ag_sub", sub); zeige(); });
  // von außen: Unterreiter öffnen (z. B. QR-Codes nach einem Scan im Logbuch)
  AT.allgemeinZeigen = s => { sub = s; ls.set("ag_sub", s); AT.tab("allgemein"); };
  AT.modules.allgemein = { show: zeige };

  /* ---------- Mitarbeiter ---------- */
  const personal = (function () {
    let data = null, wahl = null, busy = false, fehler = "";
    const heute = () => (data && data.heute) || (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); })();
    const badge = f => f.status === "leer" ? `<span class="tuev leer">Noch keine Prüfung eingetragen</span>`
      : f.status === "faellig" ? `<span class="tuev ueberfaellig">Prüfung fällig seit ${de(f.naechste)}</span>`
      : f.status === "bald" ? `<span class="tuev bald">Nächste Prüfung bis ${de(f.naechste)}</span>`
      : `<span class="tuev">Nächste Prüfung bis ${de(f.naechste)}</span>`;

    async function load() {
      try { data = await AT.api("personal"); fehler = ""; } catch (e) { fehler = e.message; }
      paint();
    }
    async function post(body, msg, btn) {
      if (busy) return; busy = true; if (btn) btn.disabled = true;
      try { data = await AT.api("personal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); say(msg); }
      catch (e) { say(e.message); }
      busy = false; paint();
    }

    function karte(m) {
      const f = m.fuehrerschein, u = m.urlaub, kann = data.pflegen;
      return `<section class="card"><h3>🪪 Führerscheinprüfung</h3>
        <div>${f.letzte ? `Zuletzt gesichtet am <b>${de(f.letzte)}</b>${f.von ? ` von ${esc(f.von)}` : ""}` : "Noch nicht gesichtet."}</div>
        <div style="margin:6px 0 4px">${badge(f)}</div>
        <div class="hint" style="margin:4px 0 0">Prüfung alle ${data.intervall} Monate. 14 Tage vorher bekommen Büro und Mitarbeiter eine Nachricht.</div>
        ${kann ? `<div class="row" style="margin-top:10px;align-items:end"><div><label>Datum der Sichtung</label><input type="date" id="peFsDatum" value="${heute()}" max="${heute()}"></div>
          <div><button class="bigbtn primary" id="peFs" style="margin:0">✓ Führerschein gesichtet</button></div></div>` : ""}
        ${f.historie.length > 1 || (kann && f.historie.length) ? `<div style="margin-top:10px"><small style="color:var(--mut)">Bisherige Prüfungen</small>${f.historie.map(h =>
          `<div class="hist"><span>${de(h.datum)} · ${esc(h.von)}</span>${kann ? `<button data-fsdel="${h.id}" title="Eintrag löschen">✕</button>` : ""}</div>`).join("")}</div>` : ""}
      </section>
      <section class="card"><h3>📋 Diverses</h3>
        <div style="font-weight:700;margin:2px 0 6px">Urlaub ${esc(data.jahr)}</div>
        ${kann ? `<div class="row"><div><label>Urlaubsanspruch (Tage)</label><input id="peAn" inputmode="decimal" value="${u.anspruch ? zahl(u.anspruch) : ""}" placeholder="z. B. 30"></div>
          <div><label>Resturlaub Vorjahr</label><input id="peVj" inputmode="decimal" value="${u.vorjahr ? zahl(u.vorjahr) : ""}" placeholder="0"></div></div>`
          : `<div class="pez"><span>Urlaubsanspruch</span><b>${u.anspruch ? zahl(u.anspruch) + " Tage" : "nicht eingetragen"}</b></div>
             ${u.vorjahr ? `<div class="pez"><span>Resturlaub Vorjahr</span><b>${zahl(u.vorjahr)} Tage</b></div>` : ""}`}
        <div class="pez"><span>Genommen</span><b>${tg(u.genommen)}</b></div>
        <div class="pez"><span>Geplant (im Wochenplan)</span><b>${tg(u.geplant)}</b></div>
        <div class="pez rest"><span><b style="font-size:inherit;color:inherit">Resturlaub</b></span><b>${u.rest === null ? (u.anspruch ? "–" : "Anspruch fehlt") : zahl(u.rest) + " Tage"}</b></div>
        ${data.urlaubFehler ? `<div class="warn" style="margin-top:6px">Wochenplan nicht lesbar: ${esc(data.urlaubFehler)}</div>` : ""}
        <div class="hint" style="margin:6px 0 0">Genommen und geplant zählt die App aus den „Urlaub“-Einträgen im Wochenplan.</div>
        ${kann ? `<label style="margin-top:12px">Notizen</label><textarea id="peNotiz" placeholder="Infos zum Mitarbeiter">${esc(m.notiz || "")}</textarea>
          <button class="bigbtn primary" id="peSave" style="margin-top:10px">Speichern</button>` : ""}
      </section>`;
    }

    function paint() {
      if (fehler && !data) { pe.innerHTML = `<section class="card"><div class="warn">${esc(fehler)}</div></section>`; return; }
      if (!data) { pe.innerHTML = `<section class="card">Lade …</section>`; return; }
      const L = data.mitarbeiter;
      if (!data.pflegen) { pe.innerHTML = L.length ? karte(L[0]) : `<section class="card"><div class="hint" style="margin:0">Keine Angaben gefunden.</div></section>`; bind(); return; }
      const m = L.find(x => x.id === wahl);
      const icon = x => x.fuehrerschein.status === "faellig" || x.fuehrerschein.status === "leer" ? "⚠️ " : x.fuehrerschein.status === "bald" ? "⏳ " : "";
      pe.innerHTML = `<section class="card"><label style="margin-top:0">Mitarbeiter</label><select id="peWahl" data-nodirty><option value="">– Mitarbeiter wählen –</option>${L.map(x =>
        `<option value="${x.id}" ${x.id === wahl ? "selected" : ""}>${icon(x)}${esc(x.name)}</option>`).join("")}</select></section>
        ${m ? karte(m) : `<section class="card"><h3>🪪 Führerschein – Übersicht</h3>${L.map(x =>
          `<div class="peli" data-ma="${x.id}"><b>${esc(x.name)}</b>${badge(x.fuehrerschein).replace("Nächste Prüfung bis", "bis").replace("Noch keine Prüfung eingetragen", "nicht eingetragen")}</div>`).join("")}</section>`}`;
      bind();
    }

    function bind() {
      const q = s => pe.querySelector(s);
      const w = q("#peWahl"); if (w) w.onchange = () => { wahl = +w.value || null; paint(); };
      pe.querySelectorAll("[data-ma]").forEach(el => el.onclick = () => { wahl = +el.dataset.ma; paint(); window.scrollTo(0, 0); });
      const fs = q("#peFs"); if (fs) fs.onclick = () => post({ aktion: "fuehrerschein", id: wahl, datum: q("#peFsDatum").value }, "Führerscheinprüfung eingetragen ✓", fs);
      pe.querySelectorAll("[data-fsdel]").forEach(b => b.onclick = () => {
        if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Löschen?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "✕"; } }, 4000); return; }
        post({ aktion: "fs_loeschen", pid: +b.dataset.fsdel, id: wahl }, "Eintrag gelöscht", b);
      });
      const sv = q("#peSave"); if (sv) sv.onclick = () => post({ aktion: "speichern", id: wahl, anspruch: q("#peAn").value, vorjahr: q("#peVj").value, notiz: q("#peNotiz").value }, "Gespeichert ✓", sv);
    }

    let wer = null;
    return { show() { if (wer !== (AT.user && AT.user.name)) { wer = AT.user && AT.user.name; data = null; wahl = null; } paint(); load(); } };
  })();
})();
