// Loads the example ads in seed/example-ads into the LOCAL site, so the ad layout can be seen with real-looking ads.
//   npm run ads:local            banners + 3 side boxes booked into slots 2, 5 and 8
//   npm run ads:local -- --all   banners + all 8 side boxes
// (needs `npm run dev` running; localhost only)
// The businesses are invented and every image is marked "Example ad". Remove them in the owner area (Ads tab).
import { readFileSync } from 'node:fs';

const base = 'http://localhost:8787';
const DIR = new URL('../seed/example-ads/', import.meta.url);
// [tier, name, image, slot]
const ALL = [
  ['large', 'Kilmore Equine Nutrition', 'banner-kilmore-feeds.png'],
  ['large', 'Slaney Valley Saddlery', 'banner-slaney-saddlery.png'],
  ['small', 'Ballyvale Stud', 'box-ballyvale-stud.png', 2],
  ['small', 'Corrib Horse Transport', 'box-corrib-transport.png', 5],
  ['small', 'Riverbank Rugs & Tack', 'box-riverbank-tack.png', 8],
  ['small', 'Glenmara Sport Horses', 'box-glenmara-sport-horses.png'],
  ['small', 'Ardnagh Equine Vets', 'box-ardnagh-vets.png'],
  ['small', 'Knockbrack Farriery', 'box-knockbrack-farriery.png'],
  ['small', 'Mullaghmore Eventing', 'box-mullaghmore-yard.png'],
  ['small', 'Carrigeen Haylage', 'box-carrigeen-haylage.png']
];
const ADS = process.argv.includes('--all') ? ALL : ALL.filter(a => a[0] === 'large' || a[3]);

const have = new Set((await (await fetch(`${base}/api/admin/ads`)).json()).ads.map(a => a.name));
for (const [tier, name, file, slot] of ADS) {
  if (have.has(name)) { console.log(`already there: ${name}`); continue; }
  const form = new FormData();
  form.append('tier', tier);
  form.append('name', name);
  form.append('link', '');
  if (slot) form.append('slot', String(slot));
  form.append('image', new Blob([readFileSync(new URL(file, DIR))], { type: 'image/png' }), file);
  const res = await fetch(`${base}/api/admin/ads`, { method: 'POST', body: form });
  console.log(res.ok ? `added: ${name}` : `failed: ${name} (${res.status})`);
}
