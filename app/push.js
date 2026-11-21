/* Airtec App – Handy-Mitteilungen (Web Push)
   • Startseite: Karte „🔔 Mitteilungen aufs Handy“ → „Mitteilungen erlauben“ (Handy fragt einmal nach)
   • iPhone: geht nur, wenn die App über „Zum Home-Bildschirm“ installiert ist (ab iOS 16.4)
   • bei jedem Start: Abo erneut an den Server melden (falls das Handy es erneuert hat)
   • Zahl am App-Symbol: ungelesene + unbestätigte Nachrichten
   • Tipp auf eine Mitteilung: sw.js öffnet die App → hier zum richtigen Reiter springen */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const kann = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installiert = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const post = b => AT.api("push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const b64 = s => { const p = "=".repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob((s + p).replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)); };
  const geraet = () => (ios ? "iPhone" : /android/i.test(navigator.userAgent) ? "Android" : "Computer") + (installiert ? "" : " (Browser)");

  const st = document.createElement("style");
  st.textContent = `.pushk .hihead{color:var(--blue)} .pushk .pbtns{display:flex;gap:8px;margin-top:10px} .pushk .pbtns button{flex:1}
    .pushk ol{margin:6px 0 0 18px;padding:0;font-size:14px;line-height:1.5}`;
  document.head.appendChild(st);
  const start = document.getElementById("stView");
  const box = document.createElement("div"); box.id = "pushBox";
  (start.querySelector("#hiBox") || start.lastChild).before(box);

  async function abo(neu) {
    const reg = await navigator.serviceWorker.ready;
    let s = await reg.pushManager.getSubscription();
    if (!s && neu) {
      const info = await AT.api("push");
      s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(info.schluessel) });
    }
    if (s) await post({ aktion: "abonnieren", abo: s.toJSON(), geraet: geraet() });
    return s;
  }

  async function erlauben(btn) {
    btn.disabled = true; btn.textContent = "…";
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") { toast2("Mitteilungen wurden nicht erlaubt – das lässt sich in den Handy-Einstellungen ändern"); malen(); return; }
      await abo(true);
      ls.set("push_an", AT.user && AT.user.name);
      toast2("🔔 Mitteilungen sind eingeschaltet ✓");
    } catch (e) { toast2("Mitteilungen konnten nicht eingeschaltet werden: " + e.message); }
    malen();
  }

  function malen() {
    if (!AT.user || !AT.user.name) { box.innerHTML = ""; return; }
    const spaeter = ls.get("push_spaeter") || 0;
    if (Date.now() < spaeter) { box.innerHTML = ""; return; }
    let inhalt = "";
    if (kann && Notification.permission === "default") {
      inhalt = `<b>Neue Nachrichten und Hinweise direkt aufs Handy bekommen?</b>
        <div class="hivon" style="margin-top:4px">Das Handy fragt einmal nach – bitte „Erlauben“ tippen.</div>
        <div class="pbtns"><button class="bigbtn primary" id="pushOn" style="margin:0">🔔 Mitteilungen erlauben</button><button class="add" id="pushLater" style="margin:0">Später</button></div>`;
    } else if (!kann && ios && !installiert) {
      inhalt = `<b>Mitteilungen gibt es auf dem iPhone nur mit installierter App</b>
        <ol><li>Unten in Safari auf <b>Teilen</b> (□↑) tippen</li><li><b>„Zum Home-Bildschirm“</b> wählen</li><li>Die App vom Home-Bildschirm öffnen und hier „Mitteilungen erlauben“ tippen</li></ol>
        <div class="pbtns"><button class="add" id="pushLater" style="margin:0">Später</button></div>`;
    }
    box.innerHTML = inhalt ? `<section class="card hicard pushk"><div class="hihead">🔔 Mitteilungen aufs Handy</div>${inhalt}</section>` : "";
    const on = box.querySelector("#pushOn"); if (on) on.onclick = () => erlauben(on);
    const sp = box.querySelector("#pushLater"); if (sp) sp.onclick = () => { ls.set("push_spaeter", Date.now() + 7 * 864e5); malen(); };
  }

  // Zahl am App-Symbol
  function zahl() {
    const d = AT.austausch && AT.austausch.data;
    if (!d || !("setAppBadge" in navigator)) return;
    const n = (d.ungelesen || 0) + (d.wichtigOffen || 0) + (d.pinsOffen || 0);
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
  }

  // Tipp auf eine Mitteilung (App war offen → Nachricht vom Service Worker; App war zu → ?ziel=…)
  const springe = ziel => { if (ziel && AT.tab) { try { AT.tab(ziel); } catch (e) {} } };
  if (kann) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.typ === "mitteilung") { springe(e.data.ziel); if (AT.austausch) AT.austausch.load(); } });
  const zielStart = (location.search.match(/[?&]ziel=(\w+)/) || [])[1];
  if (zielStart) { try { history.replaceState(null, "", "/"); } catch (e) {} }

  // nach der Anmeldung: Karte zeigen, vorhandenes Abo auffrischen, ggf. Reiter öffnen
  let fertig = false;
  const warte = setInterval(() => {
    if (!AT.user || !AT.user.name || document.body.classList.contains("locked")) return;
    clearInterval(warte); fertig = true;
    malen();
    if (kann && Notification.permission === "granted" && navigator.onLine) abo(false).catch(() => {});
    if (zielStart) setTimeout(() => springe(zielStart), 500);
    if (AT.austausch && AT.austausch.onChange) AT.austausch.onChange(zahl);
    zahl();
  }, 500);
  const alt = AT.modules.start && AT.modules.start.show;
  if (alt) AT.modules.start.show = function () { alt.apply(this, arguments); if (fertig) malen(); };
})();
