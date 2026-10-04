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
  assert.deepEqual(summary(rows), { mentions: 4, horses: 3, wins: 1, top3: 2 });
});

test('rolling 12-month window moves with today', async () => {
  const { rollingWindow } = await import('../lib/stallions.js');
  assert.deepEqual(rollingWindow(new Date('2026-10-04T12:00:00Z')), { start: '2025-11-01', end: '2026-10-31', label: 'Last 12 months (Nov 2025 – Oct 2026)' });
  assert.deepEqual(rollingWindow(new Date('2026-11-01T00:00:00Z')), { start: '2025-12-01', end: '2026-11-30', label: 'Last 12 months (Dec 2025 – Nov 2026)' });
  assert.deepEqual(rollingWindow(new Date('2026-12-15T00:00:00Z')), { start: '2026-01-01', end: '2026-12-31', label: 'Last 12 months (Jan 2026 – Dec 2026)' });
  assert.equal(rollingWindow(new Date('2028-02-10T00:00:00Z')).end, '2028-02-29');
});

test('stallion names match however they are typed', async () => {
  const { sireCore, sireKeys, matchSires } = await import('../lib/stallions.js');
  assert.equal(sireCore('Imperial Heights (ISH)[TIH]'), 'imperial heights');
  assert.equal(sireCore('  IMPERIAL   heights  '), 'imperial heights');
  assert.deepEqual(sireKeys('Imperial Heights (ISH), Cruisings Micky Finn [TIH]'), ['imperial heights', 'cruisings micky finn']);
  const sires = [
    { id: 1, name: 'Imperial Heights', name_normalised: 'imperial heights' },
    { id: 2, name: 'Imperial Hights', name_normalised: 'imperial hights' },
    { id: 3, name: 'Cruisings Micky Finn', name_normalised: 'cruisings micky finn' },
    { id: 4, name: 'Cruising Micky Finn', name_normalised: 'cruising micky finn' },
    { id: 5, name: 'Cruising', name_normalised: 'cruising' },
    { id: 6, name: 'Tyson', name_normalised: 'tyson' },
    { id: 7, name: 'Tyron', name_normalised: 'tyron' }
  ];
  const db = { prepare: () => ({ all: async () => ({ results: sires }) }) };
  const ids = async names => (await matchSires(db, names)).map(s => s.id).sort();
  assert.deepEqual(await ids('Imperial Heights (ISH)[TIH]'), [1, 2]);
  assert.deepEqual(await ids('imperial hights'), [1, 2]);
  assert.deepEqual(await ids('Cruisings Micky Finn'), [3, 4]);
  assert.deepEqual(await ids('Tyson'), [6]); // short names must match exactly
  assert.deepEqual(await ids('Cruising'), [5]);
});
