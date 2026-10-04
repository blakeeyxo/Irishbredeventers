// A horse's profile: the chosen placing plus every other run under the same name.
import { json, bad } from '../../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PUBLIC_SQL } from '../../../lib/results.js';

export async function onRequestGet({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return bad('Bad id');
  const horse = await env.DB.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN} WHERE p.id = ? AND ${PUBLIC_SQL}`).bind(id).first();
  if (!horse) return bad('Not found', 404);
  const runs = await env.DB.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN}
      WHERE p.horse_name = ?1 COLLATE NOCASE AND (?2 IS NULL OR p.foaled IS NULL OR p.foaled = ?2) AND ${PUBLIC_SQL}
      ORDER BY e.start_date DESC, p.id DESC LIMIT 500`).bind(horse.horse_name, horse.foaled).all();
  return json({ horse, runs: runs.results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
