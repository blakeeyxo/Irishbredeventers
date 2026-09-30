import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResults, parseEntry, parseEventLine, parseTitle } from '../lib/parser.js';
import { normaliseName, isNearName, splitTagged, splitBreeder, displayName } from '../lib/names.js';
import { mockupData, horsesToText } from '../scripts/mockup-data.mjs';

const ev = { name: 'Rocking Horse December Horse Trials', country: 'United States', dateText: '6th - 7th December 2025', startDate: '2025-12-06', endDate: '2025-12-07', season: 2025 };
const ctx = { country: '', event: ev, cls: 'Open Intermediate', defaultYear: 2025 };
const entry = line => { const m = line.match(/^(\d+)\S*\s+(.+)$/); return parseEntry(Number(m[1]), m[2], ctx); };

test("the brief's example line reads fully", () => {
  const r = entry('1st Westwick Rebel [ISH] - 2014 gelding by Flex A Bill (ISH)[TIH] out of Rebels Dream [ISH] by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: Madeline Hartsock (USA) 39.8, 0, 4.0 = 43.8.');
  assert.deepEqual(r.issues, []);
  assert.equal(r.position, 1);
  assert.equal(r.horse_name, 'Westwick Rebel');
  assert.equal(r.breed, 'ISH');
  assert.equal(r.tih_flag, false);
  assert.equal(r.foaled, 2014);
  assert.equal(r.sex, 'Gelding');
  assert.deepEqual([r.sire, r.sire_breed, r.sire_tih], ['Flex A Bill', 'ISH', true]);
  assert.deepEqual([r.dam, r.dam_breed, r.dam_tih], ['Rebels Dream', 'ISH', false]);
  assert.deepEqual([r.dam_sire, r.dam_sire_breed], ['Rich Rebel', 'TB']);
  assert.deepEqual([r.breeder, r.breeder_county], ['John Brady', 'Wicklow']);
  assert.deepEqual([r.rider_name, r.rider_country], ['Madeline Hartsock', 'USA']);
  assert.deepEqual([r.dressage, r.show_jumping, r.cross_country, r.score], ['39.8', '0', '4.0', 43.8]);
  assert.equal(r.verified, true);
});

test('(ISH) and [ISH] both give the breed code', () => {
  assert.equal(entry('2nd A Horse (ISH) - 2015 mare by B (KWPN) out of C (ISH) by D (TB). Breeder: E. Rider: F (IRL) 30, 0, 0 = 30').breed, 'ISH');
  assert.equal(entry('2nd A Horse [ISH] - 2015 mare by B (KWPN) out of C (ISH) by D (TB). Breeder: E. Rider: F (IRL) 30, 0, 0 = 30').breed, 'ISH');
});

test('[TIH] flags on the horse, sire, dam and dam sire', () => {
  const r = entry('8th Loughtown Cici ZA (ISH)[TIH] - 2016 mare by Dermish Cruise (ISH)[TIH] out of Castlelawn Diamond Clover (ISH)[TIH] by White Clover (ISH)[TIH]. Breeder: Gabriel Slattery. Rider: Charlotte Collier (USA) 34.3, 0, 0.0 = 34.3');
  assert.deepEqual([r.tih_flag, r.sire_tih, r.dam_tih, r.dam_sire_tih], [true, true, true, true]);
  assert.equal(r.horse_name, 'Loughtown Cici ZA');
});

test('[was Old Name] becomes the former name, including two former names', () => {
  const r = entry('4th Master Smart (ISH)[was Ballinaclough Satisfied] - 2013 gelding by Satisfation 1 (HANN) out of Kilpatrick Pip (ISH)[TIH] by Master Imp (TB). Breeder: Edmond Crotty. Rider: Tara Dixon (IRL) 38.7, 4, 8.8 = 51.5');
  assert.equal(r.horse_name, 'Master Smart');
  assert.equal(r.former_name, 'Ballinaclough Satisfied');
  const two = entry('8th Brookfield William (ISH)[was William Brookfield & Rossa Sixteen] - 2016 gelding by Mermus R (KWPN) out of Femme Fatale M25 (ISH) by Limmerick (HOLST). Breeder: Eamonn Hogan (Galway). Rider: Tom Jackson (GBR) 36.3, 0.8, 21.2 = 58.3');
  assert.equal(two.former_name, 'William Brookfield & Rossa Sixteen');
});

