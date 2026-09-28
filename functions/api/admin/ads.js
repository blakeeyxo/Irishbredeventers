// Ads: large business (top banner) and small breeder or business (side and end-of-results slots).
import { json, bad, str } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT id, tier, name, link, image_key, ends_on, created_at FROM ads ORDER BY created_at DESC, id DESC').all();
  return json({ ads: results });
}

export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const tier = form.get('tier') === 'large' ? 'large' : 'small';
  const name = str(form.get('name'), 80);
  let link = str(form.get('link'), 500);
  const endsOn = str(form.get('ends_on'), 10);
  if (!name) return bad('Add the advertiser name.');
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (link) { try { new URL(link); } catch { return bad('That link does not look right.'); } }
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return bad('Bad end date');
  let imageKey = null;
  try { imageKey = await saveImage(env, form.get('image'), 'ads'); } catch (e) { return bad(e.message); }
  await env.DB.prepare('INSERT INTO ads (tier, name, link, image_key, ends_on) VALUES (?, ?, ?, ?, ?)')
    .bind(tier, name, link, imageKey, endsOn || null).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM ads WHERE id = ? RETURNING image_key').bind(id).first();
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  return json({ ok: true });
}
