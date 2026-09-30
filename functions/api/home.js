// Home page: this week's results (the latest published upload) and the newest news post as the commentary.
import { json } from '../../lib/http.js';
import { PLACING_COLUMNS, PLACING_JOIN, PLACING_ORDER } from '../../lib/results.js';

export async function onRequestGet({ env }) {
  const db = env.DB;
  const [headline, week] = await Promise.all([
    db.prepare('SELECT id, title, snippet, published_at FROM news ORDER BY published_at DESC, id DESC LIMIT 1').first(),
    db.prepare(`SELECT ${PLACING_COLUMNS} ${PLACING_JOIN}
      WHERE p.verified = 1 AND p.batch_id = (SELECT MAX(batch_id) FROM placings WHERE verified = 1)
      ${PLACING_ORDER} LIMIT 1000`).all()
  ]);
  return json({ headline, week: week.results }, { headers: { 'cache-control': 'public, max-age=60' } });
}