test('missing breeder, missing county and missing scores are warnings, not guesses', () => {
  const noBreeder = entry('3rd A Horse (ISH) - 2015 mare by B (KWPN) out of C (ISH) by D (TB). Rider: F (IRL) 30, 0, 0 = 30');
  assert.equal(noBreeder.breeder, '');
  assert.ok(noBreeder.warnings.includes('No breeder given'));
  assert.equal(noBreeder.verified, true);
  const noCounty = entry('3rd A Horse (ISH) - 2015 mare by B (KWPN) out of C (ISH) by D (TB). Breeder: Mathew Rogers. Rider: F (IRL) 30, 0, 0 = 30');
  assert.deepEqual([noCounty.breeder, noCounty.breeder_county], ['Mathew Rogers', '']);
  const noScores = entry('3rd A Horse (ISH) - 2015 mare by B (KWPN) out of C (ISH) by D (TB). Breeder: E. Rider: F (IRL)');
  assert.equal(noScores.score, null);
  assert.ok(noScores.warnings.includes('No scores given'));
  assert.equal(noScores.rider_name, 'F');
});

test('breeder in brackets that is not a county stays in the name', () => {
  assert.deepEqual(splitBreeder('Kadrah House Stud Ltd'), { name: 'Kadrah House Stud Ltd', county: '' });
  assert.deepEqual(splitBreeder('Fiona Hickey (Limerick)'), { name: 'Fiona Hickey', county: 'Limerick' });
  assert.deepEqual(splitBreeder('Pat Byrne (Co. Cork)'), { name: 'Pat Byrne', county: 'Cork' });
  assert.deepEqual(splitBreeder('John Smith (Yorkshire)'), { name: 'John Smith (Yorkshire)', county: '' });
});

test('sire unknown, no space before "out of", and a sire called "Out of Touch"', () => {
  const unknown = entry('7th Lady Ophelia (unk) - 2012 mare sire unknown out of Legal Lady (TB) by Over the River (TB). Breeder: Denis Hickey (Wexford). Rider: Padraig McCarthy (IRL) 41.6, 0, 16.4 = 58.0');
  assert.equal(unknown.sire, '');
  assert.equal(unknown.breed, 'unk');
  assert.equal(unknown.dam, 'Legal Lady');
  assert.equal(unknown.verified, true);
  const tight = entry('6th Ballyneety Silver Service (ISH)[TIH] - 2015 gelding by Butlers Cravat (ISH)[TIH]out of Great Island Lady (TB)[IRL] by Great Palm (TB). Breeder: Fiona Hickey (Limerick). Rider: Holly Richardson (GBR) 35.0, 17.2, 4.4 = 56.6');
  assert.deepEqual([tight.sire, tight.dam, tight.dam_breed, tight.dam_sire], ['Butlers Cravat', 'Great Island Lady', 'TB', 'Great Palm']);
  const touch = entry('3rd MBF Touch Your Toes [ISH] - 2015 gelding by Out of Touch [ISH] out of Castleview Ennel Lady (TB) by Alphabatim (TB). Breeder: Val Reilly (Meath). Rider: Dani Stewart-Richardson (GBR) 28.7, 0, 2.0 = 30.7');
  assert.deepEqual([touch.sire, touch.dam], ['Out of Touch', 'Castleview Ennel Lady']);
  assert.deepEqual(touch.issues, []);
});

test('"Breeder: X, Rider:" with a comma, and a malformed "[ISH)" tag', () => {
  const r = entry('3rd Shades of Sligo II (ISH) - 2017 gelding by Sligo Candy Boy (ISH) out of Bouncing Molly (ISH) by Grange Bouncer (ID). Breeder: Martin Kenirons, Rider: Max Gordon (GBR) 31.5, 0, 1.2 = 32.7');
  assert.deepEqual([r.breeder, r.rider_name], ['Martin Kenirons', 'Max Gordon']);
  assert.deepEqual(splitTagged('Beach Ball [ISH)'), { name: 'Beach Ball', breed_code: 'ISH', tih: false, former: '', notes: [] });
});

