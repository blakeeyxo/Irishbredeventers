import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ftsQuery } from '../functions/api/search.js';

test('search words become safe FTS5 prefix queries', () => {
  assert.equal(ftsQuery('Cooley', 'all'), '"cooley"*');
  assert.equal(ftsQuery("O'Sullivan", 'breeder'), '{breeder} : "o"* AND {breeder} : "sullivan"*');
  assert.equal(ftsQuery('Womanizer (KWPN)', 'sire'), '{sire} : "womanizer"* AND {sire} : "kwpn"*');
  assert.equal(ftsQuery('Créevagh', 'name'), '{horse_name former_name} : "creevagh"*');
  assert.equal(ftsQuery('" * - ()', 'all'), null);
  assert.equal(ftsQuery('NOT OR', 'all'), '"not"* AND "or"*');
});

test('the search index covers horse, former names, sire, dam, dam sire and breeder, never the rider', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const sql = readdirSync(new URL('../migrations/', import.meta.url)).sort()
    .map(f => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')).join('\n');
  const fts = sql.match(/CREATE VIRTUAL TABLE placings_fts USING fts5\(([\s\S]*?)content=/)[1];
  const columns = fts.split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual(columns, ['horse_name', 'former_name', 'sire', 'dam', 'dam_sire', 'breeder']);
  assert.ok(!/placings_fts[^;]*rider/i.test(sql), 'no migration adds a rider to the search index');
  assert.equal(ftsQuery('Kilroe', 'dam'), '{dam dam_sire} : "kilroe"*');
  assert.equal(ftsQuery('Ballinaclough', 'name'), '{horse_name former_name} : "ballinaclough"*');
});
