// CONFIRM: save the checked results. Safe to repeat; pasting the same week twice adds nothing.
import { json, bad, readJson, siteUrl, str } from '../../../lib/http.js';
import { cleanRows, importResults } from '../../../lib/import.js';
import { sendEmails, resultsEmail } from '../../../lib/mail.js';

export async function onRequestPost({ env, request, waitUntil }) {
  const b = await readJson(request);
  if (!b || !Array.isArray(b.rows)) return bad('Bad request');
  const rows = cleanRows(b.rows, new Date().getFullYear());
  if (!rows.length) return bad('There are no rows with a horse name to save.');
  // Never save a result whose event heading was not read: it would end up under the wrong event.
  const noEvent = rows.filter(r => r.event_name === 'Event not given' || /\(\s*[A-Z]{3,4}\s*\)/.test(r.class_name)).length;
  if (noEvent) return bad(`${noEvent} result${noEvent === 1 ? ' has' : 's have'} no readable event heading above ${noEvent === 1 ? 'it' : 'them'}, so nothing was saved. Fix the Event, Country and Start date on those rows (Edit), then save again.`);
  const out = await importResults(env.DB, rows, { decisions: b.decisions || {}, weekLabel: str(b.weekLabel, 120), sourceNotes: str(b.sourceNotes, 200) });
  if (out.needsDecision) return json({ needsDecision: out.needsDecision }, { status: 409 });

  out.emailed = 0;
  if (b.notify && out.results > 0) {
    const { results } = await env.DB.prepare('SELECT email, token FROM subscribers WHERE confirmed = 1').all();
    const base = siteUrl(env, request);
    const summary = `${out.results} new Irish-bred placing${out.results === 1 ? ' has' : 's have'} been added to the results.`;
    const messages = results.map(s => resultsEmail(s.email, `${base}/results`, `${base}/api/unsubscribe?token=${s.token}`, summary));
    out.emailed = messages.length;
    waitUntil(sendEmails(env, messages).catch(e => console.error('results email failed', e)));
  }
  return json(out);
}
