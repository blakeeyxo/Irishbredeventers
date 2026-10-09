import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import { horseResults, deleteResult, deleteHorse } from '../lib/breeding.js';

test('owner area (IBER): delete one result, then a horse with the rest, and their lines on the results pages', async () => {
  const db = memoryD1(new URL('../migrations/', import.meta.url));
  const h = await db.prepare(`SELECT r.horse_id AS id, COUNT(*) AS n FROM results r JOIN placings p ON p.result_id = r.id
    GROUP BY r.horse_id HAVING n >= 2 ORDER BY n DESC LIMIT 1`).first();
  assert.ok(h, 'the launch content has a horse with two or more results');
  let rs = await horseResults(db, h.id);
  assert.equal(rs.length, h.n);
  const placings = id => db.prepare('SELECT COUNT(*) AS n FROM placings WHERE result_id IN (SELECT id FROM results WHERE horse_id = ?)').bind(id).first().then(x => x.n);
  const before = await placings(h.id);
  await deleteResult(db, rs[0].id);
  assert.equal((await horseResults(db, h.id)).length, h.n - 1);
  assert.ok(await placings(h.id) < before, 'its line on the results pages goes too');
  const r = await deleteHorse(db, h.id);
  assert.equal(r.results, h.n - 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horses WHERE id = ?').bind(h.id).first()).n, 0);
  assert.equal(await placings(h.id), 0);
  await assert.rejects(deleteHorse(db, h.id), /no longer there/);
});
