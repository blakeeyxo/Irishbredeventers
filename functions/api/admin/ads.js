// Ads: banners (top and bottom of every page) and side boxes (booked into a slot in the right-hand column).
// POST with an id edits that advert; a new image replaces the old one, no image keeps it.
import { json, bad, str } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';

const FITS = ['cover', 'contain'];
const FOCUSES = ['center', 'top', 'bottom', 'left', 'right'];
const SHAPES = ['banner', 'box', 'home', 'free'];

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
  const { results } = await env.DB.prepare(`SELECT id, tier, name, link, image_key, orig_key, crop, bg, slot, starts_on, ends_on, fit, focus, created_at
    FROM ads ORDER BY tier, slot IS NULL, slot, created_at DESC, id DESC`).all();
  return json({ ads: results });
}

// "image" is the picture as it will show (already cropped in the browser); "original" is the untouched upload.
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
  if (crop === null) return bad('The crop could not be read. Try cropping again.');
  const id = Number(form.get('id')) || null;
  const existing = id ? await env.DB.prepare('SELECT image_key, orig_key FROM ads WHERE id = ?').bind(id).first() : null;
  if (id && !existing) return bad('That advert no longer exists.', 404);
  let imageKey = null, origKey = null;
  try {
    imageKey = await saveImage(env, form.get('image'), 'ads');
    origKey = await saveImage(env, form.get('original'), 'ads/originals');
  } catch (e) { return bad(e.message); }
  if (existing) {
    await env.DB.prepare(`UPDATE ads SET tier = ?, name = ?, link = ?, image_key = IFNULL(?, image_key), orig_key = IFNULL(?, orig_key), crop = ?, bg = ?,
        ends_on = ?, starts_on = ?, slot = ?, fit = ?, focus = ? WHERE id = ?`)
      .bind(tier, name, link, imageKey, origKey, crop, bg, endsOn || null, startsOn || null, tier === 'small' ? slot : null, fit, focus, id).run();
    // Replaced files are deleted. (For an advert saved before cropping existed, the owner area re-sends its
    // old picture as the original, so nothing is lost.)
    if (imageKey && existing.image_key) await env.MEDIA.delete(existing.image_key);
    if (origKey && existing.orig_key) await env.MEDIA.delete(existing.orig_key);
    return json({ ok: true });
  }
  await env.DB.prepare('INSERT INTO ads (tier, name, link, image_key, orig_key, crop, bg, ends_on, starts_on, slot, fit, focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(tier, name, link, imageKey, origKey, crop, bg, endsOn || null, startsOn || null, tier === 'small' ? slot : null, fit, focus).run();
  return json({ ok: true });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  const row = await env.DB.prepare('DELETE FROM ads WHERE id = ? RETURNING image_key, orig_key').bind(id).first();
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  if (row && row.orig_key) await env.MEDIA.delete(row.orig_key);
  return json({ ok: true });
}
