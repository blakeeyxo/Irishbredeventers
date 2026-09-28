// Home page: newest news post as the headline, and 1st places from the latest verified results.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN } from '../../lib/results.js';

export async function onRequestGet({ env }) {
  const db = env.DB;
  const [headline, winners] = await Promise.all([
    db.prepare('SELECT id, title, snippet, published_at FROM news ORDER BY published_at DESC, id DESC LIMIT 1').first(),
    db.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN}
      WHERE p.position = 1 AND p.verified = 1
        AND p.batch_id = (SELECT MAX(batch_id) FROM placings WHERE verified = 1)
      ORDER BY e.start_date DESC, e.id, c.id`).all()
  ]);
  return json({ headline, winners: winners.results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
