// Nachbildung der Cloudflare-D1-Schnittstelle mit SQLite aus Node.js (node:sqlite) – nur für lokale Tests.
import { DatabaseSync } from "node:sqlite";

export function fakeD1(file = ":memory:") {
  const sql = new DatabaseSync(file);
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    _run() { return sql.prepare(q).run(...args); },
    async all() { return { results: sql.prepare(q).all(...args) }; },
    async first() { return sql.prepare(q).get(...args) ?? null; },
    async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return {
    prepare: q => stmt(q),
    async batch(list) {
      sql.exec("BEGIN");
      try {
        const out = list.map(s => { const r = s._run(); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; });   // wie D1
        sql.exec("COMMIT");
        return out;
      } catch (e) { sql.exec("ROLLBACK"); throw e; }
    },
    _sql: sql,
  };
}
