// Owner area (IBSR): the automatic FEI results reader.
//   GET                                   each reader: on/off, daily limit, horses read today, the latest horses read
//   POST { slug, enabled, daily_limit }   switch a reader on or off, or change its daily limit (never above what was agreed)
//   POST { action: 'switch', enabled }   on or off
//   POST { action: 'run' }                read a few horses now, even with the readers off (to try them out)
import { json, bad, readJson } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { readerStatus, setReader, runReaders } from '../../../lib/auto.js';

// What the owner area shows: each reader, and how many horses are followed.
async function status(db) {
  const f = await db.prepare("SELECT COUNT(*) AS total, SUM(last_pasted_at IS NULL) AS never FROM fei_checklist WHERE status = 'to_check'").first();
  return { readers: await readerStatus(db), followed: { total: f.total || 0, never: f.never || 0 } };
}

export const onRequestGet = ({ env }) => withShared(env, async db => json(await status(db)));

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  try {
    if (b.action === 'run') return json({ ok: true, ...(await runReaders(db, { force: true })), ...(await status(db)) });
    // On or off (the daily limit stays as it is).
    if (b.action === 'switch') {
      for (const r of await readerStatus(db)) await setReader(db, r.slug, { enabled: Boolean(b.enabled), daily_limit: r.daily_limit }, data.user ? data.user.email : '');
      return json({ ok: true, ...(await status(db)) });
    }
    await setReader(db, String(b.slug || ''), b, data.user ? data.user.email : '');
    return json({ ok: true, ...(await status(db)) });
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
