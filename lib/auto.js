/*
 * The automatic readers for IBSR (run every few minutes by the Worker's cron trigger, see src/worker.js).
 *
 *  FEI: works through the checklist of Irish-bred horses (owner area → FEI results), horses never read first, then
 *       the ones read longest ago (none more than once in 6 days). Each horse's FEI results page is read like a paste.
 *  SporthorseData: horses with showjumping results and part of their breeding missing are looked up by name; a page is
 *       only used when it is that horse (same FEI ID or UELN, or same name and year). The breeding goes in through the
 *       shared upload, so nothing already on file is overwritten and sires already on file are linked.
 *
 * Both are off until the owner switches them on, and each reads at most its daily limit of horses (never above the
 * 1000 a day FEI and SporthorseData agreed to). Every horse read is logged in auto_read.
 */
import { runFeiImport } from './sj.js';
import { runUpload } from './shared.js';
import { readShdPage, readShdSearch, tagged } from './shd.js';

export const USER_AGENT = 'IrishBredShowjumpingResults/1.0 (automatic reader agreed with the site owner; info@iber.ie)';
const RUNS_A_DAY = 288;          // every 5 minutes
const REREAD_DAYS = 6;
const RELOOK_DAYS = 30;          // a horse SporthorseData didn't have is looked for again after a month
const nameKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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

/* ---------- SporthorseData breeding ---------- */

const STUDBOOK_OF = { 'irish sport horse': 'ISH', 'irish draught': 'ID', 'irish draught horse': 'ID', connemara: 'CP', thoroughbred: 'TB' };

/** SporthorseData pages → a shared upload file (one row per horse). */
// breedingOnly: just the pedigree and breeder (for a horse FEI already describes: its sex, colour and year stay FEI's).
export function shdRows(pages, { breedingOnly = false } = {}) {
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = breedingOnly
    ? ['Name', 'FEI ID', 'UELN', 'Sire', 'Dam', 'Dam sire', 'Breeder', 'Breeder country']
    : ['Name', 'FEI ID', 'UELN', 'Year', 'Sex', 'Colour', 'Studbook', 'Sire', 'Dam', 'Dam sire', 'Breeder', 'Breeder country'];
  const rows = pages.map(p => breedingOnly
    ? [p.name, p.fei_id, p.ueln, tagged(p.sire), tagged(p.dam), tagged(p.dam_sire), p.breeder, p.breeder_country]
    : [p.name, p.fei_id, p.ueln, p.foaled_year, p.sex, p.colour, STUDBOOK_OF[p.breed.toLowerCase()] || '',
      tagged(p.sire), tagged(p.dam), tagged(p.dam_sire), p.breeder, p.breeder_country]);
  return [head, ...rows].map(r => r.map(cell).join(',')).join('\n');
}

/** Is this SporthorseData page the horse on file? Same FEI ID or UELN, or same name and year of birth. */
export function sameHorse(h, p) {
  if (!p) return false;
  if (h.fei_id && p.fei_id) return h.fei_id === p.fei_id;
  if (h.ueln && p.ueln) return h.ueln === p.ueln;
  return nameKey(h.name) === nameKey(p.name) && !!h.foaled_year && h.foaled_year === p.foaled_year;
}

async function shdSource(db) {
  return (await db.prepare("SELECT id FROM source WHERE slug = 'sporthorse-data'").first()).id;
}

/** Saved SporthorseData pages from the owner area → check (and with save, add) their breeding. */
export async function importShdPages(db, htmls, { save = false, user = '' } = {}) {
  const pages = htmls.map(readShdPage);
  const read = pages.filter(Boolean);
  if (!read.length) throw new Error('No SporthorseData horse pages found. Save the horse\'s page (Ctrl+S, "Webpage, HTML only") and choose it here.');
  const r = await runUpload(db, shdRows(read), { sourceId: await shdSource(db), save, label: 'SporthorseData pages', user });
  return { ...r, pages: read.map(p => ({ name: p.name, fei_id: p.fei_id, sire: tagged(p.sire), dam: tagged(p.dam), dam_sire: tagged(p.dam_sire), breeder: p.breeder })), unread: pages.length - read.length };
}

