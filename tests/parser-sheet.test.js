import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { xlsxToTable, delimitedToTable, tableToText } from '../lib/xlsx.js';
import { parseSheet } from '../lib/parser-sheet.js';

const template = () => xlsxToTable(readFileSync(new URL('./fixtures/iber-weekly-template.xlsx', import.meta.url)));

test('the weekly template (.xlsx): the Results sheet, every result placed, scores from their columns', async () => {
  const t = await template();
  assert.equal(t.sheet, 'Results');
  const r = parseSheet(t.rows, { defaultYear: 2026 });
  assert.equal(r.rows.length, 71);
  assert.equal(r.events, 5);
  assert.deepEqual(r.rows.filter(x => !x.verified).map(x => [x.horse_name, x.issues]), []);
  const sunny = r.rows[0];
  assert.deepEqual([sunny.position, sunny.horse_name, sunny.former_name, sunny.sire, sunny.dam, sunny.dam_sire, sunny.rider_name, sunny.rider_country],
    [7, 'Sunny For Game', 'Sunny Camillo & Call Again Cooley', 'Camillo VDL', 'Sunny Suspect', 'Sunshine Street', 'Camille Guyot', 'SUI']);
  assert.deepEqual([sunny.event_name, sunny.start_date, sunny.end_date, sunny.class_name], ['Pratoni del Vivaro International', '2026-10-22', '2026-10-25', 'CCI 4* Long']);
  assert.deepEqual([sunny.dressage, sunny.cross_country, sunny.show_jumping, sunny.score], ['32.8', '12.4', '55.2', 100.4]);
  assert.ok(!sunny.warnings.includes('No scores given'));
  assert.ok(r.notes.some(n => /Galway Downs · Open Modified B: Only 2 finished/.test(n)));
});

test('template: no country column → the riders\' country, noted in the check table only', async () => {
  const r = parseSheet((await template()).rows, { defaultYear: 2026 });
  const sunny = r.rows[0];
  assert.equal(sunny.country, 'Italy');
  assert.ok(sunny.warnings.some(w => w.startsWith('Event country taken as Italy')));
  assert.deepEqual(sunny.guesses, []);
  // An earlier upload's country for the same event wins, with no note.
  const known = parseSheet((await template()).rows, { defaultYear: 2026, knownCountries: { 'pratoni del vivaro international': 'Italy' } }).rows[0];
  assert.ok(!known.warnings.some(w => w.startsWith('Event country')));
});

test('template: an event with no dates takes the latest dates in the file, with a visible note', async () => {
  const r = parseSheet((await template()).rows, { defaultYear: 2026 });
  const galway = r.rows.find(x => x.event_name === 'The Eventing Championships At Galway Downs');
  assert.equal(galway.start_date, '2026-10-29');
  assert.ok(galway.guesses.includes('No event dates given; taken as 29th October – 1st November 2026'));
});

test('template: unk breeding is UNK (blank), OIO lines placed', async () => {
  const r = parseSheet((await template()).rows, { defaultYear: 2026 });
  const dolly = r.rows.find(x => x.horse_name === 'Knightbridge Dolly');
  assert.deepEqual([dolly.sire, dolly.dam, dolly.dam_sire, dolly.verified], ['Ross Fear Bui', '', '', true]);
  assert.equal(r.rows.find(x => x.horse_name === 'Ballinagore Hero').verified, true);
});

