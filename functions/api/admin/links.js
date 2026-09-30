// External link cards: add, edit, delete and re-order.
import { json, bad, str, text, readJson } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';
import { cleanUrl, cleanDate, saveOrder } from '../../../lib/content.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, url, teaser, source_name, image_key, card_date, sort_order FROM link_cards ORDER BY sort_order ASC, card_date DESC, id DESC'
  ).all();
  return json({ links: results });
}

export async function onRequestPost({ env, request }) {
  if ((request.headers.get('content-type') || '').includes('application/json')) {
    const b = await readJson(request);
    await saveOrder(env.DB, 'link_cards', b && b.order);
    return json({ ok: true });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const id = Number(form.get('id')) || null;
  const title = str(form.get('title'), 200);
  if (!title) return bad('Add a headline.');
  let url, date;
  try { url = cleanUrl(form.get('url'), true); date = cleanDate(form.get('date')); } catch (e) { return bad(e.message); }
  const teaser = text(form.get('teaser'), 400);
  const sourceName = str(form.get('source_name'), 120);
  let imageKey = null;
  try { imageKey = await saveImage(env, form.get('image'), 'links'); } catch (e) { return bad(e.message); }

  if (id) {
    const old = await env.DB.prepare('SELECT image_key FROM link_cards WHERE id = ?').bind(id).first();
    if (!old) return bad('Not found', 404);
    const newKey = imageKey || (form.get('remove_image') === '1' ? null : old.image_key);
    await env.DB.prepare('UPDATE link_cards SET title = ?, url = ?, teaser = ?, source_name = ?, image_key = ?, card_date = ? WHERE id = ?')
      .bind(title, url, teaser, sourceName, newKey, date, id).run();
    if (old.image_key && old.image_key !== newKey) await env.MEDIA.delete(old.image_key);
  } else {
    await env.DB.prepare(`INSERT INTO link_cards (title, url, teaser, source_name, image_key, card_date, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, (SELECT IFNULL(MIN(sort_order), 1) - 1 FROM link_cards))`)
      .bind(title, url, teaser, sourceName, imageKey, date).run();
  }
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM link_cards WHERE id = ? RETURNING image_key').bind(id).first();
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  return json({ ok: true });
}
