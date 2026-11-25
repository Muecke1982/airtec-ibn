// Alte Urlaubsliste (Excel „Airtec_Urlaub.xlsx“ neben den Stammdaten, Blatt „Urlaub“) – wird nur noch beim
// Import in die Datenbank gelesen (lib/import.js). Urlaub läuft heute über den Wochenplan (lib/urlaubplan.js).
//   Mitarbeiter | Von | Bis | Status | Arbeitstage | Eingegangen | Betreff | Im Wochenplan | Mail-ID | Hinweis
import { cfg, downloadTagged, upload } from "./graph.js";
import { openWorkbook } from "./xlsx.js";
import { VORLAGE } from "./urlaub-vorlage.js";

export function path(env) {
  return cfg(env, "SP_URLAUB_PATH", false) || cfg(env, "SP_STAMM_PATH").replace(/[^/]*$/, "") + "Airtec_Urlaub.xlsx";
}
const norm = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// Datum aus Zelle/Text → ISO (TT.MM.JJJJ, TT.MM.JJ, JJJJ-MM-TT oder Excel-Seriennummer)
function toIso(v) {
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  const n = +s;
  if (n > 30000 && n < 80000) return isoOf(new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5));
  return "";
}

// bytes: Excel-Datei direkt übergeben (Import), sonst aus SharePoint laden (fehlt sie, wird die leere Vorlage angelegt)
export async function load(env, bytes) {
  let f;
  try { f = bytes ? { bytes } : await downloadTagged(env, path(env)); }
  catch (e) {
    if (e.status !== 404) throw e;
    const p = path(env), folder = p.replace(/\/?[^/]*$/, ""), file = p.split("/").pop();
    await upload(env, folder, file, Uint8Array.from(atob(VORLAGE), c => c.charCodeAt(0)));
    f = await downloadTagged(env, p);
  }
  const wb = await openWorkbook(f.bytes);
  const rows = (await wb.rows("Urlaub")) || [];
  const v = (r, i) => String((r || [])[i] ?? "").trim();
  const list = rows.slice(1).map(r => ({
    name: v(r, 0), von: toIso(v(r, 1)), bis: toIso(v(r, 2)), status: norm(v(r, 3)) || "genehmigt", tage: v(r, 4),
    eingang: v(r, 5), betreff: v(r, 6), plan: v(r, 7), mid: v(r, 8), hinweis: v(r, 9),
  })).filter(r => r.name || r.von || r.mid);
  list.forEach(r => { r.id = idOf(r); });
  return { f, wb, list };
}
function idOf(r) {
  let h = 2166136261;
  for (const ch of `${r.mid}|${r.name}|${r.von}|${r.bis}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
