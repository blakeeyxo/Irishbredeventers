// Counts for the owner area tabs.
import { json } from '../../../lib/http.js';
import { COUNTRIES } from '../../../lib/parser.js';

export async function onRequestGet({ env, data }) {
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM placings WHERE verified = 0) AS unverified,
      (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS comments,
      (SELECT COUNT(*) FROM corrections WHERE status = 'open') AS corrections,
      (SELECT COUNT(*) FROM enquiries WHERE status = 'open') AS enquiries,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 1) AS subscribers,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 0) AS unconfirmed`).first();
  return json({ ...r, user: data.user.email, mailReady: Boolean(env.MAIL_API_KEY && env.MAIL_FROM), countries: COUNTRIES });
}
