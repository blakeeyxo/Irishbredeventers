// Counts for the owner area tabs.
import { json } from '../../../lib/http.js';
import { COUNTRIES } from '../../../lib/parser.js';
import { TO_CHECK_SQL } from '../../../lib/results.js';
import { tidyKnownSires } from '../../../lib/breeding.js';

export async function onRequestGet({ env, data }) {
  // Every owner-area visit links any spelling of a known stallion (OBOS Quality 004) to its record.
  await tidyKnownSires(env.DB).catch(e => console.error('sire tidy failed', e));
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM placings p WHERE ${TO_CHECK_SQL}) AS unverified,
      (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS comments,
      (SELECT COUNT(*) FROM corrections WHERE status = 'open') AS corrections,
      (SELECT COUNT(*) FROM enquiries WHERE status = 'open') AS enquiries,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 1) AS subscribers,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 0) AS unconfirmed`).first();
  return json({ ...r, user: data.user.email, mailReady: Boolean(env.MAIL_API_KEY && env.MAIL_FROM), countries: COUNTRIES });
}
