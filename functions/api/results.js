// Results for one season (default: the current calendar year), plus the list of seasons. Results with a real
// problem stay hidden until Charlie marks them verified.
// IBSR lists only the seasons that have results, and with latest=1 opens on the newest of them when the current year
// has none yet (its archive is uploaded a year at a time).
import { json } from '../../lib/http.js';
import { placingColumns, PLACING_JOIN, PLACING_ORDER, PUBLIC_SQL } from '../../lib/results.js';
import { siteFor } from '../../lib/sites.js';

export async function onRequestGet({ env, request }) {
  const site = siteFor(env), jumping = site.discipline === 'showjumping';
  const current = new Date().getFullYear();
  const params = new URL(request.url).searchParams;
  const { results: seasons } = await env.DB.prepare('SELECT DISTINCT season FROM events ORDER BY season DESC').all();
  const years = new Set(seasons.map(s => s.season));
  if (!jumping) years.add(current);
  let season = Number(params.get('season')) || current;
  if (jumping && params.get('latest') === '1' && !years.has(season) && years.size) season = Math.max(...years);
  const rows = await env.DB.prepare(`SELECT ${placingColumns(site)} ${PLACING_JOIN} WHERE e.season = ? AND ${PUBLIC_SQL} ${PLACING_ORDER}`).bind(season).all();
  return json({
    season,
    seasons: [...years].sort((a, b) => b - a),
    rows: rows.results
  }, { headers: { 'cache-control': 'public, max-age=60' } });
}
