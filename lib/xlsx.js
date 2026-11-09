// Minimaler Excel-Leser/-Schreiber (.xlsx) für den Server.
// Eine .xlsx-Datei ist ein ZIP-Archiv mit XML-Dateien. Gelesen wird jedes Blatt als Zeilen-Array.
// Beim Schreiben wird nur der Zeileninhalt EINES Blatts ersetzt (ab Zeile 2, Kopfzeile bleibt mit Formatierung),
// alle anderen Teile der Datei bleiben Byte für Byte erhalten.

const dec = new TextDecoder(), encT = new TextEncoder();

async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const inflate = b => pipe(b, new DecompressionStream("deflate-raw"));
const deflate = b => pipe(b, new CompressionStream("deflate-raw"));

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function parseZip(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Keine gültige Excel-Datei");
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const list = [];
  for (let k = 0; k < n; k++) {
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    list.push({
      name: dec.decode(buf.subarray(p + 46, p + 46 + nl)),
      method: v.getUint16(p + 10, true), time: v.getUint16(p + 12, true), date: v.getUint16(p + 14, true),
      crc: v.getUint32(p + 16, true), csize: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true),
      raw: buf.subarray(start, start + v.getUint32(p + 20, true)),
    });
    p += 46 + nl + el + cl;
  }
  return list;
}

function buildZip(entries) {
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = encT.encode(e.name);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, e.method, true);
    h.setUint16(10, e.time, true); h.setUint16(12, e.date, true); h.setUint32(14, e.crc, true);
    h.setUint32(18, e.csize, true); h.setUint32(22, e.usize, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, e.raw);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, e.method, true);
    c.setUint16(12, e.time, true); c.setUint16(14, e.date, true); c.setUint32(16, e.crc, true);
    c.setUint32(20, e.csize, true); c.setUint32(24, e.usize, true); c.setUint16(28, name.length, true);
    c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + e.raw.length;
  }
  const csize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

const ent = s => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const map = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  if (map[e.toLowerCase()]) return map[e.toLowerCase()];
  return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const xesc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const texts = xml => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => ent(m[1])).join("");
const colNum = ref => [...ref.replace(/\d+/g, "")].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const colName = n => { let s = ""; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

export async function openWorkbook(bytes) {
  const entries = parseZip(bytes);
  const byName = Object.fromEntries(entries.map(e => [e.name, e]));
  const text = async name => { const e = byName[name]; if (!e) return null; return dec.decode(e.method === 0 ? e.raw : await inflate(e.raw)); };
  const shared = [];
  const ss = await text("xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));
  const wb = await text("xl/workbook.xml") || "", rels = await text("xl/_rels/workbook.xml.rels") || "";
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const tag = m[0];
    const name = ent((tag.match(/\bname="([^"]*)"/) || [])[1] || "");
    const rid = (tag.match(/\br:id="([^"]+)"/) || [])[1];
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(x => x[0]).find(r => r.includes(`Id="${rid}"`));
    const t = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    return { name, path: t ? (t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "")) : "" };
  });
  const changed = {};
  const find = name => name === undefined ? sheets[0] : sheets.find(s => s.name.toLowerCase() === String(name).toLowerCase());

  return {
    sheets: sheets.map(s => s.name),
    async rows(name) {
      const sh = find(name); if (!sh) return null;
      const xml = changed[sh.path] || await text(sh.path); if (!xml) return null;
      const rows = [];
      for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
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
    },
    // Ersetzt alle Zeilen ab Zeile 2 eines Blatts durch `data` (Array von Arrays mit Text)
    async setBody(name, data) {
      const sh = find(name); if (!sh) throw new Error(`Tabellenblatt „${name}“ fehlt`);
      let xml = changed[sh.path] || await text(sh.path);
      const m = xml.match(/<sheetData\s*\/>|<sheetData>([\s\S]*?)<\/sheetData>/);
      if (!m) throw new Error("Tabellenblatt hat unerwarteten Aufbau");
      const first = m[1] ? (m[1].match(/<row\b[^>]*\br="1"[\s\S]*?(?:<\/row>|\/>)/) || [""])[0] : "";
      const body = data.map((r, i) => `<row r="${i + 2}">` + r.map((v, c) => v === "" || v == null ? "" :
        `<c r="${colName(c)}${i + 2}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`).join("") + "</row>").join("");
      xml = xml.replace(m[0], `<sheetData>${first}${body}</sheetData>`).replace(/<dimension\b[^>]*\/>/, "");
      changed[sh.path] = xml;
    },
    async toBytes() {
      const out = [];
      for (const e of entries) {
        if (!changed[e.name]) { out.push(e); continue; }
        const u = encT.encode(changed[e.name]);
        const raw = await deflate(u);
        out.push({ ...e, method: 8, crc: crc32(u), usize: u.length, csize: raw.length, raw });
      }
      return buildZip(out);
    },
  };
}

// Kurzform: erstes Blatt als Zeilen
export async function readFirstSheet(bytes) {
  return (await openWorkbook(bytes)).rows();
}
