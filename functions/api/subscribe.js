// Results-email sign-up, step 1 of double opt-in: store the address and send a confirm link.
import { json, bad, readJson, str, isEmail, verifyTurnstile, randomToken, siteUrl } from '../../lib/http.js';
import { sendEmails, confirmEmail } from '../../lib/mail.js';
import { siteFor } from '../../lib/sites.js';

export async function onRequestPost({ env, request, waitUntil }) {
  const b = await readJson(request);
  const email = str(b && b.email, 254).toLowerCase();
  if (!isEmail(email)) return bad('Please enter a valid email address.');
  if (!(await verifyTurnstile(env, b.turnstile, request))) return bad('The spam check did not pass. Please try again.', 403);

  let row = await env.DB.prepare('SELECT token, confirmed FROM subscribers WHERE email = ?').bind(email).first();
  if (!row) {
    const token = randomToken();
    await env.DB.prepare('INSERT INTO subscribers (email, token) VALUES (?, ?)').bind(email, token).run();
    row = { token, confirmed: 0 };
  }
  // Same answer either way, so the form can't be used to check who is subscribed.
  if (!row.confirmed) {
    const url = `${siteUrl(env, request)}/api/subscribe/confirm?token=${row.token}`;
    waitUntil(sendEmails(env, [confirmEmail(siteFor(env), email, url)]).catch(e => console.error('confirm email failed', e)));
  }
  return json({ ok: true });
}
