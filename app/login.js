/* Airtec App – Anmeldung (gilt für die ganze App) und Umschalten zwischen den Modulen.
   Name + Passwort werden einmal eingegeben, danach bleibt das Handy angemeldet.
   Das Sitzungs-Token wird als "kapp_code" gespeichert, damit das Protokoll-Modul unverändert weiterarbeitet. */
(function () {
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const q = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const prev = ls.get("kapp_code");
  const oldCode = ls.get("at_oldcode") || (prev && !String(prev).startsWith("s1.") ? prev : "");
  if (oldCode) ls.set("at_oldcode", oldCode);
  const AT = window.AT = {
    session: ls.get("at_session"),            // { token, user:{name,mail,plan,schreiben} }
    get user() { return this.session && this.session.user; },
    async api(path, opts = {}) {
      const h = Object.assign({ "x-app-code": (this.session && this.session.token) || "" }, opts.headers || {});
      const r = await fetch("/api/" + path, Object.assign({}, opts, { headers: h }));
      if (!r.ok) {
        let m = "Fehler " + r.status; try { m = (await r.json()).error || m; } catch (e) {}
        if (r.status === 401 && this.session && path !== "login") { this.logout(true); }
        const err = new Error(m); err.status = r.status; throw err;
      }
      return r.json();
    },
    modules: {},                               // name → { title, show() }
    // Rechte (siehe lib/rechte.js): Admin darf alles; ältere Anmeldungen ohne Rechte-Liste: Bereiche ja, Zusatzrechte = „Büro“
    darf(recht) {
      const u = this.user; if (!u) return false;
      if (u.admin) return true;
      if (Array.isArray(u.rechte)) return u.rechte.includes(recht);
      return ["wochenplan", "protokolle", "maschinen", "lager", "autos"].includes(recht) || !!u.schreiben;
    },
    logout(expired) {
      ls.del("at_session"); ls.del("kapp_code"); this.session = null;
      // zwischengespeicherte Daten der Person entfernen (Wochenplan mit „Du fährst …“, Lager/Maschinen mit Büro-Angaben)
      // – das angefangene Protokoll (kapp_draft) bleibt, damit nach abgelaufener Anmeldung nichts verloren geht
      ["wp_cache", "wp_day", "wp_day_session", "lg_cache", "ma_cache", "mu_cache", "bs_mappen", "bs_vor", "at_tab"].forEach(k => ls.del(k));
      const war = aktuell; aktuell = null;   // offene Ansichten (z. B. Wochenplan-Brett) schließen
      if (war) document.dispatchEvent(new CustomEvent("at:tab", { detail: { von: war, nach: null } }));
      showLogin(expired ? "Anmeldung abgelaufen – bitte neu anmelden." : "");
    },
  };

  /* ---------- Reiter verlassen: ungespeicherte Eingaben ----------
     Bereiche mit eigener Logik melden sich mit AT.wache(reiter, () => null | { titel, text, ja, tun }) an
     (z. B. Wochenplan „Speichern?“, Protokolle „Parken?“). tun() erledigt das Speichern, Rückgabe false = hierbleiben.
     Alle anderen Bereiche: Eingabefelder, die jemand geändert hat und die noch nicht gespeichert sind. */
  const wachen = {};
  AT.wache = (name, f) => { wachen[name] = f; };
  let beruehrt = new WeakSet();
  ["input", "change"].forEach(t => document.addEventListener(t, e => { if (e.isTrusted && e.target && e.target.matches && e.target.matches("input,textarea,select")) beruehrt.add(e.target); }, true));
  // nach dem Speichern zeichnen die Bereiche ihre Felder neu – neue Felder gelten als unverändert.
  // Wer ohne Neuzeichnen speichert, ruft AT.eingabenGespeichert() auf.
  AT.eingabenGespeichert = () => { beruehrt = new WeakSet(); };
  const anders = el => el.type === "checkbox" || el.type === "radio" ? el.checked !== el.defaultChecked
    : el.tagName === "SELECT" ? [...el.options].some(o => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
  function offeneEingaben(name) {
    for (const v of document.querySelectorAll(`main[data-mod="${name}"]`)) {
      for (const el of v.querySelectorAll("input,textarea,select")) {
        if (!beruehrt.has(el) || ["search", "file", "button", "submit"].includes(el.type) || el.closest("[data-nodirty]") || el.offsetParent === null) continue;
        const wahl = el.type === "checkbox" || el.type === "radio" || el.tagName === "SELECT";
        if (wahl ? anders(el) : String(el.value || "").trim() !== String(el.defaultValue || "").trim()) return true;
      }
    }
    return false;
  }
  // Abfrage mit drei Möglichkeiten: ja (speichern/parken) · nein (ohne weiter) · hierbleiben
  const dlg = document.createElement("div");
  dlg.className = "modal"; dlg.id = "mWechsel";
  dlg.innerHTML = `<div class="box"><h3 id="wxT"></h3><div id="wxB" style="font-size:15px"></div>
    <div class="btns" style="flex-wrap:wrap"><button class="secondary" id="wxBleib">Hierbleiben</button><button class="secondary" id="wxNein"></button><button class="primary" id="wxJa"></button></div></div>`;
  document.body.appendChild(dlg);
  function wechselFrage(f) {
    return new Promise(res => {
      q("#wxT").textContent = f.titel; q("#wxB").innerHTML = f.text;
      q("#wxJa").textContent = f.ja || "Speichern"; q("#wxJa").classList.toggle("hide", !f.tun);
      q("#wxNein").textContent = f.nein || "Nicht speichern";
      const zu = v => { dlg.classList.remove("show"); res(v); };
      q("#wxJa").onclick = () => zu("ja"); q("#wxNein").onclick = () => zu("nein"); q("#wxBleib").onclick = () => zu(null);
      dlg.classList.add("show");
    });
  }
  let aktuell = null, fragt = false;
  async function darfVerlassen(von) {
    // Bereich mit eigener Prüfung: nur die (z. B. Protokolle werden ohnehin auf dem Handy gespeichert)
    const f = wachen[von] ? wachen[von]() : (offeneEingaben(von) ? { titel: "Eingaben nicht gespeichert", text: "<p>Sie haben hier etwas eingegeben, das noch nicht gespeichert ist. Beim Wechseln geht es verloren.</p>", nein: "Verwerfen" } : null);
    if (!f) return true;
    const a = await wechselFrage(f);
    if (a === null) return false;
    if (a === "ja") { try { if ((await f.tun()) === false) return false; } catch (e) { if (typeof toast === "function") toast(e.message || String(e)); return false; } }
    else if (f.verwerfen) f.verwerfen();
    beruehrt = new WeakSet();
    return true;
  }

  /* ---------- Modul-Umschaltung ---------- */
  async function tab(name, opt = {}) {
    if (fragt) return;
    if (aktuell && aktuell !== name && !opt.ohneFrage && AT.user) {
      fragt = true;
      let ok = true;
      try { ok = await darfVerlassen(aktuell); } finally { fragt = false; }
      if (!ok) return false;
    }
    const von = aktuell; aktuell = name;
    ls.set("at_tab", name);
    if (von && von !== name) document.dispatchEvent(new CustomEvent("at:tab", { detail: { von, nach: name } }));
    document.querySelectorAll("[data-mod]").forEach(el => el.classList.toggle("hide", el.dataset.mod !== name));
    document.querySelectorAll("#tabs button").forEach(b => {
      b.classList.toggle("on", b.dataset.tab === name);
      // Reiterleiste ist seitlich verschiebbar: gewählten Reiter in die Mitte holen
      if (b.dataset.tab === name && b.offsetWidth) { const n = b.parentNode; try { n.scrollTo({ left: b.offsetLeft - (n.clientWidth - b.offsetWidth) / 2, behavior: "smooth" }); } catch (e) {} }
    });
    const m = AT.modules[name]; if (m && m.show) m.show();
    window.scrollTo(0, 0);
  }
  AT.tab = tab;
  document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => tab(b.dataset.tab));

  /* ---------- Anmeldeseite ---------- */
  const box = document.createElement("div");
  box.id = "loginView"; box.className = "login hide";
  box.innerHTML = `<div class="lbox">
    <img src="/logo-kapp.png" alt="Airtec KApp">
    <h1>Anmelden</h1>
    <label>Name</label><select id="lName"><option value="">– Namen wählen –</option></select>
    <input id="lNameFree" class="hide" placeholder="Name" autocomplete="username">
    <label>Passwort</label><input id="lPw" type="password" autocomplete="current-password">
    <div class="lerr" id="lErr"></div>
    <button class="bigbtn primary" id="lGo">Anmelden</button>
    <div class="hint" style="text-align:center;margin-top:14px">Passwort vergessen? Bitte im Büro melden.</div>
    <button class="add hide" id="lOld">Anmeldung gestört – nur Protokolle mit altem Zugang</button>
  </div>`;
  document.body.appendChild(box);

  async function loadNames() {
    let names = ls.get("at_names") || [];
    try { names = (await AT.api("login?liste=1")).namen || []; ls.set("at_names", names); }
    catch (e) { if (e.status >= 500 && oldCode) q("#lOld").classList.remove("hide"); }
    const sel = q("#lName");
    if (!names.length) { sel.classList.add("hide"); q("#lNameFree").classList.remove("hide"); return; }
    const last = ls.get("at_lastname") || "";
    sel.innerHTML = '<option value="">– Namen wählen –</option>' + names.map(n => `<option ${n === last ? "selected" : ""}>${esc(n)}</option>`).join("");
  }
  function showLogin(msg) {
    q("#lErr").textContent = msg || "";
    q("#lPw").value = "";
    box.classList.remove("hide");
    document.body.classList.add("locked");
    loadNames();
  }
  async function doLogin() {
    const name = q("#lName").classList.contains("hide") ? q("#lNameFree").value.trim() : q("#lName").value;
    const pw = q("#lPw").value;
    if (!name) { q("#lErr").textContent = "Bitte Namen wählen"; return; }
    if (!pw) { q("#lPw").focus(); return; }
    q("#lGo").disabled = true; q("#lErr").textContent = "";
    try {
      const r = await AT.api("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, passwort: pw }) });
      AT.session = r; ls.set("at_session", r); ls.set("at_lastname", r.user.name);
      if (r.user.pwNeu) { box.classList.add("hide"); pwZeigen(true, pw); } else start();
    } catch (e) {
      q("#lErr").textContent = e.status === 401 || e.status === 429 ? e.message : (navigator.onLine ? e.message : "Keine Internetverbindung");
      if (e.status >= 500 && oldCode) q("#lOld").classList.remove("hide");
    } finally { q("#lGo").disabled = false; }
  }
  q("#lGo").onclick = doLogin;
  // Notausgang: Ist die Zugangsliste gestört, können Handys mit dem alten Firmen-Code weiter Protokolle hochladen.
  q("#lOld").onclick = () => {
    ls.set("kapp_code", oldCode);
    box.classList.add("hide"); document.body.classList.remove("locked");
    document.querySelector("#tabs").classList.add("hide");
    if (window.protoReady) window.protoReady();
    tab("protokolle");
  };
  q("#lPw").onkeydown = e => { if (e.key === "Enter") doLogin(); };

  /* ---------- Eigenes Passwort ändern ----------
     pflicht = Startpasswort vom Büro: erst nach dem Ändern geht es in die App (kein „Abbrechen“).
     altBekannt = gerade eingegebenes Passwort, dann muss es nicht nochmal getippt werden. */
  const pwBox = document.createElement("div");
  pwBox.id = "pwView"; pwBox.className = "login hide";
  document.body.appendChild(pwBox);
  let pwAlt = "", pwPflicht = false;
  function pwZeigen(pflicht, altBekannt) {
    pwPflicht = !!pflicht; pwAlt = altBekannt || "";
    pwBox.innerHTML = `<div class="lbox">
      <img src="/logo-kapp.png" alt="Airtec KApp">
      <h1>${pwPflicht ? "Eigenes Passwort wählen" : "Passwort ändern"}</h1>
      ${pwPflicht ? `<div class="hint" style="text-align:center;margin-bottom:6px">Hallo ${esc(AT.user ? AT.user.name.split(" ")[0] : "")}! Sie haben ein Startpasswort vom Büro bekommen. Bitte wählen Sie jetzt ein eigenes – das kennen dann nur noch Sie.</div>` : ""}
      ${pwAlt ? "" : `<label>Bisheriges Passwort</label><input id="pAlt" type="password" autocomplete="current-password">`}
      <label>Neues Passwort</label><input id="pNeu" type="password" autocomplete="new-password">
      <label>Neues Passwort wiederholen</label><input id="pNeu2" type="password" autocomplete="new-password">
      <label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-top:10px"><input type="checkbox" id="pZeig" style="width:auto"> Passwörter anzeigen</label>
      <div class="hint">Mindestens 8 Zeichen. Nicht der eigene Name, nicht „12345678“ oder „Passwort“. Gut merkbar ist z. B. ein kurzer Satz.</div>
      <div class="lerr" id="pErr"></div>
      <button class="bigbtn primary" id="pGo">Passwort speichern</button>
      ${pwPflicht ? `<button class="add" id="pAus" style="border-style:solid;color:var(--bad);border-color:var(--bad)">Abmelden</button>` : `<button class="add" id="pAus">Abbrechen</button>`}
    </div>`;
    pwBox.classList.remove("hide"); document.body.classList.add("locked");
    q("#pZeig").onchange = e => ["#pAlt", "#pNeu", "#pNeu2"].map(s => q(s)).filter(Boolean).forEach(i => { i.type = e.target.checked ? "text" : "password"; });
    q("#pGo").onclick = pwSpeichern;
    pwBox.querySelectorAll("input").forEach(i => i.onkeydown = e => { if (e.key === "Enter") pwSpeichern(); });
    q("#pAus").onclick = () => { pwBox.classList.add("hide"); document.body.classList.remove("locked"); if (pwPflicht) AT.logout(); };
    setTimeout(() => (q("#pAlt") || q("#pNeu")).focus(), 50);
  }
  async function pwSpeichern() {
    const alt = pwAlt || q("#pAlt").value, neu = q("#pNeu").value, neu2 = q("#pNeu2").value, err = q("#pErr");
    err.textContent = "";
    if (!alt) { err.textContent = "Bitte das bisherige Passwort eingeben"; q("#pAlt").focus(); return; }
    if (neu.length < 8) { err.textContent = "Das neue Passwort braucht mindestens 8 Zeichen"; q("#pNeu").focus(); return; }
    if (neu !== neu2) { err.textContent = "Die beiden neuen Passwörter sind nicht gleich"; q("#pNeu2").focus(); return; }
    q("#pGo").disabled = true;
    try {
      const r = await AT.api("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ aktion: "passwort", alt, neu }) });
      AT.session = r; ls.set("at_session", r); ls.set("kapp_code", r.token);
      pwBox.classList.add("hide"); document.body.classList.remove("locked");
      if (pwPflicht) start();
      if (typeof toast === "function") toast("✓ Passwort geändert – ab jetzt gilt Ihr neues Passwort");
    } catch (e) {
      if (e.status === 403 && pwAlt) { pwAlt = ""; pwZeigen(pwPflicht); q("#pErr").textContent = e.message; return; }
      err.textContent = navigator.onLine ? e.message : "Keine Internetverbindung";
      if (e.status === 401) AT.logout(true);
    } finally { const b = q("#pGo"); if (b) b.disabled = false; }
  }
  AT.passwortAendern = () => pwZeigen(false);
  const pb = q("#accPw"); if (pb) pb.onclick = () => { q("#mSettings").classList.remove("show"); pwZeigen(false); };

  /* ---------- Start ---------- */
  function start() {
    const u = AT.user;
    if (u.pwNeu) { box.classList.add("hide"); pwZeigen(true); return; }   // Startpasswort: erst eigenes wählen
    box.classList.add("hide"); document.body.classList.remove("locked");
    // Für das Protokoll-Modul: Token als Code, Monteur = angemeldete Person
    ls.set("kapp_code", AT.session.token);
    try { monteur = { name: u.name, mail: u.mail || "" }; ls.set("kapp_monteur", monteur); if (typeof showWho === "function") showWho(); } catch (e) {}
    const who = q("#accName"); if (who) who.textContent = u.name + (u.admin ? " (Admin)" : u.schreiben ? " (Büro)" : "");
    reiter();
    if (window.protoReady) window.protoReady();
    tab("start", { ohneFrage: true });   // App öffnet immer auf der Startseite
    if (AT.checkMaschinen && navigator.onLine) setTimeout(AT.checkMaschinen, 1200);
    // Anmeldung im Hintergrund prüfen (z. B. Passwort geändert oder Zugang entfernt)
    if (navigator.onLine) AT.api("login").then(r => { AT.session.user = r.user; ls.set("at_session", AT.session); reiter(); if (r.user.pwNeu) pwZeigen(true); }).catch(e => { if (e.status === 401) AT.logout(true); });
  }
  // Reiter nur für freigegebene Bereiche zeigen (Zusatzrecht schließt den Bereich ein)
  const BEREICH = { wochenplan: ["wochenplan", "plan_aendern"], protokolle: ["protokolle"], maschinen: ["maschinen", "maschinen_buero"], lager: ["lager", "lager_bestellen"] };
  // „Allgemeines“ (eigene Angaben) und „Baustellen“ sehen alle
  function reiter() {
    document.querySelectorAll("#tabs button").forEach(b => {
      const need = BEREICH[b.dataset.tab];
      b.classList.toggle("hide", !!need && !need.some(r => AT.darf(r)));
    });
    const cur = ls.get("at_tab"), nb = BEREICH[cur];
    if (nb && !nb.some(r => AT.darf(r))) tab("start", { ohneFrage: true });
  }
  AT.reiter = reiter;
  // Abmelden: erst ungespeicherte Eingaben abfragen, dann Handy-Mitteilungen für diese Person abmelden
  const lo = q("#accLogout"); if (lo) lo.onclick = async () => {
    q("#mSettings").classList.remove("show");
    if (aktuell && !(await darfVerlassen(aktuell))) return;
    if (AT.pushAbmelden) await AT.pushAbmelden();
    AT.logout();
  };

  AT.ready = () => { if (AT.session && AT.session.token) start(); else showLogin(); };
})();
