// Results for one season (default: the current calendar year), plus the list of seasons. Results with a real
// problem stay hidden until Charlie marks them verified.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, PUBLIC_SQL } from '../../lib/results.js';
import { siteFor } from '../../lib/sites.js';
import { sjSeason } from '../../lib/sj.js';

export async function onRequestGet({ env, request }) {
  const current = new Date().getFullYear();
  const season = Number(new URL(request.url).searchParams.get('season')) || current;
  // Showjumping results live in the shared database (pasted from FEI pages).
  if (siteFor(env).discipline === 'showjumping') {
    const sj = env.SHARED ? await sjSeason(env.SHARED, season).catch(() => ({ rows: [], seasons: [] })) : { rows: [], seasons: [] };
    const years = new Set([...sj.seasons, current]);
    return json({ season, seasons: [...years].sort((a, b) => b - a), rows: sj.rows }, { headers: { 'cache-control': 'public, max-age=60' } });
  }
  const [rows, seasons] = await Promise.all([
    env.DB.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN} WHERE e.season = ? AND ${PUBLIC_SQL} ${PLACING_ORDER}`).bind(season).all(),
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
