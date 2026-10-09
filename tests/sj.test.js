import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { readFeiPaste, jumpingScore, feiName } from '../lib/fei.js';
import { runFeiImport, sjSeason, sjWeekWinners, sjSearch, sjHorse, runFeiList, listChecklist, setChecklistStatus } from '../lib/sj.js';
import { runUpload } from '../lib/shared.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const JUMPING = readFileSync(new URL('./fixtures/fei-jumping.txt', import.meta.url), 'utf8');
const EVENTING = readFileSync(new URL('./fixtures/fei-eventing.txt', import.meta.url), 'utf8');
const showFei = db => db.raw.exec("UPDATE source SET can_display = 1, can_store = 1 WHERE slug = 'fei'");
const hideFei = db => db.raw.exec("UPDATE source SET can_display = 0 WHERE slug = 'fei'");
const LIST = readFileSync(new URL('./fixtures/fei-list.txt', import.meta.url), 'utf8');
const noStudbook = JUMPING.replace('ABC MAYFLOWER', 'NO BOOK HORSE').replace('109WK62', '100XX01').replace('ISH - Irish Sport Horse Studbook (ISH)', '');

test('reads an FEI jumping page: horse details, each result, faults and time', () => {
  const { horses, problems } = readFeiPaste(JUMPING + EVENTING);
  assert.equal(problems.length, 0);
  const [h, ev] = horses;
  assert.deepEqual([h.name, h.fei_id, h.foaled, h.sex, h.colour, h.studbook, h.irish, h.discipline],
    ['Abc Mayflower', '109WK62', '2021-05-08', 'mare', 'Bay', 'ISH', true, 'jumping']);
  assert.equal(h.results.length, 3);
  assert.deepEqual([h.results[0].date, h.results[0].show, h.results[0].country, h.results[0].event, h.results[0].height_m, h.results[0].position, h.results[0].faults, h.results[0].time_s, h.results[0].athlete],
    ['2026-09-20', 'Lanaken', 'BEL', 'CH-M-YH-S', 1.25, 19, 4, 72.11, 'Gemma Phelan']);
  assert.equal(ev.discipline, 'eventing');
  assert.deepEqual(jumpingScore('EL'), { faults: null, rounds: '', time: null, text: 'EL' });
  assert.equal(feiName('SEVILLA VAN DE BERGHOEVE Z'), 'Sevilla van de Berghoeve Z');
});

test('import: one event over the show days, a class per competition and day, a result per horse; pasting again adds nothing', async () => {
  const db = fresh();
  const check = await runFeiImport(db, JUMPING + EVENTING, { year: 2026 });
  assert.equal(check.saved, undefined);
  assert.deepEqual([check.counts.horses, check.counts.results, check.counts.events, check.counts.classes], [1, 3, 1, 3]);
  assert.match(check.left[0].why, /Eventing/);
  const saved = await runFeiImport(db, JUMPING, { year: 2026, save: true, user: 'emer' });
  assert.equal(saved.saved, true);
  const ev = await db.prepare("SELECT name, country, start_date, end_date, source_id FROM competition_event").first();
  assert.deepEqual([ev.name, ev.country, ev.start_date, ev.end_date], ['Lanaken', 'BEL', '2026-09-17', '2026-09-20']);
  const fei = (await db.prepare("SELECT id FROM source WHERE slug = 'fei'").first()).id;
  assert.equal(ev.source_id, fei);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM result WHERE source_id = ? AND upload_id IS NOT NULL').bind(fei).first()).n, 3, 'every result records its source and paste');
  const horse = await db.prepare("SELECT name, fei_id, irish_bred, foaled_year FROM horse").first();
  assert.deepEqual([horse.name, horse.fei_id, horse.irish_bred, horse.foaled_year], ['Abc Mayflower', '109WK62', 1, 2021]);
  const again = await runFeiImport(db, JUMPING, { year: 2026, save: true });
  assert.equal(again.saved, false);
  assert.equal(again.counts.same, 3);
});

test('only Irish-bred: no studbook waits for a tick; other years are left out', async () => {
  const db = fresh();
  const r = await runFeiImport(db, noStudbook, { year: 2026 });
  assert.equal(r.counts.horses, 0);
  assert.equal(r.left[0].unclear, true);
  const ticked = await runFeiImport(db, noStudbook, { year: 2026, includeUnclear: ['100XX01'] });
  assert.equal(ticked.counts.results, 3);
  const lastYear = await runFeiImport(db, JUMPING, { year: 2025 });
  assert.match(lastYear.left[0].why, /No 2025 results/);
});

