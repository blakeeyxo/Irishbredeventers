// Live adverts (started and not past their end date), each in its page slot. The page shows the newest
// advert for each slot; a slot with none shows an "available" box.
import { json, today } from '../../lib/http.js';
import { PAGES, POSITIONS } from '../../lib/slots.js';

export async function onRequestGet({ env }) {
  const d = today();
  const { results } = await env.DB.prepare(
    `SELECT id, placement, name, link, image_key, phone_key, fit, focus, bg FROM ads
     WHERE placement IS NOT NULL
       AND (ends_on IS NULL OR ends_on = '' OR ends_on >= ?1) AND (starts_on IS NULL OR starts_on = '' OR starts_on <= ?1)
     ORDER BY created_at DESC, id DESC`
  ).bind(d).all();
  const bySlot = {};
  for (const ad of results) if (!bySlot[ad.placement]) bySlot[ad.placement] = ad;
  return json({ slots: bySlot, pages: PAGES, positions: POSITIONS }, { headers: { 'cache-control': 'public, max-age=60' } });
}
