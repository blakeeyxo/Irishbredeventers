import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { readSubmission, saveSubmission, listSubmissions, approveSubmission, rejectSubmission } from '../lib/submissions.js';
import { runFeiImport, sjBreedingList } from '../lib/sj.js';
import { parseShowjumping } from '../lib/parser-sj.js';
import { cleanRows, importResults } from '../lib/import.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const JUMPING = readFileSync(new URL('./fixtures/fei-jumping.txt', import.meta.url), 'utf8');
const contact = { contact_name: 'Mary Brennan', contact_email: 'mary@example.ie', relation: 'breeder' };

test('the form is checked: kind, horse, date and show for a result, something for breeding, and a way to reply', () => {
  assert.match(readSubmission({}).error, /Choose what/);
  assert.match(readSubmission({ kind: 'missing_result', horse_name: 'X', ...contact }).error, /date/);
  assert.match(readSubmission({ kind: 'breeding', horse_name: 'X', ...contact }).error, /sire, dam/);
  assert.match(readSubmission({ kind: 'breeding', horse_name: 'X', sire: 'Y' }).error, /name and email/);
  assert.match(readSubmission({ kind: 'breeding', horse_name: 'X', sire: 'Y', fei_id: 'not-an-id', ...contact }).error, /FEI ID/);
  assert.ok(readSubmission({ kind: 'breeding', horse_name: 'X', sire: 'Y', ...contact }).row);
});

// Submissions wait in the shared database; an approved result goes into the site's own database (IBSR's migrations).
const site = () => memoryD1(new URL('../migrations-ibsr/', import.meta.url));
const SITE_ROWS = `SELECT p.position, p.horse_name, p.sire, p.dam, p.breeder, p.verified, c.name AS class_name, e.name AS event_name, e.country, e.start_date,
    r.rider_name, r.owner_name FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id JOIN results r ON r.id = p.result_id ORDER BY p.id`;

test('a missing result waits for approval, then goes live through the upload import, with its owner', async () => {
  const db = fresh(), siteDb = site();
  assert.match(readSubmission({ kind: 'missing_result', horse_name: 'X', date: '2026-08-07', show: 'Y', ...contact }).error, /placing/);
  const { row } = readSubmission({ kind: 'missing_result', horse_name: 'Clover Lady', foaled_year: 2015, date: '2026-08-07', show: 'Dublin Horse Show',
    country: 'Ireland', level: 'CSIO5*', class_name: 'Grand Prix', height_cm: 160, placing: 3, rider: 'Shane Breen', rider_country: 'irl', owner: 'Clover Farm', ...contact });
  assert.equal('faults' in row.result, false, 'placings only');
  await saveSubmission(db, 'ibsr', row);
  assert.equal((await siteDb.prepare(SITE_ROWS).all()).results.length, 0, 'nothing on the site before approval');
  const { submissions, counts } = await listSubmissions(db, 'ibsr');
  assert.equal(counts.pending, 1);
  assert.equal(submissions[0].result.show, 'Dublin Horse Show');
  const r = await approveSubmission(db, 'ibsr', submissions[0].id, 'charlie', { siteDb });
  assert.equal(r.message, 'Result added.');
  const rows = (await siteDb.prepare(SITE_ROWS).all()).results;
  assert.deepEqual(rows.map(x => [x.horse_name, x.event_name, x.country, x.position, x.class_name, x.rider_name, x.owner_name, x.verified]),
    [['Clover Lady', 'Dublin Horse Show', 'Ireland', 3, 'CSIO5* · Grand Prix · 1.60m', 'Shane Breen', 'Clover Farm', 1]]);
  await assert.rejects(approveSubmission(db, 'ibsr', submissions[0].id, 'charlie', { siteDb }), /already been dealt with/);
  assert.equal((await listSubmissions(db, 'ibsr', 'approved')).submissions[0].decided_by, 'charlie');
});

test('a result sent in for a horse already on the site keeps its breeding; a correction replaces its result at that show', async () => {
  const db = fresh(), siteDb = site();
  const file = parseShowjumping(readFileSync(new URL('./fixtures/sj-2024.txt', import.meta.url), 'utf8'));
  await importResults(siteDb, cleanRows(file.rows.map(x => ({ ...x, verified: true })), 2024), { withOwner: true });
  const { row } = readSubmission({ kind: 'result_correction', horse_name: 'Express Trend', date: '2024-05-17', show: 'Kronenberg', country: 'NED',
    placing: 2, rider: 'Jessica Burke', rider_country: 'IRL', ...contact });
  await saveSubmission(db, 'ibsr', row);
  const id = (await listSubmissions(db, 'ibsr')).submissions[0].id;
  assert.equal((await approveSubmission(db, 'ibsr', id, 'charlie', { siteDb })).message, 'Result corrected.');
  const mine = (await siteDb.prepare(SITE_ROWS).all()).results.filter(x => x.horse_name === 'Express Trend');
  assert.deepEqual(mine.map(x => [x.position, x.event_name, x.class_name, x.sire, x.dam, x.breeder]),
    [[2, 'Kronenberg International', 'CSIO 3* · € 66,300 Nations Cup 1.45m', 'Future Trend (OLD)', 'Condios Express (ISH)', 'Liam Nicholas']], 'the same result, corrected; no second one');
  const miss = readSubmission({ kind: 'result_correction', horse_name: 'Express Trend', date: '2024-06-01', show: 'Elsewhere', placing: 1, ...contact }).row;
  await saveSubmission(db, 'ibsr', miss);
  const id2 = (await listSubmissions(db, 'ibsr')).submissions[0].id;
  await assert.rejects(approveSubmission(db, 'ibsr', id2, 'charlie', { siteDb }), /no result for this horse at a show on that date/);
});

test('breeding sent in fills in the horse on file; turned down changes nothing', async () => {
  const db = fresh();
  await runFeiImport(db, JUMPING, { save: true });
  const send = async extra => { const { row } = readSubmission({ kind: 'breeding', horse_name: 'Abc Mayflower', fei_id: '109WK62', ...extra, ...contact }); await saveSubmission(db, 'ibsr', row); };
  await send({ sire: 'Cruising (ISH)', dam: 'Abc Lady', dam_sire: 'Clover Hill', breeder: 'Mary Brennan (Cork)' });
  await send({ sire: 'Wrong Sire' });
  const [second, first] = (await listSubmissions(db, 'ibsr')).submissions;
  await rejectSubmission(db, 'ibsr', second.id, 'charlie', 'Sire is wrong');
  assert.equal((await approveSubmission(db, 'ibsr', first.id, 'charlie')).message, 'Breeding saved to the shared horse database.');
  const h = (await sjBreedingList(db, { q: 'mayflower' })).horses[0];
  assert.deepEqual([h.sire, h.dam, h.dam_sire, h.breeder, h.breeder_county], ['Cruising', 'Abc Lady', 'Clover Hill', 'Mary Brennan', 'Cork']);
  assert.equal((await listSubmissions(db, 'ibsr', 'rejected')).submissions[0].decision_note, 'Sire is wrong');
  assert.equal((await listSubmissions(db, 'iber')).submissions.length, 0, 'each site sees its own');
});
