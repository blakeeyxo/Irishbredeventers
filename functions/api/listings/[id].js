// Public: one For Sale ad, with the horse's breeding from the shared database when the ad is linked to it.
import { json, bad } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { getPublic } from '../../../lib/listings.js';
import { getHorse } from '../../../lib/shared.js';

export const onRequestGet = ({ env, params }) => withShared(env, async db => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return bad('Not found', 404);
  const listing = await getPublic(db, id, siteFor(env).discipline);
  if (!listing) return bad('This ad is no longer on the site.', 404);
  const horse = listing.horse_id ? await getHorse(db, listing.horse_id) : null;
  return json({ listing, horse: horse && { id: horse.id, pedigree: horse.pedigree, breeder: horse.breeder, breeder_county: horse.breeder_county, progeny: horse.progeny.length } });
});
