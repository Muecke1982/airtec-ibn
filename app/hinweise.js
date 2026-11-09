/* Airtec App – Hinweise auf der Startseite (unter der Begrüßung):
   • Maschinen: zu lange ausgeliehen (Monteur) / überfällig verliehen (Büro)
   • Büro-Hinweise an einzelne Monteure oder alle – zum Abhaken
   • Büro: neuen Hinweis schreiben (auch am PC im Browser) und sehen, wer abgehakt hat */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const short = s => String(s || "").replace(/^(\d{2}\.\d{2}\.)\d{4}/, "$1");
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const office = () => !!(AT.user && AT.user.schreiben);

  const root = document.getElementById("wpView");
  const box = document.createElement("div");
  box.id = "hiBox";
  root.querySelector(".wphello").after(box);

  let hin = ls.get("hi_cache"), ma = ls.get("ma_cache"), busy = false, formOpen = false, listOpen = false;

  async function load() {
    const [h, m] = await Promise.allSettled([AT.api("hinweise"), AT.api("maschinen")]);
    if (h.status === "fulfilled") { hin = h.value; ls.set("hi_cache", hin); }
    if (m.status === "fulfilled") { ma = m.value; ma.geladen = Date.now(); ls.set("ma_cache", ma); }
    paint();
  }

  function paint() {
    const me = norm(AT.user && AT.user.name);
    const items = [];
    // Maschinen
    for (const m of (ma && ma.maschinen) || []) {
      const a = m.aus; if (!a) continue;
      if (!a.extern && !a.baustelle && norm(a.wer) === me && a.faellig)
        items.push(`<section class="card hicard hima"><div class="hihead">🔧 Maschine</div><b>Hast du „${esc(m.name)}“ noch?</b>
          <div>Bei dir seit ${esc(short(a.seit))} (${a.tage} Tage).</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="bestaetigen" data-id="${esc(m.id)}">Ja, noch bei mir</button>
          <button class="mabtn back" data-ma="zurueck" data-id="${esc(m.id)}">Zurückgelegt</button></div></section>`);
      if (office() && a.extern && a.erinnern)
        items.push(`<section class="card hicard hima"><div class="hihead">⏰ Verliehen – überfällig</div><b>${esc(m.name)}</b>
          <div>an ${esc(a.an)}${a.kontakt ? " (" + esc(a.kontakt) + ")" : ""}, Rückgabe war bis ${esc(String(a.frist).slice(0, 6))}</div>
          <div class="maaskbtn"><button class="mabtn take" data-ma="zurueck" data-id="${esc(m.id)}">Ist zurück</button>
          <button class="mabtn back" data-ma="erinnern" data-id="${esc(m.id)}">In ${(ma && ma.erinnerung_tage) || 3} Tagen erinnern</button></div></section>`);
    }
    // Büro-Hinweise an mich
    for (const h of (hin && hin.meine) || [])
      items.push(`<section class="card hicard hibuero"><div class="hihead">📌 Hinweis vom Büro${h.von ? " · " + esc(h.von.split(" ")[0]) : ""}${h.erstellt ? " · " + esc(short(h.erstellt).slice(0, 6)) : ""}</div>
        <div class="hitext">${esc(h.text)}</div>
        <button class="hidone" data-done="${esc(h.id)}">Erledigt ✓</button></section>`);
    // Büro: Hinweis schreiben + Übersicht
    let ofc = "";
    if (office()) {
      const all = (hin && hin.alle) || [];
      const open = all.filter(h => h.alle || !h.done.length);
      ofc = `<section class="card hiofc">
        <div class="hirow"><button class="add" id="hiNew">＋ Hinweis an Monteur</button><button class="add" id="hiList">Gesendete (${open.length} offen)</button></div>
        <div id="hiForm" class="${formOpen ? "" : "hide"}">
          <label>An</label><select id="hiAn"><option>Alle</option></select>
          <label>Hinweis</label><textarea id="hiText" rows="3" placeholder="z. B. Im Büro liegen Unterlagen der Versicherung für dich."></textarea>
          <div class="row"><div><label>Sichtbar ab (optional)</label><input type="date" id="hiAb"></div><div></div></div>
          <button class="bigbtn primary" id="hiSend">Hinweis senden</button>
        </div>
        <div id="hiSent" class="${listOpen ? "" : "hide"}">${all.length ? all.map(h => {
          const st = h.alle
            ? (h.done.length ? `✓ ${h.done.length}× abgehakt: ${h.done.map(d => esc(d.wer.split(" ")[0])).join(", ")}` : "noch von niemandem abgehakt")
            : (h.done.length ? `✓ erledigt ${esc(short(h.done[0].am))}` : "offen");
          return `<div class="hisent${!h.alle && h.done.length ? " ok" : ""}"><div><b>an ${esc(h.an)}</b>${h.ab ? ` <small>ab ${esc(h.ab)}</small>` : ""}<div>${esc(h.text)}</div>
            <small>${h.von ? "von " + esc(h.von) + ", " : ""}${esc(short(h.erstellt))} · ${st}</small></div>
            <button class="hidel" data-del="${esc(h.id)}">Löschen</button></div>`;
        }).join("") : '<div class="hint">Noch keine Hinweise.</div>'}</div>
      </section>`;
    }
    box.innerHTML = items.join("") + ofc;
    if (office()) fillNames();
    bind();
  }

  async function fillNames() {
    const sel = box.querySelector("#hiAn"); if (!sel) return;
    let names = ls.get("at_names") || [];
    if (!names.length) try { names = (await AT.api("login?liste=1")).namen || []; ls.set("at_names", names); } catch (e) {}
    const keep = sel.value;
    sel.innerHTML = "<option>Alle</option>" + names.filter(n => norm(n) !== norm(AT.user.name)).map(n => `<option ${n === keep ? "selected" : ""}>${esc(n)}</option>`).join("");
  }

  async function post(path, body) {
    return AT.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  function bind() {
    box.querySelectorAll("[data-ma]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      try { ma = await post("maschinen", { aktion: b.dataset.ma, id: b.dataset.id }); ma.geladen = Date.now(); ls.set("ma_cache", ma);
        toast2({ bestaetigen: "Danke – wir fragen in 10 Tagen nochmal", zurueck: "Als zurück eingetragen", erinnern: "Okay, Erinnerung später" }[b.dataset.ma]);
        if (AT.checkMaschinen) AT.checkMaschinen(true);
      } catch (e) { toast2(e.message); }
      busy = false; paint();
    });
    box.querySelectorAll("[data-done]").forEach(b => b.onclick = async () => {
      if (busy) return; busy = true; b.disabled = true; b.textContent = "…";
      const card = b.closest(".hicard"); if (card) card.classList.add("gone");
      try { hin = await post("hinweise", { aktion: "erledigt", id: b.dataset.done }); ls.set("hi_cache", hin); toast2("Abgehakt ✓"); }
      catch (e) { toast2(e.message); }
      busy = false; setTimeout(paint, 250);
    });
    const $ = s => box.querySelector(s);
    if (!$("#hiNew")) return;
    $("#hiNew").onclick = () => { formOpen = !formOpen; listOpen = false; paint(); if (formOpen) setTimeout(() => $("#hiText") && $("#hiText").focus(), 50); };
    $("#hiList").onclick = () => { listOpen = !listOpen; formOpen = false; paint(); };
    $("#hiSend").onclick = async () => {
      const text = $("#hiText").value.trim(), an = $("#hiAn").value, abIso = $("#hiAb").value;
      if (!text) { $("#hiText").focus(); return; }
      const ab = abIso ? abIso.split("-").reverse().join(".") : "";
      $("#hiSend").disabled = true; $("#hiSend").textContent = "Wird gesendet …";
      try { hin = await post("hinweise", { aktion: "neu", an, text, ab }); ls.set("hi_cache", hin); formOpen = false; listOpen = true; toast2(`Hinweis an ${an} gesendet`); }
      catch (e) { toast2(e.message); }
      paint();
    };
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "Löschen"; } }, 4000); return; }
      b.disabled = true;
      try { hin = await post("hinweise", { aktion: "loeschen", id: b.dataset.del }); ls.set("hi_cache", hin); toast2("Gelöscht"); }
      catch (e) { toast2(e.message); }
      paint();
    });
  }

  // bei jedem Öffnen der Startseite aktualisieren
  const prev = AT.modules.wochenplan.show;
  AT.modules.wochenplan.show = function () {
    const r = prev.apply(this, arguments);
    paint();
    if (navigator.onLine) load();
    return r;
  };
})();
