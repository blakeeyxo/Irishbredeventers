// Published uploads. Each one can be renamed, opened to edit its results, or removed whole.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { deleteBatch, PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER } from '../../../lib/results.js';

export async function onRequestGet({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (id) {
    // One upload's results, for editing. Fixes are saved through /api/admin/unverified (any placing by id).
    const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS}, IFNULL(r.raw_line, '') AS raw_line, IFNULL(r.parse_ok, 1) AS parse_ok
      ${PLACING_JOIN} WHERE p.batch_id = ? ${PLACING_ORDER} LIMIT 2000`).bind(id).all();
    return json({ rows: results });
  }
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, label, row_count, unverified_count FROM batches ORDER BY id DESC LIMIT 100'
  ).all();
  return json({ batches: results });
}

// { id, label }: rename an upload.
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  const label = str(b && b.label, 120);
  if (!Number.isInteger(id) || !label) return bad('Give the upload a name.');
  await env.DB.prepare('UPDATE batches SET label = ? WHERE id = ?').bind(label, id).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return bad('Bad id');
  await deleteBatch(env.DB, id);
  return json({ ok: true });
}
