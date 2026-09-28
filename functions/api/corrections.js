// Corrections and additions from the public form, queued for Charlie.
import { json, bad, readJson, str, text, isEmail, verifyTurnstile } from '../../lib/http.js';

export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  const eventText = str(b.event, 200);
  const message = text(b.message, 3000);
  const email = str(b.email, 200);
  if (!eventText || !message) return bad('Please add the event and what needs correcting.');
  if (email && !isEmail(email)) return bad('That email address does not look right.');
  if (!(await verifyTurnstile(env, b.turnstile, request))) return bad('The spam check did not pass. Please try again.', 403);
  await env.DB.prepare('INSERT INTO corrections (event_text, message, email) VALUES (?, ?, ?)').bind(eventText, message, email).run();
  return json({ ok: true });
}
