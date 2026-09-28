// News posts, newest first.
import { json } from '../../lib/http.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, body, snippet, image_key, published_at FROM news ORDER BY published_at DESC, id DESC LIMIT 100'
  ).all();
  return json({ news: results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
