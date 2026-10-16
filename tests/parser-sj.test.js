import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memoryD1 } from './d1-shim.js';
import { parseShowjumping } from '../lib/parser-sj.js';
import { parseResults } from '../lib/parser.js';
import { cleanRows, importResults } from '../lib/import.js';
import { placingColumns, PLACING_JOIN, PUBLIC_SQL, PLACING_ORDER } from '../lib/results.js';
import { ftsQuery } from '../functions/api/search.js';

// Charlie's 2024 showjumping results file, as the owner area reads it out of the Word file (lib/docx.js). The Word
// file itself is kept out of the repository (.gitignore).
const TEXT = readFileSync(new URL('./fixtures/sj-2024.txt', import.meta.url), 'utf8');
const IBSR = { discipline: 'showjumping' };
const read = async () => parseShowjumping(TEXT, { defaultYear: 2026 });

test('the 2024 file: every placing, under the right event and class, with its level and prize money', async () => {
  const r = await read();
  assert.equal(r.weekLabel, 'Week of 21 May 2024');
  assert.deepEqual([r.rows.length, r.events, r.classes, r.notes.length], [18, 5, 16, 0]);
  assert.deepEqual([...new Set(r.rows.map(x => `${x.event_name} (${x.country})`))], ['Lexington International (United States)',
    'Wellington, Heckfield International (Great Britain)', 'Madrid International (Spain)', 'Kronenberg International (Netherlands)', 'Busto Arsizio International (Italy)']);
  assert.ok(r.rows.every(x => x.season === 2024 && x.start_date.startsWith('2024-05-')), 'the year comes from the file title, not this year');
  // The two long "Special Two Phase" classes are classes, not notes, so the horses under them are filed there.
  const comme = r.rows.find(x => x.horse_name === 'Comme Ci Comme Ca' && x.position === 1);
  assert.equal(comme.class_name, 'CSI 2* · € 2,122 Special Two Phase. Table A. First round not against the clock, second round against the clock - points aggregated 1.30m');
  assert.equal(r.rows[0].class_name, 'CSI 3* · € 125,000 US Grand Prix. Table A. One round against the clock, jump off against the clock 1.50m');
  assert.equal(r.rows.find(x => x.horse_name === 'Express Trend').class_name, 'CSIO 3* · € 66,300 Nations Cup 1.45m');
  assert.equal(r.rows.find(x => x.horse_name === 'Moonlight Escape B').class_name, 'CSI 2* · € 1,520 Table A. One round against the clock 1.30m');
});

test('the 2024 file: horse, breeding, breeder, county, owner and rider each in their own place', async () => {
  const r = await read();
  const pick = x => [x.position, x.horse_name, x.breed, x.foaled, x.sex, x.sire, x.sire_breed, x.dam, x.dam_breed, x.dam_sire, x.breeder, x.breeder_county, x.owner, x.rider_name, x.rider_country];
  assert.deepEqual(pick(r.rows[0]), [8, 'Ultimately Cooley', 'ISH', 2014, 'Gelding', 'OBOS Quality 004', 'OLD', 'Tiamo Diamant', 'SF', 'Diamant De Semilly',
    'Patrick J. Kearns', '', 'Orpen Horses Ltd', 'Loic Cannaert', 'BEL']);
  const leestone = r.rows.find(x => x.horse_name === 'Leestone Mylord Trumps');
  assert.deepEqual([leestone.breeder, leestone.breeder_county, leestone.owner], ['John McKibbin', 'Down', 'Al Shira’aa Stables']);
  assert.deepEqual(pick(r.rows.find(x => x.horse_name === 'Fermoyle Prince')).slice(10), ['Henry Gardiner', 'Sligo', "Brian O'Malley", 'Alicia Page', 'GBR']);
  const comme = r.rows.find(x => x.horse_name === 'Comme Ci Comme Ca');
  assert.deepEqual([comme.former_name, comme.sire, comme.dam], ['TSC Comme Ci Comme Ca', 'Comme Il Faut', 'Evenda'], '"(SF)out of" with no space');
  const express = r.rows.find(x => x.horse_name === 'Express Trend');
  assert.deepEqual([express.breeder, express.owner], ['Liam Nicholas', 'Liam Nicholas'], '"Breeder and owner: …"');
  const abc = r.rows.find(x => x.horse_name === 'ABC Caruso');
  assert.deepEqual([abc.dam, abc.dam_tih, abc.dam_sire, abc.dam_sire_tih], ['Ardnehue Diamond Cruiser', true, 'Cruising', true]);
  assert.ok(r.rows.every(x => !x.breeder.includes('Owner')), 'the owner never runs into the breeder');
  assert.ok(r.rows.every(x => x.score === null && x.dressage === ''), 'placings only: no scores');
  assert.ok(r.rows.every(x => !x.warnings.includes('No scores given')));
});

