import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import { readListing, createListing, listPublic, getPublic, addEnquiry, ownerAction, listForOwner, saveSettings, deleteListing, readEnquiry } from '../lib/listings.js';
import { runUpload } from '../lib/shared.js';

const fresh = () => memoryD1(new URL('../migrations-shared/', import.meta.url));
const AD = {
  title: 'Talented 7yo ISH gelding', horse_name: 'Fernhill Cool Confection', sex: 'gelding', foaled_year: String(new Date().getUTCFullYear() - 7),
  height_hh: '16.2', studbook: 'ish', sire: 'Sligo Candy Boy', dam: 'Princess Cool Diamond', price: '€12,500', county: 'Kilkenny',
  disciplines: ['showjumping'], seller_name: 'Mary Brennan', seller_email: 'Mary@Example.ie', seller_phone: '087 123 4567', description: 'Lovely horse.'
};
const send = async (db, over = {}) => createListing(db, readListing({ ...AD, ...over }), { photoKeys: ['listings/a.jpg', 'listings/b.jpg'], site: 'ibsr' });

test('the sell form is checked: price or price on request, sex, discipline, seller email', () => {
  const ok = readListing(AD);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.values.price_cents, 1250000);
  assert.equal(ok.values.height_hh, 16.2);
  assert.equal(ok.values.studbook, 'ISH');
  assert.equal(ok.seller.email, 'mary@example.ie');
  const bad = readListing({ title: '', price: 'lots', height_hh: '30', disciplines: ['dressage'], seller_email: 'nope', video_url: 'http://x' });
  assert.equal(bad.errors.length, 8);
  assert.deepEqual(readListing({ ...AD, price: '', price_on_request: 'on' }).errors, []);
  assert.equal(readEnquiry({ name: 'A', email: 'a@b.ie', message: 'Still for sale?' }).errors.length, 0);
});

test('an ad stays hidden until approved and paid, then shows only on its discipline\'s site', async () => {
  const db = fresh();
  const id = await send(db);
  assert.equal((await listPublic(db, 'showjumping')).total, 0, 'waiting for review is hidden');
  assert.equal((await listForOwner(db, 'draft')).listings.length, 1);
  await assert.rejects(ownerAction(db, id, 'approve', {}), /Enter the fee/);
  const approved = await ownerAction(db, id, 'approve', { fee: '25' });
  assert.equal(approved.email, 'approved');
  assert.equal(approved.listing.listing_fee_cents, 2500);
  assert.equal((await listPublic(db, 'showjumping')).total, 0, 'awaiting payment is hidden');
  const live = await ownerAction(db, id, 'publish');
  assert.equal(live.email, 'live');
  assert.ok(live.listing.expires_at);
  const sj = await listPublic(db, 'showjumping');
  assert.equal(sj.total, 1);
  assert.equal(sj.listings[0].photo, 'listings/a.jpg');
  assert.equal(sj.listings[0].photos, 2);
  assert.equal((await listPublic(db, 'eventing')).total, 0, 'not on the eventing site');
  assert.equal(await getPublic(db, id, 'eventing'), null);
  const page = await getPublic(db, id, 'showjumping');
  assert.deepEqual(page.photos, ['listings/a.jpg', 'listings/b.jpg']);
  assert.equal(page.seller_email, undefined, 'no seller details in public data');
  assert.equal(page.seller_id, undefined);
});

