// News articles: add, edit, delete and re-order. The top article is the home page commentary.
import { json, bad, str, text, readJson } from '../../../lib/http.js';
import { saveImage, savePhoneImage, phoneKeyOf } from '../../../lib/images.js';
import { cleanUrl, cleanDate, snippetOf, saveOrder } from '../../../lib/content.js';
import { NEWS_ORDER } from '../news.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, body, snippet, image_key, published_at, source_url, source_name, sort_order FROM news ${NEWS_ORDER} LIMIT 300`
  ).all();
  return json({ news: results });
}

// Multipart form: create (no id) or update (id). JSON { order: [ids] } saves a new order.
export async function onRequestPost({ env, request }) {
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const b = await readJson(request);
    await saveOrder(env.DB, 'news', b && b.order);
    return json({ ok: true });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const id = Number(form.get('id')) || null;
  const title = str(form.get('title'), 200);
  const body = text(form.get('body'), 50000);
  if (!title || !body) return bad('Add a headline and the article text.');
  let sourceUrl, date;
  try { sourceUrl = cleanUrl(form.get('source_url'), false); date = cleanDate(form.get('date')); } catch (e) { return bad(e.message); }
  const sourceName = str(form.get('source_name'), 120);
  let imageKey = null;
  try { imageKey = await saveImage(env, form.get('image'), 'news'); await savePhoneImage(env, imageKey, form.get('image_phone')); } catch (e) { return bad(e.message); }
  const publishedAt = date ? `${date} 12:00:00` : null;

  if (id) {
    const old = await env.DB.prepare('SELECT image_key FROM news WHERE id = ?').bind(id).first();
    if (!old) return bad('Not found', 404);
    const removeImage = form.get('remove_image') === '1';
    const newKey = imageKey || (removeImage ? null : old.image_key);
    await env.DB.prepare(`UPDATE news SET title = ?, body = ?, snippet = ?, image_key = ?, source_url = ?, source_name = ?,
        published_at = COALESCE(?, published_at) WHERE id = ?`)
      .bind(title, body, snippetOf(body), newKey, sourceUrl, sourceName, publishedAt, id).run();
    if (old.image_key && old.image_key !== newKey) await env.MEDIA.delete([old.image_key, phoneKeyOf(old.image_key)]);
  } else {
    // New articles go to the top of the list.
    await env.DB.prepare(`INSERT INTO news (title, body, snippet, image_key, source_url, source_name, published_at, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), (SELECT IFNULL(MIN(sort_order), 1) - 1 FROM news))`)
      .bind(title, body, snippetOf(body), imageKey, sourceUrl, sourceName, publishedAt).run();
  }
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM news WHERE id = ? RETURNING image_key').bind(id).first();
  if (row && row.image_key) await env.MEDIA.delete([row.image_key, phoneKeyOf(row.image_key)]);
  return json({ ok: true });
}
