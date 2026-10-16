// Public: a seller answers a "Looking for" post. POST { id, name, email, phone, message, turnstile }. Emailed on to the
// buyer (who can reply straight to the seller) and kept in the owner area. The buyer's address is never shown.
import { json, bad, readJson, verifyTurnstile, siteUrl } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { readReply, addReply } from '../../../lib/wanted.js';
import { sendEmails, wantedReplyEmail } from '../../../lib/mail.js';

export const onRequestPost = ({ env, request, waitUntil }) => withShared(env, async db => {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  if (!(await verifyTurnstile(env, b.turnstile, request).catch(() => false))) return bad('The spam check did not pass. Please wait a moment and try again.');
  const { reply, errors } = readReply(b);
  if (errors.length) return bad(errors.join(' '));
  const site = siteFor(env);
  const saved = await addReply(db, Number(b.id), site.discipline, reply);
  if (!saved) return bad('This post is no longer taking answers.', 404);
  const url = `${siteUrl(env, request)}/for-sale#looking-for-${saved.wanted.id}`;
  waitUntil(sendEmails(env, [wantedReplyEmail(site, saved.wanted.buyer_email, saved.wanted, reply, url)])
    .then(r => r.sent && db.prepare('UPDATE wanted_reply SET emailed = 1 WHERE id = ?').bind(saved.replyId).run())
    .catch(e => console.error('wanted reply email failed', e)));
  return json({ ok: true });
});
