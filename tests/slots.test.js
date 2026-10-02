import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACEMENTS, isPlacement, placementTier, placementName } from '../lib/slots.js';
import { sireKeys, summary } from '../lib/stallions.js';

test('every page has a top banner and six side boxes', () => {
  assert.equal(PLACEMENTS.length, 35);
  for (const page of ['home', 'results', 'news', 'stallions', 'about']) {
    for (const pos of ['top', 'left1', 'left2', 'left3', 'right1', 'right2', 'right3']) assert.ok(isPlacement(`${page}:${pos}`));
  }
  assert.ok(!isPlacement('home:left4'));
  assert.ok(!isPlacement('horse:top'));
});

test('slot names and tiers', () => {
  assert.equal(placementName('home:top'), 'Home – Top');
  assert.equal(placementName('stallions:right3'), 'Stallions – Right 3');
  assert.equal(placementTier('news:top'), 'large');
  assert.equal(placementTier('news:left1'), 'small');
});

test('stallion sire names: commas separate spellings', () => {
  assert.equal(sireKeys('OBOS Quality 004, Obos Quality').length, 2);
  assert.deepEqual(sireKeys(''), []);
});

test('stallion progeny totals', () => {
  const rows = [
    { horse_id: 1, placing: 1 }, { horse_id: 1, placing: 4 }, { horse_id: 2, placing: 3 }, { horse_id: 3, placing: null }
  ];
  assert.deepEqual(summary(rows), { horses: 3, placings: 4, wins: 1, top3: 2 });
});
