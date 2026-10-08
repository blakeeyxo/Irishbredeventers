// Public: one horse from the shared horse database, with pedigree, other names and progeny.
import { json, bad } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';
import { getHorse } from '../../../../lib/shared.js';

export const onRequestGet = ({ env, params }) => withShared(env, async db => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return bad('Not found', 404);
  const horse = await getHorse(db, id);
  return horse ? json({ horse }) : bad('Not found', 404);
});
