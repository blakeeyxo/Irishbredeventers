// Results-email sign-ups, for the owner area. New ones (signed up since "Mark as seen") are flagged under Messages.
// Which ones were seen is kept in settings (subscribers_seen_id: the newest sign-up seen), so no extra column is needed.
import { json, bad, readJson, siteUrl } from '../../../lib/http.js';
import { sendEmails, confirmEmail } from '../../../lib/mail.js';
import { siteFor } from '../../../lib/sites.js';

export const SEEN_SQL = "IFNULL((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'subscribers_seen_id'), 0)";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, confirmed, created_at, id > ${SEEN_SQL} AS new FROM subscribers ORDER BY id DESC LIMIT 5000`
  ).all();
  return json({ subscribers: results });
}

// { action: 'seen' } | { action: 'delete', id } | { action: 'resend', id? }  (resend: the confirm email again, to one or
// to everyone still waiting to confirm)
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  if (b && b.action === 'seen') {
    await env.DB.prepare(`INSERT INTO settings (key, value) SELECT 'subscribers_seen_id', CAST(IFNULL(MAX(id), 0) AS TEXT) FROM subscribers WHERE true
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    return json({ ok: true });
  }
  if (b && b.action === 'delete') {
    const id = Number(b.id);
    if (!Number.isInteger(id)) return bad('Bad id');
    await env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  if (b && b.action === 'resend') {
    const one = b.id !== undefined && b.id !== null;
    if (one && !Number.isInteger(Number(b.id))) return bad('Bad id');
    const { results } = await (one
      ? env.DB.prepare('SELECT email, token FROM subscribers WHERE confirmed = 0 AND id = ?').bind(Number(b.id))
      : env.DB.prepare('SELECT email, token FROM subscribers WHERE confirmed = 0')).all();
    const base = siteUrl(env, request);
    const messages = results.map(s => confirmEmail(siteFor(env), s.email, `${base}/api/subscribe/confirm?token=${s.token}`));
    try {
      const r = await sendEmails(env, messages);
      return json({ ok: true, status: r.skipped ? 'not-set-up' : 'sent', sent: r.sent || 0 });
    } catch (e) {
      console.error('confirm resend failed', e);
      return json({ ok: false, status: 'failed', error: String(e && e.message || e).slice(0, 300) });
    }
  }
  return bad('Unknown action');
}
