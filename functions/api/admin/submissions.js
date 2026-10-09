// Owner area: results and breeding sent in through the site.
//   GET ?status=pending|approved|rejected
//   POST { id, action: 'approve' }              puts it live
//   POST { id, action: 'reject', note }
import { json, bad, readJson } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { siteFor } from '../../../lib/sites.js';
import { listSubmissions, approveSubmission, rejectSubmission } from '../../../lib/submissions.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  return json(await listSubmissions(db, siteFor(env).id, ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending'));
});

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  const id = Number(b.id), user = data.user ? data.user.email : '', site = siteFor(env).id;
  if (!Number.isInteger(id)) return bad('Choose a submission.');
  try {
    if (b.action === 'approve') return json({ ok: true, ...(await approveSubmission(db, site, id, user)) });
    if (b.action === 'reject') { await rejectSubmission(db, site, id, user, b.note); return json({ ok: true }); }
    return bad('Unknown action.');
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
