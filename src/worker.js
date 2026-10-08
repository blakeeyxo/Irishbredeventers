/*
 * Worker entry point.
 * Static pages in /public are served by Workers static assets (see wrangler.jsonc).
 * Only /api/*, /media/*, the owner area (/admin) and the sign-in path reach this code;
 * it hands each API request to the matching handler in /functions, which use the
 * Pages Functions calling style.
 *
 * The owner area is invisible to the public: /admin and /api/admin answer a plain 404
 * to anyone without a valid Cloudflare Access login, exactly like a page that doesn't exist.
 * Cloudflare Access guards /signin only; after the emailed-code login it sends the
 * owner on to /admin/.
 */
import * as config from '../functions/api/config.js';
import * as home from '../functions/api/home.js';
import * as results from '../functions/api/results.js';
import * as search from '../functions/api/search.js';
import * as horse from '../functions/api/horse/[id].js';
import * as stallions from '../functions/api/stallions.js';
import * as stallion from '../functions/api/stallions/[slot].js';
import * as adminStallions from '../functions/api/admin/stallions.js';
import * as adminBreeding from '../functions/api/admin/breeding.js';
import * as adminAnalytics from '../functions/api/admin/analytics.js';
import * as track from '../functions/api/track.js';
import * as news from '../functions/api/news.js';
import * as links from '../functions/api/links.js';
import * as ads from '../functions/api/ads.js';
import * as comments from '../functions/api/comments.js';
import * as corrections from '../functions/api/corrections.js';
import * as enquiries from '../functions/api/enquiries.js';
import * as subscribe from '../functions/api/subscribe.js';
import * as subscribeConfirm from '../functions/api/subscribe/confirm.js';
import * as unsubscribe from '../functions/api/unsubscribe.js';
import * as media from '../functions/media/[[path]].js';
import { verifyAccess } from '../lib/access.js';
import * as adminParse from '../functions/api/admin/parse.js';
import * as adminImport from '../functions/api/admin/import.js';
import * as adminImportCheck from '../functions/api/admin/import/check.js';
import * as adminBatches from '../functions/api/admin/batches.js';
import * as adminUnverified from '../functions/api/admin/unverified.js';
import * as adminNews from '../functions/api/admin/news.js';
import * as adminLinks from '../functions/api/admin/links.js';
import * as adminAds from '../functions/api/admin/ads.js';
import * as adminComments from '../functions/api/admin/comments.js';
import * as adminCorrections from '../functions/api/admin/corrections.js';
import * as adminEnquiries from '../functions/api/admin/enquiries.js';
import * as adminSummary from '../functions/api/admin/summary.js';
import * as sharedStallions from '../functions/api/shared/stallions.js';
import * as sharedHorse from '../functions/api/shared/horse/[id].js';
import * as adminSharedSources from '../functions/api/admin/shared/sources.js';
import * as adminSharedUpload from '../functions/api/admin/shared/upload.js';

const ROUTES = {
  '/api/config': config,
  '/api/home': home,
  '/api/results': results,
  '/api/stallions': stallions,
  '/api/search': search,
  '/api/news': news,
  '/api/links': links,
  '/api/ads': ads,
  '/api/comments': comments,
  '/api/corrections': corrections,
  '/api/enquiries': enquiries,
  '/api/subscribe': subscribe,
  '/api/subscribe/confirm': subscribeConfirm,
  '/api/unsubscribe': unsubscribe,
  '/api/admin/parse': adminParse,
  '/api/admin/import': adminImport,
  '/api/admin/import/check': adminImportCheck,
  '/api/admin/batches': adminBatches,
  '/api/admin/unverified': adminUnverified,
  '/api/admin/news': adminNews,
  '/api/admin/links': adminLinks,
  '/api/admin/ads': adminAds,
  '/api/admin/stallions': adminStallions,
  '/api/admin/breeding': adminBreeding,
  '/api/admin/analytics': adminAnalytics,
  '/api/track': track,
  '/api/admin/comments': adminComments,
  '/api/admin/corrections': adminCorrections,
  '/api/admin/enquiries': adminEnquiries,
  '/api/admin/summary': adminSummary,
  // Shared horse database (both sites): stallions, horses, pedigree, breeders.
  '/api/shared/stallions': sharedStallions,
  '/api/admin/shared/sources': adminSharedSources,
  '/api/admin/shared/upload': adminSharedUpload
};

const METHOD_EXPORT = { GET: 'onRequestGet', HEAD: 'onRequestGet', POST: 'onRequestPost', DELETE: 'onRequestDelete' };

function match(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (ROUTES[path]) return { mod: ROUTES[path], params: {} };
  const h = path.match(/^\/api\/horse\/([^/]+)$/);
  if (h) return { mod: horse, params: { id: decodeURIComponent(h[1]) } };
  const sh = path.match(/^\/api\/shared\/horse\/(\d+)$/);
  if (sh) return { mod: sharedHorse, params: { id: sh[1] } };
  const st = path.match(/^\/api\/stallions\/(\d)$/);
  if (st) return { mod: stallion, params: { slot: st[1] } };
  if (path.startsWith('/media/')) return { mod: media, params: { path: path.slice(7).split('/') } };
  return null;
}

