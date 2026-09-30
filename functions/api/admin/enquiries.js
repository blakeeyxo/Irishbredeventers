// Advertising enquiries queue, with a "done" action.
import { json, bad, readJson } from '../../../lib/http.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, business, email, phone, interest, message, status, created_at FROM enquiries ORDER BY status = 'open' DESC, created_at DESC LIMIT 300`
  ).all();
  return json({ enquiries: results });
}

// { id, action: 'done' | 'delete' }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Bad id');
  if (b.action === 'done') await env.DB.prepare(`UPDATE enquiries SET status = 'done' WHERE id = ?`).bind(id).run();
  else if (b.action === 'delete') await env.DB.prepare('DELETE FROM enquiries WHERE id = ?').bind(id).run();
  else return bad('Unknown action');
  return json({ ok: true });
}
