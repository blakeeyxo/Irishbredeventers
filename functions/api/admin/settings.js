// Owner-area settings: advert prices per slot type (Top, Side). Never shown on the public site.
import { json, bad, readJson } from '../../../lib/http.js';

const KEYS = ['ad_price_top', 'ad_price_side'];

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings`).all();
  return json({ settings: Object.fromEntries(results.map(r => [r.key, r.value])) });
}

// { ad_price_top: 3000, ad_price_side: 600 }
export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  const stmts = [];
  for (const k of KEYS) {
    if (!(k in b)) continue;
    const v = Number(b[k]);
    if (!Number.isFinite(v) || v < 0 || v > 1e6) return bad('Prices must be a number of euros.');
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(Math.round(v))));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}
