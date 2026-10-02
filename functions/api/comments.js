// Comments: approved ones are public; new ones wait for approval in the owner area.
import { json, bad, readJson, str, text, verifyTurnstile } from '../../lib/http.js';

const SCOPES = ['results', 'news'];

export async function onRequestGet({ env, request }) {
  const scope = new URL(request.url).searchParams.get('scope');
  if (!SCOPES.includes(scope)) return bad('Unknown scope');
  const { results } = await env.DB.prepare(
    `SELECT id, name, body, created_at FROM comments WHERE status = 'approved' AND scope = ? ORDER BY created_at DESC LIMIT 200`
  ).bind(scope).all();
  return json({ comments: results });
}

export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  const scope = SCOPES.includes(b.scope) ? b.scope : null;
  const name = str(b.name, 60);
  const body = text(b.body, 600);
  if (!scope || !name || !body) return bad('Please add your name and a comment.');
  // Comments are held for approval anyway, so a failed or missing spam check doesn't turn a genuine comment
  // away: it goes to the queue marked, and the owner decides.
  const passed = await verifyTurnstile(env, b.turnstile, request).catch(() => false);
  await env.DB.prepare('INSERT INTO comments (scope, name, body, spam_check) VALUES (?, ?, ?, ?)').bind(scope, name, body, passed ? 'passed' : 'failed').run();
  return json({ ok: true });
}
