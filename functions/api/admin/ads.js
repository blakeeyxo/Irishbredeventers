// Ads: banners (top and bottom of every page) and side boxes (booked into a slot in the right-hand column).
// POST with an id edits that advert; a new image replaces the old one, no image keeps it.
import { json, bad, str } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';

const FITS = ['cover', 'contain'];
const FOCUSES = ['center', 'top', 'bottom', 'left', 'right'];
const SHAPES = ['banner', 'box', 'home', 'phone-banner', 'phone-box', 'free'];

// The crop as saved by the owner area's crop tool: fractions of the original image, and the shape used.
function readCrop(raw) {
  if (!raw) return '';
  let c;
  try { c = JSON.parse(raw); } catch { return null; }
  const frac = v => typeof v === 'number' && v >= 0 && v <= 1;
  if (!c || ![c.x, c.y, c.w, c.h].every(frac) || c.w <= 0 || c.h <= 0 || c.x + c.w > 1.0001 || c.y + c.h > 1.0001) return null;
  return JSON.stringify({ x: c.x, y: c.y, w: c.w, h: c.h, shape: SHAPES.includes(c.shape) ? c.shape : 'free' });
}

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT id, tier, name, link, image_key, orig_key, phone_key, crop, phone_crop, bg, slot, starts_on, ends_on, fit, focus, created_at
    FROM ads ORDER BY tier, slot IS NULL, slot, created_at DESC, id DESC`).all();
  return json({ ads: results });
}

// "image" is the picture as it will show on laptops and tablets (already cropped in the browser), "phone_image" the
// separate crop for phones, and "original" the untouched upload.
export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const tier = form.get('tier') === 'large' ? 'large' : 'small';
  const name = str(form.get('name'), 80);
  let link = str(form.get('link'), 500);
  const endsOn = str(form.get('ends_on'), 10);
  const startsOn = str(form.get('starts_on'), 10);
  const slot = Number(form.get('slot')) || null;
  if (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return bad('Bad start date');
  if (slot !== null && (slot < 1 || slot > 40)) return bad('Slots are numbered from 1 (top).');
  if (!name) return bad('Add the advertiser name.');
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (link) { try { new URL(link); } catch { return bad('That link does not look right.'); } }
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return bad('Bad end date');
  const fit = FITS.includes(form.get('fit')) ? form.get('fit') : 'cover';
  const focus = FOCUSES.includes(form.get('focus')) ? form.get('focus') : 'center';
  const bg = /^#[0-9a-f]{6}$/i.test(form.get('bg') || '') ? form.get('bg').toLowerCase() : '#ffffff';
  const crop = readCrop(str(form.get('crop'), 400));
  const phoneCrop = readCrop(str(form.get('phone_crop'), 400));
  if (crop === null || phoneCrop === null) return bad('The crop could not be read. Try cropping again.');
  // "Show the whole image" needs no phone crop: phones then show the same picture.
  const clearPhone = fit === 'contain' || form.get('phone_clear') === '1';
  const id = Number(form.get('id')) || null;
  const existing = id ? await env.DB.prepare('SELECT image_key, orig_key, phone_key FROM ads WHERE id = ?').bind(id).first() : null;
  if (id && !existing) return bad('That advert no longer exists.', 404);
  let imageKey = null, origKey = null, phoneKey = null;
  try {
    imageKey = await saveImage(env, form.get('image'), 'ads');
    origKey = await saveImage(env, form.get('original'), 'ads/originals');
    if (!clearPhone) phoneKey = await saveImage(env, form.get('phone_image'), 'ads');
  } catch (e) { return bad(e.message); }
  if (existing) {
    await env.DB.prepare(`UPDATE ads SET tier = ?, name = ?, link = ?, image_key = IFNULL(?, image_key), orig_key = IFNULL(?, orig_key),
        phone_key = CASE WHEN ? THEN NULL ELSE IFNULL(?, phone_key) END, crop = ?, phone_crop = CASE WHEN ? THEN '' ELSE ? END, bg = ?,
        ends_on = ?, starts_on = ?, slot = ?, fit = ?, focus = ? WHERE id = ?`)
      .bind(tier, name, link, imageKey, origKey, clearPhone ? 1 : 0, phoneKey, crop, clearPhone ? 1 : 0, phoneCrop, bg,
        endsOn || null, startsOn || null, tier === 'small' ? slot : null, fit, focus, id).run();
    // Replaced files are deleted. (For an advert saved before cropping existed, the owner area re-sends its
    // old picture as the original, so nothing is lost.)
    if (imageKey && existing.image_key) await env.MEDIA.delete(existing.image_key);
    if (origKey && existing.orig_key) await env.MEDIA.delete(existing.orig_key);
    if ((phoneKey || clearPhone) && existing.phone_key) await env.MEDIA.delete(existing.phone_key);
    return json({ ok: true });
  }
  await env.DB.prepare(`INSERT INTO ads (tier, name, link, image_key, orig_key, phone_key, crop, phone_crop, bg, ends_on, starts_on, slot, fit, focus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(tier, name, link, imageKey, origKey, phoneKey, crop, clearPhone ? '' : phoneCrop, bg, endsOn || null, startsOn || null, tier === 'small' ? slot : null, fit, focus).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM ads WHERE id = ? RETURNING image_key, orig_key, phone_key').bind(id).first();
  if (row && row.phone_key) await env.MEDIA.delete(row.phone_key);
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  if (row && row.orig_key) await env.MEDIA.delete(row.orig_key);
  return json({ ok: true });
}
