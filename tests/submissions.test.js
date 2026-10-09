import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { readSubmission, saveSubmission, listSubmissions, approveSubmission, rejectSubmission } from '../lib/submissions.js';
import { runFeiImport, sjSeason, sjBreedingList } from '../lib/sj.js';

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

test('a missing result waits for approval, then goes live as a result sent in by owners', async () => {
  const db = fresh();
  const { row } = readSubmission({ kind: 'missing_result', horse_name: 'Clover Lady', foaled_year: 2015, date: '2026-08-07', show: 'Dublin Horse Show',
    country: 'Ireland', level: 'CSIO5*', class_name: 'Grand Prix', height_cm: 160, placing: 3, faults: '0', time: '41.2', rider: 'Shane Breen', rider_country: 'irl', ...contact });
  await saveSubmission(db, 'ibsr', row);
  db.raw.exec("UPDATE source SET can_display = 1 WHERE slug IN ('fei', 'owners')");
  assert.equal((await sjSeason(db, 2026)).rows.length, 0, 'nothing on the site before approval');
  const { submissions, counts } = await listSubmissions(db, 'ibsr');
  assert.equal(counts.pending, 1);
  assert.equal(submissions[0].result.show, 'Dublin Horse Show');
  const r = await approveSubmission(db, 'ibsr', submissions[0].id, 'charlie');
  assert.equal(r.message, 'Result added.');
  const rows = (await sjSeason(db, 2026)).rows;
  assert.deepEqual([rows[0].horse_name, rows[0].event_name, rows[0].position, rows[0].score, rows[0].rider_name, rows[0].level],
    ['Clover Lady', 'Dublin Horse Show', 3, '0/41.2', 'Shane Breen', 'CSIO5*']);
  const src = await db.prepare("SELECT s.slug FROM result r JOIN source s ON s.id = r.source_id").first();
  assert.equal(src.slug, 'owners');
  await assert.rejects(approveSubmission(db, 'ibsr', submissions[0].id, 'charlie'), /already been dealt with/);
  assert.equal((await listSubmissions(db, 'ibsr', 'approved')).submissions[0].decided_by, 'charlie');
});

test('a correction to a result changes the result already on file', async () => {
  const db = fresh();
  await runFeiImport(db, JUMPING, { save: true }); // Abc Mayflower, 19th at Lanaken on 2026-09-20, CH-M-YH-S
  const before = await db.prepare("SELECT c.name, c.class_date FROM result r JOIN competition_class c ON c.id = r.class_id WHERE c.class_date = '2026-09-20'").first();
  const { row } = readSubmission({ kind: 'result_correction', horse_name: 'Abc Mayflower', fei_id: '109WK62', date: '2026-09-20', show: 'Lanaken', country: 'BEL',
    level: 'CH-M-YH-S', class_name: before.name, placing: 12, faults: '0', time: '70.5', rider: 'Gemma Phelan', rider_country: 'IRL', ...contact });
  await saveSubmission(db, 'ibsr', row);
  const id = (await listSubmissions(db, 'ibsr')).submissions[0].id;
  assert.equal((await approveSubmission(db, 'ibsr', id, 'charlie')).message, 'Result corrected.');
  const after = await db.prepare("SELECT r.placing, r.score_text FROM result r JOIN competition_class c ON c.id = r.class_id WHERE c.class_date = '2026-09-20'").all();
  assert.deepEqual(after.results.map(x => [x.placing, x.score_text]), [[12, '0/70.5']], 'the same result, corrected; no second one');
});

test('breeding sent in fills in the horse on file; turned down changes nothing', async () => {
  const db = fresh();
  await runFeiImport(db, JUMPING, { save: true });
  const send = async extra => { const { row } = readSubmission({ kind: 'breeding', horse_name: 'Abc Mayflower', fei_id: '109WK62', ...extra, ...contact }); await saveSubmission(db, 'ibsr', row); };
  await send({ sire: 'Cruising (ISH)', dam: 'Abc Lady', dam_sire: 'Clover Hill', breeder: 'Mary Brennan (Cork)' });
  await send({ sire: 'Wrong Sire' });
  const [second, first] = (await listSubmissions(db, 'ibsr')).submissions;
  await rejectSubmission(db, 'ibsr', second.id, 'charlie', 'Sire is wrong');
  assert.equal((await approveSubmission(db, 'ibsr', first.id, 'charlie')).message, 'Breeding saved.');
  const h = (await sjBreedingList(db, { q: 'mayflower' })).horses[0];
  assert.deepEqual([h.sire, h.dam, h.dam_sire, h.breeder, h.breeder_county], ['Cruising', 'Abc Lady', 'Clover Hill', 'Mary Brennan', 'Cork']);
  assert.equal((await listSubmissions(db, 'ibsr', 'rejected')).submissions[0].decision_note, 'Sire is wrong');
  assert.equal((await listSubmissions(db, 'iber')).submissions.length, 0, 'each site sees its own');
});
