// Loads seed/starter-content.json (news articles and link cards) into the LOCAL site.
//   npm run content:local        (needs `npm run dev` running; localhost only)
// Skips anything with a title already on the site, so it is safe to run twice.
import { readFileSync } from 'node:fs';

const base = 'http://localhost:8787';
const data = JSON.parse(readFileSync(new URL('../seed/starter-content.json', import.meta.url), 'utf8'));

async function post(url, fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, String(v));
  const res = await fetch(base + url, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`${url}: ${(await res.json().catch(() => ({}))).error || res.status}`);
}

const haveLinks = new Set((await (await fetch(`${base}/api/admin/links`)).json()).links.map(l => l.title));
for (const l of [...data.links].reverse()) { // new cards go to the top, so add the last one first
  if (haveLinks.has(l.title)) { console.log(`already there: ${l.title}`); continue; }
  await post('/api/admin/links', { title: l.title, url: l.url, source_name: l.source_name, teaser: l.teaser, date: l.date });
  console.log(`link card: ${l.title}`);
}
const haveNews = new Set((await (await fetch(`${base}/api/admin/news`)).json()).news.map(n => n.title));
for (const n of [...data.news].reverse()) {
  if (haveNews.has(n.title)) { console.log(`already there: ${n.title}`); continue; }
  await post('/api/admin/news', { title: n.title, body: n.body, date: n.date, source_url: n.source_url, source_name: n.source_name });
  console.log(`article: ${n.title}`);
}
