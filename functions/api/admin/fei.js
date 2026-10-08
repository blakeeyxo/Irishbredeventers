// Owner area (IBSR): showjumping results pasted from FEI horse pages. POST { text, year, include_unclear: [fei ids],
// save, label }. Without save it only checks. Saved under the FEI source, which stays hidden from visitors until
// it is allowed to show (Shared stallions → Sources).
import { json, bad, readJson, str } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { runFeiImport } from '../../../lib/sj.js';

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  const text = String(b.text || '');
  if (!text.trim()) return bad('Paste one or more FEI horse pages.');
  if (text.length > 2_000_000) return bad('That is too much at once. Paste fewer horses.');
  const year = Number(b.year) || new Date().getUTCFullYear();
  try {
    return json(await runFeiImport(db, text, {
      year, includeUnclear: Array.isArray(b.include_unclear) ? b.include_unclear.map(String) : [], save: Boolean(b.save),
      user: data.user ? data.user.email : '', label: str(b.label, 120)
    }));
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
