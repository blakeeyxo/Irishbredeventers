import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { memoryD1 } from './d1-shim.js';
import { runUpload } from '../lib/shared.js';
import { runFeiImport } from '../lib/sj.js';

const MIG = new URL('../migrations-shared/', import.meta.url);
const JUMPING = readFileSync(new URL('./fixtures/fei-jumping.txt', import.meta.url), 'utf8');

// The shared database as it was before 0009 (migrations 0001–0008 only).
function before0009() {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const f of readdirSync(MIG).filter(n => n.endsWith('.sql') && n < '0009')) copyFileSync(new URL(f, MIG), join(dir, f));
  return memoryD1(pathToFileURL(dir + '/'));
}

test('0009: everything that came from SporthorseData is removed or put back, and the source is recorded as refused', async () => {
  const db = before0009();
  const iber = (await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first()).id;
  const shd = (await db.prepare("SELECT id FROM source WHERE slug = 'sporthorse-data'").first()).id;
  await runUpload(db, 'Name,Year,Sire\nKeep Me,2015,Cruising (ISH)', { sourceId: iber, save: true });
  await runFeiImport(db, JUMPING, { save: true }); // Abc Mayflower, with results and no breeding
  // SporthorseData fills in Abc Mayflower's breeding (new sire, dam, dam sire, breeder) and changes Keep Me's sire.
  await runUpload(db, 'Name,FEI ID,UELN,Sire,Dam,Dam sire,Breeder\nAbc Mayflower,109WK62,372000000000099,Cyrano (HOLST),Abc Royale,Cavalier Royale (HOLST),Miguel Bravo', { sourceId: shd, save: true });
  await runUpload(db, 'Name,Year,Sire\nKeep Me,2015,Cyrano (HOLST)', { sourceId: shd, save: true, overwrite: true });
  db.raw.exec("INSERT INTO breeding_lookup (horse_id, outcome) SELECT id, 'saved' FROM horse WHERE fei_id = '109WK62'");
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse WHERE source_id = ?').bind(shd).first()).n, 3, 'Cyrano, Abc Royale, Cavalier Royale');

  db.raw.exec(readFileSync(new URL('0009_remove_sporthorse_data.sql', MIG), 'utf8'));

  const may = await db.prepare("SELECT sire_id, dam_id, breeder_id, ueln FROM horse WHERE fei_id = '109WK62'").first();
  assert.deepEqual({ ...may }, { sire_id: null, dam_id: null, breeder_id: null, ueln: null }, 'its breeding is taken off again');
  const keep = await db.prepare("SELECT s.name FROM horse h JOIN horse s ON s.id = h.sire_id WHERE h.name = 'Keep Me'").first();
  assert.equal(keep.name, 'Cruising', 'a changed sire is put back');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM horse WHERE source_id = ?').bind(shd).first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM party WHERE source_id = ?').bind(shd).first()).n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM result').first()).n, 3, 'FEI results untouched');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM breeding_lookup').first()).n, 0);
  const src = await db.prepare("SELECT licence_status, can_store, can_display FROM source WHERE slug = 'sporthorse-data'").first();
  assert.deepEqual([src.licence_status, src.can_store, src.can_display], ['refused', 0, 0]);
  assert.deepEqual((await db.prepare('SELECT slug FROM auto_reader').all()).results.map(r => r.slug), ['fei']);
});