test('the 2024 file: lines the parser is not sure of are flagged, not guessed', async () => {
  const r = await read();
  const flagged = r.rows.filter(x => x.issues.length);
  assert.deepEqual(flagged.map(x => [x.horse_name, x.position]), [['Leestone Mylord Trumps', 1], ['ABC Caruso', 5], ['Express Trend', 3], ['ESI Toulouse', 1], ['Curraghgraigue OBOS Flight', 1]]);
  assert.match(flagged[0].issues[0], /Two placings given \("1st 2nd"\): 1 used, check which is right/);
  assert.ok(flagged.slice(1).every(x => /Year "20240" in the event heading is not a year/.test(x.issues[0])), 'every placing under "May 20240"');
  assert.ok(flagged.every(x => !x.verified), 'kept off the site until checked');
  const lex = r.rows.filter(x => x.event_name === 'Lexington International');
  assert.ok(lex.every(x => x.warnings.includes('No year in the event heading; 2024 taken from the file title') && x.verified), 'a note, not a doubt');
  assert.equal(r.rows.filter(x => x.verified).length, 13);
});

test('a line inside an event that is neither a class nor a horse is used as the class, but flagged', () => {
  const r = parseShowjumping(`1.6.24 International Showjumping Results
Dublin Horse Show (IRL) 5th – 9th August 2024
CSIO 5*
Aga Khan Trophy
1st Some Horse (ISH) – 2015 gelding by A (ISH) out of B (ISH) by C (TB). Breeder: D. Owner: E. Rider: F (IRL).`);
  assert.equal(r.rows[0].class_name, 'CSIO 5* · Aga Khan Trophy');
  assert.match(r.rows[0].issues.join(' '), /Class heading not recognised \("Aga Khan Trophy"\)/);
});

test('the eventing parser is untouched by the showjumping one', async () => {
  const r = parseResults(TEXT);
  assert.ok(r.rows.some(x => x.warnings.includes('No scores given')), 'IBER still warns about missing scores');
  assert.equal(r.rows[0].owner, undefined);
});

test('IBSR: the 2024 file saves with owners, shows OIO, and search never matches a rider or owner', async () => {
  const db = memoryD1(new URL('../migrations-ibsr/', import.meta.url));
  const r = await read();
  // As the owner area sends it: rows as parsed, plus one horse with no breeding.
  const rows = [...r.rows, { ...r.rows[0], horse_name: 'Mystery Horse', sire: '', dam: '', dam_sire: '', sire_breed: '', dam_breed: '', dam_sire_breed: '', position: 9, issues: [], warnings: [], verified: true, owner: 'Someone Else' }];
  const out = await importResults(db, cleanRows(rows, 2024), { weekLabel: r.weekLabel, withOwner: true });
  assert.equal(out.results, 19);
  const shown = (await db.prepare(`SELECT ${placingColumns(IBSR)} ${PLACING_JOIN} WHERE e.season = 2024 AND ${PUBLIC_SQL} ${PLACING_ORDER}`).all()).results;
  assert.equal(shown.length, 14, 'the 5 flagged placings wait in Unverified');
  const ult = shown.find(x => x.horse_name === 'Ultimately Cooley' && x.position === 8);
  assert.deepEqual([ult.owner_name, ult.rider_name, ult.breeder, ult.oio], ['Orpen Horses Ltd', 'Loic Cannaert', 'Patrick J. Kearns', 0]);
  assert.equal(shown.find(x => x.horse_name === 'Mystery Horse').oio, 1, 'no breeding listed: OIO');
  const search = async q => (await db.prepare(`SELECT p.horse_name FROM placings_fts f JOIN placings p ON p.id = f.rowid WHERE placings_fts MATCH ?`).bind(ftsQuery(q, 'all')).all()).results.map(x => x.horse_name);
  assert.ok((await search('Diamant De Semilly')).includes('Ultimately Cooley'), 'dam sire is searchable');
  assert.ok((await search('Kearns')).includes('Ultimately Cooley'), 'breeder is searchable');
  assert.ok((await search('TSC Comme')).includes('Comme Ci Comme Ca'), 'former name is searchable');
  assert.deepEqual(await search('Cannaert'), [], 'rider is not searchable');
  assert.deepEqual(await search('Orpen'), [], 'owner is not searchable');
  // Saving the same file again adds nothing.
  assert.equal((await importResults(db, cleanRows(rows, 2024), { weekLabel: r.weekLabel, withOwner: true })).results, 0);
});

test("IBER's results reads never ask for an owner column (its database has none)", () => {
  assert.doesNotMatch(placingColumns({ discipline: 'eventing' }), /owner_name/);
  assert.match(placingColumns(IBSR), /owner_name/);
});
