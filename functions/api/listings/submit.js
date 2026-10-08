// Public: "I want to sell". A multipart form with the ad, the seller's details and 1 to 8 photos ("photos").
// The ad waits for the owner's approval; the seller gets an email saying it was received.
import { json, bad, verifyTurnstile } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { saveImage } from '../../../lib/images.js';
import { readListing, createListing, siteDisciplines, MAX_PHOTOS } from '../../../lib/listings.js';
import { needsListingStorage } from '../../../lib/listings-http.js';
import { sendEmails, listingReceivedEmail } from '../../../lib/mail.js';

export const onRequestPost = ({ env, request, waitUntil }) => withShared(env, async db => {
  const missing = needsListingStorage(env);
  if (missing) return bad(missing, 503);
  let form;
  try { form = await request.formData(); } catch { return bad('Something went wrong sending the form. Please try again.'); }
  if (!(await verifyTurnstile(env, form.get('turnstile'), request).catch(() => false))) {
    return bad('The spam check did not pass. Please wait a moment and press Send again.');
  }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  fields.disciplines = siteDisciplines(siteFor(env).id, fields.share_other === 'on');
  const parsed = readListing(fields);
  const photos = form.getAll('photos').filter(f => f && typeof f === 'object' && f.size);
  if (!photos.length) parsed.errors.push('Add at least one photo.');
  if (photos.length > MAX_PHOTOS) parsed.errors.push(`Add up to ${MAX_PHOTOS} photos.`);
  if (form.get('confirm') !== 'on') parsed.errors.push('Tick the box to confirm you can sell this horse and use these photos.');
  if (parsed.errors.length) return bad(parsed.errors.join(' '));
  const keys = [];
  try {
    for (const p of photos) keys.push(await saveImage(env, p, 'listings', env.LISTING_MEDIA));
  } catch (e) {
    await Promise.all(keys.map(k => env.LISTING_MEDIA.delete(k)));
    return bad(e.message);
  }
  const site = siteFor(env);
  const id = await createListing(db, parsed, { photoKeys: keys, site: site.id });
  waitUntil(sendEmails(env, [listingReceivedEmail(site, parsed.seller.email, { id, title: parsed.values.title })]).catch(e => console.error('listing email failed', e)));
  return json({ ok: true, id });
});
