// Builds migrations/0007_hsi_2026_results.sql from Charlie's weekly Irish-Bred Results articles on
// horsesportireland.ie (downloaded first with: node scripts/scrape-hsi.mjs).
//
//   node scripts/build-hsi-migration.mjs [--cache .cache/hsi] [--persist-to .wrangler/hsi-build]
//
// 1. Reads every cached article and merges the weeks (lib/hsi.js): the latest version of a result wins,
//    a result repeated by a later article is confirmed, and lines that can't be read are kept with
//    parse_ok = 0 (shown as unverified).
// 2. Writes reports/hsi-2026-review.csv (lines that need a person) and reports/hsi-2026-name-checks.csv
//    (names that look like an existing record; each was saved as a separate record, nothing merged).
// 3. Imports into a fresh LOCAL database built from migrations 0001–0006 (which includes the live launch
//    content), one upload per article, through the same code as the owner area.
// 4. Writes only what the import added, linked by natural identity, so the migration adds nothing that
//    is already live and adds nothing when run twice.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';
import { readArticle, collectResults, reviewCsv, weekLabel } from '../lib/hsi.js';
import { cleanRows, importResults } from '../lib/import.js';
import { queryLocal, q, sireId, damId, breederId, horseId, eventId, classId, batchId, HORSE_KEY, HORSE_JOIN, EVENT_KEY } from './sql-dump.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const CACHE = opt('--cache', '.cache/hsi');
const PERSIST = opt('--persist-to', '.wrangler/hsi-build');
const OUT = 'migrations/0007_hsi_2026_results.sql';
const SEASON = 2026;

// 1. Articles → merged rows
const index = JSON.parse(readFileSync(join(CACHE, 'index.json'), 'utf8')).filter(a => !a.missing);
const articles = index.map(a => ({ ...readArticle(readFileSync(join(CACHE, a.file), 'utf8')), url: a.url, title: a.title, date: a.date }));
const { rows, review } = collectResults(articles);

// 2. Review list
mkdirSync('reports', { recursive: true });
writeFileSync('reports/hsi-2026-review.csv', reviewCsv(review));

// 3. Fresh local database with the live schema and launch content
rmSync(PERSIST, { recursive: true, force: true });
for (const file of readdirSync('migrations').filter(f => /^000[1-6]_.*\.sql$/.test(f)).sort()) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'irishbredeventers', '--local', '--persist-to', PERSIST, '--file', join('migrations', file)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${file}: ${r.stderr || r.stdout}`);
}
const TABLES = ['sires', 'dams', 'breeders', 'horses', 'horse_aliases', 'events', 'classes', 'batches', 'results', 'placings'];
const baseline = queryLocal(PERSIST, `SELECT ${TABLES.map(t => `(SELECT IFNULL(MAX(id), 0) FROM ${t}) AS ${t}`).join(', ')}`)[0];

const { env, dispose } = await getPlatformProxy({ persist: { path: join(PERSIST, 'v3') } });
const questions = [];
const byArticle = new Map(articles.map(a => [a.url, []]));
for (const r of rows) byArticle.get(r.article_url).push(r);
let added = 0;
for (const a of [...articles].sort((x, y) => x.date.localeCompare(y.date))) {
  const list = cleanRows(byArticle.get(a.url), SEASON);
  if (!list.length) continue;
  const decisions = {};
  let res = await importResults(env.DB, list, { decisions, weekLabel: weekLabel(a.date) });
  while (res.needsDecision) {
    // Nothing is merged on a guess: a name that only looks like an existing one becomes its own record.
    for (const qn of res.needsDecision) { decisions[qn.key] = 'new'; questions.push({ article_date: a.date, ...qn }); }
    res = await importResults(env.DB, list, { decisions, weekLabel: weekLabel(a.date) });
  }
  added += res.results;
  console.log(`${a.date}: ${list.length} rows, ${res.results} new results (${res.alreadySaved} already saved), ${res.horses} horses, ${res.sires} sires, ${res.dams} dams, ${res.breeders} breeders`);
}
await dispose();

const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
writeFileSync('reports/hsi-2026-name-checks.csv', ['article_date,kind,name,context,looks_like', ...questions.map(x =>
  [x.article_date, x.kind, x.name, x.context, x.candidates.map(c => `${c.label} (${c.detail})`).join(' | ')].map(cell).join(','))].join('\n') + '\n');

// 4. SQL for everything the import added
const rowsOf = sql => queryLocal(PERSIST, sql);
const after = (alias, table) => `${alias}.id > ${baseline[table]}`;
const out = [
  `-- Charlie Ripman's ${SEASON} Irish-Bred Results from horsesportireland.ie: ${articles.length} weekly articles,`,
  `-- ${articles[0] ? [...articles].sort((x, y) => x.date.localeCompare(y.date))[0].date : ''} to ${articles[0] ? [...articles].sort((x, y) => y.date.localeCompare(x.date))[0].date : ''}. One upload per article.`,
  '-- Generated by scripts/build-hsi-migration.mjs; do not edit by hand. Lines that could not be read are saved',
  '-- with parse_ok = 0 and verified = 0; see reports/hsi-2026-review.csv.',
  '-- Safe to run more than once: rows are matched on their natural identity and never duplicated.',
  ''
];
const add = s => out.push(s.replace(/\n\s+/g, ' ') + ';');

