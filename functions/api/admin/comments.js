// Comments queue: approve or delete.
import { json, bad, readJson } from '../../../lib/http.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, scope, name, body, status, created_at FROM comments ORDER BY status = 'pending' DESC, created_at DESC LIMIT 300`
  ).all();
  return json({ comments: results });
}

// { id, action: 'approve' | 'delete' }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Bad id');
  if (b.action === 'approve') await env.DB.prepare(`UPDATE comments SET status = 'approved' WHERE id = ?`).bind(id).run();
  else if (b.action === 'delete') await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  else return bad('Unknown action');
  return json({ ok: true });
}
