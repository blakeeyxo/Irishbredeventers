import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResults, parseEntry, parseEventLine } from '../lib/parser.js';
import { mockupData, horsesToText } from '../scripts/mockup-data.mjs';

const ctx = { country: 'England', event: { name: 'Thoresby', dateText: '3rd – 5th April 2026', startDate: '2026-04-03', season: 2026 }, cls: 'CCI 4* Short Sec G' };

test('reads the example sentence from the brief, without the rider', () => {
  const r = parseEntry(4, 'Master Smart (was Ballinaclough Satisfied) ISH 2013 gelding by Satisfation 1 (HANN) out of Kilpatrick Pip (ISH)[TIH] by Master Imp (TB). Breeder: Edmond Crotty. Tara Dixon (IRL) 38.7, 4, 8.8 = 51.5', ctx);
  assert.deepEqual(r.issues, []);
  assert.equal(r.horse_name, 'Master Smart');
  assert.equal(r.former_name, 'Ballinaclough Satisfied');
  assert.equal(r.breed, 'ISH');
  assert.equal(r.foaled, 2013);
  assert.equal(r.sex, 'Gelding');
  assert.equal(r.sire, 'Satisfation 1 (HANN)');
  assert.equal(r.dam, 'Kilpatrick Pip (ISH)[TIH]');
  assert.equal(r.dam_sire, 'Master Imp (TB)');
  assert.equal(r.breeder, 'Edmond Crotty');
  assert.deepEqual([r.dressage, r.show_jumping, r.cross_country, r.score], ['38.7', '4', '8.8', 51.5]);
  assert.equal(r.verified, true);
  assert.ok(!JSON.stringify(r).includes('Tara'), 'rider must not be kept');
});

test('breeder with county and initials', () => {
  assert.equal(parseEntry(1, 'A ISH 2015 mare by B out of C by D. Breeder: Fiona Hickey (Limerick). Jo Bloggs (GBR) 30, 0, 0 = 30', ctx).breeder, 'Fiona Hickey (Limerick)');
  assert.equal(parseEntry(1, 'A ISH 2015 mare by B out of C by D. Breeder: J. P. Finlay. Jo Bloggs (GBR) 30, 0, 0 = 30', ctx).breeder, 'J. P. Finlay');
});

test('a sire called "Out of Touch" does not confuse the dam', () => {
  const r = parseEntry(2, 'MBF Touch Your Toes ISH 2015 gelding by Out of Touch [ISH] out of Castleview Ennel Lady (TB) by Alphabatim (TB). Breeder: Val Reilly (Meath). X Y (IRL) 30, 0, 0 = 30', ctx);
  assert.equal(r.sire, 'Out of Touch [ISH]');
  assert.equal(r.dam, 'Castleview Ennel Lady (TB)');
  assert.deepEqual(r.issues, []);
});

test('breeder run into the rider is flagged, never guessed', () => {
  const r = parseEntry(3, 'A ISH 2015 mare by B out of C by D. Breeder: Ann Cash Jo Bloggs (GBR) 30, 0, 0 = 30', ctx);
  assert.equal(r.breeder, '');
  assert.equal(r.verified, false);
  assert.ok(!JSON.stringify(r).includes('Bloggs'));
});

test('missing breeding is flagged', () => {
  const r = parseEntry(3, 'Coolfin Comet by Cabaret Star out of Cloneen Queen. Breeder: Paul Byrne.', ctx);
  assert.equal(r.verified, false);
  assert.ok(r.issues.includes('Breed, year or sex not found'));
  assert.ok(r.issues.includes('Score not found'));
  assert.equal(r.sire, 'Cabaret Star');
  assert.equal(r.breeder, 'Paul Byrne');
});

test('typo "Breder" and a comma before Breeder still read', () => {
  assert.equal(parseEntry(1, 'A ISH 2017 gelding by B out of C by Maltstriker (KWPN) Breder: Deirdre Connolly. X (GBR) 25.0, 0, 0.0 = 25', ctx).breeder, 'Deirdre Connolly');
  assert.equal(parseEntry(1, 'A ISH 2017 gelding by B out of C by Master Imp (TB), Breeder: Maria Ranahan. X (GBR) 25.0, 0, 0.0 = 25', ctx).dam_sire, 'Master Imp (TB)');
});

test('event lines and dates', () => {
  assert.deepEqual(parseEventLine('Thoresby International and One Day Event, 3rd – 5th April 2026', 2020),
    { name: 'Thoresby International and One Day Event', dateText: '3rd – 5th April 2026', startDate: '2026-04-03', season: 2026 });
  assert.equal(parseEventLine('Ballindenisk, 30th March – 2nd April 2026', 2020).startDate, '2026-03-30');
  assert.equal(parseEventLine('Tattersalls 4th June', 2010).startDate, '2010-06-04');
  assert.equal(parseEventLine('CCI 4* Short Sec G', 2026), null);
});

test('headings, unverified section and commentary lines', () => {
  const text = `This week another huge entry at Thoresby gave Irish breeding a serious showcase, with more than half of the top ten places going to Irish-breds.
USA
Stable View Spring International, 2nd – 5th April 2026
CCI 3* Short
1st Fernhill Salt Lake (was Haw Minister) ISH 2015 gelding by My O My (HOLST) out of Salt Lake City (ISH)[TIH] by Yeats (ISH)[TIH]. Breeder: James Hickey. Some Rider (USA) 28.2, 0, 0 = 28.2
Unverified
2nd Other Horse ISH 2016 mare by X out of Y by Z. Breeder: Q. R Rider (USA) 30, 0, 0 = 30`;
  const r = parseResults(text, { defaultYear: 2026 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.notes.length, 1);
  assert.equal(r.rows[0].country, 'United States');
  assert.equal(r.rows[0].class_name, 'CCI 3* Short');
  assert.equal(r.rows[0].verified, true);
  assert.equal(r.rows[1].verified, false);
});

test('mockup sample week: nearly every entry reads cleanly and no rider is kept', () => {
  const { horses } = mockupData();
  const r = parseResults(horsesToText(horses), { defaultYear: 2026 });
  assert.equal(r.rows.length, horses.length);
  const clean = r.rows.filter(x => !x.issues.length);
  assert.ok(clean.length >= horses.length - 3, `${clean.length} of ${horses.length} clean`);
  r.rows.forEach((row, i) => {
    assert.ok(!JSON.stringify(row).includes(horses[i].rider), `rider kept for ${row.horse_name}`);
    if (!row.issues.length) {
      assert.equal(row.horse_name, horses[i].name);
      assert.equal(row.sire, horses[i].sire);
      assert.equal(row.score, horses[i].score);
    }
  });
});