for (const s of rowsOf(`SELECT name, name_normalised, breed_code, tih_flag FROM sires s WHERE ${after('s', 'sires')} ORDER BY id`)) {
  add(`INSERT OR IGNORE INTO sires (name, name_normalised, breed_code, tih_flag) VALUES (${q(s.name)}, ${q(s.name_normalised)}, ${q(s.breed_code)}, ${s.tih_flag})`);
}
for (const d of rowsOf(`SELECT d.name, d.name_normalised, d.breed_code, d.tih_flag, s.name_normalised AS sire FROM dams d LEFT JOIN sires s ON s.id = d.sire_id WHERE ${after('d', 'dams')} ORDER BY d.id`)) {
  add(`INSERT OR IGNORE INTO dams (name, name_normalised, breed_code, tih_flag, sire_id) VALUES (${q(d.name)}, ${q(d.name_normalised)}, ${q(d.breed_code)}, ${d.tih_flag}, ${sireId(d.sire)})`);
}
for (const b of rowsOf(`SELECT name, name_normalised, county FROM breeders b WHERE ${after('b', 'breeders')} ORDER BY id`)) {
  add(`INSERT OR IGNORE INTO breeders (name, name_normalised, county) VALUES (${q(b.name)}, ${q(b.name_normalised)}, ${q(b.county)})`);
}
for (const h of rowsOf(`SELECT h.name, h.sex, h.breed_code, h.tih_flag, h.notes, ${HORSE_KEY}, ds.name_normalised AS damsire, b.name_normalised AS breeder, b.county AS breeder_county
    FROM horses h ${HORSE_JOIN} LEFT JOIN sires ds ON ds.id = h.damsire_id LEFT JOIN breeders b ON b.id = h.breeder_id WHERE ${after('h', 'horses')} ORDER BY h.id`)) {
  add(`INSERT OR IGNORE INTO horses (name, name_normalised, birth_year, sex, breed_code, tih_flag, notes, sire_id, dam_id, damsire_id, breeder_id)
    VALUES (${q(h.name)}, ${q(h.h_norm)}, ${h.h_year ?? 'NULL'}, ${q(h.sex)}, ${q(h.breed_code)}, ${h.tih_flag}, ${q(h.notes)},
    ${sireId(h.h_sire)}, ${damId(h.h_dam, h.h_dam_sire)}, ${sireId(h.damsire)}, ${breederId(h.breeder, h.breeder_county)})`);
}
for (const a of rowsOf(`SELECT a.former_name, a.former_name_normalised, ${HORSE_KEY} FROM horse_aliases a JOIN horses h ON h.id = a.horse_id ${HORSE_JOIN} WHERE ${after('a', 'horse_aliases')} ORDER BY a.id`)) {
  add(`INSERT OR IGNORE INTO horse_aliases (horse_id, former_name, former_name_normalised) VALUES (${horseId(a)}, ${q(a.former_name)}, ${q(a.former_name_normalised)})`);
}

for (const e of rowsOf(`SELECT name, date_text, start_date, end_date, country, season, source_notes, article_url, article_date FROM events e WHERE ${after('e', 'events')} ORDER BY id`)) {
  add(`INSERT OR IGNORE INTO events (name, date_text, start_date, end_date, country, season, source_notes, article_url, article_date)
    VALUES (${q(e.name)}, ${q(e.date_text)}, ${q(e.start_date)}, ${q(e.end_date)}, ${q(e.country)}, ${e.season}, ${q(e.source_notes)}, ${q(e.article_url)}, ${q(e.article_date)})`);
}
// Events that were already live (e.g. the week of 6 April 2026) take the article they appeared in.
for (const e of rowsOf(`SELECT name, start_date, country, article_url, article_date FROM events e WHERE NOT (${after('e', 'events')}) AND article_url <> '' ORDER BY id`)) {
  add(`UPDATE events SET article_url = ${q(e.article_url)}, article_date = ${q(e.article_date)}
    WHERE name = ${q(e.name)} AND start_date = ${q(e.start_date)} AND country = ${q(e.country)} AND article_date < ${q(e.article_date)}`);
}
for (const c of rowsOf(`SELECT c.name AS cl_name, ${EVENT_KEY} FROM classes c JOIN events e ON e.id = c.event_id WHERE ${after('c', 'classes')} ORDER BY c.id`)) {
  add(`INSERT OR IGNORE INTO classes (event_id, name) VALUES (${eventId(c)}, ${q(c.cl_name)})`);
}
const batches = rowsOf(`SELECT label, created_at FROM batches b WHERE ${after('b', 'batches')} ORDER BY id`);
for (const b of batches) {
  add(`INSERT INTO batches (label, created_at, row_count, unverified_count) SELECT ${q(b.label)}, ${q(b.created_at)}, 0, 0
    WHERE NOT EXISTS (SELECT 1 FROM batches WHERE label = ${q(b.label)})`);
}

