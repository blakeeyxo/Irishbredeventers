// Owner area: breeding records. GET ?q=&sire=&gaps=1 finds horses; POST { id, ...fields } saves one.
import { json, bad, readJson } from '../../../lib/http.js';
import { findHorses, gapCount, saveBreeding } from '../../../lib/breeding.js';

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url).searchParams;
  const q = (u.get('q') || '').slice(0, 100), sire = (u.get('sire') || '').slice(0, 300), gaps = u.get('gaps') === '1';
  const [found, missing, sires] = await Promise.all([
    findHorses(env.DB, { q, sire, gaps }),
    gapCount(env.DB),
    env.DB.prepare('SELECT name FROM sires ORDER BY name').all()
  ]);
  return json({ ...found, gaps: missing, sires: sires.results.map(s => s.name) });
}

export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Choose a horse.');
  try {
    return json({ ok: true, ...(await saveBreeding(env.DB, id, b)) });
  } catch (e) {
    return bad(e.message);
  }
}
