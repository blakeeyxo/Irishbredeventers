// Results for one season (default: the current calendar year), plus the list of seasons.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER } from '../../lib/results.js';

export async function onRequestGet({ env, request }) {
  const current = new Date().getFullYear();
  const season = Number(new URL(request.url).searchParams.get('season')) || current;
  const [rows, seasons] = await Promise.all([
    env.DB.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN} WHERE e.season = ? ${PLACING_ORDER}`).bind(season).all(),
    env.DB.prepare('SELECT DISTINCT season FROM events ORDER BY season DESC').all()
  ]);
  const years = new Set(seasons.results.map(s => s.season));
  years.add(current);
  return json({
    season,
    seasons: [...years].sort((a, b) => b - a),
    rows: rows.results
  }, { headers: { 'cache-control': 'public, max-age=60' } });
}
