// The six stallion listings on the Stallions page, each with its progeny's headline numbers.
import { json } from '../../lib/http.js';
import { progeny, summary } from '../../lib/stallions.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT slot, name, blurb, link, image_key, sire_names FROM stallions WHERE name <> '' ORDER BY slot`).all();
  const listings = [];
  for (let slot = 1; slot <= 6; slot++) {
    const s = results.find(x => x.slot === slot);
    if (!s) { listings.push({ slot }); continue; }
    const { sire_names, ...pub } = s;
    listings.push({ ...pub, totals: summary(await progeny(env.DB, sire_names)) });
  }
  return json({ listings }, { headers: { 'cache-control': 'public, max-age=120' } });
}
