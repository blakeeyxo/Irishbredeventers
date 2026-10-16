import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import { readWanted, createWanted, listPublicWanted, readReply, addReply, listWantedForOwner, repliesFor, wantedAction, deleteWanted, wantedFacts } from '../lib/wanted.js';
import { wantedReplyEmail } from '../lib/mail.js';
import { SITES } from '../lib/sites.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const POST = { title: '1.20m schoolmaster for a teenager', sex: 'Gelding', age_min: '8', age_max: '14', height_min: '15.2', height_max: '16.2',
  budget: '€15,000', level: 'Jumping 1.20m', location: 'Ireland or UK', description: 'Safe and honest.', buyer_name: 'Aoife Byrne', buyer_email: 'Aoife@Example.ie' };

test('the "looking for" form is checked; only a title and a way to reach the buyer are needed', () => {
  const ok = readWanted(POST);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual([ok.values.sex, ok.values.age_min, ok.values.height_max, ok.values.budget_cents, ok.buyer.email], ['gelding', 8, 16.2, 1500000, 'aoife@example.ie']);
  assert.deepEqual(readWanted({ title: 'Any pony', buyer_name: 'A', buyer_email: 'a@b.ie' }).errors, []);
  const bad = readWanted({ title: '', age_min: '12', age_max: '5', height_min: '30', budget: 'lots', buyer_email: 'nope' });
  assert.equal(bad.errors.length, 6);
  assert.equal(wantedFacts(ok.values), 'Gelding · 8 yrs to 14 yrs · 15.2hh to 16.2hh · up to €15,000');
});

test('a post is hidden until approved, then shows on its own site (and the other only when shared)', async () => {
  const db = fresh();
  const id = await createWanted(db, readWanted(POST), { site: 'iber', share: false });
  const shared = await createWanted(db, readWanted({ ...POST, title: 'Young mare to produce' }), { site: 'ibsr', share: 'on' });
  assert.equal((await listPublicWanted(db, 'eventing')).length, 0, 'waiting for review');
  assert.equal((await listWantedForOwner(db, 'draft', 'iber')).wanted.length, 1, "each site's owner area sees its own");
  const out = await wantedAction(db, id, 'approve');
  assert.equal(out.email, 'live');
  await wantedAction(db, shared, 'approve');
  const iber = await listPublicWanted(db, 'eventing'), ibsr = await listPublicWanted(db, 'showjumping');
  assert.deepEqual(iber.map(w => w.title).sort(), ['1.20m schoolmaster for a teenager', 'Young mare to produce']);
  assert.deepEqual(ibsr.map(w => w.title), ['Young mare to produce']);
  assert.equal('buyer_email' in iber[0], false, "the buyer's details are never public");
  // Ends after the For Sale "days an ad stays live".
  const w = (await listWantedForOwner(db, 'live', 'iber')).wanted[0];
  assert.match(w.expires_at, /^\d{4}-\d{2}-\d{2} /);
  db.raw.exec(`UPDATE wanted SET expires_at = datetime('now', '-1 day') WHERE id = ${id}`);
  assert.equal((await listPublicWanted(db, 'eventing')).length, 1, 'an ended post is no longer shown');
  assert.equal((await listWantedForOwner(db, 'live', 'iber')).counts.ended, 1);
});

test("a seller's answer is saved and emailed to the buyer, never the other way round; found and removed come down", async () => {
  const db = fresh();
  const id = await createWanted(db, readWanted(POST), { site: 'iber', share: false });
  const { reply } = readReply({ name: 'Tom Walsh', email: 'tom@example.ie', message: 'I have a 10yo gelding, 16.1hh, jumping 1.20m.' });
  assert.equal(await addReply(db, id, 'eventing', reply), null, 'not live yet');
  await wantedAction(db, id, 'approve');
  assert.equal(await addReply(db, id, 'showjumping', reply), null, 'not shown on the other site');
  const saved = await addReply(db, id, 'eventing', reply);
  assert.equal(saved.wanted.buyer_email, 'aoife@example.ie');
  const mail = wantedReplyEmail(SITES.iber, saved.wanted.buyer_email, saved.wanted, reply, 'https://x/for-sale');
  assert.deepEqual([mail.to, mail.replyTo], ['aoife@example.ie', 'tom@example.ie']);
  assert.equal((await repliesFor(db, id))[0].name, 'Tom Walsh');
  assert.equal((await listWantedForOwner(db, 'live', 'iber')).wanted[0].replies, 1);
  await wantedAction(db, id, 'found');
  assert.equal((await listPublicWanted(db, 'eventing')).length, 0);
  assert.equal((await wantedAction(db, id, 'reject', { reason: 'Not a sales post' })).email, 'rejected');
  await deleteWanted(db, id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM wanted_reply').first()).n, 0, 'answers go with it');
  assert.equal(readReply({}).errors.length, 3);
});
