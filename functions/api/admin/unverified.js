// Rows for Charlie to check: only real problems (misread, conflicting, marked not verified). They are hidden from
// the public site until he fixes them and marks them verified. A gap in the breeding is not a problem: it shows
// on the site as OIO / UNK and is not listed here.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, TO_CHECK_SQL, refreshBatchCounts } from '../../../lib/results.js';
import { problemsFor } from '../../../lib/checks.js';

const EDITABLE = ['horse_name', 'former_name', 'breed', 'sex', 'sire', 'dam', 'dam_sire', 'breeder', 'dressage', 'show_jumping', 'cross_country'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS}, IFNULL(r.raw_line, '') AS raw_line, IFNULL(r.parse_ok, 1) AS parse_ok,
      IFNULL(r.article_url, '') AS article_url ${PLACING_JOIN} WHERE ${TO_CHECK_SQL} ${PLACING_ORDER} LIMIT 1000`).all();
  // Each row says what is wrong with it, in plain words.
  return json({ rows: results.map(r => ({ ...r, problems: problemsFor(r) })) });
}

// { id, fields: {...}, verify: true|false }  or  { id, remove: true }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Bad id');
  const row = await env.DB.prepare('SELECT batch_id, result_id FROM placings WHERE id = ?').bind(id).first();
  if (!row) return bad('Not found', 404);

  if (b.remove) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM placings WHERE id = ?').bind(id),
      env.DB.prepare('DELETE FROM results WHERE id = ?').bind(row.result_id)
    ]);
  } else {
    if (b.verify && row.result_id) await env.DB.prepare('UPDATE results SET verified = 1 WHERE id = ?').bind(row.result_id).run();
    const f = b.fields || {};
    const sets = [], vals = [];
    for (const k of EDITABLE) if (k in f) { sets.push(`${k} = ?`); vals.push(str(f[k], 240)); }
    if ('position' in f) { sets.push('position = ?'); vals.push(Number(f.position) || null); }
    if ('foaled' in f) { sets.push('foaled = ?'); vals.push(Number(f.foaled) || null); }
    if ('score' in f) { sets.push('score = ?'); vals.push(f.score === '' ? null : Number(f.score)); }
    if (b.verify) sets.push('verified = 1');
    if (sets.length) await env.DB.prepare(`UPDATE placings SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  }
  await refreshBatchCounts(env.DB, row.batch_id);
  return json({ ok: true });
}
