// Owner area: the six stallion listings (Stallions – Listing 1 to 6). POST saves one; DELETE empties it.
import { json, bad, str, text } from '../../../lib/http.js';
import { saveImage } from '../../../lib/images.js';
import { progeny, summary, rollingWindow, matchSires } from '../../../lib/stallions.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM stallions ORDER BY slot').all();
  const win = rollingWindow();
  const listings = [];
  for (let slot = 1; slot <= 6; slot++) {
    const s = results.find(x => x.slot === slot) || { slot };
    // The sire records the names match (so the owner can see "Imperial Heights, Imperial Hights") and the numbers.
    const matched = s.sire_names ? await matchSires(env.DB, s.sire_names) : [];
    listings.push({ ...s, matched: matched.map(m => m.name), totals: s.sire_names ? summary(await progeny(env.DB, s.sire_names, win, matched)) : null });
  }
  const sires = (await env.DB.prepare('SELECT name FROM sires ORDER BY name').all()).results.map(r => r.name);
  return json({ window: win, listings, sires });
}

export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  const slot = Number(form.get('slot'));
  if (!(slot >= 1 && slot <= 6)) return bad('Choose a listing from 1 to 6.');
  const name = str(form.get('name'), 80);
  if (!name) return bad('Add the stallion name.');
  let link = str(form.get('link'), 500);
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  if (link) { try { new URL(link); } catch { return bad('That link does not look right.'); } }
  const existing = await env.DB.prepare('SELECT image_key FROM stallions WHERE slot = ?').bind(slot).first();
  let imageKey = null;
  try { imageKey = await saveImage(env, form.get('image'), 'ads'); } catch (e) { return bad(e.message); }
  await env.DB.prepare(`INSERT INTO stallions (slot, name, sire_names, blurb, link, image_key, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
      ON CONFLICT(slot) DO UPDATE SET name = ?2, sire_names = ?3, blurb = ?4, link = ?5, image_key = IFNULL(?6, image_key), updated_at = datetime('now')`)
    .bind(slot, name, str(form.get('sire_names'), 300) || name, text(form.get('blurb'), 400), link, imageKey).run();
  if (imageKey && existing && existing.image_key) await env.MEDIA.delete(existing.image_key);
  // What was saved, so the owner area can say so plainly: the sires matched and how often they appear.
  const sireNames = str(form.get('sire_names'), 300) || name;
  const win = rollingWindow();
  const matched = await matchSires(env.DB, sireNames);
  const totals = summary(await progeny(env.DB, sireNames, win, matched));
  return json({ ok: true, slot, matched: matched.map(m => m.name), totals, window: win, image_key: imageKey || (existing && existing.image_key) || null });
}

export async function onRequestDelete({ env, request }) {
  const slot = Number(new URL(request.url).searchParams.get('slot'));
  const row = await env.DB.prepare('DELETE FROM stallions WHERE slot = ? RETURNING image_key').bind(slot).first();
  if (row && row.image_key) await env.MEDIA.delete(row.image_key);
  return json({ ok: true });
}
