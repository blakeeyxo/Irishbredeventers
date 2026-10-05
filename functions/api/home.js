// Home page: the first-placed horses from the latest week (the upload holding the most recent event),
// and the top news article as the commentary. A gap in the breeding (OIO / UNK) doesn't stop a winner showing.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER, PUBLIC_SQL } from '../../lib/results.js';

export async function onRequestGet({ env }) {
  const db = env.DB;
  const [headline, week] = await Promise.all([
    db.prepare('SELECT id, title, snippet, published_at FROM news ORDER BY sort_order ASC, published_at DESC, id DESC LIMIT 1').first(),
    db.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN}
      WHERE ${PUBLIC_SQL} AND p.position = 1 AND p.batch_id = (
        -- the upload holding the most recent event, so loading older results never replaces this week
        SELECT p2.batch_id FROM placings p2 JOIN classes c2 ON c2.id = p2.class_id JOIN events e2 ON e2.id = c2.event_id
        WHERE p2.verified = 1 AND COALESCE((SELECT published FROM batches WHERE id = p2.batch_id), 1) = 1
        ORDER BY e2.start_date DESC, p2.batch_id DESC LIMIT 1)
      ${PLACING_ORDER} LIMIT 1000`).all()
  ]);
  return json({ headline, week: week.results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
