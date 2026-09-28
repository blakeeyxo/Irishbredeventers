// Every owner-area API call must carry a valid Cloudflare Access login.
import { verifyAccess } from '../../../lib/access.js';
import { bad } from '../../../lib/http.js';

export async function onRequest(context) {
  let user = null;
  try { user = await verifyAccess(context.request, context.env); } catch (e) { console.error(e); }
  if (!user) return bad('Please log in to the owner area.', 401);
  context.data.user = user;
  return context.next();
}
