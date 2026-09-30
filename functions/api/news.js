// News articles in Charlie's chosen order (newest first unless he re-orders them).
import { json } from '../../lib/http.js';

export const NEWS_ORDER = 'ORDER BY sort_order ASC, published_at DESC, id DESC';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, body, snippet, image_key, published_at, source_url, source_name FROM news ${NEWS_ORDER} LIMIT 100`
  ).all();
  return json({ news: results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
