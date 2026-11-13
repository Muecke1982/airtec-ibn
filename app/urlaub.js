/* Airtec App – Urlaub aus Label (Startseite)
   • Monteur: neue Entscheidung (genehmigt / abgelehnt) als Karte zum Abhaken + „Mein Urlaub“ (kommende Tage)
   • Büro: Liste der Mails aus dem Urlaubs-Postfach, „In Wochenplan eintragen“, nicht erkannte Mails */
(function () {
  const AT = window.AT;
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const toast2 = t => { if (typeof toast === "function") toast(t); };
  const office = () => !!(AT.user && AT.user.schreiben);
  const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  const d1 = iso => iso ? `${WT[new Date(iso + "T12:00:00Z").getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.` : "?";
  const span = r => !r.von ? "Zeitraum unbekannt" : r.von === r.bis ? d1(r.von) : `${d1(r.von)} – ${d1(r.bis)}${r.bis.slice(0, 4) !== r.von.slice(0, 4) ? r.bis.slice(0, 4) : ""}`;
  const days = r => r.tage ? ` · ${r.tage} Arbeitstag${r.tage === "1" ? "" : "e"}` : "";
  const ST = { genehmigt: ["✅", "genehmigt", "urok"], abgelehnt: ["❌", "abgelehnt", "urno"], storniert: ["↩️", "storniert", "urno"], unklar: ["⚠️", "nicht erkannt", "urwarn"] };

  const root = document.getElementById("stView");
  const box = document.createElement("div");
  box.id = "urBox";
  const hi = root.querySelector("#hiBox");
  hi.parentNode.insertBefore(box, hi);   // über den Hinweisen

  let data = ls.get("ur_cache"), open = false, busy = false;
  const seenKey = () => "ur_seen_" + ((AT.user && AT.user.name) || "");

  async function load() {
    try { data = await AT.api("urlaub"); ls.set("ur_cache", data); } catch (e) { if (e.status === 404) data = null; }
    paint();
  }
  async function post(body) {
    const r = await AT.api("urlaub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r;
  }

  function paint() {
    if (!data || !AT.user) { box.innerHTML = ""; return; }
    const out = [];
    const seen = ls.get(seenKey()) || [];
    const today = data.heute || new Date().toISOString().slice(0, 10);
    const mine = data.meine || [];
    // neue Entscheidungen
    for (const r of mine.filter(r => !seen.includes(r.id) && (r.bis || "") >= today)) {
      const [ic, word, cls] = ST[r.status] || ST.unklar;
      out.push(`<section class="card hicard urnew ${cls}"><div class="hihead">🌴 Urlaubsantrag</div>
        <b>${ic} Dein Urlaub wurde ${esc(word)}</b><div>${esc(span(r))}${esc(days(r))}${r.hinweis && r.hinweis.includes("halber") ? " · halber Tag" : ""}</div>
        <button class="hidone" data-seen="${esc(r.id)}">OK</button></section>`);
    }
    // kommender genehmigter Urlaub
    const next = mine.filter(r => r.status === "genehmigt" && seen.includes(r.id) && (r.bis || "") >= today);
    if (next.length) out.push(`<section class="card hicard urmine"><div class="hihead">🌴 Mein Urlaub</div>${next.map(r =>
      `<div class="urline"><b>${esc(span(r))}</b>${esc(days(r))}${r.von <= today ? ' <span class="urnow">läuft gerade</span>' : ""}</div>`).join("")}</section>`);
    // Büro
    if (office() && data.alle) {
      const all = data.alle, unklar = all.filter(r => r.status === "unklar"), offen = all.filter(r => r.status === "genehmigt" && !r.plan && (r.bis || "") >= today);
      const show = open || unklar.length > 0;
      out.push(`<section class="card hiofc urofc"><div class="hihead">🌴 Urlaub aus Label</div>
        ${data.fehler ? `<div class="urerr">⚠ ${esc(data.fehler)}</div>` : ""}
        <div class="hivon" style="margin-top:0">${offen.length ? `<b>${offen.length} genehmigt, noch nicht im Wochenplan</b> · ` : ""}${unklar.length ? `<b>${unklar.length} Mail${unklar.length > 1 ? "s" : ""} nicht erkannt</b> · ` : ""}Postfach ${esc(data.postfach || "")}${data.geprueft ? ", geprüft " + esc(data.geprueft.slice(11)) : ""}</div>
        <div class="hirow"><button class="add" id="urToggle">${show ? "Liste zuklappen" : `Liste anzeigen (${all.length})`}</button><button class="add" id="urSync">${busy ? "Wird abgerufen …" : "Postfach abrufen"}</button></div>
        <div class="${show ? "" : "hide"}">${all.length ? all.map(r => {
          const [ic, word, cls] = ST[r.status] || ST.unklar;
          const btn = r.status === "genehmigt" && (r.bis || "") >= today
            ? (r.plan ? `<small>✓ im Wochenplan (${esc(r.plan)})</small>` : `<button class="urplan" data-plan="${esc(r.id)}">In Wochenplan eintragen</button>`) : "";
          return `<div class="hisent ${cls}"><div><b>${esc(r.name || "Mitarbeiter?")}</b> <span class="urbadge">${ic} ${esc(word)}</span>
            <div>${esc(span(r))}${esc(days(r))}</div>
            ${r.status === "unklar" ? `<small>„${esc(r.betreff)}“ – ${esc(r.hinweis || "")}. Bitte in Airtec_Urlaub.xlsx ergänzen.</small>` : r.hinweis ? `<small>${esc(r.hinweis)}</small>` : ""}
            <small>Mail vom ${esc(String(r.eingang || "").slice(0, 10))}</small></div>${btn}</div>`;
        }).join("") : '<div class="hint">Noch keine Urlaubsmails eingegangen.</div>'}</div></section>`);
    }
    box.innerHTML = out.join("");
    bind();
  }

  function bind() {
    box.querySelectorAll("[data-seen]").forEach(b => b.onclick = () => {
      const s = ls.get(seenKey()) || []; s.push(b.dataset.seen); ls.set(seenKey(), s.slice(-200)); paint();
    });
    const t = box.querySelector("#urToggle"); if (t) t.onclick = () => { open = !open; paint(); };
    const s = box.querySelector("#urSync");
    if (s) s.onclick = async () => {
      if (busy) return; busy = true; paint();
      try { data = await post({ aktion: "abrufen" }); ls.set("ur_cache", data); toast2(data.fehler ? "Abruf fehlgeschlagen" : "Postfach abgerufen"); }
      catch (e) { toast2(e.message); }
      busy = false; open = true; paint();
    };
    box.querySelectorAll("[data-plan]").forEach(b => b.onclick = async () => {
      if (!b.classList.contains("sure")) { b.classList.add("sure"); b.textContent = "Wirklich eintragen?"; setTimeout(() => { if (b.isConnected) { b.classList.remove("sure"); b.textContent = "In Wochenplan eintragen"; } }, 4000); return; }
      b.disabled = true; b.textContent = "Wird eingetragen …";
      const e0 = ((data && data.alle) || []).find(x => x.id === b.dataset.plan);
      try {
        const r = await post({ aktion: "wochenplan", id: b.dataset.plan });
        data = r; ls.set("ur_cache", data);
        toast2(`${r.geschrieben} Tag${r.geschrieben === 1 ? "" : "e"} als Urlaub eingetragen` + (r.fehler && r.fehler.length ? ` – nicht möglich: ${r.fehler.join("; ")}` : ""));
        if (e0 && e0.von && AT.wp && AT.wp.forget) for (let d = e0.von; d <= e0.bis; d = AT.wp.addDays(d, 7)) AT.wp.forget(d), AT.wp.forget(e0.bis);
      } catch (e) { toast2(e.message); }
      paint();
    });
  }

  const prev = AT.modules.start.show;
  AT.modules.start.show = function () { paint(); if (navigator.onLine) load(); return prev.apply(this, arguments); };
})();
