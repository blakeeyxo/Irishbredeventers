import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import { readUpload, parseDelimited, runUpload, listStallions, getHorse } from '../lib/shared.js';

const MIGRATIONS = new URL('../migrations-shared/', import.meta.url);
const fresh = () => memoryD1(MIGRATIONS);
const iberSource = async db => (await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first()).id;

const FILE = `Name,Sex,Year,Studbook,UELN,Sire,Dam,Dam sire,Breeder,County,Irish bred,Aliases
Cruising,Stallion,1985,ISH,,Lucky Boy (TB),Mising,Laurence O,,,yes,
Sligo Candy Boy,stallion,2002,ISH,372001234567890,Candy Boy (KWPN),Sligo Lady,Cruising (ISH),Seamus Gorevan,Sligo,yes,
"Coolcorran Cool Diamond",S,2003,ISH,,Cruising (ISH),"Coolcorran Lady",Diamond Lad,,,y,Cool Diamond
Fernhill Cool Confection,gelding,2017,ISH,,Sligo Candy Boy,Princess Cool Diamond,Coolcorran Cool Diamond,"Fernhill Sport Horses (Tipperary)",,yes,Fernhill Cool Connection`;

test('reads CSV with quotes, odd headings and tagged names; tab-separated paste works too', () => {
  assert.deepEqual(parseDelimited('a,"b, c","say ""hi"""\n1,2,3'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('Name\tSire\nX\tY'), [['Name', 'Sire'], ['X', 'Y']]);
  const { rows, problems } = readUpload(FILE);
  assert.equal(problems.length, 0);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].sex, 'stallion');
  assert.equal(rows[2].sex, 'stallion');
  assert.equal(rows[1].dam_sire.name, 'Cruising');
  assert.equal(rows[1].dam_sire.breed_code, 'ISH');
  assert.equal(rows[3].breeder, 'Fernhill Sport Horses');
  assert.equal(rows[3].breeder_county, 'Tipperary');
  assert.deepEqual(rows[2].aliases, ['Cool Diamond']);
  assert.match(readUpload('Horse;Sire\nA;B').rows[0].sire.name, /^B$/);
  assert.match(readUpload('Sire,Dam\nA,B').problems[0].message, /No "Name" column/);
});

test('an upload links sires, dams and dam sires into one pedigree, and the same file twice adds nothing', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  const check = await runUpload(db, FILE, { sourceId });
  assert.equal(check.saved, undefined, 'checking saves nothing');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse').first()).n, 0);
  assert.deepEqual([check.counts.new, check.counts.held], [4, 0]);

  const saved = await runUpload(db, FILE, { sourceId, save: true, label: 'Test', user: 'emer' });
  assert.equal(saved.saved, true);
  // Cruising is one horse: a row of its own, the dam sire of Sligo Candy Boy, and the sire of Coolcorran Cool Diamond.
  const cruising = await db.prepare("SELECT id FROM horse WHERE name_key = 'cruising'").all();
  assert.equal(cruising.results.length, 1);
  const fern = await db.prepare(`SELECT h.id, s.name AS sire, d.name AS dam, ds.name AS dam_sire, p.name AS breeder, p.county
    FROM horse h JOIN horse s ON s.id = h.sire_id JOIN horse d ON d.id = h.dam_id JOIN horse ds ON ds.id = d.sire_id
    JOIN party p ON p.id = h.breeder_id WHERE h.name = 'Fernhill Cool Confection'`).first();
  assert.deepEqual([fern.sire, fern.dam, fern.dam_sire, fern.breeder, fern.county],
    ['Sligo Candy Boy', 'Princess Cool Diamond', 'Coolcorran Cool Diamond', 'Fernhill Sport Horses', 'Tipperary']);
  // Every row records its source, and every new record is in the upload log.
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse WHERE source_id IS NULL').first()).n, 0);
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM horse').first()).n;
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM upload_change WHERE table_name = 'horse' AND field = '*'").first()).n, total);

  const again = await runUpload(db, FILE, { sourceId, save: true });
  assert.equal(again.saved, false);
  assert.equal(again.counts.same, 4);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse').first()).n, total);
});

test('a different value on file holds the row (nothing saved) unless "replace" is ticked', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, 'Name,Year,Sire\nMHS Seventeen,2013,Callahan (HANN)', { sourceId, save: true });
  const clash = await runUpload(db, 'Name,Year,Sire\nMHS Seventeen,2013,Cavalier Royale (HOLST)', { sourceId, save: true });
  assert.equal(clash.counts.held, 1);
  assert.match(clash.rows[0].notes.join(' '), /Sire on file is Callahan/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM horse WHERE name = 'Cavalier Royale'").first()).n, 0, 'a held row creates no sire');
  const replaced = await runUpload(db, 'Name,Year,Sire\nMHS Seventeen,2013,Cavalier Royale (HOLST)', { sourceId, save: true, overwrite: true });
  assert.equal(replaced.counts.updated, 1);
  const row = await db.prepare("SELECT s.name FROM horse h JOIN horse s ON s.id = h.sire_id WHERE h.name = 'MHS Seventeen'").first();
  assert.equal(row.name, 'Cavalier Royale');
  const log = await db.prepare("SELECT old_value, new_value FROM upload_change WHERE field = 'sire_id'").all();
  assert.equal(log.results.length, 1, 'the change and the old value are logged');
});

