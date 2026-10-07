// Owner area: visits, page views and advert clicks between two dates.
import { json, bad } from '../../../lib/http.js';

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url).searchParams;
  const to = isDay(u.get('to')) ? u.get('to') : new Date().toISOString().slice(0, 10);
  const from = isDay(u.get('from')) ? u.get('from') : new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  if (from > to) return bad('The start date is after the end date.');
  const q = (sql, ...b) => env.DB.prepare(sql).bind(from, to, ...b).all().then(r => r.results);
  const [totals, pages, ads, links, days] = await Promise.all([
    q(`SELECT kind, SUM(count) AS n FROM analytics WHERE day BETWEEN ? AND ? GROUP BY kind`),
    q(`SELECT key AS page, SUM(count) AS n FROM analytics WHERE day BETWEEN ? AND ? AND kind = 'view' GROUP BY key ORDER BY n DESC`),
    q(`SELECT a.key, SUM(a.count) AS n, ads.name, ads.link FROM analytics a
        LEFT JOIN ads ON ads.id = CAST(substr(a.key, 1, instr(a.key, '|') - 1) AS INTEGER)
       WHERE a.day BETWEEN ? AND ? AND a.kind = 'ad' GROUP BY a.key ORDER BY n DESC`),
    q(`SELECT a.key, SUM(a.count) AS n, l.title FROM analytics a LEFT JOIN link_cards l ON l.id = CAST(a.key AS INTEGER)
       WHERE a.day BETWEEN ? AND ? AND a.kind = 'link' GROUP BY a.key ORDER BY n DESC`),
    q(`SELECT day, SUM(CASE WHEN kind = 'visit' THEN count ELSE 0 END) AS visits, SUM(CASE WHEN kind = 'view' THEN count ELSE 0 END) AS views,
        SUM(CASE WHEN kind = 'ad' THEN count ELSE 0 END) AS ad_clicks FROM analytics WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`)
  ]);
  const t = Object.fromEntries(totals.map(r => [r.kind, r.n]));
  return json({ from, to, visits: t.visit || 0, views: t.view || 0, adClicks: t.ad || 0, linkClicks: t.link || 0,
    pages, ads: ads.map(a => ({ ...a, placement: a.key.split('|')[1] })), links, days });
}
