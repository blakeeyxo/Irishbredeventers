// Counts a visit, a page view or a click on an advert or link card for the owner area's analytics. Only a daily
// total per page or advert is kept: no cookies, IP addresses or anything that identifies a person.
import { json } from '../../lib/http.js';

const PAGES = ['home', 'results', 'news', 'article', 'stallions', 'stallion', 'about', 'search', 'horse'];
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

export async function onRequestPost({ env, request }) {
  const ok = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  if (BOT.test(request.headers.get('user-agent') || '')) return ok();
  let b;
  try { b = JSON.parse((await request.text()).slice(0, 500)); } catch { return ok(); }
  let kind = String(b && b.k || ''), key = '';
  if (kind === 'visit') key = '';
  else if (kind === 'view' && PAGES.includes(b.p)) key = b.p;
  else if (kind === 'ad' && /^\d{1,9}$/.test(String(b.a)) && /^[a-z]+:[a-z0-9]+$/.test(String(b.s))) key = `${b.a}|${b.s}`;
  else if (kind === 'link' && /^\d{1,9}$/.test(String(b.a))) key = String(b.a);
  else return ok();
  const day = new Date().toISOString().slice(0, 10);
  await env.DB.prepare(`INSERT INTO analytics (day, kind, key, count) VALUES (?, ?, ?, 1)
    ON CONFLICT(day, kind, key) DO UPDATE SET count = count + 1`).bind(day, kind, key).run();
  return ok();
}

export const onRequestGet = () => json({ error: 'Not found' }, { status: 404 });
