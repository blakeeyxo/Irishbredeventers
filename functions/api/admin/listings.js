// Owner area: For Sale. GET ?status=draft|pending_payment|live|sold|expired|removed|rejected (the queue) or ?id=&enquiries=1.
// POST { id, action, ... } (see ownerAction in lib/listings.js) or { action: 'settings', ... }.
// DELETE ?id= deletes an ad and its photos for good; DELETE ?photo= removes one photo.
import { json, bad, readJson } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { listForOwner, enquiriesFor, getSettings, saveSettings, ownerAction, deleteListing, deletePhoto, euro } from '../../../lib/listings.js';
import { listingUrl } from '../../../lib/listings-http.js';
import { sendEmails, listingApprovedEmail, listingLiveEmail, listingRejectedEmail } from '../../../lib/mail.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  if (u.get('id') && u.get('enquiries')) return json({ enquiries: await enquiriesFor(db, Number(u.get('id'))) });
  const [queue, settings] = await Promise.all([listForOwner(db, u.get('status') || 'draft'), getSettings(db)]);
  return json({ ...queue, settings, mailReady: Boolean(env.MAIL_API_KEY && env.MAIL_FROM), photosReady: Boolean(env.LISTING_MEDIA) });
});

export const onRequestPost = ({ env, request }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  if (b.action === 'settings') return json({ ok: true, settings: await saveSettings(db, b) });
  const id = Number(b.id);
  if (!Number.isInteger(id)) return bad('Choose an ad.');
  let out;
  try { out = await ownerAction(db, id, b.action, b); } catch (e) { return bad(e.message); }
  const l = out.listing, site = siteFor(env);
  const disciplines = String(l.disciplines || '').split(',').filter(Boolean);
  let message = null;
  if (out.email === 'approved') message = listingApprovedEmail(site, l.seller_email, l, euro(l.listing_fee_cents), out.settings.payment_instructions);
  if (out.email === 'live') message = listingLiveEmail(site, l.seller_email, l, listingUrl(env, request, l.id, disciplines));
  if (out.email === 'rejected') message = listingRejectedEmail(site, l.seller_email, l, l.reject_reason);
  let emailed = null;
  if (message && l.seller_email) {
    try { const r = await sendEmails(env, [message]); emailed = r.skipped ? 'not-set-up' : r.sent > 0; } catch (e) { console.error('listing email failed', e); emailed = false; }
  }
  return json({ ok: true, status: l.status, emailed });
});

export const onRequestDelete = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  if (u.get('photo')) {
    const row = await deletePhoto(db, Number(u.get('photo')));
    if (row && env.LISTING_MEDIA) await env.LISTING_MEDIA.delete(row.image_key);
    return json({ ok: true });
  }
  const keys = await deleteListing(db, Number(u.get('id')));
  if (env.LISTING_MEDIA) await Promise.all(keys.map(k => env.LISTING_MEDIA.delete(k)));
  return json({ ok: true });
});
