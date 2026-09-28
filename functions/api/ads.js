// Live ads. Ads past their end date drop off automatically.
import { json, today } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, tier, name, link, image_key FROM ads
     WHERE ends_on IS NULL OR ends_on = '' OR ends_on >= ? ORDER BY created_at DESC, id DESC`
  ).bind(today()).all();
  return json({
    large: results.filter(a => a.tier === 'large'),
    small: results.filter(a => a.tier === 'small')
  }, { headers: { 'cache-control': 'public, max-age=120' } });
}
