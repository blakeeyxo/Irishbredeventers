// Loads the example ads in seed/example-ads into the LOCAL site, so the ad layout can be seen with real-looking ads.
//   npm run ads:local            (needs `npm run dev` running; localhost only)
// The businesses are invented and every image is marked "Example ad". Remove them in the owner area (Ads tab).
import { readFileSync } from 'node:fs';

const base = 'http://localhost:8787';
const DIR = new URL('../seed/example-ads/', import.meta.url);
const ADS = [
  ['large', 'Kilmore Equine Nutrition', 'banner-kilmore-feeds.png'],
  ['large', 'Slaney Valley Saddlery', 'banner-slaney-saddlery.png'],
  ['small', 'Ballyvale Stud', 'box-ballyvale-stud.png'],
  ['small', 'Glenmara Sport Horses', 'box-glenmara-sport-horses.png'],
  ['small', 'Corrib Horse Transport', 'box-corrib-transport.png'],
  ['small', 'Ardnagh Equine Vets', 'box-ardnagh-vets.png'],
  ['small', 'Knockbrack Farriery', 'box-knockbrack-farriery.png'],
  ['small', 'Riverbank Rugs & Tack', 'box-riverbank-tack.png'],
  ['small', 'Mullaghmore Eventing', 'box-mullaghmore-yard.png'],
  ['small', 'Carrigeen Haylage', 'box-carrigeen-haylage.png']
];

const have = new Set((await (await fetch(`${base}/api/admin/ads`)).json()).ads.map(a => a.name));
for (const [tier, name, file] of ADS) {
  if (have.has(name)) { console.log(`already there: ${name}`); continue; }
  const form = new FormData();
  form.append('tier', tier);
  form.append('name', name);
  form.append('link', '');
  form.append('image', new Blob([readFileSync(new URL(file, DIR))], { type: 'image/png' }), file);
  const res = await fetch(`${base}/api/admin/ads`, { method: 'POST', body: form });
  console.log(res.ok ? `added: ${name}` : `failed: ${name} (${res.status})`);
}
