import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import { runUpload, ownerFindHorses, ownerProgeny } from '../lib/shared.js';
import { fillPlan, fillApply } from '../lib/fill.js';
import { findHorses } from '../lib/breeding.js';

const iberDb = () => memoryD1(new URL('../migrations/', import.meta.url));
const sharedDb = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const iberSource = async db => (await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first()).id;

test('IBER gaps are filled from the shared database, only where missing and only for the same horse', async () => {
  const iber = iberDb(), shared = sharedDb();
  const { horses } = await findHorses(iber, { gaps: true, limit: 2000 });
  // Two IBER horses with gaps; the first gets a shared record with the same name and year, the second a different year.
  const [a, b] = horses.filter(h => h.birth_year);
  assert.ok(a && b, 'the launch content has horses with breeding gaps');
  const src = await iberSource(shared);
  await runUpload(shared, `Name,Year,Sire,Dam,Dam sire,Breeder\n"${a.name}",${a.birth_year},Shared Sire (ISH),Shared Dam,Shared Dam Sire (TB),Shared Breeder (Cork)\n"${b.name}",${b.birth_year - 3},Wrong Sire,Wrong Dam,,`, { sourceId: src, save: true });
  const plan = await fillPlan(iber, shared);
  assert.deepEqual(plan.map(p => p.id), [a.id], 'a different year is a different horse');
  const p = plan[0];
  for (const [k, v] of Object.entries({ sire: a.sire, dam: a.dam, dam_sire: a.dam_sire, breeder: a.breeder })) {
    if (v && !/^unk/i.test(v)) assert.equal(p.adds[k], undefined, `${k} already recorded is not changed`);
  }
  const r = await fillApply(iber, shared, { ids: [a.id] });
  assert.equal(r.filled, 1);
  const after = (await findHorses(iber, { q: a.name })).horses.find(h => h.id === a.id || h.name === a.name);
  if (p.adds.sire) assert.equal(after.sire, 'Shared Sire');
  if (p.adds.breeder) assert.equal(after.breeder, 'Shared Breeder');
  assert.equal((await fillPlan(iber, shared)).length, 0, 'nothing left to fill');
});

test('owner area: the shared database can be browsed, stallions first, with their progeny', async () => {
  const shared = sharedDb();
  await runUpload(shared, 'Name,Year,Sex,Sire,Dam\nCruising,1985,Stallion,,\nFoal One,2015,Mare,Cruising (ISH),Lady A\nFoal Two,2016,Gelding,Cruising (ISH),Lady B', { sourceId: await iberSource(shared), save: true });
  const st = await ownerFindHorses(shared, { stallions: true });
  assert.equal(st.horses[0].name, 'Cruising');
  assert.equal(st.horses[0].progeny, 2);
  assert.equal((await ownerFindHorses(shared, { q: 'foal' })).total, 2);
  assert.deepEqual((await ownerProgeny(shared, st.horses[0].id)).map(x => x.name), ['Foal Two', 'Foal One']);
});
