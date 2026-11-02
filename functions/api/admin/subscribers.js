// Results-email sign-ups, for the owner area. New ones (signed up since "Mark as seen") are flagged under Messages.
// Which ones were seen is kept in settings (subscribers_seen_id: the newest sign-up seen), so no extra column is needed.
import { json, bad, readJson } from '../../../lib/http.js';

export const SEEN_SQL = "IFNULL((SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'subscribers_seen_id'), 0)";

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, email, confirmed, created_at, id > ${SEEN_SQL} AS new FROM subscribers ORDER BY id DESC LIMIT 5000`
  ).all();
  return json({ subscribers: results });
}

// { action: 'seen' } | { action: 'delete', id }
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
  return bad('Unknown action');
}
