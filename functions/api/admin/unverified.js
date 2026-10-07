// Rows for Charlie to check: only real problems (misread, conflicting, marked not verified). They are hidden from
// the public site until he fixes them and marks them verified. A gap in the breeding is not a problem: it shows
// on the site as OIO / UNK and is not listed here.
import { json, bad, readJson, str } from '../../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, TO_CHECK_SQL, refreshBatchCounts, renameEvent, moveResult } from '../../../lib/results.js';
import { problemsFor } from '../../../lib/checks.js';

const EDITABLE = ['horse_name', 'former_name', 'breed', 'sex', 'sire', 'dam', 'dam_sire', 'breeder', 'dressage', 'show_jumping', 'cross_country'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT ${PLACING_COLUMNS}, IFNULL(r.raw_line, '') AS raw_line, IFNULL(r.parse_ok, 1) AS parse_ok,
      IFNULL(r.article_url, '') AS article_url,
      (SELECT COUNT(*) FROM results rr WHERE rr.event_id = e.id) AS event_results ${PLACING_JOIN} WHERE ${TO_CHECK_SQL} ${PLACING_ORDER} LIMIT 1000`).all();
  // Each row says what is wrong with it, in plain words.
  // Events with no name in the article (placeholder events), so the owner can name them in one go.
  const { results: placeholders } = await env.DB.prepare(`SELECT e.id, e.name, e.start_date, COUNT(r.id) AS results,
      (SELECT GROUP_CONCAT(DISTINCT r2.class_name) FROM results r2 WHERE r2.event_id = e.id) AS classes
    FROM events e JOIN results r ON r.event_id = e.id WHERE e.name LIKE 'Event heading missing%' GROUP BY e.id`).all();
  // The same horse, class and score listed under two events that run on the same dates: one of them is misfiled.
  const { results: duplicates } = await env.DB.prepare(`SELECT p1.id AS id1, e1.name AS event1, e1.country AS country1, p2.id AS id2, e2.name AS event2, e2.country AS country2,
      p1.horse_name, c1.name AS class_name, p1.position, p1.score
    FROM placings p1 JOIN classes c1 ON c1.id = p1.class_id JOIN events e1 ON e1.id = c1.event_id
    JOIN placings p2 ON p2.id > p1.id AND p2.horse_name = p1.horse_name AND IFNULL(p2.score, -1) = IFNULL(p1.score, -1) AND p2.position IS p1.position
    JOIN classes c2 ON c2.id = p2.class_id AND c2.name = c1.name JOIN events e2 ON e2.id = c2.event_id
    WHERE e1.id <> e2.id AND e1.start_date <= IFNULL(e2.end_date, e2.start_date) AND e2.start_date <= IFNULL(e1.end_date, e1.start_date) LIMIT 200`).all();
  return json({ rows: results.map(r => ({ ...r, problems: problemsFor(r) })), placeholders, duplicates });
}

// { id, fields: {...}, verify: true|false }  or  { id, remove: true }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  // Name the event for results the article gave no event for: { eventFix: { id, name, start_date, end_date, country } }
  if (b && b.eventFix) {
    try { return json({ ok: true, ...(await renameEvent(env.DB, Number(b.eventFix.id), b.eventFix)) }); } catch (e) { return bad(e.message); }
  }
  // Move one result to the right event / country: { moveResult: { id (the placing), name, country, start_date, end_date } }
  if (b && b.moveResult) {
    try { return json({ ok: true, ...(await moveResult(env.DB, Number(b.moveResult.id), b.moveResult)) }); } catch (e) { return bad(e.message); }
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
