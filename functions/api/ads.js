// Live ads: started, and not past their end date. Side-box ads carry their booked slot.
import { json, today } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  const d = today();
  const { results } = await env.DB.prepare(
    `SELECT id, tier, name, link, image_key, slot FROM ads
     WHERE (ends_on IS NULL OR ends_on = '' OR ends_on >= ?1) AND (starts_on IS NULL OR starts_on = '' OR starts_on <= ?1)
     ORDER BY created_at DESC, id DESC`
  ).bind(d).all();
  return json({
    large: results.filter(a => a.tier === 'large'),
    small: results.filter(a => a.tier === 'small')
  }, { headers: { 'cache-control': 'public, max-age=120' } });
}
