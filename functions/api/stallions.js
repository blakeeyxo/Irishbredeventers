// The Stallions page: the six listings with their progeny's numbers, and the sires mentioned most,
// all over the same rolling 12 months.
import { json } from '../../lib/http.js';
import { progeny, summary, rollingWindow, topSires } from '../../lib/stallions.js';

export async function onRequestGet({ env }) {
  const win = rollingWindow();
  const { results } = await env.DB.prepare(`SELECT slot, name, blurb, link, image_key, sire_names FROM stallions WHERE name <> '' ORDER BY slot`).all();
  const listings = [];
  for (let slot = 1; slot <= 6; slot++) {
    const s = results.find(x => x.slot === slot);
    if (!s) { listings.push({ slot }); continue; }
    const { sire_names, ...pub } = s;
    listings.push({ ...pub, totals: summary(await progeny(env.DB, sire_names, win)) });
  }
  return json({ window: win, listings, top: await topSires(env.DB, win, 10) }, { headers: { 'cache-control': 'public, max-age=120' } });
}
