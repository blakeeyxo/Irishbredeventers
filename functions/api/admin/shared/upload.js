// Owner area: stallion and breeding upload. POST { source_id, text, filename?, label?, overwrite?, save? }.
// Without save it only checks; with save it saves everything it can, in one go (rows that need a decision are left out).
import { json, bad, readJson, str } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';
import { runUpload } from '../../../../lib/shared.js';

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  const content = String(b.text || '');
  if (!content.trim()) return bad('Choose a CSV file or paste the rows.');
  if (content.length > 3_000_000) return bad('That file is too big. Split it into smaller files.');
  try {
    return json(await runUpload(db, content, {
      sourceId: Number(b.source_id), overwrite: Boolean(b.overwrite), save: Boolean(b.save),
      label: str(b.label, 120), filename: str(b.filename, 200), user: data.user ? data.user.email : ''
    }));
  } catch (e) {
    if (/no such table/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
