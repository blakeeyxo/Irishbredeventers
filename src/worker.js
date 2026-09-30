/*
 * Worker entry point.
 * Static pages in /public are served by Workers static assets (see wrangler.jsonc).
 * Only /api/* and /media/* reach this code; it hands each request to the matching
 * handler in /functions, which use the Pages Functions calling style.
 */
import * as config from '../functions/api/config.js';
import * as home from '../functions/api/home.js';
import * as results from '../functions/api/results.js';
import * as search from '../functions/api/search.js';
import * as horse from '../functions/api/horse/[id].js';
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
import * as adminMiddleware from '../functions/api/admin/_middleware.js';
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

const ROUTES = {
  '/api/config': config,
  '/api/home': home,
  '/api/results': results,
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
  '/api/admin/comments': adminComments,
  '/api/admin/corrections': adminCorrections,
  '/api/admin/enquiries': adminEnquiries,
  '/api/admin/summary': adminSummary
};

const METHOD_EXPORT = { GET: 'onRequestGet', HEAD: 'onRequestGet', POST: 'onRequestPost', DELETE: 'onRequestDelete' };

function match(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (ROUTES[path]) return { mod: ROUTES[path], params: {} };
  const h = path.match(/^\/api\/horse\/([^/]+)$/);
  if (h) return { mod: horse, params: { id: decodeURIComponent(h[1]) } };
  if (path.startsWith('/media/')) return { mod: media, params: { path: path.slice(7).split('/') } };
  return null;
}

const jsonError = (message, status) => new Response(JSON.stringify({ error: message }), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const found = match(url.pathname);
    if (!found) return jsonError('Not found', 404);
    const handler = found.mod[METHOD_EXPORT[request.method]] || found.mod.onRequest;
    if (!handler) return jsonError('Method not allowed', 405);
    if (!env.DB) return jsonError('The database is not connected yet.', 503);

    const context = {
      request, env, params: found.params, data: {},
      waitUntil: p => ctx.waitUntil(p),
      next: () => handler(context)
    };
    try {
      if (url.pathname.startsWith('/api/admin/')) return await adminMiddleware.onRequest(context);
      return await handler(context);
    } catch (e) {
      console.error(e);
      return jsonError('Something went wrong on the server.', 500);
    }
  }
};
