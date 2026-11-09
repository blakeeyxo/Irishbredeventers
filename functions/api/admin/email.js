// Owner area → Email: write to confirmed subscribers (a results update or any other message), test it on yourself,
// then send to the ones ticked. Each person gets their own email with their own unsubscribe link.
// The send log is kept in settings (key email_log, newest first, last 50 sends), so no extra table is needed.
import { json, bad, readJson, siteUrl, str } from '../../../lib/http.js';
import { ownerEmail, sendInBatches } from '../../../lib/mail.js';
import { siteFor } from '../../../lib/sites.js';

const LOG_KEY = 'email_log';
const MAX_IDS = 5000;
// Like str() but keeps line breaks: a blank line starts a new paragraph in the email.
const body = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[^\S\n]+/g, ' ').trim().slice(0, max);

async function readLog(env) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(LOG_KEY).first();
  try { return row ? JSON.parse(row.value) : []; } catch { return []; }
}
async function addToLog(env, entry) {
  const log = [entry, ...(await readLog(env))].slice(0, 50);
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(LOG_KEY, JSON.stringify(log)).run();
}

// The message as the owner wrote it, cut to size. Nothing in it is trusted: lib/mail.js escapes it all.
function readMessage(b) {
  const kind = b && b.kind === 'results' ? 'results' : 'other';
  const m = {
    kind,
    subject: str(b && b.subject, 200),
    text: body(b && b.text, 20000),
    closing: body(b && b.closing, 2000),
    news: b && b.news ? { headline: str(b.news.headline, 300), summary: body(b.news.summary, 3000), link: str(b.news.link, 500) } : null
  };
  const errors = [];
  if (!m.subject.trim()) errors.push('Add a subject.');
  if (kind === 'other' && !m.text.trim() && !(m.news && (m.news.headline || m.news.summary))) errors.push('Write a message.');
  return { m, errors };
}

export async function onRequestGet({ env, data }) {
  const { results } = await env.DB.prepare('SELECT id, email, created_at FROM subscribers WHERE confirmed = 1 ORDER BY created_at DESC, id DESC').all();
  return json({
    subscribers: results,
    log: await readLog(env),
    me: data && data.user ? data.user.email : '',
    mailReady: Boolean(env.MAIL_API_KEY && env.MAIL_FROM)
  });
}

// { action: 'preview' | 'test' | 'send', kind, subject, text, closing, news, ids }
export async function onRequestPost({ env, request, data }) {
  const b = await readJson(request);
  const action = b && b.action;
  const { m, errors } = readMessage(b);
  const site = siteFor(env);
  const base = siteUrl(env, request);

  if (action === 'preview') {
    const e = ownerEmail(site, 'you@example.com', m, { siteUrl: base, unsubscribeUrl: `${base}/api/unsubscribe?token=preview` });
    return json({ subject: e.subject, html: e.html, text: e.text, errors });
  }
  if (errors.length) return bad(errors.join(' '));

  if (action === 'test') {
    // Only ever to the signed-in owner. The unsubscribe link in a test goes nowhere (no subscriber has that token).
    const me = data && data.user && data.user.email;
    if (!me || !me.includes('@')) return bad('Your owner-area email could not be found, so no test was sent.');
    const e = ownerEmail(site, me, { ...m, subject: `[Test] ${m.subject}` }, { siteUrl: base, unsubscribeUrl: `${base}/api/unsubscribe?token=test` });
    const r = await sendInBatches(env, [e]);
    if (r.skipped) return json({ status: 'not-set-up' });
    await addToLog(env, { at: new Date().toISOString(), kind: m.kind, subject: m.subject, test: true, recipients: 1, sent: r.sent, failed: r.failed });
    return json({ status: r.failed.length ? 'failed' : 'sent', to: me, error: r.failed[0] && r.failed[0].error });
  }

  if (action === 'send') {
    // Only confirmed subscribers, looked up here from the ids ticked: any address the browser might send is ignored.
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger))].slice(0, MAX_IDS);
    if (!ids.length) return bad('Tick at least one subscriber.');
    const people = [];
    for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT email, token FROM subscribers WHERE confirmed = 1 AND id IN (${part.map(() => '?').join(',')})`).bind(...part).all();
      people.push(...results);
    }
    if (!people.length) return bad('None of the ticked addresses is a confirmed subscriber any more.');
    const messages = people.map(p => ownerEmail(site, p.email, m, { siteUrl: base, unsubscribeUrl: `${base}/api/unsubscribe?token=${p.token}` }));
    const r = await sendInBatches(env, messages);
    if (r.skipped) return json({ status: 'not-set-up' });
    const entry = { at: new Date().toISOString(), kind: m.kind, subject: m.subject, recipients: messages.length, sent: r.sent, failed: r.failed.slice(0, 200) };
    await addToLog(env, entry);
    return json({ status: r.failed.length ? (r.sent ? 'partly' : 'failed') : 'sent', ...entry });
  }
  return bad('Unknown action');
}
