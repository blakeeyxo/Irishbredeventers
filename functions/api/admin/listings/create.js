// Owner area: put a For Sale ad up directly, for a seller who phoned in. A multipart form with the ad, the seller's
// name and email or phone, 1 to 8 photos ("photos"), and "then": 'publish' (paid, live now) or 'payment' (waiting
// for payment, fee in "fee"). "email_seller" sends the seller the matching email when they have an address.
import { json, bad } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';
import { siteFor } from '../../../../lib/sites.js';
import { saveImage, savePhoneImage } from '../../../../lib/images.js';
import { readListing, createListing, ownerAction, siteDisciplines, euro, MAX_PHOTOS } from '../../../../lib/listings.js';
import { needsListingStorage, listingUrl } from '../../../../lib/listings-http.js';
import { sendEmails, listingLiveEmail, listingApprovedEmail } from '../../../../lib/mail.js';

export const onRequestPost = ({ env, request }) => withShared(env, async db => {
  const missing = needsListingStorage(env);
  if (missing) return bad(missing, 503);
  let form;
  try { form = await request.formData(); } catch { return bad('Something went wrong sending the form. Please try again.'); }
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  fields.disciplines = siteDisciplines(siteFor(env).id, fields.share_other === 'on');
  const parsed = readListing(fields, { owner: 'create' });
  const photos = form.getAll('photos').filter(f => f && typeof f === 'object' && f.size);
  if (!photos.length) parsed.errors.push('Add at least one photo.');
  if (photos.length > MAX_PHOTOS) parsed.errors.push(`Add up to ${MAX_PHOTOS} photos.`);
  if (parsed.errors.length) return bad(parsed.errors.join(' '));
  const keys = [];
  try {
    const phones = form.getAll('photos_phone'); // in the same order as the photos; empty where there is no phone crop
    for (const [i, p] of photos.entries()) {
      keys.push(await saveImage(env, p, 'listings', env.LISTING_MEDIA));
      await savePhoneImage(env, keys[i], phones[i], env.LISTING_MEDIA);
    }
  } catch (e) {
    await Promise.all(keys.map(k => env.LISTING_MEDIA.delete(k)));
    return bad(e.message);
  }
  const site = siteFor(env);
  const id = await createListing(db, parsed, { photoKeys: keys, site: site.id });
  let out;
  try {
    out = fields.then === 'payment' ? await ownerAction(db, id, 'approve', { fee: fields.fee }) : await ownerAction(db, id, 'publish');
  } catch (e) {
    // The ad is saved either way; it waits for review if the next step couldn't be done (e.g. no fee entered).
    return json({ ok: true, id, status: 'draft', warning: `Saved, waiting for review: ${e.message}` });
  }
  const l = out.listing;
  let emailed = null;
  if (fields.email_seller === 'on' && l.seller_email) {
    const message = l.status === 'live'
      ? listingLiveEmail(site, l.seller_email, l, listingUrl(env, request, id, String(l.disciplines || '').split(',').filter(Boolean)))
      : listingApprovedEmail(site, l.seller_email, l, euro(l.listing_fee_cents), out.settings.payment_instructions);
    try { const r = await sendEmails(env, [message]); emailed = r.skipped ? 'not-set-up' : r.sent > 0; } catch (e) { console.error('listing email failed', e); emailed = false; }
  }
  return json({ ok: true, id, status: l.status, emailed });
});
