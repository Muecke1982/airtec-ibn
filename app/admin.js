/* Airtec KApp – Datenbank (nur Büro): Überblick und Einmal-Import aus den Excel-Dateien in SharePoint.
   Erscheint in den Einstellungen (⚙︎) für Personen mit Schreibrecht. */
(function () {
  const box = document.querySelector("#mSettings .box");
  if (!box) return;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sec = document.createElement("div");
  sec.id = "dbAdmin";
  sec.className = "hide";
  sec.innerHTML = `<h3 style="margin-top:22px">Datenbank (Büro)</h3>
    <div class="hint" style="margin-top:0">Einmalig: Daten aus den Excel-Dateien in SharePoint in die Datenbank übernehmen.
      Ein erneuter Import <b>ersetzt</b> die Daten dieses Bereichs in der Datenbank.</div>
    <div id="dbList" style="margin-top:8px;font-size:14px">…</div>`;
  box.insertBefore(sec, box.querySelector(".btns"));
  const list = sec.querySelector("#dbList");

  const fmt = iso => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}` : iso; };
  function render(st) {
    if (!st.verbunden) { list.innerHTML = `<div class="warn">Die Datenbank ist noch nicht mit der App verbunden.</div>`; return; }
    list.innerHTML = st.bereiche.map(b => {
      const n = Object.values(b.zahlen).reduce((a, x) => a + x, 0);
      const imp = b.import ? `Importiert am ${esc(fmt(b.import.am))} von ${esc(b.import.von)}: ${esc(b.import.anzahl)}` : "Noch nicht importiert";
      return `<div style="border:1px solid #dde3ea;border-radius:10px;padding:8px 10px;margin:6px 0">
        <b>${esc(b.titel)}</b> <span style="color:var(--mut)">· ${n} Einträge</span>
        <div class="hint" style="margin:2px 0 6px">${imp}</div>
        <button class="add" data-imp="${esc(b.id)}" style="margin:0">${b.import ? "Erneut importieren" : "Aus Excel importieren"}</button></div>`;
    }).join("");
  }
  async function load() {
    list.textContent = "Lade …";
    try { render(await (await api("admin")).json()); }
    catch (e) { list.innerHTML = `<div class="warn">${esc(e.message)}</div>`; }
  }
  list.onclick = async e => {
    const btn = e.target.closest("[data-imp]"); if (!btn) return;
    const bereich = btn.dataset.imp;
    if (!confirm("Daten für diesen Bereich aus Excel übernehmen? Vorhandene Daten dieses Bereichs in der Datenbank werden ersetzt.")) return;
    btn.disabled = true; btn.textContent = "Importiere …";
    try {
      const body = { aktion: "import", bereich };
      if (bereich === "stammdaten") {
        await syncStamm(false);   // Stammdaten frisch aus SharePoint lesen (im Browser, wegen der Links)
        if (!STAMM || STAMM.src === "eingebaut") throw new Error("Stammdaten aus SharePoint konnten nicht geladen werden");
        body.stamm = STAMM;
      }
      const r = await (await api("admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
      toast("Importiert: " + r.anzahl);
      render(r.status);
    } catch (err) { toast("Fehler: " + err.message); btn.disabled = false; btn.textContent = "Erneut versuchen"; }
  };

  // beim Öffnen der Einstellungen anzeigen (nur Büro)
  const modal = document.getElementById("mSettings");
  new MutationObserver(() => {
    const show = modal.classList.contains("show") && window.AT && AT.user && AT.user.schreiben;
    sec.classList.toggle("hide", !show);
    if (show) load();
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
})();