export async function runShdReader(db, { fetcher = fetch, force = false, now = new Date() } = {}) {
  const n = await allowance(db, 'sporthorse-data', { force, now });
  if (!n) return [];
  // Horses with showjumping results and part of their breeding missing, latest results first.
  const { results: horses } = await db.prepare(`SELECT h.id, h.name, h.fei_id, h.ueln, h.foaled_year, MAX(c.class_date) AS last_run
      FROM horse h JOIN result r ON r.horse_id = h.id JOIN competition_class c ON c.id = r.class_id
      JOIN competition_event e ON e.id = c.event_id AND e.discipline_code = 'showjumping'
      LEFT JOIN horse d ON d.id = h.dam_id LEFT JOIN breeding_lookup bl ON bl.horse_id = h.id
      WHERE (h.sire_id IS NULL OR h.dam_id IS NULL OR d.sire_id IS NULL OR h.breeder_id IS NULL)
        AND (bl.horse_id IS NULL OR (bl.outcome IN ('not_found', 'failed') AND bl.looked_up_at < datetime(?, '-${RELOOK_DAYS} days')))
      GROUP BY h.id ORDER BY last_run DESC LIMIT ?`).bind(now.toISOString().slice(0, 19).replace('T', ' '), n).all();
  const sourceId = await shdSource(db);
  const done = [];
  for (const h of horses) {
    let outcome, detail = '', url = null;
    try {
      const found = await get(fetcher, `https://sporthorse-data.com/search/pedigree?keys=${encodeURIComponent(h.name)}`);
      // The search may land straight on the horse's page, or list several horses: try the closest three.
      let page = readShdPage(found);
      if (!sameHorse(h, page)) {
        page = null;
        const words = nameKey(h.name).split(' ').filter(w => w.length > 2);
        const links = readShdSearch(found).filter(u => !/\/procentage\//.test(u))
          .map(u => ({ u, score: words.filter(w => u.toLowerCase().includes(w)).length })).filter(x => x.score)
          .sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.u);
        for (const u of links) {
          const p = readShdPage(await get(fetcher, u).catch(() => ''));
          if (sameHorse(h, p)) { page = p; break; }
        }
      }
      if (!page) { outcome = 'not_found'; detail = 'Not found on SporthorseData (or no page there matched its FEI ID, UELN or year).'; }
      else {
        url = page.url;
        // Saved under the name on file, so the row finds this horse (by FEI ID first).
        const r = await runUpload(db, shdRows([{ ...page, name: h.name }], { breedingOnly: true }), { sourceId, save: true, label: `SporthorseData: ${h.name}`, user: 'automatic' });
        const row = r.rows[0] || {};
        if (r.counts.held) { outcome = 'held'; detail = (row.notes || []).join(' '); }
        else if (r.saved) { outcome = 'saved'; detail = [tagged(page.sire), tagged(page.dam), tagged(page.dam_sire)].filter(Boolean).join(' × ') + (page.breeder ? `; bred by ${page.breeder}` : ''); }
        else { outcome = 'nothing_new'; detail = 'Its breeding there is what is already on file.'; }
      }
    } catch (e) { outcome = 'failed'; detail = e.message; }
    await db.batch([
      db.prepare(`INSERT INTO breeding_lookup (horse_id, url, outcome, looked_up_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(horse_id) DO UPDATE SET url = excluded.url, outcome = excluded.outcome, looked_up_at = excluded.looked_up_at`).bind(h.id, url, outcome),
      db.prepare('INSERT INTO auto_read (slug, day, horse, fei_id, outcome, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('sporthorse-data', today(now), h.name, h.fei_id || null, outcome, String(detail).slice(0, 300))
    ]);
    done.push({ horse: h.name, outcome, detail });
  }
  return done;
}

/** One run of both readers (the cron trigger, or "Run now" in the owner area). */
export async function runReaders(db, opts = {}) {
  const fei = await runFeiReader(db, opts);
  const shd = await runShdReader(db, opts);
  return { fei, shd };
}