test('filters, sorting and counties', async () => {
  const db = fresh();
  await saveSettings(db, { listing_fee: '25', listing_days: '60' });
  const year = new Date().getUTCFullYear();
  for (const [title, sex, age, height, price, county] of [['A', 'mare', 4, '15.2', '5000', 'Cork'], ['B', 'gelding', 9, '17', '30000', 'Kilkenny'], ['C', 'gelding', 6, '16.1', '', 'Cork']]) {
    const id = await send(db, { title, sex, foaled_year: String(year - age), height_hh: height, price, price_on_request: price ? '' : 'on', county });
    await ownerAction(db, id, 'approve', {});
    await ownerAction(db, id, 'publish');
  }
  const names = async p => (await listPublic(db, 'showjumping', p)).listings.map(l => l.title).join('');
  assert.equal(await names({ sex: 'gelding', sort: 'price_low' }), 'BC', 'price on request comes last');
  assert.equal(await names({ age_min: 5, age_max: 8 }), 'C');
  assert.equal(await names({ height_min: 16, sort: 'tallest' }), 'BC');
  assert.equal(await names({ price_max: 10000 }), 'A', 'price filters leave out price on request');
  assert.equal(await names({ county: 'Cork', sort: 'youngest' }), 'AC');
  assert.equal(await names({ q: 'Candy' }), 'ABC');
  assert.deepEqual((await listPublic(db, 'showjumping')).counties.map(c => ({ ...c })), [{ county: 'Cork', n: 2 }, { county: 'Kilkenny', n: 1 }]);
});

test('enquiries only on live ads; sold ads stay up with no enquiries; ended ads disappear', async () => {
  const db = fresh();
  const id = await send(db);
  const e = { name: 'Buyer', email: 'b@b.ie', message: 'Still for sale?' };
  assert.equal(await addEnquiry(db, id, 'showjumping', e), null, 'not before it is live');
  await ownerAction(db, id, 'approve', { fee: '20' });
  await ownerAction(db, id, 'publish');
  const saved = await addEnquiry(db, id, 'showjumping', e);
  assert.equal(saved.listing.seller_email, 'mary@example.ie');
  assert.equal(await addEnquiry(db, id, 'eventing', e), null, 'not from a site that does not show it');
  await ownerAction(db, id, 'sold');
  assert.equal((await getPublic(db, id, 'showjumping')).status, 'sold');
  assert.equal(await addEnquiry(db, id, 'showjumping', e), null);
  db.raw.exec(`UPDATE listing SET expires_at = datetime('now', '-1 day') WHERE id = ${id}`);
  assert.equal((await listPublic(db, 'showjumping')).total, 0);
  db.raw.exec(`UPDATE listing SET status = 'live' WHERE id = ${id}`);
  assert.equal((await listForOwner(db, 'expired')).listings.length, 1, 'a live ad past its date shows as expired');
  assert.equal((await listForOwner(db, 'live')).listings.length, 0);
});

test('publishing links the ad to the shared horse record; one seller record per email; delete removes everything', async () => {
  const db = fresh();
  const iber = (await db.prepare("SELECT id FROM source WHERE slug = 'iber'").first()).id;
  await runUpload(db, `Name,Year,Sire\nFernhill Cool Confection,${new Date().getUTCFullYear() - 7},Sligo Candy Boy`, { sourceId: iber, save: true });
  const id = await send(db);
  await send(db, { title: 'Second', seller_name: 'Mary B' });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM party WHERE email = 'mary@example.ie'").first()).n, 1);
  await ownerAction(db, id, 'approve', { fee: '20' });
  await ownerAction(db, id, 'publish');
  const l = (await listForOwner(db, 'live')).listings[0];
  assert.equal(l.horse_link_name, 'Fernhill Cool Confection');
  assert.equal(l.seller_name, 'Mary B', 'latest name kept');
  const keys = await deleteListing(db, id);
  assert.deepEqual(keys.sort(), ['listings/a.jpg', 'listings/b.jpg']);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM listing_photo WHERE listing_id = ?').bind(id).first()).n, 0);
});

test('rejecting tells the seller why; the owner can edit an ad and its sites', async () => {
  const db = fresh();
  const id = await send(db);
  const r = await ownerAction(db, id, 'reject', { reason: 'Photos are too dark.' });
  assert.equal(r.email, 'rejected');
  assert.equal(r.listing.reject_reason, 'Photos are too dark.');
  await ownerAction(db, id, 'save', { ...AD, title: 'Edited', disciplines: ['eventing', 'showjumping'] });
  await ownerAction(db, id, 'approve', { fee: '20' });
  await ownerAction(db, id, 'publish');
  assert.equal((await getPublic(db, id, 'eventing')).title, 'Edited');
  assert.equal((await getPublic(db, id, 'showjumping')).title, 'Edited');
});
