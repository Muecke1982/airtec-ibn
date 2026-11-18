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
      showLogin(expired ? "Anmeldung abgelaufen – bitte neu anmelden." : "");
    },
  };

  /* ---------- Modul-Umschaltung ---------- */
  function tab(name) {
    ls.set("at_tab", name);
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
    <img src="${typeof LOGO !== "undefined" ? LOGO : ""}" alt="Airtec">
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
      start();
    } catch (e) {
      q("#lErr").textContent = e.status === 401 ? "Name oder Passwort falsch" : (navigator.onLine ? e.message : "Keine Internetverbindung");
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

  /* ---------- Start ---------- */
  function start() {
    const u = AT.user;
    box.classList.add("hide"); document.body.classList.remove("locked");
    // Für das Protokoll-Modul: Token als Code, Monteur = angemeldete Person
    ls.set("kapp_code", AT.session.token);
    try { monteur = { name: u.name, mail: u.mail || "" }; ls.set("kapp_monteur", monteur); if (typeof showWho === "function") showWho(); } catch (e) {}
    const who = q("#accName"); if (who) who.textContent = u.name + (u.admin ? " (Admin)" : u.schreiben ? " (Büro)" : "");
    reiter();
    if (window.protoReady) window.protoReady();
    tab("start");   // App öffnet immer auf der Startseite
    if (AT.checkMaschinen && navigator.onLine) setTimeout(AT.checkMaschinen, 1200);
    // Anmeldung im Hintergrund prüfen (z. B. Passwort geändert oder Zugang entfernt)
    if (navigator.onLine) AT.api("login").then(r => { AT.session.user = r.user; ls.set("at_session", AT.session); reiter(); }).catch(e => { if (e.status === 401) AT.logout(true); });
  }
  // Reiter nur für freigegebene Bereiche zeigen (Zusatzrecht schließt den Bereich ein)
  const BEREICH = { wochenplan: ["wochenplan", "plan_aendern"], protokolle: ["protokolle"], maschinen: ["maschinen", "maschinen_buero"], lager: ["lager", "lager_bestellen"] };   // „Allgemeines“ sehen alle (eigene Angaben)
  function reiter() {
    document.querySelectorAll("#tabs button").forEach(b => {
      const need = BEREICH[b.dataset.tab];
      b.classList.toggle("hide", !!need && !need.some(r => AT.darf(r)));
    });
    const cur = ls.get("at_tab"), nb = BEREICH[cur];
    if (nb && !nb.some(r => AT.darf(r))) tab("start");
  }
  AT.reiter = reiter;
  const lo = q("#accLogout"); if (lo) lo.onclick = () => { q("#mSettings").classList.remove("show"); AT.logout(); };

  AT.ready = () => { if (AT.session && AT.session.token) start(); else showLogin(); };
})();
