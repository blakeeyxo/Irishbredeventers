// Rows for Charlie to check: only real problems (misread, conflicting, marked not verified). They are hidden from
// the public site until he fixes them and marks them verified. A gap in the breeding is not a problem: it shows
// on the site as OIO / UNK and is not listed here.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, TO_CHECK_SQL, refreshBatchCounts, renameEvent } from '../../../lib/results.js';
import { problemsFor } from '../../../lib/checks.js';

const EDITABLE = ['horse_name', 'former_name', 'breed', 'sex', 'sire', 'dam', 'dam_sire', 'breeder', 'dressage', 'show_jumping', 'cross_country'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS}, IFNULL(r.raw_line, '') AS raw_line, IFNULL(r.parse_ok, 1) AS parse_ok,
      IFNULL(r.article_url, '') AS article_url ${PLACING_JOIN} WHERE ${TO_CHECK_SQL} ${PLACING_ORDER} LIMIT 1000`).all();
  // Each row says what is wrong with it, in plain words.
  // Events with no name in the article (placeholder events), so the owner can name them in one go.
  const { results: placeholders } = await env.DB.prepare(`SELECT e.id, e.name, e.start_date, COUNT(r.id) AS results,
      (SELECT GROUP_CONCAT(DISTINCT r2.class_name) FROM results r2 WHERE r2.event_id = e.id) AS classes
    FROM events e JOIN results r ON r.event_id = e.id WHERE e.name LIKE 'Event heading missing%' GROUP BY e.id`).all();
  return json({ rows: results.map(r => ({ ...r, problems: problemsFor(r) })), placeholders });
}

// { id, fields: {...}, verify: true|false }  or  { id, remove: true }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  // Name the event for results the article gave no event for: { eventFix: { id, name, start_date, end_date, country } }
  if (b && b.eventFix) {
    try { return json({ ok: true, ...(await renameEvent(env.DB, Number(b.eventFix.id), b.eventFix)) }); } catch (e) { return bad(e.message); }
  }
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
