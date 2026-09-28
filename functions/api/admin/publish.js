// Step 3 of the weekly upload: save the checked rows as one batch, then email subscribers if ticked.
import { json, bad, readJson, siteUrl } from '../../../lib/http.js';
import { saveBatch } from '../../../lib/results.js';
import { sendEmails, resultsEmail } from '../../../lib/mail.js';

export async function onRequestPost({ env, request, waitUntil }) {
  const b = await readJson(request);
  if (!b || !Array.isArray(b.rows)) return bad('Bad request');
  let saved;
  try {
    saved = await saveBatch(env.DB, b.rows, b.label || `Upload ${new Date().toISOString().slice(0, 10)}`);
  } catch (e) {
    return bad(e.message || 'Could not save');
  }

  let emailed = 0;
  if (b.notify) {
    const { results } = await env.DB.prepare('SELECT email, token FROM subscribers WHERE confirmed = 1').all();
    emailed = results.length;
    const base = siteUrl(env, request);
    const summary = `${saved.rowCount - saved.unverifiedCount} new Irish-bred placings have been added to the results.`;
    const messages = results.map(s => resultsEmail(s.email, `${base}/results`, `${base}/api/unsubscribe?token=${s.token}`, summary));
    waitUntil(sendEmails(env, messages).catch(e => console.error('results email failed', e)));
  }
  return json({ ok: true, ...saved, emailed });
}
