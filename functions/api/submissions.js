// "Send in a result" (IBSR): a missing result, a correction or breeding from an owner, breeder or rider. It waits for
// approval in the owner area before anything changes on the site.
import { json, bad, readJson, verifyTurnstile } from '../../lib/http.js';
import { siteFor } from '../../lib/sites.js';
import { readSubmission, saveSubmission } from '../../lib/submissions.js';

export async function onRequestPost({ env, request }) {
  const site = siteFor(env);
  if (site.discipline !== 'showjumping' || !env.SHARED) return bad('Not found', 404);
  const b = await readJson(request);
  if (!b) return bad('Bad request');
  const { row, error } = readSubmission(b);
  if (error) return bad(error);
  if (!(await verifyTurnstile(env, b.turnstile, request))) return bad('The spam check did not pass. Please try again.', 403);
  await saveSubmission(env.SHARED, site.id, row);
  return json({ ok: true });
}
