// Advertising enquiries from the About page. Queued for the owner area, and emailed on if ENQUIRY_EMAIL is set.
import { json, bad, readJson, str, text, isEmail, verifyTurnstile } from '../../lib/http.js';
import { sendEmails, enquiryEmail } from '../../lib/mail.js';

const INTERESTS = ['banner', 'box', 'unsure'];

export async function onRequestPost({ env, request, waitUntil }) {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  const e = {
    name: str(b.name, 80), business: str(b.business, 120), email: str(b.email, 200).toLowerCase(),
    phone: str(b.phone, 40), interest: INTERESTS.includes(b.interest) ? b.interest : 'unsure', message: text(b.message, 3000)
  };
  if (!e.name || !isEmail(e.email)) return bad('Please add your name and a valid email address.');
  if (!(await verifyTurnstile(env, b.turnstile, request))) return bad('The spam check did not pass. Please try again.', 403);
  await env.DB.prepare('INSERT INTO enquiries (name, business, email, phone, interest, message) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(e.name, e.business, e.email, e.phone, e.interest, e.message).run();
  if (env.ENQUIRY_EMAIL) waitUntil(sendEmails(env, [enquiryEmail(env.ENQUIRY_EMAIL, e)]).catch(err => console.error('enquiry email failed', err)));
  return json({ ok: true });
}
