// One stallion listing and every result of its progeny (the page builds the breakdown from these rows).
import { json, bad } from '../../../lib/http.js';
import { progeny, summary } from '../../../lib/stallions.js';

export async function onRequestGet({ env, params }) {
  const slot = Number(params.slot);
  if (!(slot >= 1 && slot <= 6)) return bad('Not found', 404);
  const s = await env.DB.prepare(`SELECT slot, name, blurb, link, image_key, sire_names FROM stallions WHERE slot = ? AND name <> ''`).bind(slot).first();
  if (!s) return bad('Not found', 404);
  const rows = await progeny(env.DB, s.sire_names);
  const { sire_names, ...pub } = s;
  return json({ stallion: pub, totals: summary(rows), rows }, { headers: { 'cache-control': 'public, max-age=120' } });
}
