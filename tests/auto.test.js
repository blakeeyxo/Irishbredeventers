import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { readFeiPaste, readFeiListHtml } from '../lib/fei.js';
import { runFeiList } from '../lib/sj.js';
import { runFeiReader, readerStatus, setReader } from '../lib/auto.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const PERF = readFileSync(new URL('./fixtures/fei-performance-saved.html', import.meta.url), 'utf8');
const LIST_HTML = readFileSync(new URL('./fixtures/fei-list-saved.html', import.meta.url), 'utf8');

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

test('FEI may be read automatically, at most 1000 horses a day, switched off to start; SporthorseData is refused', async () => {
  const db = fresh();
  const shd = await db.prepare("SELECT licence_status, can_store, can_display FROM source WHERE slug = 'sporthorse-data'").first();
  assert.deepEqual([shd.licence_status, shd.can_store, shd.can_display], ['refused', 0, 0]);
  const readers = await readerStatus(db);
  assert.deepEqual(readers.map(r => [r.slug, r.enabled, r.max_daily]), [['fei', 0, 1000]]);
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

test('saved FEI list pages keep their links (fixture check)', () => {
  assert.equal(readFeiListHtml(LIST_HTML).horses.every(h => h.url), true);
});
