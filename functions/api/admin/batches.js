// Published uploads. Each one can be renamed, opened to edit its results, taken off the site and put back
// (unpublish / re-publish), or removed whole.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { deleteBatch, PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, DOUBT_SQL } from '../../../lib/results.js';

export async function onRequestGet({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (id) {
    // One upload's results, for editing. Fixes are saved through /api/admin/unverified (any placing by id).
    const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS}, IFNULL(r.raw_line, '') AS raw_line, IFNULL(r.parse_ok, 1) AS parse_ok,
      (SELECT COUNT(*) FROM results rr WHERE rr.event_id = e.id) AS event_results
      ${PLACING_JOIN} WHERE p.batch_id = ? ${PLACING_ORDER} LIMIT 2000`).bind(id).all();
    return json({ rows: results });
  }
  // Every upload with the events it holds, newest events first (so a late-loaded older week sits with its own
  // dates, not at the top).
  const { results } = await env.DB.prepare(`SELECT b.id, b.label, b.created_at, b.published,
      COUNT(p.id) AS results, SUM(CASE WHEN ${DOUBT_SQL} THEN 1 ELSE 0 END) AS held,
      MIN(e.start_date) AS first_date, MAX(COALESCE(NULLIF(e.end_date, ''), e.start_date)) AS last_date, CAST(SUBSTR(COALESCE(NULLIF(MAX(r.article_date), ''), MAX(e.start_date)), 1, 4) AS INTEGER) AS season,
      COUNT(DISTINCT e.id) AS events, GROUP_CONCAT(DISTINCT e.name) AS event_names,
      -- The week the upload covers: the article it came from, or else its latest event (a late result from an
      -- earlier event doesn't move it).
      COALESCE(NULLIF(MAX(r.article_date), ''), MAX(e.start_date)) AS week_date
    FROM batches b LEFT JOIN placings p ON p.batch_id = b.id LEFT JOIN results r ON r.id = p.result_id
      LEFT JOIN classes c ON c.id = p.class_id LEFT JOIN events e ON e.id = c.event_id
    GROUP BY b.id ORDER BY week_date IS NULL, week_date DESC, b.id DESC LIMIT 1000`).all();
  return json({ batches: results });
}

// { id, label }: rename an upload.  { id, published: true|false }: put it on the site or take it off.
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Bad id');
  if (b && typeof b.published === 'boolean') {
    await env.DB.prepare('UPDATE batches SET published = ? WHERE id = ?').bind(b.published ? 1 : 0, id).run();
    return json({ ok: true });
  }
  const label = str(b && b.label, 120);
  if (!label) return bad('Give the upload a name.');
  await env.DB.prepare('UPDATE batches SET label = ? WHERE id = ?').bind(label, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return bad('Bad id');
  await deleteBatch(env.DB, id);
  return json({ ok: true });
}
