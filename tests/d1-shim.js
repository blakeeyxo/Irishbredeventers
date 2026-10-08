// A small stand-in for a Cloudflare D1 database, on Node's built-in SQLite, for tests only.
// Runs the real migration files; batch() is all-or-nothing like D1's.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function memoryD1(migrationsDir) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  if (migrationsDir) {
    for (const f of readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, migrationsDir), 'utf8'));
  }
  const norm = v => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const prep = sql => {
    const stmt = { sql, args: [] };
    stmt.bind = (...args) => ({ ...stmt, args: args.map(norm), bind: stmt.bind });
    const run = s => raw.prepare(s.sql);
    stmt.first = function () { return Promise.resolve(run(this).get(...this.args) ?? null); };
    stmt.all = function () { return Promise.resolve({ results: run(this).all(...this.args) }); };
    stmt.run = function () { const r = run(this).run(...this.args); return Promise.resolve({ meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }); };
    stmt.bind = function (...args) { const b = Object.create(this); b.args = args.map(norm); return b; };
    return stmt;
  };
  return {
    raw,
    prepare: prep,
    async batch(stmts) {
      raw.exec('BEGIN');
      try {
        const out = stmts.map(s => {
          const p = raw.prepare(s.sql);
          return /^\s*(select|with)/i.test(s.sql) ? { results: p.all(...s.args) } : (p.run(...s.args), { results: [] });
        });
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    }
  };
}
