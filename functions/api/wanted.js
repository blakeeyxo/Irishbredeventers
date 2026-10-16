// Public: For Sale → Looking for. GET lists this site's live posts. POST { title, …, buyer_name, buyer_email, share_other,
// turnstile } sends one in; it waits for the owner's approval and the buyer gets an email saying it was received.
import { json, bad, readJson, verifyTurnstile } from '../../lib/http.js';
import { withShared } from '../../lib/shared-http.js';
import { siteFor } from '../../lib/sites.js';
import { readWanted, createWanted, listPublicWanted } from '../../lib/wanted.js';
import { sendEmails, wantedReceivedEmail } from '../../lib/mail.js';

export const onRequestGet = ({ env }) => withShared(env, async db => json({ wanted: await listPublicWanted(db, siteFor(env).discipline) }));

export const onRequestPost = ({ env, request, waitUntil }) => withShared(env, async db => {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  if (!(await verifyTurnstile(env, b.turnstile, request).catch(() => false))) return bad('The spam check did not pass. Please wait a moment and press Send again.');
  const parsed = readWanted(b);
  if (parsed.errors.length) return bad(parsed.errors.join(' '));
  const site = siteFor(env);
  const id = await createWanted(db, parsed, { site: site.id, share: b.share_other });
  waitUntil(sendEmails(env, [wantedReceivedEmail(site, parsed.buyer.email, parsed.values)]).catch(e => console.error('wanted email failed', e)));
  return json({ ok: true, id });
});
