import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spamCheckStatus, verifyTurnstile } from '../lib/http.js';

// Cloudflare's siteverify, as documented: a wrong secret gives "invalid-input-secret"; a right secret with a made-up
// token gives "invalid-input-response".
const GOOD = 'right-secret';
function fakeCloudflare() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, { body }) => {
    const secret = body.get('secret'), token = body.get('response');
    const out = secret !== GOOD ? { success: false, 'error-codes': ['invalid-input-secret'] }
      : token === 'good-token' ? { success: true, hostname: 'irishbredshowjumpers.emerblakeey.workers.dev' }
      : { success: false, 'error-codes': ['invalid-input-response'] };
    return new Response(JSON.stringify(out));
  };
  return () => { globalThis.fetch = real; };
}
const req = new Request('https://x/api/wanted');

test('the owner-area spam check says what is missing or wrong', async () => {
  const restore = fakeCloudflare();
  try {
    assert.deepEqual(await spamCheckStatus({}), { siteKey: '', hasSiteKey: false, hasSecret: false, secretOk: null, codes: [] });
    const right = await spamCheckStatus({ TURNSTILE_SITE_KEY: '0x4AAAAAAAFRgUpYtf7IT', TURNSTILE_SECRET: GOOD });
    assert.deepEqual([right.secretOk, right.siteKey], [true, '0x4AAAAAAAFR…']);
    const wrong = await spamCheckStatus({ TURNSTILE_SITE_KEY: 'k', TURNSTILE_SECRET: 'from-the-other-widget' });
    assert.deepEqual([wrong.secretOk, wrong.codes], [false, ['invalid-input-secret']]);
  } finally { restore(); }
});

test('forms pass with a good token and are refused (fail closed) otherwise', async () => {
  const restore = fakeCloudflare();
  const errors = [], log = console.error;
  console.error = m => errors.push(m);
  try {
    assert.equal(await verifyTurnstile({ TURNSTILE_SECRET: GOOD }, 'good-token', req), true);
    assert.equal(await verifyTurnstile({ TURNSTILE_SECRET: GOOD }, 'stale', req), false);
    assert.equal(await verifyTurnstile({ TURNSTILE_SECRET: 'wrong' }, 'good-token', req), false);
    assert.equal(await verifyTurnstile({}, 'good-token', req), false);
    assert.equal(await verifyTurnstile({ TURNSTILE_SECRET: GOOD }, '', req), false);
    assert.equal(await verifyTurnstile({ DEV_MODE: 'true' }, '', req), true);
    assert.deepEqual(errors, ['Turnstile refused: invalid-input-response', 'Turnstile refused: invalid-input-secret',
      'Turnstile refused: TURNSTILE_SECRET is not set on this Worker', 'Turnstile refused: the form sent no token']);
  } finally { restore(); console.error = log; }
});