// Keep in step with "run_worker_first" in wrangler.jsonc and the Access application.
const SIGN_IN = /^\/signin(\/|$)/;
const OWNER_PAGES = /^\/admin(\/|$)/;
const OWNER_API = /^\/api\/admin(\/|$)/;

const CACHEABLE = /^\/api\/(home|results|search|news|links|ads|config|stallions(\/\d)?|horse\/[^/]+|shared\/stallions|shared\/horse\/\d+)$/;
const EDGE_SECONDS = 300;
// The pages the public site loads first; anything else expires by itself within EDGE_SECONDS.
async function clearPublicCache(origin) {
  const year = new Date().getFullYear();
  const paths = ['/api/home', '/api/news', '/api/links', '/api/ads', '/api/config', '/api/stallions', '/api/results', '/api/shared/stallions',
    `/api/results?season=${year}`, `/api/results?season=${year - 1}`, ...[1, 2, 3, 4, 5, 6].map(n => `/api/stallions/${n}`)];
  await Promise.all(paths.map(p => caches.default.delete(new Request(origin + p)).catch(() => {})));
}

const PRIVATE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };
const jsonError = (message, status) => new Response(JSON.stringify({ error: message }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...PRIVATE }
});
const notFoundPage = () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', ...PRIVATE } });

async function ownerLogin(request, env, why) {
  try { return await verifyAccess(request, env, why); } catch (e) { console.error(e); why.reason = 'check-failed'; return null; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Owner area: decided before anything else, so a stranger learns nothing (no 401, 405 or 503).
    const ownerPage = OWNER_PAGES.test(path), ownerApi = OWNER_API.test(path), signIn = SIGN_IN.test(path);
    let user = null;
    if (ownerPage || ownerApi || signIn) {
      const why = {};
      user = await ownerLogin(request, env, why);
      if (!user) {
        console.warn(`Owner login refused (${why.reason || 'unknown'}): ${request.method} ${path}`);
        // Someone who has signed in before (an owner login is on the request) but whose login has expired or
        // doesn't fit is told so, instead of a "Not found" that looks like a broken page. Anyone else still
        // gets the plain 404.
        if (ownerApi && !['no-token', 'not-configured'].includes(why.reason)) {
          return jsonError(why.reason === 'check-failed'
            ? "We couldn't check your owner-area login just now. Nothing was saved. Try again in a moment."
            : 'Your owner-area login has expired. Nothing was saved. Reload the page and sign in again, then save once more.', 401);
        }
        return ownerApi ? jsonError('Not found', 404) : notFoundPage();
      }
      if (signIn) return new Response(null, { status: 302, headers: { location: '/admin/', ...PRIVATE } });
      if (ownerPage) {
        const res = await env.ASSETS.fetch(request);
        const out = new Response(res.body, res);
        for (const [k, v] of Object.entries(PRIVATE)) out.headers.set(k, v);
        return out;
      }
    }

    const found = match(path);
    if (!found) return jsonError('Not found', 404);
    const handler = found.mod[METHOD_EXPORT[request.method]] || found.mod.onRequest;
    if (!handler) return jsonError('Method not allowed', 405);
    if (!env.DB) return jsonError('The database is not connected yet.', 503);

    const context = {
      request, env, params: found.params, data: { user },
      waitUntil: p => ctx.waitUntil(p),
      next: () => handler(context)
    };
    // Public reads are kept at the edge for a few minutes, so a busy day (or a crawler) costs the database one
    // read of each page, not one per visit. The owner area clears them after every save.
    const cacheable = request.method === 'GET' && !ownerApi && CACHEABLE.test(path);
    const cacheKey = cacheable ? new Request(url.origin + path + url.search) : null;
    if (cacheable) {
      const hit = await caches.default.match(cacheKey).catch(() => null);
      if (hit) return hit;
    }
    try {
      const res = await handler(context);
      if (cacheable && res.status === 200) {
        const stored = new Response(res.clone().body, res);
        stored.headers.set('cache-control', `public, max-age=${EDGE_SECONDS}`);
        ctx.waitUntil(caches.default.put(cacheKey, stored).catch(() => {}));
      }
      if (ownerApi && request.method !== 'GET' && res.status < 400) ctx.waitUntil(clearPublicCache(url.origin));
      if (!ownerApi) return res;
      const out = new Response(res.body, res);
      for (const [k, v] of Object.entries(PRIVATE)) out.headers.set(k, v);
      return out;
    } catch (e) {
      console.error('handler failed', path, e && e.stack || e);
      // The owner area is behind a login, so it gets the real reason; the public site does not.
      return jsonError(ownerApi ? `Something went wrong on the server: ${String(e && e.message || e).slice(0, 300)}` : 'Something went wrong on the server.', 500);
    }
  }
};
