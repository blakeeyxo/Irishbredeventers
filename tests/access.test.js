import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccess } from '../lib/access.js';

const TEAM = 'ibe.cloudflareaccess.com', AUD = 'aud-123';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: 'charlie@example.ie, emer@example.ie' };
const b64url = b => Buffer.from(b).toString('base64url');

const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
globalThis.fetch = async url => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }));
};

async function token(payload, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid })), p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
const req = (t, host = 'irishbredeventers.pages.dev') => new Request(`https://${host}/api/admin/summary`, { headers: t ? { 'Cf-Access-Jwt-Assertion': t } : {} });
const good = { aud: [AUD], email: 'Charlie@example.ie', iss: `https://${TEAM}`, exp: Math.floor(Date.now() / 1000) + 600 };

test('valid Access login for an allowed email passes', async () => {
  assert.deepEqual(await verifyAccess(req(await token(good)), env), { email: 'charlie@example.ie' });
});
test('no token, wrong audience, expired, or other email fails', async () => {
  assert.equal(await verifyAccess(req(null), env), null);
  assert.equal(await verifyAccess(req(await token({ ...good, aud: ['other'] })), env), null);
  assert.equal(await verifyAccess(req(await token({ ...good, exp: 1 })), env), null);
  assert.equal(await verifyAccess(req(await token({ ...good, email: 'someone@else.com' })), env), null);
});
test('tampered token fails', async () => {
  const t = await token(good);
  const [h, , s] = t.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'emer@example.ie' }))}.${s}`;
  assert.equal(await verifyAccess(req(forged), env), null);
});
test('not configured means closed; dev mode only opens on localhost', async () => {
  assert.equal(await verifyAccess(req(await token(good)), {}), null);
  assert.equal(await verifyAccess(req(null), { DEV_MODE: 'true' }), null);
  assert.deepEqual(await verifyAccess(req(null, 'localhost:8788'), { DEV_MODE: 'true' }), { email: 'dev@localhost' });
});