test('FEI results reach the site only when the FEI source may show; then results, winners, search and horse pages work', async () => {
  const db = fresh();
  const iber = (await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first()).id;
  await runUpload(db, 'Name,Year,Sire,Dam,Dam sire,Breeder\nAbc Mayflower,2021,Cruising (ISH),Abc Lady,Clover Hill,Mary Brennan', { sourceId: iber, save: true });
  await runFeiImport(db, JUMPING, { year: 2026, save: true });
  hideFei(db);
  assert.equal((await sjSeason(db, 2026)).rows.length, 0, 'a source not allowed to show stays hidden');
  showFei(db);
  const season = await sjSeason(db, 2026);
  assert.equal(season.rows.length, 3);
  const top = season.rows[0];
  assert.deepEqual([top.horse_name, top.sire, top.dam, top.dam_sire, top.breeder, top.event_name, top.class_date, top.score, top.rider_name],
    ['Abc Mayflower', 'Cruising', 'Abc Lady', 'Clover Hill', 'Mary Brennan', 'Lanaken', '2026-09-20', '4(4+0)/72.11', 'Gemma Phelan'], 'breeding from the stallion upload joins the FEI results');
  assert.equal(top.oio, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse WHERE name_key = ?').bind('abc mayflower').first()).n, 1, 'the FEI horse matched the uploaded one');
  assert.deepEqual(season.seasons, [2026]);
  const winners = await sjWeekWinners(db);
  assert.deepEqual(winners.map(w => w.class_date).sort(), ['2026-09-17', '2026-09-18']);
  assert.equal((await sjSearch(db, 'cruising', 'sire')).total, 3);
  assert.equal((await sjSearch(db, 'brennan', 'breeder')).total, 3);
  assert.equal((await sjSearch(db, 'phelan', 'all')).total, 0, 'riders are not searched');
  const page = await sjHorse(db, top.id);
  assert.equal(page.runs.length, 3);
});

test('FEI permission is on record: the FEI source may store and show', async () => {
  const db = fresh();
  const fei = await db.prepare("SELECT licence_status, can_store, can_display FROM source WHERE slug = 'fei'").first();
  assert.deepEqual([fei.licence_status, fei.can_store, fei.can_display], ['agreed_in_writing', 1, 1]);
});

test('checklist: a pasted FEI horse list keeps Irish-bred and unclear horses; pasting results ticks them off', async () => {
  const db = fresh();
  const check = await runFeiList(db, LIST);
  assert.deepEqual([check.total, check.irish, check.unclear, check.notIrish, check.added], [50, 26, 6, 18, 32]);
  assert.equal(check.saved, false);
  await runFeiList(db, LIST, { save: true });
  assert.equal((await runFeiList(db, LIST, { save: true })).added, 0, 'pasting the same page twice adds nothing');
  let list = await listChecklist(db);
  assert.deepEqual([list.counts.to_check, list.counts.never, list.counts.done, list.counts.unclear], [26, 26, 0, 6]);
  await runFeiImport(db, JUMPING, { year: 2026, save: true });
  list = await listChecklist(db, { view: 'done' });
  assert.deepEqual(list.horses.map(h => [h.name, h.results_found]), [['Abc Mayflower', 3]]);
  assert.equal((await listChecklist(db)).counts.never, 25);
  // An unclear horse the owner knows is Irish-bred moves onto the list to check.
  await setChecklistStatus(db, '106AH67', 'to_check');
  assert.equal((await listChecklist(db)).counts.to_check, 27);
  assert.equal((await listChecklist(db, { q: 'alonsa' })).horses[0].fei_id, '106AH67');
});

test('owner area breeding on IBSR: lists FEI horses with gaps and saves breeding into the shared database', async () => {
  const { sjBreedingList, sjSaveBreeding } = await import('../lib/sj.js');
  const db = fresh();
  await runFeiImport(db, JUMPING, { year: 2026, save: true });
  let list = await sjBreedingList(db, { gaps: true });
  assert.deepEqual([list.total, list.gaps, list.horses[0].name, list.horses[0].runs], [1, 1, 'Abc Mayflower', 3]);
  const id = list.horses[0].id;
  const r = await sjSaveBreeding(db, id, { sire: 'Cruising (ISH)', dam: 'Abc Lady', dam_sire: 'Clover Hill', breeder: 'Mary Brennan (Cork)', sex: 'Mare', breed: 'ISH' }, 'emer');
  assert.deepEqual([r.saved, r.results], [true, 3]);
  list = await sjBreedingList(db, { q: 'mayflower' });
  const h = list.horses[0];
  assert.deepEqual([h.sire, h.sire_breed, h.dam, h.dam_sire, h.breeder, h.breeder_county, h.sex], ['Cruising', 'ISH', 'Abc Lady', 'Clover Hill', 'Mary Brennan', 'Cork', 'Mare']);
  assert.equal((await sjBreedingList(db, { gaps: true })).total, 0);
  assert.equal((await sjBreedingList(db, { sire: 'cruis' })).total, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse WHERE name_key = ?').bind('abc mayflower').first()).n, 1, 'the same horse, not a new one');
  assert.ok((await db.prepare("SELECT COUNT(*) AS n FROM upload_change WHERE field = 'sire_id'").first()).n >= 1, 'the change is logged');
});

test('with no year chosen, every year on the FEI page is kept', async () => {
  const db = fresh();
  const mixed = JUMPING.replace('20/09/2026', '20/09/2025');
  const all = await runFeiImport(db, mixed, {});
  assert.equal(all.counts.results, 3);
  const only = await runFeiImport(db, mixed, { year: 2026 });
  assert.equal(only.counts.results, 2);
  await runFeiImport(db, mixed, { save: true });
  showFei(db);
  assert.deepEqual((await sjSeason(db, 2026)).seasons.sort(), [2025, 2026]);
  assert.equal((await sjSeason(db, 2025)).rows.length, 1);
});
