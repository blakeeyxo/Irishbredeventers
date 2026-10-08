// Public: stallions in the shared horse database. GET ?q=&limit=&offset=
import { json } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { listStallions } from '../../../lib/shared.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  return json({ stallions: await listStallions(db, { q: (u.get('q') || '').slice(0, 100), limit: u.get('limit'), offset: u.get('offset') }) });
});
