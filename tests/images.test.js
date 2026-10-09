import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveImage, savePhoneImage, phoneKeyOf } from '../lib/images.js';
import { onRequestGet as media } from '../functions/media/[[path]].js';

function bucket() {
  const store = new Map();
  return {
    store,
    async put(k, v, o) { store.set(k, { v, type: o.httpMetadata.contentType }); },
    async get(k) { const o = store.get(k); return o ? { body: o.v, httpEtag: 'x', writeHttpMetadata: h => h.set('content-type', o.type) } : null; }
  };
}
const jpg = name => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

test('a phone crop is stored next to its photo, and phones fall back to the photo when there is none', async () => {
  const MEDIA = bucket(), env = { MEDIA };
  const key = await saveImage(env, jpg('a.jpg'), 'news');
  assert.match(key, /^news\/[\w-]+\.jpg$/);
  assert.equal(phoneKeyOf(key), key.replace('.jpg', '-phone.jpg'));
  const path = k => ({ env, params: { path: k.split('/') } });
  // No phone crop yet: the phone address gives the photo itself.
  assert.equal((await media(path(phoneKeyOf(key)))).status, 200);
  await savePhoneImage(env, key, jpg('p.jpg'));
  assert.ok(MEDIA.store.has(phoneKeyOf(key)));
  assert.equal((await media(path(phoneKeyOf(key)))).status, 200);
  assert.equal((await media(path('news/missing-phone.jpg'))).status, 404);
  await savePhoneImage(env, key, new File([], 'none')); // an empty phone box changes nothing
  await assert.rejects(savePhoneImage(env, key, new File(['x'], 'a.txt', { type: 'text/plain' })), /isn't a picture/);
});
