/*
 * Showjumping results in the shared database, for IBSR.
 *
 * Import: FEI horse pages pasted in the owner area (lib/fei.js reads them). Horses are matched to the shared
 * horse records the same way as the stallion and breeding uploads (FEI ID first, then name and year), so a horse's
 * breeding uploaded there shows with its results. Only Irish-bred horses are kept (an Irish studbook); a horse with
 * no studbook on its FEI page is kept only when the owner ticks it. Results are kept for one year (the current
 * one by default). Same horse in the same class again: the newer paste wins. Every row records its source (FEI).
 *
 * Read: the same row shape as IBER's results (lib/results.js PLACING_COLUMNS), so the public pages work unchanged.
 * Only results whose source is allowed to show (source.can_display) reach visitors.
 */
import { readFeiPaste, jumpingLevel } from './fei.js';
import { loadIndex, planUpload, applyUpload } from './shared.js';
import { normaliseName, COUNTRY_CODES } from './names.js';

const DAY = 86400000;
const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / DAY;

/** Paste → plan (and, with save, saves it). */
export async function runFeiImport(db, text, { year = new Date().getUTCFullYear(), includeUnclear = [], save = false, user = '', label = '' } = {}) {
  const source = await db.prepare("SELECT id, name, can_display FROM source WHERE slug = 'fei'").first();
  if (!source) throw new Error('The FEI source is missing from the shared database.');
  const read = readFeiPaste(text);
  const horses = [], left = [];
  for (const h of read.horses) {
    const results = h.results.filter(r => r.date.startsWith(String(year)));
    const base = { name: h.name, fei_id: h.fei_id, line: h.line, studbook: h.studbook || 'none', results: h.results.length, kept: results.length };
    if (h.discipline === 'eventing') { left.push({ ...base, why: 'Eventing results: these belong on IBER, so they are left out here.' }); continue; }
    if (h.discipline !== 'jumping') { left.push({ ...base, why: 'No jumping results table on this page.' }); continue; }
    if (h.irish === false) { left.push({ ...base, why: `Studbook ${h.studbook} is not an Irish studbook.` }); continue; }
    if (h.irish === null && !includeUnclear.includes(h.fei_id)) { left.push({ ...base, unclear: true, why: 'No studbook on the FEI page, so it can\'t tell whether this horse is Irish-bred. Tick it to include it.' }); continue; }
    if (!results.length) { left.push({ ...base, why: `No ${year} results.` }); continue; }
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
  if (!plan.created.length && !plan.updates.size && !inserts.length && !updates.length) return { ...summary, saved: false, message: 'Nothing new to save.' };

  const uploadId = ids.u + 1;
  await applyUpload(db, plan, { sourceId: source.id, label: label || `FEI results ${year}`, filename: '', user, uploadId });
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
