/*
 * Showjumping results in the shared database, for IBSR.
 *
 * Import: FEI horse pages pasted in the owner area (lib/fei.js reads them). Horses are matched to the shared
 * horse records the same way as the stallion and breeding uploads (FEI ID first, then name and year), so a horse's
 * breeding uploaded there shows with its results. Only Irish-bred horses are kept (an Irish studbook); a horse with
 * no studbook on its FEI page is kept only when the owner ticks it. Every year's results on the page are kept by default; a year
 * can be chosen to keep only that one. Same horse in the same class again: the newer paste wins. Every row records its source (FEI).
 *
 * Read: the same row shape as IBER's results (lib/results.js PLACING_COLUMNS), so the public pages work unchanged.
 * Only results whose source is allowed to show (source.can_display) reach visitors.
 */
import { readFeiPaste, readFeiList, readFeiListHtml, isFeiListHtml, jumpingLevel } from './fei.js';
import { loadIndex, planUpload, applyUpload, runUpload } from './shared.js';
import { normaliseName, COUNTRY_CODES } from './names.js';

const DAY = 86400000;
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / DAY;

/** Paste → plan (and, with save, saves it). */
export async function runFeiImport(db, text, opts = {}) {
  return importJumping(db, readFeiPaste(text), { ...opts, sourceSlug: 'fei' });
}

/**
 * Horses with jumping results (in readFeiPaste's shape) → events, classes, horses and results, recording sourceSlug
 * as their source: 'fei' for FEI pages, 'owners' for results sent in by owners and approved in the owner area.
 */