test('a sire or dam first named in a pedigree is filled in later by its own row', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, 'Name,Year,Sire\nCooley Fun Time,2015,Future Trend (OLD)', { sourceId, save: true });
  const later = await runUpload(db, 'Name,Sex,Year,Studbook,UELN\nFuture Trend,stallion,2008,OLD,276333330000108', { sourceId, save: true });
  assert.equal(later.counts.updated, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM horse WHERE name_key = 'future trend'").first()).n, 1);
  assert.equal((await db.prepare("SELECT foaled_year FROM horse WHERE name_key = 'future trend'").first()).foaled_year, 2008);
});

test('ambiguous names wait for a decision; UELN tells two same-name horses apart', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, 'Name,Year,UELN\nCasper,2010,372000000000001\nCasper,2014,372000000000002', { sourceId, save: true });
  const vague = await runUpload(db, 'Name,Colour\nCasper,grey', { sourceId });
  assert.equal(vague.counts.held, 1);
  assert.match(vague.rows[0].notes[0], /2 horses called Casper/);
  const exact = await runUpload(db, 'Name,UELN,Colour\nCasper,372000000000002,grey', { sourceId, save: true });
  assert.equal(exact.counts.updated, 1);
  assert.equal((await db.prepare("SELECT colour FROM horse WHERE ueln = '372000000000002'").first()).colour, 'grey');
  const sire = await runUpload(db, 'Name,Sire\nYoung Casper,Casper', { sourceId });
  assert.equal(sire.counts.held, 1, 'a sire name that fits two horses is not guessed');
  assert.match(sire.rows[0].notes[0], /Casper \(2010\)/);
  const byYear = await runUpload(db, 'Name,Sire\nYoung Casper,Casper (2014)', { sourceId, save: true });
  assert.equal(byYear.counts.new, 1);
  const linked = await db.prepare("SELECT s.ueln FROM horse h JOIN horse s ON s.id = h.sire_id WHERE h.name = 'Young Casper'").first();
  assert.equal(linked.ueln, '372000000000002');
});

test('two mares with one name are told apart by their sire', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, 'Name,Year,Dam,Dam sire\nA One,2015,Kate,Cruising\nB Two,2016,Kate,Clover Hill', { sourceId, save: true });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM horse WHERE name_key = 'kate'").first()).n, 2);
  await runUpload(db, 'Name,Year,Dam,Dam sire\nC Three,2018,Kate,Clover Hill', { sourceId, save: true });
  const dams = await db.prepare(`SELECT h.name, d.id AS dam FROM horse h JOIN horse d ON d.id = h.dam_id WHERE h.name IN ('B Two', 'C Three') ORDER BY h.name`).all();
  assert.equal(dams.results[0].dam, dams.results[1].dam);
});

test('a similar new name is saved separately and listed as a possible duplicate', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, 'Name,Year\nCoolcorran,2010', { sourceId, save: true });
  const r = await runUpload(db, 'Name,Year\nCoolcorron,2011', { sourceId, save: true });
  assert.equal(r.counts.new, 1);
  assert.equal(r.possibleDuplicates, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM horse_match_candidate WHERE status = 'pending'").first()).n, 1);
});

test('sites read stallions and horse pages; hidden sources stay hidden', async () => {
  const db = fresh();
  const sourceId = await iberSource(db);
  await runUpload(db, FILE, { sourceId, save: true });
  const stallions = await listStallions(db, {});
  assert.equal(stallions[0].name, 'Cruising');
  assert.equal(stallions[0].progeny, 2);
  assert.deepEqual((await listStallions(db, { q: 'candy' })).map(x => x.name), ['Candy Boy', 'Sligo Candy Boy']);
  const id = (await db.prepare("SELECT id FROM horse WHERE name = 'Fernhill Cool Confection'").first()).id;
  const h = await getHorse(db, id);
  assert.equal(h.pedigree.s.name, 'Sligo Candy Boy');
  assert.equal(h.pedigree.ds.name, 'Coolcorran Cool Diamond');
  assert.equal(h.pedigree.dsd.name, 'Coolcorran Lady');
  assert.deepEqual(h.aliases, ['Fernhill Cool Connection']);
  assert.equal(h.breeder, 'Fernhill Sport Horses');

  const fei = (await db.prepare("SELECT id FROM source WHERE slug = 'fei'").first()).id;
  const r = await runUpload(db, 'Name,Year,Sire\nHidden Horse,2019,Cruising', { sourceId: fei, save: true });
  assert.ok(r.warnings.some(w => /not marked as allowed to store/.test(w)));
  const hidden = (await db.prepare("SELECT id FROM horse WHERE name = 'Hidden Horse'").first()).id;
  assert.equal(await getHorse(db, hidden), null);
  assert.equal((await listStallions(db, {}))[0].progeny, 3, 'counted, but the horse itself is not listed');
  assert.ok(!(await getHorse(db, stallions[0].id)).progeny.some(p => p.name === 'Hidden Horse'));
});
