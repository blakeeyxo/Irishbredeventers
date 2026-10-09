// Owner area: browse the shared horse database (horses, stallions, pedigrees, breeders) that both sites read.
//   GET ?q=&stallions=1          horses on file (every source, hidden ones marked)
//   GET ?progeny=<id>            a horse's progeny on file
import { json } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';
import { ownerFindHorses, ownerProgeny } from '../../../../lib/shared.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  if (u.get('progeny')) return json({ progeny: await ownerProgeny(db, Number(u.get('progeny'))) });
  return json(await ownerFindHorses(db, { q: (u.get('q') || '').slice(0, 100), stallions: u.get('stallions') === '1' }));
});
