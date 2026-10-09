/*
 * The automatic FEI reader for IBSR (run every few minutes by the Worker's cron trigger, see src/worker.js).
 * It works through the Irish-bred horses followed (owner area → Showjumping results), horses never read first, then the
 * ones read longest ago (none more than once in 6 days). Each horse's FEI results page is read like a paste.
 * Off until the owner switches it on; at most its daily limit of horses (never above the 1000 a day FEI agreed to).
 * Every horse read is logged in auto_read. (Breeding is not read from other websites: see migrations-shared/0009.)
 */
import { runFeiImport } from './sj.js';

export const USER_AGENT = 'IrishBredShowjumpingResults/1.0 (automatic reader agreed with the site owner; info@iber.ie)';
const RUNS_A_DAY = 288;          // every 5 minutes
const REREAD_DAYS = 6;
const today = (now = new Date()) => now.toISOString().slice(0, 10);

export async function readerStatus(db, now = new Date()) {
  const [readers, counts, recent] = await db.batch([
    db.prepare('SELECT slug, enabled, daily_limit, max_daily, updated_at, updated_by FROM auto_reader ORDER BY slug DESC'),
    db.prepare('SELECT slug, outcome, COUNT(*) AS n FROM auto_read WHERE day = ? GROUP BY slug, outcome').bind(today(now)),
    db.prepare('SELECT slug, horse, fei_id, outcome, detail, read_at FROM auto_read ORDER BY id DESC LIMIT 40')
  ]);
  return readers.results.map(r => {
    const mine = counts.results.filter(c => c.slug === r.slug);
    return { ...r, today: mine.reduce((n, c) => n + c.n, 0), outcomes: Object.fromEntries(mine.map(c => [c.outcome, c.n])),
      recent: recent.results.filter(x => x.slug === r.slug).slice(0, 20) };
  });
}

export async function setReader(db, slug, { enabled, daily_limit }, user = '') {
  const r = await db.prepare('SELECT max_daily FROM auto_reader WHERE slug = ?').bind(slug).first();
  if (!r) throw new Error('Unknown reader.');
  const limit = Math.max(1, Math.min(r.max_daily, Math.round(Number(daily_limit) || 0)));
  await db.prepare("UPDATE auto_reader SET enabled = ?, daily_limit = ?, updated_at = datetime('now'), updated_by = ? WHERE slug = ?")
    .bind(enabled ? 1 : 0, limit, user, slug).run();
}

// How many horses this run may read: the day's allowance, spread over the day's runs.
async function allowance(db, slug, { force = false, now = new Date() } = {}) {
  const r = await db.prepare('SELECT enabled, daily_limit, max_daily FROM auto_reader WHERE slug = ?').bind(slug).first();
  if (!r || (!r.enabled && !force)) return 0;
  const cap = Math.min(r.daily_limit, r.max_daily);
  const done = (await db.prepare('SELECT COUNT(*) AS n FROM auto_read WHERE slug = ? AND day = ?').bind(slug, today(now)).first()).n;
  return Math.max(0, Math.min(cap - done, Math.ceil(cap / RUNS_A_DAY) + 1, force ? 5 : 20));
}

const log = (db, slug, horse, fei_id, outcome, detail = '', now = new Date()) =>
  db.prepare('INSERT INTO auto_read (slug, day, horse, fei_id, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(slug, today(now), horse || '?', fei_id || null, outcome, String(detail).slice(0, 300)).run();

async function get(fetcher, url) {
  const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.text();
}

/* ---------- FEI ---------- */

export async function runFeiReader(db, { fetcher = fetch, force = false, now = new Date() } = {}) {
  const n = await allowance(db, 'fei', { force, now });
  if (!n) return [];
  const { results: horses } = await db.prepare(`SELECT fei_id, name, fei_url FROM fei_checklist
      WHERE status = 'to_check' AND fei_url IS NOT NULL
        AND (last_pasted_at IS NULL OR last_pasted_at < datetime(?, '-${REREAD_DAYS} days'))
      ORDER BY last_pasted_at IS NOT NULL, last_pasted_at, name LIMIT ?`).bind(now.toISOString().slice(0, 19).replace('T', ' '), n).all();
  const done = [];
  for (const h of horses) {
    let outcome, detail = '';
    try {
      const html = await get(fetcher, h.fei_url);
      const r = await runFeiImport(db, html, { save: true, user: 'automatic', label: 'FEI automatic' });
      if (!r.horses.length && !r.left.length) { outcome = 'failed'; detail = 'No horse found on the FEI page.'; }
      else if (r.left.length && !r.horses.length) { outcome = 'nothing_new'; detail = r.left[0].why; }
      else if (r.counts.held) { outcome = 'held'; detail = (r.horses[0].notes || []).join(' ') || 'Could match more than one horse: paste it by hand.'; }
      else if (r.saved) { outcome = 'saved'; detail = `${r.counts.results} new result${r.counts.results === 1 ? '' : 's'}${r.counts.updated ? `, ${r.counts.updated} updated` : ''}`; }
      else { outcome = 'nothing_new'; detail = 'No new results.'; }
    } catch (e) {
      outcome = 'failed'; detail = e.message;
      // Not ticked off, so it comes round again, but not straight away.
      await db.prepare("UPDATE fei_checklist SET last_pasted_at = datetime('now') WHERE fei_id = ?").bind(h.fei_id).run();
    }
    await log(db, 'fei', h.name, h.fei_id, outcome, detail, now);
    done.push({ horse: h.name, outcome, detail });
  }
  return done;
}

/** One run (the cron trigger, or "Update a few horses now" in the owner area). */
export async function runReaders(db, opts = {}) {
  return { fei: await runFeiReader(db, opts) };
}

