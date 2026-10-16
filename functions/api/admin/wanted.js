// Owner area: For Sale → Looking for. GET ?status=draft|live|found|removed|rejected (this site's queue) or ?id=&replies=1.
// POST { id, action: approve|found|removed|reject|note, reason, note }. DELETE ?id= deletes a post for good.
import { json, bad, readJson, siteUrl } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { listWantedForOwner, repliesFor, wantedAction, deleteWanted } from '../../../lib/wanted.js';
import { sendEmails, wantedLiveEmail, wantedRejectedEmail } from '../../../lib/mail.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  if (u.get('id') && u.get('replies')) return json({ replies: await repliesFor(db, Number(u.get('id'))) });
  return json(await listWantedForOwner(db, u.get('status') || 'draft', siteFor(env).id));
});

export const onRequestPost = ({ env, request }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  const id = Number(b.id);
  if (!Number.isInteger(id)) return bad('Choose a post.');
  let out;
  try { out = await wantedAction(db, id, b.action, b); } catch (e) { return bad(e.message); }
  const w = out.wanted, site = siteFor(env);
  const message = out.email === 'live' ? wantedLiveEmail(site, w.buyer_email, w, `${siteUrl(env, request)}/for-sale#looking-for-${w.id}`)
    : out.email === 'rejected' ? wantedRejectedEmail(site, w.buyer_email, w, w.reject_reason) : null;
  let emailed = null;
  if (message) {
    try { const r = await sendEmails(env, [message]); emailed = r.skipped ? 'not-set-up' : r.sent > 0; } catch (e) { console.error('wanted email failed', e); emailed = false; }
  }
  return json({ ok: true, status: w.status, emailed });
});

export const onRequestDelete = ({ env, request }) => withShared(env, async db => {
  await deleteWanted(db, Number(new URL(request.url).searchParams.get('id')));
  return json({ ok: true });
});
