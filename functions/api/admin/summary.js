// Counts for the owner area tabs.
import { json } from '../../../lib/http.js';
import { COUNTRIES } from '../../../lib/parser.js';
import { TO_CHECK_SQL } from '../../../lib/results.js';
import { tidyKnownSires } from '../../../lib/breeding.js';
import { siteFor } from '../../../lib/sites.js';

let lastTidy = 0;

export async function onRequestGet({ env, data }) {
  // Every owner-area visit links any spelling of a known stallion (OBOS Quality 004) to its record.
  // Reads every sire, so at most once every half hour.
  if (Date.now() - lastTidy > 30 * 60 * 1000) { lastTidy = Date.now(); await tidyKnownSires(env.DB).catch(e => console.error('sire tidy failed', e)); }
  const r = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM placings p WHERE ${TO_CHECK_SQL}) AS unverified,
      (SELECT COUNT(*) FROM comments WHERE status = 'pending') AS comments,
      (SELECT COUNT(*) FROM corrections WHERE status = 'open') AS corrections,
      (SELECT COUNT(*) FROM enquiries WHERE status = 'open') AS enquiries,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 1) AS subscribers,
      (SELECT COUNT(*) FROM subscribers WHERE confirmed = 0) AS unconfirmed`).first();
  // Results and breeding sent in (showjumping site, shared database) also wait under Messages.
  let submissions = 0;
  if (env.SHARED && siteFor(env).discipline === 'showjumping') {
    submissions = await env.SHARED.prepare("SELECT COUNT(*) AS n FROM submission WHERE site = ? AND status = 'pending'").bind(siteFor(env).id).first()
      .then(x => x.n).catch(() => 0);
  }
  return json({ ...r, submissions, user: data.user.email, mailReady: Boolean(env.MAIL_API_KEY && env.MAIL_FROM), countries: COUNTRIES });
}
