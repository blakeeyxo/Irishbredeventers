// Search horses (and former names), sires, dams, dam sires and breeders with SQLite FTS5. Riders are
// shown in the results but are not indexed, so they never match a search.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PUBLIC_SQL } from '../../lib/results.js';
import { siteFor } from '../../lib/sites.js';
import { sjSearch } from '../../lib/sj.js';

const FIELDS = {
  all: '',
  name: '{horse_name former_name}',
  sire: '{sire}',
  dam: '{dam dam_sire}',
  breeder: '{breeder}'
};
const LIMIT = 200;

export function ftsQuery(q, field) {
  const words = (q || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return null;
  const cols = FIELDS[field] ?? '';
  return words.slice(0, 8).map(w => `${cols ? cols + ' : ' : ''}"${w}"*`).join(' AND ');
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').slice(0, 100);
  if (siteFor(env).discipline === 'showjumping') {
    const r = env.SHARED ? await sjSearch(env.SHARED, q, url.searchParams.get('field') || 'all').catch(() => ({ total: 0, rows: [] })) : { total: 0, rows: [] };
    return json({ q, ...r }, { headers: { 'cache-control': 'public, max-age=60' } });
  }
  const match = ftsQuery(q, url.searchParams.get('field') || 'all');
  if (!match) return json({ q, total: 0, rows: [] });
  const [rows, count] = await Promise.all([
    env.DB.prepare(`SELECT ${PLACING_COLUMNS} FROM placings_fts f
        JOIN placings p ON p.id = f.rowid JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id
        LEFT JOIN results r ON r.id = p.result_id
      WHERE placings_fts MATCH ?1 AND ${PUBLIC_SQL}
      ORDER BY f.rank, e.start_date DESC LIMIT ${LIMIT}`).bind(match).all(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM placings_fts f JOIN placings p ON p.id = f.rowid WHERE placings_fts MATCH ?1 AND ${PUBLIC_SQL}`).bind(match).first()
  ]);
  return json({ q, total: count.n, rows: rows.results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
