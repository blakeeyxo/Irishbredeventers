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
