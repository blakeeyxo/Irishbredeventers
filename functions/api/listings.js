// Public: For Sale ads on this site. GET ?sex=&age_min=&age_max=&height_min=&height_max=&price_min=&price_max=&county=&q=&sort=&page=
import { json } from '../../lib/http.js';
import { withShared } from '../../lib/shared-http.js';
import { siteFor } from '../../lib/sites.js';
import { listPublic } from '../../lib/listings.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const p = Object.fromEntries(new URL(request.url).searchParams);
  return json(await listPublic(db, siteFor(env).discipline, p));
});
