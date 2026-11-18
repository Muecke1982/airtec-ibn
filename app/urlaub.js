/* Airtec KApp – Urlaub (Startseite, ganz unten)
   Quelle ist allein der Wochenplan (Google-Tabelle): jede Zelle „Urlaub“ zählt.
   • alle: „Mein Urlaub <Jahr>“ – anstehende Zeiträume, Summe, schon genommen
   • Büro (Recht „urlaub“): „Urlaub im Team“ – wer heute im Urlaub ist + alle anstehenden Zeiträume */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const office = () => AT.darf("urlaub");
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const d1 = iso => iso ? `${WT[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "?";
  const span = r => r.von === r.bis ? d1(r.von) : `${d1(r.von)} – ${d1(r.bis)}`;
  const zahl = n => String(n).replace(".", ",");
  const days = r => r.tage ? ` · ${zahl(r.tage)} Arbeitstag${r.tage === 1 ? "" : "e"}` : "";

  const root = document.getElementById("stView");
  const box = document.createElement("div");
  box.id = "urBox";
  root.appendChild(box);   // ganz unten auf der Startseite

  const key = () => "ur2_cache_" + ((AT.user && AT.user.name) || "");
  let data = null, wer = null, open = false, busy = false, fehler = "";

  async function load(neu) {
    try { data = await AT.api("urlaub" + (neu ? "?neu=1" : "")); ls.set(key(), data); fehler = ""; }
    catch (e) { fehler = e.message || "Urlaub konnte nicht geladen werden"; if (neu) toast2(fehler); }
    paint();
  }

  function paint() {
    if (!AT.user) { box.innerHTML = ""; return; }
    if (wer !== AT.user.name) { wer = AT.user.name; data = ls.get(key()); open = false; fehler = ""; }
    if (!data) { box.innerHTML = fehler && office() ? `<section class="card hicard"><div class="hihead">🌴 Urlaub</div><div class="urerr">⚠ ${esc(fehler)}</div></section>` : ""; return; }
    const out = [];
    const today = data.heute || new Date().toISOString().slice(0, 10);
    const mine = data.meine || [];
    const next = mine.filter(r => r.bis >= today);
    const summe = z => z.reduce((s, r) => s + (+r.tage || 0), 0);
    // schon genommen = abgeschlossene Zeiträume (ein laufender Urlaub zählt noch als anstehend)
    const genommen = summe(mine.filter(r => r.bis < today));
    out.push(`<section class="card hicard urmine"><div class="hihead">🌴 Mein Urlaub ${esc(data.jahr || today.slice(0, 4))}</div>${next.length ? next.map(r =>
      `<div class="urline"><b>${esc(span(r))}</b>${esc(days(r))}${r.von <= today ? ' <span class="urnow">läuft gerade</span>' : ""}</div>`).join("")
      + (next.length > 1 ? `<div class="hivon">zusammen ${zahl(summe(next))} Arbeitstage</div>` : "")
      : '<div class="hivon" style="margin-top:0">Kein Urlaub mehr in diesem Jahr im Wochenplan eingetragen.</div>'}
      ${genommen ? `<div class="hivon">Schon genommen: ${zahl(genommen)} Arbeitstage · im Jahr gesamt ${zahl(summe(mine))}</div>` : ""}</section>`);
    // Büro
    if (office() && data.alle) {
      const all = data.alle;
      const jetzt = all.filter(r => r.von <= today);
      out.push(`<section class="card hiofc urofc"><div class="hihead">🌴 Urlaub im Team</div>
        ${fehler ? `<div class="urerr">⚠ ${esc(fehler)}</div>` : ""}
        <div class="hivon" style="margin-top:0">${jetzt.length ? `<b>Heute im Urlaub: ${jetzt.map(r => esc(r.name)).join(", ")}</b> · ` : "Heute niemand im Urlaub · "}aus dem Wochenplan${data.stand ? ", Stand " + esc(new Date(data.stand).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })) : ""}</div>
        <div class="hirow"><button class="add" id="urToggle">${open ? "Liste zuklappen" : `Anstehender Urlaub (${all.length})`}</button><button class="add" id="urSync">${busy ? "Wird geladen …" : "Neu einlesen"}</button></div>
        <div class="${open ? "" : "hide"}">${all.length ? all.map(r =>
          `<div class="hisent urok"><div><b>${esc(r.name)}</b>${r.von <= today ? ' <span class="urnow">läuft gerade</span>' : ""}
            <div>${esc(span(r))}${esc(days(r))}</div></div></div>`).join("") : '<div class="hint">Kein Urlaub mehr in diesem Jahr im Wochenplan.</div>'}</div></section>`);
    }
    box.innerHTML = out.join("");
    const t = box.querySelector("#urToggle"); if (t) t.onclick = () => { open = !open; paint(); };
    const s = box.querySelector("#urSync");
    if (s) s.onclick = async () => {
      if (busy) return; busy = true; paint();
      await load(true);
      busy = false; open = true; paint();
      if (!fehler) toast2("Wochenplan neu eingelesen");
    };
  }

  const prev = AT.modules.start.show;
  AT.modules.start.show = function () { paint(); if (navigator.onLine) load(); return prev.apply(this, arguments); };
})();
