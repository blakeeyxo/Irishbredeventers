import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { readFeiPaste, readFeiListHtml } from '../lib/fei.js';
import { readShdPage } from '../lib/shd.js';
import { runFeiList, runFeiImport, sjBreedingList } from '../lib/sj.js';
import { runFeiReader, runShdReader, readerStatus, setReader, importShdPages, sameHorse } from '../lib/auto.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const PERF = readFileSync(new URL('./fixtures/fei-performance-saved.html', import.meta.url), 'utf8');
const SHD = readFileSync(new URL('./fixtures/shd-horse-saved.html', import.meta.url), 'utf8');
const LIST_HTML = readFileSync(new URL('./fixtures/fei-list-saved.html', import.meta.url), 'utf8');
const JUMPING = readFileSync(new URL('./fixtures/fei-jumping.txt', import.meta.url), 'utf8');

// A pretend web: url → page, with every request recorded.
function web(pages) {
  const asked = [];
  const fetcher = async url => {
    asked.push(url);
    const body = pages[url];
    return body === undefined ? new Response('Not found', { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetcher, asked };
}

test('a saved FEI results page (HTML) reads like a paste', () => {
  const { horses, problems } = readFeiPaste(PERF);
  assert.equal(problems.length, 0);
  const h = horses[0];
  assert.deepEqual([h.name, h.fei_id, h.studbook, h.irish, h.sex, h.foaled, h.nf], ['Altivo', '106OV63', 'ISH', true, 'gelding', '2011-05-12', 'AUT']);
  assert.equal(h.results.length, 30);
  assert.deepEqual([h.results[1].date, h.results[1].show, h.results[1].position, h.results[1].faults, h.results[1].time_s, h.results[1].athlete],
    ['2023-10-20', 'San Giovanni in Marignano', 37, 13, 73.59, 'Cora Dieringer']);
});

test('a SporthorseData page gives the breeding, with studbooks the shared file uses', () => {
  const p = readShdPage(SHD);
  assert.deepEqual([p.name, p.fei_id, p.ueln, p.foaled, p.sex, p.breed, p.breeder, p.breeder_country],
    ['A Touch of Royal Cyrano', '106ZU51', '372414005771275', '2013-07-28', 'mare', 'Irish Sport Horse', 'Miguel Bravo', 'Ireland']);
  assert.deepEqual(p.sire, { name: 'Cyrano', studbook: 'HOLST', year: 1991 });
  assert.deepEqual(p.dam, { name: 'A Touch Of Royale', studbook: 'ISH', year: 1995 });
  assert.deepEqual(p.dam_sire, { name: 'Cavalier Royale', studbook: 'HOLST', year: 1978 });
  assert.equal(p.url, 'https://sporthorse-data.com/pedigree/touch-royal-cyrano');
  assert.equal(readShdPage('<html>something else</html>'), null);
  assert.ok(sameHorse({ fei_id: '106ZU51' }, p));
  assert.ok(!sameHorse({ fei_id: '999XX99' }, p), 'a different FEI ID is a different horse, whatever the name');
  assert.ok(sameHorse({ name: 'A TOUCH OF ROYAL CYRANO', foaled_year: 2013 }, p));
  assert.ok(!sameHorse({ name: 'A Touch of Royal Cyrano', foaled_year: 2014 }, p));
});

test('permission on record: both sources may be read automatically, at most 1000 horses a day, and start switched off', async () => {
  const db = fresh();
  const shd = await db.prepare("SELECT licence_status, can_store, can_display FROM source WHERE slug = 'sporthorse-data'").first();
  assert.deepEqual([shd.licence_status, shd.can_store, shd.can_display], ['agreed_in_writing', 1, 1]);
  const readers = await readerStatus(db);
  assert.deepEqual(readers.map(r => [r.slug, r.enabled, r.max_daily]), [['sporthorse-data', 0, 1000], ['fei', 0, 1000]]);
  await setReader(db, 'fei', { enabled: true, daily_limit: 5000 }, 'emer');
  assert.equal((await readerStatus(db)).find(r => r.slug === 'fei').daily_limit, 1000, 'never above what FEI agreed');
});

test('FEI reader: switched off it reads nothing; switched on it reads checklist horses from their FEI link and saves their results', async () => {
  const db = fresh();
  await runFeiList(db, LIST_HTML, { save: true });
  const altivoUrl = 'https://data.fei.org/Horse/Performance.aspx?p=A8E7B3EC6C636B50C7E3F4B26436B90C';
  db.raw.exec(`INSERT INTO fei_checklist (fei_id, name, studbook, status, fei_url) VALUES ('106OV63', 'Altivo', 'ISH', 'to_check', '${altivoUrl}')`);
  db.raw.exec("UPDATE fei_checklist SET last_pasted_at = datetime('now') WHERE fei_id != '106OV63'");
  const w = web({ [altivoUrl]: PERF });
  assert.deepEqual(await runFeiReader(db, { fetcher: w.fetcher }), []);
  assert.equal(w.asked.length, 0, 'off: no requests at all');
  await setReader(db, 'fei', { enabled: true, daily_limit: 300 });
  const done = await runFeiReader(db, { fetcher: w.fetcher });
  assert.deepEqual(done.map(d => [d.horse, d.outcome]), [['Altivo', 'saved']]);
  assert.match(done[0].detail, /^30 new results/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM result r JOIN horse h ON h.id = r.horse_id WHERE h.fei_id = '106OV63'").first()).n, 30);
  // Read: not again for 6 days.
  assert.deepEqual(await runFeiReader(db, { fetcher: w.fetcher }), []);
  assert.equal(w.asked.length, 1);
  const status = (await readerStatus(db)).find(r => r.slug === 'fei');
  assert.deepEqual([status.today, status.outcomes.saved, status.recent[0].horse], [1, 1, 'Altivo']);
});

test('FEI reader stops at the daily limit', async () => {
  const db = fresh();
  for (let i = 0; i < 4; i++) db.raw.exec(`INSERT INTO fei_checklist (fei_id, name, status, fei_url) VALUES ('10000${i}', 'Horse ${i}', 'to_check', 'https://data.fei.org/Horse/Performance.aspx?p=${i}')`);
  await setReader(db, 'fei', { enabled: true, daily_limit: 2 });
  const w = web({});
  const first = await runFeiReader(db, { fetcher: w.fetcher });
  assert.equal(first.length, 2);
  assert.ok(first.every(d => d.outcome === 'failed'), 'a page that would not load is logged, not saved');
  assert.deepEqual(await runFeiReader(db, { fetcher: w.fetcher }), [], 'no more today');
  assert.equal(w.asked.length, 2);
});

test('SporthorseData reader: finds the horse by search, checks it is the same horse, and fills in its breeding', async () => {
  const db = fresh();
  // A Touch of Royal Cyrano with results and no breeding.
  const mayflower = JUMPING.replace('ABC MAYFLOWER', 'A TOUCH OF ROYAL CYRANO').replace('109WK62', '106ZU51').replace('08/05/2021', '28/07/2013');
  await runFeiImport(db, mayflower, { save: true });
  assert.equal((await sjBreedingList(db, { gaps: true })).total, 1);
  const search = 'https://sporthorse-data.com/search/pedigree?keys=A%20Touch%20Of%20Royal%20Cyrano';
  const results = '<html><a href="/pedigree/touch-grey-1">A Touch Grey</a><a href="https://sporthorse-data.com/pedigree/touch-royal-cyrano">A Touch of Royal Cyrano</a></html>';
  const w = web({ [search]: results, 'https://sporthorse-data.com/pedigree/touch-royal-cyrano': SHD, 'https://sporthorse-data.com/pedigree/touch-grey-1': SHD.replace('106ZU51', '000AA00') });
  await setReader(db, 'sporthorse-data', { enabled: true, daily_limit: 100 });
  const done = await runShdReader(db, { fetcher: w.fetcher });
  assert.deepEqual(done.map(d => d.outcome), ['saved'], done[0].detail);
  assert.match(done[0].detail, /Cyrano \(HOLST\) × A Touch Of Royale \(ISH\) × Cavalier Royale \(HOLST\); bred by Miguel Bravo/);
  const h = (await sjBreedingList(db, { q: 'cyrano' })).horses[0];
  assert.deepEqual([h.sire, h.dam, h.dam_sire, h.breeder], ['Cyrano', 'A Touch Of Royale', 'Cavalier Royale', 'Miguel Bravo']);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM horse WHERE source_id = (SELECT id FROM source WHERE slug = 'sporthorse-data')").first()).n >= 3, true, 'new sires and dams record their source');
  assert.deepEqual(await runShdReader(db, { fetcher: w.fetcher }), [], 'looked up once, not again');
});

test('SporthorseData reader: a page for another horse with the same name is not used', async () => {
  const db = fresh();
  const other = JUMPING.replace('ABC MAYFLOWER', 'A TOUCH OF ROYAL CYRANO').replace('109WK62', '999ZZ99');
  await runFeiImport(db, other, { save: true });
  const w = web({ 'https://sporthorse-data.com/search/pedigree?keys=A%20Touch%20Of%20Royal%20Cyrano': SHD });
  await setReader(db, 'sporthorse-data', { enabled: true, daily_limit: 100 });
  const done = await runShdReader(db, { fetcher: w.fetcher });
  assert.deepEqual(done.map(d => d.outcome), ['not_found']);
  assert.equal((await sjBreedingList(db, { gaps: true })).total, 1, 'nothing filled in');
});

test('saved SporthorseData pages from the owner area: check, then save', async () => {
  const db = fresh();
  const check = await importShdPages(db, [SHD, '<html>not a horse</html>']);
  assert.equal(check.saved, undefined);
  assert.deepEqual([check.pages[0].sire, check.unread, check.counts.new], ['Cyrano (HOLST)', 1, 1]);
  const saved = await importShdPages(db, [SHD], { save: true, user: 'emer' });
  assert.equal(saved.saved, true);
  const h = await db.prepare("SELECT h.ueln, s.name AS sire, b.name AS breeder, b.country FROM horse h JOIN horse s ON s.id = h.sire_id JOIN party b ON b.id = h.breeder_id WHERE h.fei_id = '106ZU51'").first();
  assert.deepEqual([h.ueln, h.sire, h.breeder, h.country], ['372414005771275', 'Cyrano', 'Miguel Bravo', 'Ireland']);
});

test('saved FEI list pages keep their links (fixture check)', () => {
  assert.equal(readFeiListHtml(LIST_HTML).horses.every(h => h.url), true);
});
