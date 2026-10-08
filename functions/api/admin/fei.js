// Owner area (IBSR): FEI pages pasted in.
//   GET ?view=to_check|never|done|unclear|skip&q=   the checklist of horses to look up on the FEI database
//   POST { text, year, include_unclear, save, label } a results page (imported) or a horse list (added to the checklist)
//   POST { action: 'status', fei_id, status }        the owner's answer for one horse ('to_check' or 'skip')
import { json, bad, readJson, str } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { runFeiImport, runFeiList, listChecklist, setChecklistStatus } from '../../../lib/sj.js';
import { isFeiList } from '../../../lib/fei.js';

export const onRequestGet = ({ env, request }) => withShared(env, async db => {
  const u = new URL(request.url).searchParams;
  return json(await listChecklist(db, { view: u.get('view') || 'to_check', q: (u.get('q') || '').slice(0, 80) }));
});

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  try {
    if (b.action === 'status') { await setChecklistStatus(db, b.fei_id, b.status); return json({ ok: true }); }
    const text = String(b.text || '');
    if (!text.trim()) return bad('Paste one or more FEI pages.');
    if (text.length > 2_000_000) return bad('That is too much at once. Paste fewer pages.');
    if (isFeiList(text) && !/^\s*Name\t/m.test(text)) return json({ kind: 'list', ...(await runFeiList(db, text, { save: Boolean(b.save) })) });
    const year = Number(b.year) || new Date().getUTCFullYear();
    return json({ kind: 'results', ...(await runFeiImport(db, text, {
      year, includeUnclear: Array.isArray(b.include_unclear) ? b.include_unclear.map(String) : [], save: Boolean(b.save),
      user: data.user ? data.user.email : '', label: str(b.label, 120)
    })) });
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
