/*
 * Which site this Worker is: SITE_ID in wrangler.jsonc ("iber" by default, "ibsr" for the showjumping Worker).
 * Each site's name, wording, colours and email settings live in sites/<id>.js.
 */
import iber from '../sites/iber.js';
import ibsr from '../sites/ibsr.js';

export const SITES = { iber, ibsr };

export function siteFor(env) {
  const id = String(env && env.SITE_ID || 'iber').toLowerCase();
  const site = SITES[id];
  if (!site) throw new Error(`Unknown SITE_ID "${id}". Expected one of: ${Object.keys(SITES).join(', ')}`);
  return site;
}

// The few values the browser script needs (public/js/site.js), in a fixed order so the file never changes by accident.
export function clientConfig(site) {
  return { id: site.id, discipline: site.discipline, name: site.name, short: site.short };
}
