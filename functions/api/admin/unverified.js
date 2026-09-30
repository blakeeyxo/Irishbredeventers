// Unverified rows: fix the details, then "Mark as verified" moves them up into their class.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, refreshBatchCounts } from '../../../lib/results.js';

const EDITABLE = ['horse_name', 'former_name', 'breed', 'sex', 'sire', 'dam', 'dam_sire', 'breeder', 'dressage', 'show_jumping', 'cross_country'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN} WHERE p.verified = 0 ${PLACING_ORDER} LIMIT 1000`).all();
  return json({ rows: results });
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
