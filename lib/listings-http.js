// Shared helpers for the For Sale handlers.
import { SITES, siteFor } from './sites.js';
import { siteUrl } from './http.js';

// The address of an ad: on this site if the ad is shown here, otherwise on the site for its discipline.
export function listingUrl(env, request, id, disciplines) {
  const here = siteFor(env);
  if (!disciplines.length || disciplines.includes(here.discipline)) return `${siteUrl(env, request)}/for-sale/${id}`;
  const other = Object.values(SITES).find(s => disciplines.includes(s.discipline));
  return `${(other || here).publicUrl || siteUrl(env, request)}/for-sale/${id}`;
}

export function needsListingStorage(env) {
  return !env.LISTING_MEDIA ? 'Photo storage for For Sale is not connected to this site yet.' : null;
}