for (const r of rowsOf(`SELECT r.rider_name, r.rider_country, r.class_name, r.placing, r.dressage, r.xc_jumping, r.show_jumping, r.total, r.week_label, r.verified, r.created_at,
    r.raw_line, r.parse_ok, r.article_url, r.article_date, b.label AS batch, ${EVENT_KEY}, ${HORSE_KEY}
    FROM results r JOIN events e ON e.id = r.event_id JOIN horses h ON h.id = r.horse_id ${HORSE_JOIN} LEFT JOIN batches b ON b.id = r.batch_id
    WHERE ${after('r', 'results')} ORDER BY r.id`)) {
  add(`INSERT OR IGNORE INTO results (event_id, horse_id, rider_name, rider_country, class_name, placing, dressage, xc_jumping, show_jumping, total, week_label, verified, batch_id, created_at,
    raw_line, parse_ok, article_url, article_date)
    VALUES (${eventId(r)}, ${horseId(r)}, ${q(r.rider_name)}, ${q(r.rider_country)}, ${q(r.class_name)}, ${r.placing ?? 'NULL'}, ${q(r.dressage)}, ${q(r.xc_jumping)},
    ${q(r.show_jumping)}, ${r.total ?? 'NULL'}, ${q(r.week_label)}, ${r.verified}, ${batchId(r.batch)}, ${q(r.created_at)},
    ${q(r.raw_line)}, ${r.parse_ok}, ${q(r.article_url)}, ${q(r.article_date)})`);
}
for (const p of rowsOf(`SELECT p.position, p.horse_name, p.former_name, p.breed, p.foaled, p.sex, p.sire, p.dam, p.dam_sire, p.breeder, p.dressage, p.show_jumping,
    p.cross_country, p.score, p.verified, c.name AS cl_name, b.label AS batch, ${EVENT_KEY},
    r.class_name AS r_class, ${HORSE_KEY}
    FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id LEFT JOIN batches b ON b.id = p.batch_id
    LEFT JOIN results r ON r.id = p.result_id LEFT JOIN horses h ON h.id = r.horse_id ${HORSE_JOIN} WHERE ${after('p', 'placings')} ORDER BY p.id`)) {
  const resultId = p.r_class ? `(SELECT id FROM results WHERE event_id = ${eventId(p)} AND class_name = ${q(p.r_class)} AND horse_id = ${horseId(p)})` : 'NULL';
  add(`INSERT OR IGNORE INTO placings (class_id, batch_id, result_id, position, horse_name, former_name, breed, foaled, sex, sire, dam, dam_sire, breeder,
    dressage, show_jumping, cross_country, score, verified)
    VALUES (${classId(p)}, ${batchId(p.batch)}, ${resultId}, ${p.position ?? 'NULL'}, ${q(p.horse_name)}, ${q(p.former_name)}, ${q(p.breed)}, ${p.foaled ?? 'NULL'},
    ${q(p.sex)}, ${q(p.sire)}, ${q(p.dam)}, ${q(p.dam_sire)}, ${q(p.breeder)}, ${q(p.dressage)}, ${q(p.show_jumping)}, ${q(p.cross_country)}, ${p.score ?? 'NULL'}, ${p.verified})`);
}
for (const label of new Set(rowsOf(`SELECT DISTINCT b.label FROM placings p JOIN batches b ON b.id = p.batch_id WHERE ${after('p', 'placings')}`).map(b => b.label))) {
  add(`UPDATE batches SET row_count = (SELECT COUNT(*) FROM placings WHERE batch_id = batches.id),
    unverified_count = (SELECT COUNT(*) FROM placings WHERE batch_id = batches.id AND verified = 0) WHERE label = ${q(label)}`);
}

writeFileSync(OUT, out.join('\n') + '\n');
const by = s => review.filter(r => r.status === s).length;
console.log(`\n${OUT}: ${out.length - 6} statements. ${rows.length} results read, ${added} new; ${rows.filter(r => !r.parse_ok).length} not read cleanly.`);
console.log(`reports/hsi-2026-review.csv: ${by('failed')} failed, ${by('conflict')} conflicts, ${by('check')} to check, ${by('skipped')} skipped.`);
console.log(`reports/hsi-2026-name-checks.csv: ${questions.length} names that look like an existing record (saved separately).`);
