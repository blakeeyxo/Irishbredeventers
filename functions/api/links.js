// External link cards for the right-hand column (e.g. Charlie's articles on other sites).
import { json } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, url, teaser, source_name, image_key, card_date FROM link_cards ORDER BY sort_order ASC, card_date DESC, id DESC LIMIT 100'
  ).all();
  return json({ links: results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
