// Owner area: breeding records. GET ?q=&sire=&gaps=1 finds horses (?kind=sires&q= finds sires); POST { id, ...fields }
// saves a horse, or { kind: 'sire', id, name, breed, tih, merge_into } a sire.
import { json, bad, readJson } from '../../../lib/http.js';
import { findHorses, gapCount, saveBreeding, findSires, saveSire, findStallions, horseResults, deleteResult, deleteHorse } from '../../../lib/breeding.js';
import { fillPlan, fillApply } from '../../../lib/fill.js';

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url).searchParams;
  const q = (u.get('q') || '').slice(0, 100), sire = (u.get('sire') || '').slice(0, 300), gaps = u.get('gaps') === '1';
  // ?fill=1 lists the breeding gaps the shared horse database can fill.
  if (u.get('fill') === '1') {
    if (!env.SHARED) return bad('The shared horse database is not connected to this site yet.', 503);
    const plan = await fillPlan(env.DB, env.SHARED);
    return json({ plan: plan.map(({ current, ...p }) => p) });
  }
  // ?results=<horse id>: that horse's results, to delete any of them.
  if (u.get('results')) {
    const id = Number(u.get('results'));
    return json({ results: await horseResults(env.DB, id) });
  }
  if (u.get('kind') === 'sires') return json({ sires: await findSires(env.DB, { q }) });
  const [found, missing, sires, stallions] = await Promise.all([
    findHorses(env.DB, { q, sire, gaps }),
    gapCount(env.DB),
    env.DB.prepare('SELECT name FROM sires ORDER BY name').all(),
    findStallions(env.DB, { q, sire })
  ]);
  return json({ ...found, stallions, gaps: missing, sires: sires.results.map(s => s.name) });
}

export async function onRequestPost({ env, request, data }) {
  const b = await readJson(request);
  // { action: 'fill', ids } fills those horses' gaps from the shared horse database.
  if (b && b.action === 'fill') {
    if (!env.SHARED) return bad('The shared horse database is not connected to this site yet.', 503);
    const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter(Number.isInteger) : null;
    return json({ ok: true, ...(await fillApply(env.DB, env.SHARED, { ids, user: data && data.user ? data.user.email : '' })) });
  }
  // Deleting: { action: 'delete_result', result_id } or { action: 'delete_horse', id }.
  if (b && b.action === 'delete_result') {
    const rid = Number(b.result_id);
    try { await deleteResult(env.DB, rid); return json({ ok: true }); }
    catch (e) { return bad(e.message); }
  }
  if (b && b.action === 'delete_horse') {
    const hid = Number(b.id);
    try { return json({ ok: true, ...(await deleteHorse(env.DB, hid)) }); }
    catch (e) { return bad(e.message); }
  }
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Choose a horse.');
  try {
    return json({ ok: true, ...(b.kind === 'sire' ? await saveSire(env.DB, id, b) : await saveBreeding(env.DB, id, b)) });
  } catch (e) {
    return bad(e.message);
  }
}
