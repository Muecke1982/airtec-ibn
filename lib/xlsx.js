// Minimaler Excel-Leser (.xlsx) für den Server: liefert die Zellwerte des ersten Tabellenblatts als Zeilen-Array.
// Eine .xlsx-Datei ist ein ZIP-Archiv mit XML-Dateien; entpackt wird mit der eingebauten DecompressionStream.

const dec = new TextDecoder();

async function inflate(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function unzip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Keine gültige Excel-Datei");
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    files[name] = { method, csize, off };
    p += 46 + nl + el + cl;
  }
  return async name => {
    const f = files[name]; if (!f) return null;
    const start = f.off + 30 + v.getUint16(f.off + 26, true) + v.getUint16(f.off + 28, true);
    const raw = buf.subarray(start, start + f.csize);
    return dec.decode(f.method === 0 ? raw : await inflate(raw));
  };
}

const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const map = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const texts = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => ent(m[1])).join("");
const colNum = ref => [...ref.replace(/\d+/g, "")].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readFirstSheet(bytes) {
  const get = await unzip(bytes);
  const shared = [];
  const ss = await get("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  // erstes Blatt laut workbook.xml (Reihenfolge der Reiter)
  let path = "xl/worksheets/sheet1.xml";
  const wb = await get("xl/workbook.xml"), rels = await get("xl/_rels/workbook.xml.rels");
  const first = wb && wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (first && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${first[1]}"`));
    const t = rel && rel.match(/Target="([^"]+)"/);
    if (t) path = t[1].startsWith("/") ? t[1].slice(1) : "xl/" + t[1].replace(/^\.\//, "");
  }
  const sheet = await get(path);
  if (!sheet) throw new Error("Tabellenblatt nicht gefunden");
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = rm[1].match(/\br="(\d+)"/);
    const ri = rn ? +rn[1] - 1 : rows.length;
    const row = [];
    for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || "";
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const vm = body.match(/<v>([\s\S]*?)<\/v>/);
      let val = "";
      if (t === "s") val = vm ? shared[+vm[1]] ?? "" : "";
      else if (t === "inlineStr") val = texts(body);
      else if (t === "b") val = vm && vm[1] === "1" ? "WAHR" : "FALSCH";
      else val = vm ? ent(vm[1]) : "";
      row[ref ? colNum(ref) : row.length] = val;
    }
    rows[ri] = Array.from(row, x => x ?? "");
  }
  return Array.from(rows, r => r || []);
}
