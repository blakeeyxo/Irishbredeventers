// News posts. The newest one becomes the home page headline.
import { json, bad, str, text } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT id, title, snippet, image_key, published_at FROM news ORDER BY published_at DESC, id DESC LIMIT 200').all();
  return json({ news: results });
}

export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const title = str(form.get('title'), 160);
  const body = text(form.get('body'), 20000);
  if (!title || !body) return bad('Add a headline and the write-up.');
  const flat = body.replace(/\s+/g, ' ');
  const snippet = flat.length > 220 ? flat.slice(0, 220).replace(/\s+\S*$/, '') + '…' : flat;
  let imageKey = null;
  try { imageKey = await saveImage(env, form.get('image'), 'news'); } catch (e) { return bad(e.message); }
  await env.DB.prepare('INSERT INTO news (title, body, snippet, image_key) VALUES (?, ?, ?, ?)').bind(title, body, snippet, imageKey).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM news WHERE id = ? RETURNING image_key').bind(id).first();
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  return json({ ok: true });
}
