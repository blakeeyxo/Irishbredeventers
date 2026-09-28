// Published uploads. Each one can be removed whole.
import { json, bad } from '../../../lib/http.js';
import { deleteBatch } from '../../../lib/results.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    'SELECT id, created_at, label, row_count, unverified_count FROM batches ORDER BY id DESC LIMIT 100'
  ).all();
  return json({ batches: results });
}

export async function onRequestDelete({ env, request }) {
  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return bad('Bad id');
  await deleteBatch(env.DB, id);
  return json({ ok: true });
}
