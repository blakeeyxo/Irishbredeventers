import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planImport } from '../lib/import-plan.js';
import { parseResults } from '../lib/parser.js';

const week = `Tweseldown Horse Trials (GBR) 14th – 15th March 2026
Novice Sec A
1st Westwick Rebel [ISH] - 2014 gelding by Flex A Bill (ISH)[TIH] out of Rebels Dream [ISH] by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: Madeline Hartsock (USA) 29.8, 0, 4.0 = 33.8
2nd Ballinure Star (ISH) - 2013 gelding by Flex-a-Bill (ISH)[TIH] out of Star of Ballinure (ISH) by Cruising (ISH)[TIH]. Breeder: Kieran Doyle (Wexford). Rider: Emily Hartley (GBR) 27.9, 0, 3.2 = 31.1
3rd Orchard Tune (ISH) - 2015 mare by Je T'Aime Flamenco (BWP) out of Orchard Song (ISH) by Cruising (ISH). Breeder: Ann Walsh. Rider: X (GBR) 30, 0, 0 = 30
4th Orchard Beat (ISH) - 2016 gelding by Je T'Aime Flaminco (BWP) out of Orchard Song (ISH) by Cruising (ISH). Breeder: Ann Walsh. Rider: Y (GBR) 31, 0, 0 = 31`;
const rows = parseResults(week).rows;

test('Flex A Bill and Flex-a-Bill are one sire; nothing exists yet so all is new', () => {
  const plan = planImport(rows, {});
  assert.equal(plan.sires.get('flex a bill').name, 'Flex A Bill');
  assert.ok(!plan.sires.has('flex-a-bill'));
  assert.equal(plan.newCounts.horses, 4);
  // Flex A Bill, Rich Rebel, Cruising, Je T'Aime Flamenco and (pending) Flaminco
  assert.equal(plan.newCounts.sires, 5);
  assert.equal(plan.newCounts.dams, 3);
  assert.equal(plan.newCounts.breeders, 3);
});

test('a typo in the same paste is asked about, and "same" links it to the first spelling', () => {
  const plan = planImport(rows, {});
  assert.equal(plan.pending.length, 1);
  const q = plan.pending[0];
  assert.equal(q.key, 'sire:je taime flaminco');
  assert.equal(q.candidates[0].id, 'paste:je taime flamenco');
  const answered = planImport(rows, {}, { [q.key]: q.candidates[0].id });
  assert.equal(answered.pending.length, 0);
  assert.equal(answered.sires.get('je taime flaminco').sameAs, 'je taime flamenco');
  assert.equal(answered.newCounts.sires, 4);
  const different = planImport(rows, {}, { [q.key]: 'new' });
  assert.equal(different.newCounts.sires, 5);
});

const existing = {
  sires: [{ id: 7, name: 'Flex-a-Bill', name_normalised: 'flex a bill', horses: 3 }, { id: 8, name: 'Rich Rebel', name_normalised: 'rich rebel' },
    { id: 9, name: 'Cruising', name_normalised: 'cruising' }, { id: 10, name: "Je T'Aime Flamenco", name_normalised: 'je taime flamenco' }],
  dams: [{ id: 20, name: 'Rebels Dream', name_normalised: 'rebels dream', sire_name: 'Rich Rebel', sire_normalised: 'rich rebel' }],
  breeders: [{ id: 30, name: 'John Brady', name_normalised: 'john brady', county: 'Wicklow' }, { id: 31, name: 'Ann Walsh', name_normalised: 'ann walsh', county: 'Cork' }],
  horses: [{ id: 40, name: 'Westwick Rebel', name_normalised: 'westwick rebel', birth_year: 2014, sire_normalised: 'flex a bill', dam_normalised: 'rebels dream', damsire_normalised: 'rich rebel', sire_name: 'Flex-a-Bill', dam_name: 'Rebels Dream' }]
};

test('existing records match exactly, whatever the punctuation', () => {
  const plan = planImport(rows, existing, { 'sire:je taime flaminco': 10 });
  assert.equal(plan.sires.get('flex a bill').id, 7);
  assert.equal(plan.dams.get('rebels dream|rich rebel').id, 20);
  assert.equal(plan.horses.get('westwick rebel|2014|flex a bill|rebels dream|rich rebel').id, 40);
  assert.equal(plan.breeders.get('john brady|wicklow').id, 30);
  assert.equal(plan.sires.get('je taime flaminco').id, 10);
});

test('same breeder name with a different county is a question, not a guess', () => {
  const plan = planImport(rows, existing, { 'sire:je taime flaminco': 10 });
  const q = plan.pending.find(p => p.kind === 'breeder');
  assert.equal(q.name, 'Ann Walsh');
  assert.equal(q.candidates[0].detail, '(Cork)');
});

test('same horse name and year with a different sire is a question', () => {
  const other = parseResults(`Tweseldown Horse Trials (GBR) 14th – 15th March 2026
Novice Sec A
1st Westwick Rebel [ISH] - 2014 gelding by Kannan (KWPN) out of Rebels Dream [ISH] by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: M (USA) 29.8, 0, 4.0 = 33.8`).rows;
  const plan = planImport(other, existing);
  const q = plan.pending.find(p => p.kind === 'horse');
  assert.equal(q.candidates[0].id, 40);
  assert.match(q.candidates[0].detail, /Flex-a-Bill/);
  const kept = planImport(other, existing, { [q.key]: 'new' });
  assert.equal(kept.newCounts.horses, 1);
});

test('a mare is found under her sire\'s confirmed spelling', () => {
  const rows = parseResults(`Rocking Horse Winter Horse trials (USA) 14th – 16th February 2025
Open Modified A
4th Rock Island (ISH)[TIH] – 2017 gelding by Island Commander (TB) out of Coolcorren Gypsey (ISH)[TIH] by Coolcorran Cool Diamond (ISH). Breeder: Michael Byrne. Rider: Robin Walker (USA) 27.6, 0, 2.0 = 29.6`).rows;
  const existing = {
    sires: [{ id: 1, name: 'Coolcorron Cool Diamond', name_normalised: 'coolcorron cool diamond' }, { id: 2, name: 'Island Commander', name_normalised: 'island commander' }],
    dams: [{ id: 5, name: 'Coolcorren Gypsey', name_normalised: 'coolcorren gypsey', sire_name: 'Coolcorron Cool Diamond', sire_normalised: 'coolcorron cool diamond' }],
    breeders: [{ id: 7, name: 'Michael Byrne', name_normalised: 'michael byrne', county: '' }],
    horses: [{ id: 9, name: 'Rock Island', name_normalised: 'rock island', birth_year: 2017, sire_normalised: 'island commander', dam_normalised: 'coolcorren gypsey', damsire_normalised: 'coolcorron cool diamond' }],
    matches: [{ kind: 'sire', match_key: 'coolcorran cool diamond', target_id: 1 }]
  };
  const plan = planImport(rows, existing);
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.dams.get('coolcorren gypsey|coolcorran cool diamond').id, 5);
  assert.equal([...plan.horses.values()][0].id, 9);
});
