// Owner area (IBSR): the automatic readers (FEI results, SporthorseData breeding).
//   GET                                   each reader: on/off, daily limit, horses read today, the latest horses read
//   POST { slug, enabled, daily_limit }   switch a reader on or off, or change its daily limit (never above what was agreed)
//   POST { action: 'run' }                read a few horses now, even with the readers off (to try them out)
import { json, bad, readJson } from '../../../lib/http.js';
import { withShared } from '../../../lib/shared-http.js';
import { readerStatus, setReader, runReaders } from '../../../lib/auto.js';

export const onRequestGet = ({ env }) => withShared(env, async db => json({ readers: await readerStatus(db) }));

export const onRequestPost = ({ env, request, data }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  try {
    if (b.action === 'run') return json({ ok: true, ...(await runReaders(db, { force: true })), readers: await readerStatus(db) });
    await setReader(db, String(b.slug || ''), b, data.user ? data.user.email : '');
    return json({ ok: true, readers: await readerStatus(db) });
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) throw e;
    return bad(e.message);
  }
});