test('lines it cannot read are flagged, never guessed', () => {
  const noBreeding = entry('9th Ross Joey (unk) - 2014 gelding OIO. Rider: Georgia Reece (GBR) 37.3, 0, 10.8 = 48.1');
  assert.equal(noBreeding.verified, false);
  assert.ok(noBreeding.issues.includes('Breeding not found'));
  const twice = entry('2nd MBF Vital Finesse (ISH) - 2018 gelding by Ringwood Cassero (HOLST) out of Paddys Pride (TB)[IRL] out of Indian River (TB). Breeder: A. Rider: B (GBR) 29.5, 0, 0.0 = 29.5');
  assert.ok(twice.issues.includes('"out of" appears twice'));
  assert.equal(twice.verified, false);
});

test('scores that do not add up get a warning', () => {
  const r = entry('4th Kilcannon Max (ISH) - 2011 gelding by Lux Z (HANN) out of Bridies Flight (ISH) by Errigal Flight (ISH)[TIH]. Breeder: Dermot Ryan (Tipperary). Rider: Todd Wulf (USA) 39.3, 4, 11.4 = 65.7');
  assert.ok(r.warnings.some(w => w.startsWith('Scores add up to 54.7')));
});

test('2010 archive style', () => {
  const r = parseEntry(1, "Watervalley Lockey Guy ('04 g Loughehoe Guy (ISH) - Cornamagh (ISH) (Diamond Lad (RID)). Bd Sean Thomas Lydon. Rd Virginia Wells) 34.0, 0, 0.4 = 34.4", ctx);
  assert.deepEqual(r.issues, []);
  assert.deepEqual([r.horse_name, r.foaled, r.sex], ['Watervalley Lockey Guy', 2004, 'Gelding']);
  assert.deepEqual([r.sire, r.sire_breed, r.dam, r.dam_breed, r.dam_sire, r.dam_sire_breed], ['Loughehoe Guy', 'ISH', 'Cornamagh', 'ISH', 'Diamond Lad', 'RID']);
  assert.deepEqual([r.breeder, r.rider_name, r.score], ['Sean Thomas Lydon', 'Virginia Wells', 34.4]);
  const old = parseEntry(8, 'Sky Crest (93 g Sky Boy (TB) - Lotteria (AID) (Sea Crest (RID)). Bd Joseph & Matthew Duff. Rd Sally Billing) 30.0, 8, 4.0 = 42.0', ctx);
  assert.equal(old.foaled, 1993);
  const tight = parseEntry(5, "Bonnabee ('02m Benny the Dip (TB) - Samhat Mtoto (TB) (Mtoto (TB)). Bd C. Lilburn.Rd Sarah Williamson) 37.5, 4, 1.6 = 43.1.", ctx);
  assert.deepEqual([tight.sex, tight.breeder, tight.rider_name], ['Mare', 'C. Lilburn', 'Sarah Williamson']);
  const missingBracket = parseEntry(4, "Gogo Gadget ('00 g Coronea Eagle (ISH) - Dawn Cherry (ISH) (Oakley Dawn RID)). Bd Valerie Patterson. Rd Lucienne Elms) 33.0, 0, 1.2 = 34.2.", ctx);
  assert.deepEqual([missingBracket.dam, missingBracket.dam_sire, missingBracket.dam_sire_breed], ['Dawn Cherry', 'Oakley Dawn', 'RID']);
  const sireOnly = parseEntry(5, "The Cult ('03 g Cult Hero. Rd Tanya Kyle) 30.5, 0, 5.6 = 36.1", ctx);
  assert.equal(sireOnly.sire, 'Cult Hero');
  assert.ok(sireOnly.issues.includes('Dam not found'));
});

