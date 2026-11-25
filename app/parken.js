/* Airtec App – Protokolle „parken“.
   Ein angefangenes IBN-/Abnahmeprotokoll oder Schnellaufmaß wird samt Fotos und Unterschriften auf dem Handy
   beiseitegelegt (IndexedDB „airtec-park“), damit man ein anderes ausfüllen und später weitermachen kann –
   z. B. bei einer großen IBN erst alle Außengeräte, dann alle Innengeräte. Geparkte Protokolle bleiben nur
   auf diesem Gerät. Nutzt die globalen S, photos, pickDoc, blank, save, init, ask, toast, esc, DOCS, TYPES. */
(function () {
  const AT = window.AT;
  const ESC = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- Speicher ---------- */
  const db = () => new Promise((res, rej) => {
    const q = indexedDB.open("airtec-park", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("p", { keyPath: "id", autoIncrement: true });
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction("p", mode); const rq = fn(t.objectStore("p"));
      t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
    });
  }
  const alle = async () => ((await tx("readonly", st => st.getAll())) || []).sort((a, b) => b.ts - a.ts);
  const holen = id => tx("readonly", st => st.get(id));
  const weg = id => tx("readwrite", st => st.delete(id));
  const ablegen = x => tx("readwrite", st => st.add(x));
  let anzahl = 0;

  /* ---------- Was liegt gerade offen? ---------- */
  const aufm = () => AT.aufmass && AT.aufmass.stand ? AT.aufmass.stand() : null;
  function protHatInhalt() {
    if (S.bv || S.kom || S.type || photos.length) return true;
    const a = S.a || {};
    return Object.keys(a).some(k => k !== "gewerk" && a[k]);
  }
  function aufmHatInhalt() { const A = aufm(); return !!(A && (A.bv || A.bereich || (A.pos || []).length)); }
  const offenIst = () => S.docOk && S.doc === "aufm" ? (aufmHatInhalt() ? "aufm" : null) : (S.docOk && S.doc && protHatInhalt() ? S.doc : null);

  function titelVon(doc, s, A) {
    if (doc === "aufm") return { titel: (A.bv || "ohne Bauvorhaben"), sub: "Schnellaufmaß" + (A.bereich ? " · " + A.bereich : "") + ((A.pos || []).length ? " · " + A.pos.length + " Pos." : "") };
    const teile = [DOCS[doc] || "Protokoll"];
    if (doc === "ibn" && s.type && TYPES[s.type]) teile.push(TYPES[s.type].label);
    if (s.kom) teile.push(s.kom);
    return { titel: (s.bv || "ohne Bauvorhaben"), sub: teile.join(" · ") };
  }

  /* aktuelles Dokument beiseitelegen und leeren; gibt den Titel zurück */
  async function parkeAktuelles() {
    const doc = offenIst(); if (!doc) return null;
    let x;
    if (doc === "aufm") {
      const A = JSON.parse(JSON.stringify(aufm()));
      x = Object.assign({ ts: Date.now(), doc, A }, titelVon(doc, null, A));
      await ablegen(x);
      AT.aufmass.leeren();
    } else {
      const s = JSON.parse(JSON.stringify(S));
      x = Object.assign({ ts: Date.now(), doc, S: s, photos: photos.map(p => Object.assign({}, p)) }, titelVon(doc, s));
      await ablegen(x);
      S = blank(); photos = []; save();
    }
    pickDoc = null; S.docOk = false; save(); init(); window.scrollTo(0, 0);
    return x.titel;
  }

  async function fortsetzen(id) {
    const x = await holen(id); if (!x) { toast("Nicht mehr vorhanden"); await zeichnen(); return; }
    if (offenIst()) {
      const t = titelVon(offenIst(), S, aufm() || {}).titel;
      if (!await ask("Aktuelles Protokoll parken?", `<p style="font-size:15px">„${ESC(t)}“ ist noch offen. Es wird geparkt, damit nichts verloren geht.</p>`, "Parken & weiter")) return;
      await parkeAktuelles();
    }
    if (x.doc === "aufm") {
      AT.aufmass.setzen(x.A);
      S.doc = "aufm"; S.docOk = true;
    } else {
      S = Object.assign(blank(), x.S); photos = x.photos || [];
      S.doc = x.doc; S.docOk = true;
    }
    save(); await weg(id); init(); window.scrollTo(0, 0);
    toast("Weiter mit: " + x.titel);
    zeichnen();
  }

  /* ---------- Ansicht ---------- */
  const css = document.createElement("style");
  css.textContent = `
  .pkl{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
  .pkl h3{margin:0 0 8px;font-size:15px}
  .pki{display:flex;align-items:center;gap:8px;border:1.5px solid var(--line);border-radius:12px;padding:10px 10px 10px 12px;margin-bottom:8px;background:#fff}
  .pki div{flex:1;min-width:0}
  .pki b{display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pki small{display:block;color:var(--mut);font-size:12.5px}
  .pki .go{border:0;background:var(--blue,#009ED5);color:#fff;border-radius:10px;padding:9px 12px;font:inherit;font-weight:700}
  .pki .x{border:0;background:none;color:var(--mut);font-size:20px;padding:4px 6px}
  #parkChip{margin:0 8px 0 auto;white-space:nowrap;padding:8px 10px!important}
  #btnPark{white-space:nowrap}
  #docBar>div{min-width:0;margin-right:8px}
  #docBar>div b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  document.head.appendChild(css);

  const liste = document.createElement("div");
  liste.className = "pkl hide"; liste.id = "parkListe";
  document.getElementById("docGo").after(liste);

  const sheet = document.createElement("div");
  sheet.className = "modal"; sheet.id = "mPark";
  sheet.innerHTML = `<div class="box"><h3>🅿 Geparkte Protokolle</h3><div class="hint" style="margin-top:0">Nur auf diesem Handy gespeichert.</div><div id="parkSheetL" style="margin-top:12px"></div><div class="btns"><button class="secondary" id="parkZu">Schließen</button></div></div>`;
  document.body.appendChild(sheet);
  sheet.onclick = e => { if (e.target === sheet) sheet.classList.remove("show"); };
  sheet.querySelector("#parkZu").onclick = () => sheet.classList.remove("show");

  const chip = document.createElement("button");
  chip.id = "parkChip"; chip.className = "hide";
  const docChange = document.getElementById("docChange");
  docChange.before(chip);
  chip.onclick = () => { sheet.classList.add("show"); };

  const wann = ts => {
    const d = new Date(ts), h = new Date();
    const zeit = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === h.toDateString()) return "heute " + zeit;
    h.setDate(h.getDate() - 1);
    if (d.toDateString() === h.toDateString()) return "gestern " + zeit;
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) + " " + zeit;
  };
  const zeile = x => `<div class="pki"><div><b>${ESC(x.titel)}</b><small>${ESC(x.sub)} · geparkt ${wann(x.ts)}${x.photos && x.photos.length ? " · " + x.photos.length + " Foto" + (x.photos.length > 1 ? "s" : "") : ""}</small></div><button class="go" data-go="${x.id}">Weiter</button><button class="x" data-del="${x.id}" aria-label="Löschen">×</button></div>`;

  async function zeichnen() {
    let L = [];
    try { L = await alle(); } catch (e) { }
    anzahl = L.length;
    const html = L.map(zeile).join("");
    liste.innerHTML = L.length ? `<h3>🅿 Geparkt – hier weitermachen</h3>${html}` : "";
    liste.classList.toggle("hide", !L.length);
    sheet.querySelector("#parkSheetL").innerHTML = html || `<div class="hint">Nichts geparkt.</div>`;
    chip.textContent = "🅿 " + L.length + " geparkt";
    chip.classList.toggle("hide", !L.length);
    if (!L.length) sheet.classList.remove("show");
    [liste, sheet].forEach(el => {
      el.querySelectorAll("[data-go]").forEach(b => b.onclick = () => { sheet.classList.remove("show"); fortsetzen(+b.dataset.go); });
      el.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
        const x = L.find(y => y.id === +b.dataset.del); if (!x) return;
        sheet.classList.remove("show");
        if (await ask("Geparktes Protokoll löschen?", `<p style="font-size:15px">„${ESC(x.titel)}“ (${ESC(x.sub)}) wird mit allen Eingaben und Fotos gelöscht.</p>`, "Löschen")) { await weg(x.id); toast("Gelöscht"); }
        zeichnen();
      });
    });
  }

  /* ---------- Knopf in der unteren Leiste ---------- */
  const btn = document.createElement("button");
  btn.className = "secondary"; btn.id = "btnPark"; btn.textContent = "🅿 Parken";
  document.getElementById("btnNew").after(btn);
  btn.onclick = async () => {
    if (!offenIst()) { toast("Noch nichts eingetragen – nichts zu parken"); return; }
    try {
      const t = await parkeAktuelles();
      toast("Geparkt: " + t);
    } catch (e) { toast("Parken fehlgeschlagen: " + (e.message || e)); }
    zeichnen();
  };

  // Reiter „Protokolle“ verlassen, während ein Protokoll/Aufmaß offen ist → „Parken?“
  if (AT.wache) AT.wache("protokolle", () => {
    const doc = offenIst(); if (!doc) return null;
    const t = titelVon(doc, S, aufm() || {});
    return { titel: "Protokoll parken?", text: `<p>„<b>${ESC(t.titel)}</b>“ (${ESC(t.sub)}) ist noch offen.</p><p style="font-size:14px;color:var(--mut)">Parken legt es mit Fotos auf diesem Handy beiseite – unter „Geparkt“ geht es später weiter. Ohne Parken bleibt es hier geöffnet.</p>`,
      ja: "🅿 Parken", nein: "Nicht parken", tun: async () => { const n = await parkeAktuelles(); if (n) toast("Geparkt: " + n); zeichnen(); } };
  });

  AT.parken = { zeichnen, alle, anzahl: () => anzahl };
  zeichnen();
})();
