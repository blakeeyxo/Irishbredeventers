// Public: a buyer's question about an ad. POST { id, name, email, phone, message, turnstile }. Emailed on to the
// seller (who can reply straight to the buyer) and kept in the owner area. The seller's address is never shown.
import { json, bad, readJson, verifyTurnstile } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { readEnquiry, addEnquiry } from '../../../lib/listings.js';
import { listingUrl } from '../../../lib/listings-http.js';
import { sendEmails, listingEnquiryEmail } from '../../../lib/mail.js';

export const onRequestPost = ({ env, request, waitUntil }) => withShared(env, async db => {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  if (!(await verifyTurnstile(env, b.turnstile, request).catch(() => false))) return bad('The spam check did not pass. Please wait a moment and try again.');
  const { enquiry, errors } = readEnquiry(b);
  if (errors.length) return bad(errors.join(' '));
  const site = siteFor(env);
  const saved = await addEnquiry(db, Number(b.id), site.discipline, enquiry);
  if (!saved) return bad('This ad is no longer taking enquiries.', 404);
  // A seller Charlie added with only a phone number has no email: the enquiry waits in the owner area for him to pass on.
  if (!saved.listing.seller_email) return json({ ok: true });
  const url = listingUrl(env, request, saved.listing.id, [site.discipline]);
  waitUntil(sendEmails(env, [listingEnquiryEmail(site, saved.listing.seller_email, saved.listing, enquiry, url)])
    .then(r => r.sent && db.prepare('UPDATE listing_enquiry SET emailed = 1 WHERE id = ?').bind(saved.enquiryId).run())
    .catch(e => console.error('enquiry email failed', e)));
  return json({ ok: true });
});
