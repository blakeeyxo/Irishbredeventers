// Owner area: breeding records. GET ?q=&sire=&gaps=1 finds horses (?kind=sires&q= finds sires); POST { id, ...fields }
// saves a horse, or { kind: 'sire', id, name, breed, tih, merge_into } a sire.
import { json, bad, readJson } from '../../../lib/http.js';
import { findHorses, gapCount, saveBreeding, findSires, saveSire, findStallions } from '../../../lib/breeding.js';
import { sjBreedingList, sjSaveBreeding, sjBreedingSheet } from '../../../lib/sj.js';
import { siteFor } from '../../../lib/sites.js';
import { importShdPages } from '../../../lib/auto.js';

// On the showjumping site the horses live in the shared database (env.SHARED), so its breeding is edited there.
const shared = env => siteFor(env).discipline === 'showjumping';

export async function onRequestGet({ env, request }) {
  const u = new URL(request.url).searchParams;
  const q = (u.get('q') || '').slice(0, 100), sire = (u.get('sire') || '').slice(0, 300), gaps = u.get('gaps') === '1';
  if (shared(env) && u.get('format') === 'csv') {
    return new Response('\ufeff' + await sjBreedingSheet(env.SHARED, { gaps }), { headers: {
      'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="ibsr-breeding-${gaps ? 'missing' : 'all'}.csv"` } });
  }
  if (shared(env)) return json(await sjBreedingList(env.SHARED, { q, sire, gaps }));
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
  // Saved SporthorseData horse pages (IBSR): { action: 'shd', pages: [html…], save }
  if (shared(env) && b && b.action === 'shd') {
    const pages = Array.isArray(b.pages) ? b.pages.map(String).slice(0, 60) : [];
    try { return json({ ok: true, ...(await importShdPages(env.SHARED, pages, { save: Boolean(b.save), user: data && data.user ? data.user.email : '' })) }); }
    catch (e) { return bad(e.message); }
  }
  const id = Number(b && b.id);
  if (!Number.isInteger(id)) return bad('Choose a horse.');
  try {
    if (shared(env)) return json({ ok: true, ...(await sjSaveBreeding(env.SHARED, id, b, data && data.user ? data.user.email : '')) });
    return json({ ok: true, ...(b.kind === 'sire' ? await saveSire(env.DB, id, b) : await saveBreeding(env.DB, id, b)) });
  } catch (e) {
    return bad(e.message);
  }
}
