// Downloads Charlie's weekly Irish-Bred Results articles from Horse Sport Ireland and caches the raw HTML.
//
//   node scripts/scrape-hsi.mjs [--since 2026-01-01] [--cache .cache/hsi] [--refresh]
//
// Reads the category listing ?paged=1, 2, 3… and stops after the first page whose articles are all
// older than --since. Every article dated on or after --since is downloaded once into the cache;
// rerunning only fetches what is missing (listing pages are always refreshed unless they're older).
// Waits 1.5 seconds between requests. Writes <cache>/index.json: [{ url, title, date }], newest first.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const SINCE = opt('--since', '2026-01-01');
const CACHE = opt('--cache', '.cache/hsi');
const REFRESH = args.includes('--refresh');
const LISTING = 'https://www.horsesportireland.ie/category/breeding-production/irish-bred-results/';
const UA = 'Mozilla/5.0 (compatible; IBER results import; +https://irishbredeventers.ie)';
const DELAY_MS = 1500;

mkdirSync(join(CACHE, 'pages'), { recursive: true });
mkdirSync(join(CACHE, 'articles'), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let lastRequest = 0;
async function get(url) {
  const wait = lastRequest + DELAY_MS - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 1; ; attempt++) {
    lastRequest = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt >= 4) throw new Error(`${url}: ${err.message}`);
      await sleep(DELAY_MS * 2 ** attempt);
    }
  }
}

const decode = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
  .replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"');

/** Listing page HTML → [{ url, title, date }] */
export function readListing(html) {
  const out = [];
  for (const m of html.matchAll(/<article\b[\s\S]*?<\/article>/g)) {
    const a = m[0];
    const time = a.match(/<time datetime="(\d{4}-\d{2}-\d{2})/);
    const link = a.match(/<a href="([^"]+)">\s*<h1>([\s\S]*?)<\/h1>/);
    if (time && link) out.push({ url: link[1], title: decode(link[2].replace(/<[^>]+>/g, '').trim()), date: time[1] });
  }
  return out;
}

const slug = url => new URL(url).pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9-]+/gi, '_') || 'index';

async function main() {
  const found = [];
  for (let page = 1; page < 200; page++) {
    const file = join(CACHE, 'pages', `page-${page}.html`);
    const html = await get(page === 1 ? LISTING : `${LISTING}?paged=${page}`);
    if (html === null) { console.log(`page ${page}: not found, stopping`); break; }
    writeFileSync(file, html);
    const items = readListing(html);
    if (!items.length) { console.log(`page ${page}: no articles, stopping`); break; }
    const keep = items.filter(i => i.date >= SINCE);
    found.push(...keep);
    console.log(`page ${page}: ${items.length} articles, ${keep.length} on or after ${SINCE} (${items[items.length - 1].date} … ${items[0].date})`);
    if (!keep.length) break;
  }

  const seen = new Set();
  const index = found.filter(i => !seen.has(i.url) && seen.add(i.url));
  for (const item of index) {
    item.file = join('articles', `${item.date}_${slug(item.url)}.html`);
    const path = join(CACHE, item.file);
    if (existsSync(path) && !REFRESH) continue;
    const html = await get(item.url);
    if (html === null) { console.log(`missing: ${item.url}`); item.missing = true; continue; }
    writeFileSync(path, html);
    console.log(`saved ${item.date} ${item.title}`);
  }
  writeFileSync(join(CACHE, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`${index.length} articles since ${SINCE} → ${join(CACHE, 'index.json')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(err => { console.error(err.message); process.exit(1); });