test('event lines: country codes, missing bracket, missing year, month ranges', () => {
  assert.deepEqual(parseEventLine('Rocking Horse December Horse Trials (USA) 6th - 7th December 2025', 2020),
    { name: 'Rocking Horse December Horse Trials', country: 'United States', dateText: '6th - 7th December 2025', startDate: '2025-12-06', endDate: '2025-12-07', season: 2025 });
  const open = parseEventLine('Thoresby International and One Day Event (GBR 3rd – 5th April 2026', 2020);
  assert.deepEqual([open.name, open.country, open.startDate], ['Thoresby International and One Day Event', 'Great Britain', '2026-04-03']);
  assert.equal(parseEventLine('Rocking Horse Spring Horse Trials (USA)4th – 5th April 2026', 2020).name, 'Rocking Horse Spring Horse Trials');
  const noYear = parseEventLine('Carlton One Day Event, North Bedfordshire. 31 July – 1 August.', 2010);
  assert.deepEqual([noYear.startDate, noYear.endDate], ['2010-07-31', '2010-08-01']);
  assert.equal(parseEventLine('CCI 4* Short Sec G', 2026), null);
  assert.deepEqual(parseTitle('6.4.26 International Eventing Results.'), { label: 'Week of 6 April 2026', year: 2026 });
});

test('whole file: headings, notes and the week label', () => {
  const text = `6.4.26 International Eventing Results.
Another huge entry at Thoresby gives Irish breeding a serious showcase.
Rocking Horse December Horse Trials (USA) 6th - 7th December 2025
Open Intermediate
1st Westwick Rebel [ISH] - 2014 gelding by Flex A Bill (ISH)[TIH] out of Rebels Dream [ISH] by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: Madeline Hartsock (USA) 39.8, 0, 4.0 = 43.8.
Only 3 finished.
England.
Carlton One Day Event, North Bedfordshire. 31 July – 1 August.
Novice Sec A.
2 Riocca ('03 m My O My (HOLST) - Shes Wonderful (ISH) (Diamond Lad (RID)). Bd Patrick Fenlon. Rd Piggy French) 31.5, 0, 1.2 = 32.7
These results have been provided by Charlie Ripman.`;
  const r = parseResults(text);
  assert.equal(r.weekLabel, 'Week of 6 April 2026');
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows.map(x => [x.country, x.class_name]), [['United States', 'Open Intermediate'], ['England', 'Novice Sec A']]);
  assert.equal(r.rows[1].start_date, '2026-07-31');
  assert.equal(r.notes.length, 3);
});

test('name normalising and near matches', () => {
  assert.equal(normaliseName('Flex-a-Bill'), normaliseName('Flex A Bill'));
  assert.equal(normaliseName("  Je T'Aime   Flamenco. "), 'je taime flamenco');
  assert.equal(normaliseName('Créevagh'), 'creevagh');
  assert.ok(isNearName(normaliseName('Satisfation'), normaliseName('Satisfaction')));
  assert.ok(isNearName(normaliseName("Je T'Aime Flaminco"), normaliseName("Je T'Aime Flamenco")));
  assert.ok(isNearName('flexabill', 'flex a bill'));
  assert.ok(!isNearName(normaliseName('Luidam'), normaliseName('Lucam')));
  assert.ok(!isNearName(normaliseName('Kannan'), normaliseName('Cannon')));
  assert.equal(displayName('Kilpatrick Pip', 'ISH', true), 'Kilpatrick Pip (ISH)[TIH]');
});

test('mockup sample week (older style) still reads, rider kept only in its own field', () => {
  const { horses } = mockupData();
  const r = parseResults(horsesToText(horses), { defaultYear: 2026 });
  assert.equal(r.rows.length, horses.length);
  const clean = r.rows.filter(x => !x.issues.length);
  assert.ok(clean.length >= horses.length - 4, `${clean.length} of ${horses.length} clean`);
  const unbracket = s => s.replace(/\[IRL\]/g, '').replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  r.rows.forEach((row, i) => {
    const { rider_name, rider_country, raw, ...rest } = row;
    assert.ok(!JSON.stringify(rest).includes(horses[i].rider), `rider leaked into another field for ${row.horse_name}`);
    if (!row.issues.length) {
      assert.equal(row.horse_name, horses[i].name);
      if (!/unknown/i.test(horses[i].sire)) assert.equal(unbracket(displayName(row.sire, row.sire_breed, row.sire_tih)), unbracket(horses[i].sire));
      assert.equal(row.score, horses[i].score);
      assert.equal(rider_name, horses[i].rider);
    }
  });
});