export async function importJumping(db, read, { year = null, includeUnclear = [], save = false, user = '', label = '', sourceSlug = 'fei' } = {}) {
  const source = await db.prepare('SELECT id, name, can_display FROM source WHERE slug = ?').bind(sourceSlug).first();
  if (!source) throw new Error(`The ${sourceSlug} source is missing from the shared database.`);
  const inYear = r => !year || r.date.startsWith(String(year)); // no year: all of them
  const horses = [], left = [];
  for (const h of read.horses) {
    const results = h.results.filter(inYear);
    const base = { name: h.name, fei_id: h.fei_id, line: h.line, studbook: h.studbook || 'none', results: h.results.length, kept: results.length };
    if (h.discipline === 'eventing') { left.push({ ...base, why: 'Eventing results: these belong on IBER, so they are left out here.' }); continue; }
    if (h.discipline !== 'jumping') { left.push({ ...base, why: 'No jumping results table on this page.' }); continue; }
    if (h.irish === false) { left.push({ ...base, why: `Studbook ${h.studbook} is not an Irish studbook.` }); continue; }
    if (h.irish === null && !includeUnclear.includes(h.fei_id)) { left.push({ ...base, unclear: true, why: 'No studbook on the FEI page, so it can\'t tell whether this horse is Irish-bred. Tick it to include it.' }); continue; }
    if (!results.length) { left.push({ ...base, why: year ? `No ${year} results.` : 'No results on this page.' }); continue; }
    horses.push({ ...h, results });
  }

  // Horses: matched like a breeding upload, by FEI ID first.
  const rows = horses.map(h => ({
    line: h.line, name: h.name, sex: h.sex, foaled_year: h.foaled_year, colour: h.colour, studbook: h.studbook, ueln: '', fei_id: h.fei_id,
    sji_id: '', sire: { name: '' }, dam: { name: '' }, dam_sire: { name: '' }, breeder: '', breeder_county: '', breeder_country: '',
    irish_bred: h.irish ? 1 : null, aliases: []
  }));
  const [ix, ids] = await Promise.all([
    loadIndex(db),
    db.prepare(`SELECT (SELECT IFNULL(MAX(id), 0) FROM horse) AS h, (SELECT IFNULL(MAX(id), 0) FROM party) AS p, (SELECT IFNULL(MAX(id), 0) FROM upload) AS u,
      (SELECT IFNULL(MAX(id), 0) FROM competition_event) AS e, (SELECT IFNULL(MAX(id), 0) FROM competition_class) AS c, (SELECT IFNULL(MAX(id), 0) FROM result) AS r`).first()
  ]);
  const plan = planUpload(rows, ix, { nextHorseId: ids.h + 1, nextPartyId: ids.p + 1 });

  // Events, classes and riders already on file.
  const [events, classes, existing, riders] = await db.batch([
    db.prepare("SELECT id, name, country, start_date, end_date FROM competition_event WHERE discipline_code = 'showjumping'"),
    db.prepare(`SELECT c.id, c.event_id, c.name, c.class_date, c.level_label FROM competition_class c JOIN competition_event e ON e.id = c.event_id
      WHERE e.discipline_code = 'showjumping'`),
    db.prepare(`SELECT r.id, r.class_id, r.horse_id, r.placing, r.score_text FROM result r JOIN competition_class c ON c.id = r.class_id
      JOIN competition_event e ON e.id = c.event_id WHERE e.discipline_code = 'showjumping'`),
    db.prepare("SELECT id, name_key, country FROM party")
  ]);
  const ev = events.results.map(e => ({ ...e })), cl = classes.results.map(c => ({ ...c }));
  const res = new Map(existing.results.map(r => [`${r.class_id}|${r.horse_id}`, r]));
  const riderIx = new Map(riders.results.map(p => [`${p.name_key}|${p.country || ''}`, p.id]));
  let eid = ids.e, cid = ids.c, rid = ids.r, pid = plan.createdParties.length ? Math.max(...plan.createdParties.map(p => p.id)) : ids.p;
  const newEvents = [], eventDates = new Map(), newClasses = [], newRiders = [], inserts = [], updates = [];
  const out = [];

  horses.forEach((h, i) => {
    const pr = plan.rows[i];
    const entry = { name: h.name, fei_id: h.fei_id, horse: pr.outcome, notes: pr.notes, results: [] };
    out.push(entry);
    if (pr.outcome === 'held') return; // its results wait until the horse question is answered
    for (const r of h.results) {
      // One event per show, country and week (an FEI show's classes run over several days).
      let e = ev.find(x => x.name === r.show && x.country === r.country && (days(x.start_date, r.date) <= 7 || days(x.end_date || x.start_date, r.date) <= 7));
      if (!e) { e = { id: ++eid, name: r.show, country: r.country, start_date: r.date, end_date: r.date }; ev.push(e); newEvents.push(e); }
      if (r.date < e.start_date || r.date > (e.end_date || e.start_date)) {
        e.start_date = r.date < e.start_date ? r.date : e.start_date;
        e.end_date = r.date > (e.end_date || '') ? r.date : e.end_date;
        if (!newEvents.includes(e)) eventDates.set(e.id, e);
      }
      const className = r.competition + (r.height_m ? ` (${r.height_m.toFixed(2)}m)` : '');
      let c = cl.find(x => x.event_id === e.id && x.name === className && x.class_date === r.date);
      if (!c) { c = { id: ++cid, event_id: e.id, name: className, class_date: r.date, level_label: r.event, height: r.height_m }; cl.push(c); newClasses.push(c); }
      let riderId = null;
      if (r.athlete) {
        const key = `${normaliseName(r.athlete)}|${r.athlete_country}`;
        riderId = riderIx.get(key);
        if (!riderId) { riderId = ++pid; riderIx.set(key, riderId); newRiders.push({ id: riderId, name: r.athlete, name_key: normaliseName(r.athlete), country: r.athlete_country }); }
      }
      const was = res.get(`${c.id}|${pr.horse_id}`);
      const row = { class_id: c.id, horse_id: pr.horse_id, rider_id: riderId, placing: r.position, faults: r.faults, time_seconds: r.time_s, score_text: r.score_text };
      let outcome = 'new';
      if (was) {
        if (was.placing === r.position && was.score_text === r.score_text) outcome = 'same';
        else { outcome = 'updated'; updates.push({ id: was.id, ...row }); }
      } else {
        const id = ++rid;
        inserts.push({ id, ...row });
        res.set(`${c.id}|${pr.horse_id}`, { id, ...row });
      }
      entry.results.push({ date: r.date, show: r.show, country: r.country, level: jumpingLevel(r.event), event: r.event, class: className,
        position: r.position, status: r.status, score: r.score_text, rider: r.athlete, outcome });
    }
  });

  const count = o => out.reduce((n, h) => n + h.results.filter(r => r.outcome === o).length, 0);
  const summary = {
    year, source: { name: source.name, can_display: source.can_display },
    horses: out, left, problems: read.problems,
    counts: { horses: horses.length, horsesNew: plan.counts.horsesAdded, held: plan.counts.held, left: left.length,
      results: count('new'), updated: count('updated'), same: count('same'), events: newEvents.length, classes: newClasses.length }
  };
  if (!save) return summary;
  // Every jumping horse pasted counts as looked up, whatever it had for this year.
  const pasted = read.horses.filter(h => h.discipline === 'jumping' && h.fei_id)
    .map(h => ({ ...h, found: h.results.filter(inYear).length }));
  if (sourceSlug === 'fei') await tickChecklist(db, pasted);
  if (!plan.created.length && !plan.updates.size && !inserts.length && !updates.length) return { ...summary, saved: false, message: 'Nothing new to save (the horses are ticked off the checklist).' };

  const uploadId = ids.u + 1;
  await applyUpload(db, plan, { sourceId: source.id, label: label || (year ? `${source.name} results ${year}` : `${source.name} results`), filename: '', user, uploadId });
  const s = [];
  for (const p of newRiders) s.push(db.prepare("INSERT INTO party (id, name, name_key, kind, country, source_id) VALUES (?, ?, ?, 'person', ?, ?)").bind(p.id, p.name, p.name_key, p.country || null, source.id));
  for (const e of newEvents) s.push(db.prepare("INSERT INTO competition_event (id, discipline_code, name, venue, country, start_date, end_date, source_id) VALUES (?, 'showjumping', ?, ?, ?, ?, ?, ?)")
    .bind(e.id, e.name, e.name, e.country, e.start_date, e.end_date, source.id));
  for (const e of eventDates.values()) s.push(db.prepare('UPDATE competition_event SET start_date = ?, end_date = ? WHERE id = ?').bind(e.start_date, e.end_date, e.id));
  for (const c of newClasses) s.push(db.prepare('INSERT INTO competition_class (id, event_id, name, level_label, spec, class_date, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(c.id, c.event_id, c.name, c.level_label, c.height ? `${c.height.toFixed(2)}m` : null, c.class_date, source.id));
  for (const r of inserts) s.push(db.prepare(`INSERT INTO result (id, class_id, horse_id, rider_id, placing, faults, time_seconds, score_text, source_id, upload_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.id, r.class_id, r.horse_id, r.rider_id, r.placing, r.faults, r.time_seconds, r.score_text, source.id, uploadId));
  for (const r of updates) s.push(db.prepare('UPDATE result SET rider_id = ?, placing = ?, faults = ?, time_seconds = ?, score_text = ?, upload_id = ? WHERE id = ?')
    .bind(r.rider_id, r.placing, r.faults, r.time_seconds, r.score_text, uploadId, r.id));
  if (s.length) await db.batch(s);
  return { ...summary, saved: true, uploadId };
}

/* ---------- Reading, in IBER's row shape ---------- */

const VISIBLE = 'r.source_id IN (SELECT id FROM source WHERE can_display = 1)';
const unknown = col => `(${col} IS NULL)`;
export const SJ_COLUMNS = `
  r.id, r.placing AS position, h.name AS horse_name,
  IFNULL((SELECT alias FROM horse_alias a WHERE a.horse_id = h.id ORDER BY a.alias LIMIT 1), '') AS former_name,
  IFNULL(h.studbook, '') AS breed, h.foaled_year AS foaled, CASE WHEN h.sex = 'unknown' THEN '' ELSE h.sex END AS sex,
  IFNULL(s.name, '') AS sire, IFNULL(d.name, '') AS dam, IFNULL(ds.name, '') AS dam_sire, IFNULL(b.name, '') AS breeder,
  '' AS dressage, '' AS show_jumping, '' AS cross_country, IFNULL(r.score_text, '') AS score, r.faults, r.time_seconds,
  1 AS verified, (${unknown('s.id')} OR ${unknown('d.id')} OR ${unknown('ds.id')}) AS oio,
  (${unknown('s.id')} OR ${unknown('d.id')} OR ${unknown('ds.id')} OR ${unknown('b.id')}) AS breeding_gap, 0 AS doubtful, NULL AS batch_id,
  IFNULL(rd.name, '') AS rider_name, IFNULL(rd.country, '') AS rider_country,
  c.name AS class_name, c.level_label AS level, c.class_date, e.id AS event_id, e.name AS event_name, '' AS date_text,
  e.start_date, e.end_date, e.country, CAST(substr(e.start_date, 1, 4) AS INTEGER) AS season, h.id AS horse_id`;
export const SJ_JOIN = `FROM result r JOIN competition_class c ON c.id = r.class_id JOIN competition_event e ON e.id = c.event_id
  JOIN horse h ON h.id = r.horse_id LEFT JOIN horse s ON s.id = h.sire_id LEFT JOIN horse d ON d.id = h.dam_id
  LEFT JOIN horse ds ON ds.id = d.sire_id LEFT JOIN party b ON b.id = h.breeder_id LEFT JOIN party rd ON rd.id = r.rider_id`;
const SHOWN = `e.discipline_code = 'showjumping' AND ${VISIBLE}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "17 – 20 September 2026", "28 September – 1 October 2026", "5 May 2026".
function dateRange(a, b) {
  if (!a) return '';
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = (b || a).split('-').map(Number);
  if (a === (b || a)) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MONTHS[m1 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]}${y1 === y2 ? '' : ` ${y1}`} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}
// The pages group by country name, as on IBER; FEI gives three-letter codes.
const display = rows => rows.map(r => ({ ...r, country: COUNTRY_CODES[r.country] || r.country, date_text: dateRange(r.start_date, r.end_date) }));
const ORDER = 'ORDER BY e.start_date DESC, e.id, c.class_date DESC, c.id, r.placing IS NULL, r.placing, r.id';

export async function sjSeason(db, season) {
  const [rows, seasons] = await db.batch([
    db.prepare(`SELECT ${SJ_COLUMNS} ${SJ_JOIN} WHERE ${SHOWN} AND substr(e.start_date, 1, 4) = ? ${ORDER}`).bind(String(season)),
    db.prepare(`SELECT DISTINCT CAST(substr(e.start_date, 1, 4) AS INTEGER) AS season FROM competition_event e WHERE e.discipline_code = 'showjumping'`)
  ]);
  return { rows: display(rows.results), seasons: seasons.results.map(s => s.season).filter(Boolean) };
}

/** Winners from the latest week that has results (the week of the newest class). */
export async function sjWeekWinners(db) {
  const latest = await db.prepare(`SELECT MAX(c.class_date) AS d ${SJ_JOIN} WHERE ${SHOWN}`).first();
  if (!latest || !latest.d) return [];
  const d = new Date(latest.d + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const monday = d.toISOString().slice(0, 10);
  const { results } = await db.prepare(`SELECT ${SJ_COLUMNS} ${SJ_JOIN} WHERE ${SHOWN} AND r.placing = 1 AND c.class_date >= ? AND c.class_date < date(?, '+7 days') ${ORDER} LIMIT 500`)
    .bind(monday, monday).all();
  return display(results);
}

const FIELD = {
  all: ['h.name', 'a2.alias', 's.name', 'd.name', 'ds.name', 'b.name'],
  name: ['h.name', 'a2.alias'], sire: ['s.name'], dam: ['d.name', 'ds.name'], breeder: ['b.name']
};
export async function sjSearch(db, q, field = 'all') {
  const words = String(q || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!words.length) return { total: 0, rows: [] };
  const cols = FIELD[field] || FIELD.all;
  const cond = words.slice(0, 6).map(() => `(${cols.map(c => `lower(${c}) LIKE ?`).join(' OR ')})`).join(' AND ');
  const binds = words.slice(0, 6).flatMap(w => cols.map(() => `%${w}%`));
  const join = `${SJ_JOIN} LEFT JOIN horse_alias a2 ON a2.horse_id = h.id`;
  const [rows, count] = await db.batch([
    db.prepare(`SELECT DISTINCT ${SJ_COLUMNS} ${join} WHERE ${SHOWN} AND ${cond} ORDER BY e.start_date DESC, r.placing LIMIT 200`).bind(...binds),
    db.prepare(`SELECT COUNT(DISTINCT r.id) AS n ${join} WHERE ${SHOWN} AND ${cond}`).bind(...binds)
  ]);
  return { total: count.results[0].n, rows: display(rows.results) };
}

export async function sjHorse(db, resultId) {
  let horse = await db.prepare(`SELECT ${SJ_COLUMNS} ${SJ_JOIN} WHERE r.id = ? AND ${SHOWN}`).bind(resultId).first();
  if (!horse) return null;
  [horse] = display([horse]);
  const { results } = await db.prepare(`SELECT ${SJ_COLUMNS} ${SJ_JOIN} WHERE h.id = ? AND ${SHOWN} ORDER BY e.start_date DESC, c.class_date DESC, r.id DESC LIMIT 500`)
    .bind(horse.horse_id).all();
  return { horse, runs: display(results) };
}

/* ---------- The checklist of horses to look up on the FEI database ---------- */

/** Pasted FEI horse list → checklist (Irish-bred and unclear horses; others counted, not kept). */
export async function runFeiList(db, text, { save = false } = {}) {
  const { horses, problems } = isFeiListHtml(text) ? readFeiListHtml(text) : readFeiList(text);
  const keep = horses.filter(h => h.irish !== false);
  const { results } = await db.prepare('SELECT fei_id, fei_url FROM fei_checklist').all();
  const have = new Map(results.map(r => [r.fei_id, r.fei_url]));
  const fresh = keep.filter(h => !have.has(h.fei_id));
  // Horses already on the checklist pick up their FEI link from a saved page.
  const links = keep.filter(h => h.url && have.has(h.fei_id) && have.get(h.fei_id) !== h.url);
  const summary = {
    problems, total: horses.length, irish: horses.filter(h => h.irish).length, unclear: horses.filter(h => h.irish === null).length,
    notIrish: horses.filter(h => h.irish === false).length, added: fresh.length, already: keep.length - fresh.length,
    linked: links.length + fresh.filter(h => h.url).length, unclearNames: horses.filter(h => h.irish === null).map(h => h.name)
  };
  if (!save || (!fresh.length && !links.length)) return { ...summary, saved: false };
  await db.batch([
    ...fresh.map(h => db.prepare(`INSERT OR IGNORE INTO fei_checklist (fei_id, name, studbook, registration, sex, foaled, nf, status, fei_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(h.fei_id, h.name, h.studbook, h.registration, h.sex, h.foaled, h.nf, h.irish ? 'to_check' : 'unclear', h.url || null)),
    ...links.map(h => db.prepare('UPDATE fei_checklist SET fei_url = ? WHERE fei_id = ?').bind(h.url, h.fei_id))
  ]);
  return { ...summary, saved: true };
}

/** The checklist: counts, and the horses in one view ('to_check' oldest first, 'never', 'done', 'unclear', 'skip'). */
export async function listChecklist(db, { view = 'to_check', q = '', limit = 200 } = {}) {
  const where = { to_check: "status = 'to_check'", never: "status = 'to_check' AND last_pasted_at IS NULL",
    done: "status = 'to_check' AND last_pasted_at IS NOT NULL", unclear: "status = 'unclear'", skip: "status IN ('skip', 'not_irish')" }[view] || "status = 'to_check'";
  const binds = [];
  let filter = '';
  if (q) { filter = ' AND (lower(name) LIKE ? OR fei_id LIKE ?)'; binds.push(`%${String(q).toLowerCase()}%`, `%${String(q).toUpperCase()}%`); }
  const [counts, rows] = await db.batch([
    db.prepare(`SELECT
        SUM(status = 'to_check') AS to_check, SUM(status = 'to_check' AND last_pasted_at IS NULL) AS never,
        SUM(status = 'to_check' AND last_pasted_at IS NOT NULL) AS done, SUM(status = 'unclear') AS unclear,
        SUM(status IN ('skip', 'not_irish')) AS skip FROM fei_checklist`),
    db.prepare(`SELECT * FROM fei_checklist WHERE ${where}${filter} ORDER BY last_pasted_at IS NOT NULL, last_pasted_at, name LIMIT ?`).bind(...binds, Math.min(Number(limit) || 200, 1000))
  ]);
  const c = counts.results[0];
  return { counts: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v || 0])), horses: rows.results };
}

/** Owner's answer for one horse: 'to_check' (it's Irish-bred), 'skip' (leave it out). */
export async function setChecklistStatus(db, feiId, status) {
  if (!['to_check', 'skip', 'unclear'].includes(status)) throw new Error('Unknown choice.');
  await db.prepare('UPDATE fei_checklist SET status = ? WHERE fei_id = ?').bind(status, String(feiId).toUpperCase()).run();
}

/** After a results paste: tick off the horses pasted (and add any not on the list yet). */
export async function tickChecklist(db, pasted) {
  if (!pasted.length) return;
  await db.batch(pasted.map(h => db.prepare(`INSERT INTO fei_checklist (fei_id, name, studbook, sex, foaled, nf, status, last_pasted_at, results_found)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      ON CONFLICT(fei_id) DO UPDATE SET last_pasted_at = datetime('now'), results_found = excluded.results_found`)
    .bind(h.fei_id, h.name, h.studbook || '', h.sex || '', h.foaled || null, h.nf || '', h.irish === false ? 'not_irish' : h.irish ? 'to_check' : 'unclear', h.found)));
}

/* ---------- Breeding records for the showjumping horses (owner area) ---------- */

const GAP = '(h.sire_id IS NULL OR h.dam_id IS NULL OR d.sire_id IS NULL OR h.breeder_id IS NULL)';
const SJ_HORSES = `FROM horse h
  JOIN (SELECT r.horse_id, COUNT(*) AS runs, MAX(c.class_date) AS last_run, MIN(r.id) AS placing_id
        FROM result r JOIN competition_class c ON c.id = r.class_id JOIN competition_event e ON e.id = c.event_id
        WHERE e.discipline_code = 'showjumping' GROUP BY r.horse_id) x ON x.horse_id = h.id
  LEFT JOIN horse s ON s.id = h.sire_id LEFT JOIN horse d ON d.id = h.dam_id LEFT JOIN horse ds ON ds.id = d.sire_id
  LEFT JOIN party b ON b.id = h.breeder_id`;
const cap = s => (s && s !== 'unknown' ? s[0].toUpperCase() + s.slice(1) : '');

/** Horses with showjumping results, in the shape of the owner area's breeding cards. */
export async function sjBreedingList(db, { q = '', sire = '', gaps = false, limit = 100 } = {}) {
  const where = [], binds = [];
  for (const w of (String(q).toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, 6)) {
    where.push('(lower(h.name) LIKE ? OR h.id IN (SELECT horse_id FROM horse_alias WHERE lower(alias) LIKE ?) OR lower(IFNULL(h.fei_id, \'\')) = ?)');
    binds.push(`%${w}%`, `%${w}%`, w);
  }
  if (sire.trim()) { where.push('lower(s.name) LIKE ?'); binds.push(`%${sire.trim().toLowerCase()}%`); }
  if (gaps) where.push(GAP);
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count, missing, sires] = await db.batch([
    db.prepare(`SELECT h.id, h.name, h.foaled_year AS birth_year, h.sex, IFNULL(h.studbook, '') AS breed_code, h.fei_id,
        (SELECT alias FROM horse_alias a WHERE a.horse_id = h.id ORDER BY a.alias LIMIT 1) AS former,
        s.name AS sire, s.studbook AS sire_breed, d.name AS dam, d.studbook AS dam_breed, ds.name AS dam_sire, ds.studbook AS dam_sire_breed,
        b.name AS breeder, b.county AS breeder_county, x.runs, x.last_run, x.placing_id
      ${SJ_HORSES} ${cond} ORDER BY x.last_run DESC, h.name LIMIT ?`).bind(...binds, limit),
    db.prepare(`SELECT COUNT(*) AS n ${SJ_HORSES} ${cond}`).bind(...binds),
    db.prepare(`SELECT COUNT(*) AS n ${SJ_HORSES} WHERE ${GAP}`),
    db.prepare('SELECT DISTINCT s.name FROM horse h JOIN horse s ON s.id = h.sire_id ORDER BY s.name LIMIT 3000')
  ]);
  return {
    horses: rows.results.map(h => ({ ...h, sex: cap(h.sex), sire_tih: 0, dam_tih: 0, dam_sire_tih: 0, tih_flag: 0 })),
    total: count.results[0].n, gaps: missing.results[0].n, sires: sires.results.map(s => s.name), stallions: []
  };
}

/**
 * Saves one horse's breeding from the owner area. It goes through the same upload as a spreadsheet row (found by
 * FEI ID, else name and year; replacing what's on file), so sires and dams are linked the same way and every change
 * is logged with the old value. The owner's edits are recorded under IBER's own source.
 */
export async function sjSaveBreeding(db, id, b, user = '') {
  const h = await db.prepare('SELECT name, foaled_year, fei_id FROM horse WHERE id = ?').bind(id).first();
  if (!h) throw new Error('That horse is no longer on file.');
  const own = await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first();
  const v = k => String(b[k] ?? '').trim();
  const year = v('birth_year') || (h.foaled_year ?? '');
  const cells = [h.name, year, v('sex'), v('breed'), h.fei_id || '', v('sire'), v('dam'), v('dam_sire'), v('breeder')];
  const csv = `Name,Year,Sex,Studbook,FEI ID,Sire,Dam,Dam sire,Breeder\n${cells.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')}`;
  const r = await runUpload(db, csv, { sourceId: own.id, save: true, overwrite: true, label: `Breeding: ${h.name}`, user });
  const row = r.rows[0] || {};
  if (r.counts.held) throw new Error((row.notes || []).join(' ') || 'Not saved: this could match more than one horse.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM result WHERE horse_id = ?').bind(id).first();
  return { saved: !!r.saved, results: n.n };
}

/**
 * The horses with showjumping results as a spreadsheet (CSV) in the shared upload's own columns, so the owner can fill
 * in the breeding for many horses at once and upload it back under Shared stallions (matched by FEI ID).
 */
export async function sjBreedingSheet(db, { gaps = true } = {}) {
  const { horses } = await sjBreedingList(db, { gaps, limit: 5000 });
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const tag = (name, breed) => (name ? (breed ? `${name} (${breed})` : name) : '');
  const lines = [['Name', 'FEI ID', 'Year', 'Sex', 'Studbook', 'Sire', 'Dam', 'Dam sire', 'Breeder', 'Irish bred']];
  for (const h of horses) {
    lines.push([h.name, h.fei_id, h.birth_year, h.sex, h.breed_code, tag(h.sire, h.sire_breed), tag(h.dam, h.dam_breed),
      tag(h.dam_sire, h.dam_sire_breed), h.breeder ? `${h.breeder}${h.breeder_county ? ` (${h.breeder_county})` : ''}` : '', 'yes']);
  }
  return lines.map(l => l.map(cell).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Deleting (owner area, IBSR): one result, or a horse with all its results ---------- */

export async function sjHorseResults(db, horseId) {
  const { results } = await db.prepare(`SELECT r.id, e.name AS event, e.start_date, e.country, c.name AS class_name, c.class_date, c.level_label,
        r.placing, r.score_text, rd.name AS rider_name
      FROM result r JOIN competition_class c ON c.id = r.class_id JOIN competition_event e ON e.id = c.event_id
      LEFT JOIN party rd ON rd.id = r.rider_id WHERE r.horse_id = ? ORDER BY c.class_date DESC, r.id DESC`).bind(horseId).all();
  return results;
}

// Classes and shows left with no results are tidied away.
const tidyEmpty = db => [
  db.prepare("DELETE FROM competition_class WHERE id NOT IN (SELECT class_id FROM result) AND event_id IN (SELECT id FROM competition_event WHERE discipline_code = 'showjumping')"),
  db.prepare("DELETE FROM competition_event WHERE discipline_code = 'showjumping' AND id NOT IN (SELECT event_id FROM competition_class)")
];

export async function sjDeleteResult(db, resultId) {
  const r = await db.prepare('SELECT id FROM result WHERE id = ?').bind(resultId).first();
  if (!r) throw new Error('That result is no longer there.');
  await db.batch([db.prepare('DELETE FROM result WHERE id = ?').bind(resultId), ...tidyEmpty(db)]);
}

/**
 * Deletes a horse from the shared database with all its results. Horses it is the sire or dam of keep their record,
 * with that parent left empty. A horse followed on FEI is left out of the list, so the automatic reader doesn't bring
 * it back.
 */
export async function sjDeleteHorse(db, horseId) {
  const h = await db.prepare('SELECT name, fei_id FROM horse WHERE id = ?').bind(horseId).first();
  if (!h) throw new Error('That horse is no longer there.');
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM result WHERE horse_id = ?').bind(horseId).first()).n;
  await db.batch([
    db.prepare('DELETE FROM result WHERE horse_id = ?').bind(horseId),
    db.prepare('UPDATE horse SET sire_id = NULL WHERE sire_id = ?').bind(horseId),
    db.prepare('UPDATE horse SET dam_id = NULL WHERE dam_id = ?').bind(horseId),
    db.prepare('UPDATE listing SET horse_id = NULL WHERE horse_id = ?').bind(horseId),
    db.prepare('DELETE FROM horse_match_candidate WHERE horse_a_id = ? OR horse_b_id = ?').bind(horseId, horseId),
    db.prepare('DELETE FROM horse_alias WHERE horse_id = ?').bind(horseId),
    db.prepare("UPDATE fei_checklist SET status = 'skip' WHERE fei_id = ?").bind(h.fei_id || ''),
    db.prepare('DELETE FROM horse WHERE id = ?').bind(horseId),
    ...tidyEmpty(db)
  ]);
  return { name: h.name, results: n };
}