test('pasted rows (tab-separated) read the same as the file; a Country column and odd cells', () => {
  const rows = [
    ['Event', 'Event dates', 'Class', 'Place', 'Horse line', 'Dressage', 'XC', 'SJ', 'Total', 'Country'],
    ['Thoresby International', '3rd – 5th April 2026', 'CCI 4* Short', '2nd', 'Cooley Test (ISH) - 2015 gelding by Cruising (ISH) out of Kates Girl (ISH) by unk. Breeder: A Breeder. Rider: Tom Test (GBR)', '30', '0', '4', '35', 'GBR'],
    ['Thoresby International', '3rd – 5th April 2026', 'CCI 4* Short', 'X', 'Cooley Two (ISH) - 2016 mare by Cruising (ISH) out of Kates Girl (ISH). Rider: Tom Test (GBR)', '31', '0', '0', '', 'GBR']
  ];
  const r = parseSheet(delimitedToTable(tableToText(rows)), { defaultYear: 2026 });
  assert.deepEqual([r.rows[0].country, r.rows[0].position, r.rows[0].score], ['Great Britain', 2, 35]);
  assert.ok(r.rows[0].warnings.includes('Scores add up to 34, not 35'));
  assert.deepEqual([r.rows[1].score, r.rows[1].verified], [31, false]);
  assert.ok(r.rows[1].warnings.includes('No total given; worked out as 31'));
  assert.ok(r.rows[1].issues.includes('Place "X" is not a number'));
});

test('IBSR: a showjumping sheet (no scores, an Owner column)', () => {
  const rows = [
    ['Event', 'Event dates', 'Class', 'Place', 'Horse line', 'Owner'],
    ['Mill Spring International (USA)', '14th – 18th October 2026', 'CSI 5* · $31,100 Table A 1.50m', '7', 'Rockwell RC (ISH) – 2014 mare by Kannan (KWPN) out of Urban Sea (ISH) by Guidam (SF). Breeder: Ronan Byrne, Co. Kilkenny. Rider: Marlon Modolo Zanotelli (BRA)', 'Test Stables']
  ];
  const [row] = parseSheet(rows, { discipline: 'showjumping', defaultYear: 2026 }).rows;
  assert.deepEqual([row.horse_name, row.country, row.owner, row.breeder, row.breeder_county, row.verified],
    ['Rockwell RC', 'United States', 'Test Stables', 'Ronan Byrne', 'Kilkenny', true]);
});

test('a sheet with no Horse heading reads nothing and says why', () => {
  const r = parseSheet([['a', 'b'], ['c', 'd']]);
  assert.equal(r.rows.length, 0);
  assert.match(r.notes[0], /No "Horse line" heading/);
});

test('IBSR sheet with CSI Spec and Class Detail columns: the level goes in front of the class; "Riser:" is the rider', async () => {
  const t = await xlsxToTable(readFileSync(new URL('./fixtures/sj-2026-11-sheet.xlsx', import.meta.url)));
  const r = parseSheet(t.rows, { discipline: 'showjumping', defaultYear: 2026 });
  assert.equal(r.rows.length, 24);
  assert.deepEqual(r.rows.filter(x => !x.verified).map(x => [x.horse_name, x.issues]), []);
  assert.ok(r.rows.every(x => /^CSI\S* [^·]+ · /.test(x.class_name)), 'every class starts with its CSI level');
  const cosmo = r.rows.find(x => x.horse_name === 'MHS Cosmo');
  assert.equal(cosmo.class_name, 'CSI 3* · € 56,900 GP Table A. One round against the clock with jump-off against the clock. 1.50m');
  assert.deepEqual([cosmo.event_name, cosmo.country, cosmo.start_date], ['Valencia International', 'Spain', '2026-11-09']);
  assert.equal(r.rows.find(x => x.horse_name === 'HK Valhalla').rider_name, 'Seamus Hugher-Kennedy');
  assert.equal(r.rows.find(x => x.horse_name === 'Cruising with Alice').owner, 'Laurence Masterson');
  // A level with no class detail is the class on its own.
  const [only] = parseSheet([['Event', 'Event dates', 'CSI Spec', 'Class Detail', 'Place', 'Horse line'],
    ['Lier International (BEL)', '11th - 15th November 2026', 'CSI 2*', '', '4', 'Rossmount Luis (ISH) - 2017 gelding by Luidam (KWPN) out of Greenacres Clover (ISH). Breeder: M. Rider: E (IRL)']],
  { discipline: 'showjumping', defaultYear: 2026 }).rows;
  assert.equal(only.class_name, 'CSI 2*');
});
