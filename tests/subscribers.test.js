// The results-email list, end to end through the Worker: sign up, confirm, new results emailed, unsubscribe,
// and the list kept private. The mail service is replaced by a recorder; nothing is really sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import worker from '../src/worker.js';

const ROW = {
  position: 1, horse_name: 'Qzxv Mailhorse', breed: 'ISH', foaled: 2016, sex: 'Gelding', sire: 'Qzxv Mailsire', dam: 'Qzxv Maildam', dam_sire: 'Qzxv Maildamsire',
  breeder: 'Qzxv Mailbreeder', rider_name: 'Test Rider', rider_country: 'GBR', dressage: '30', show_jumping: '0', cross_country: '4', score: 34,
  country: 'Great Britain', event_name: 'Mail Test Horse Trials', event_date_text: '3rd – 4th November 2026', start_date: '2026-11-03', end_date: '2026-11-04',
  season: 2026, class_name: 'CCI3*-S', verified: true
};

function setup(mail = {}) {
  const env = { DB: memoryD1(new URL('../migrations/', import.meta.url)), DEV_MODE: 'true', SITE_URL: 'https://iber.ie', ...mail };
  const sent = [];
  const realFetch = globalThis.fetch;
  // Cloudflare's edge cache isn't there outside Cloudflare.
  globalThis.caches ??= { default: { match: async () => undefined, put: async () => {}, delete: async () => false } };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      if (mail.failMail) return new Response('{"message":"API key is invalid"}', { status: 401 });
      sent.push(...JSON.parse(init.body));
      return new Response('{"data":[]}', { status: 200 });
    }
    return realFetch(url, init);
  };
  const call = async (path, { method = 'GET', body, host = 'localhost' } = {}) => {
    const req = new Request(`http://${host}${path}`, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json' }, redirect: 'manual' });
    const waits = [];
    const res = await worker.fetch(req, env, { waitUntil: p => waits.push(p), passThroughOnException() {} });
    await Promise.all(waits);
    return res;
  };
  return { env, sent, call, restore: () => { globalThis.fetch = realFetch; } };
}
const mailOn = { MAIL_API_KEY: 'test-key', MAIL_FROM: 'IBER <info@iber.ie>' };
const tokenOf = (env, email) => env.DB.raw.prepare('SELECT token FROM subscribers WHERE email = ?').get(email).token;

test('sign up → confirm → new results emailed one by one, each with its own unsubscribe link → unsubscribe deletes', async () => {
  const t = setup(mailOn);
  try {
    // Sign up (twice, and in capitals: still one address).
    for (const email of ['Fan@Example.ie', 'fan@example.ie', 'other@example.ie', 'never-confirms@example.ie']) {
      const res = await t.call('/api/subscribe', { method: 'POST', body: { email } });
      assert.equal(res.status, 200);
    }
    assert.equal(t.env.DB.raw.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n, 3);
    const confirms = t.sent.filter(m => /confirm/i.test(m.subject));
    assert.ok(confirms.length >= 3, 'a confirm email goes out to each new address');
    assert.ok(confirms.every(m => m.to.length === 1), 'one person per email');

    // Confirm two of them with the link from the email; a made-up link confirms nothing.
    for (const email of ['fan@example.ie', 'other@example.ie']) {
      const res = await t.call(`/api/subscribe/confirm?token=${tokenOf(t.env, email)}`);
      assert.equal(res.status, 303);
      assert.match(res.headers.get('location'), /subscribe=confirmed/);
    }
    assert.match((await t.call('/api/subscribe/confirm?token=madeup')).headers.get('location'), /subscribe=invalid/);

    // Publish results with "Email subscribers" ticked: only the two confirmed addresses, each on their own.
    t.sent.length = 0;
    const res = await t.call('/api/admin/import', { method: 'POST', body: { rows: [ROW], notify: true, decisions: {} } });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual([out.emailStatus, out.emailed], ['sent', 2]);
    assert.deepEqual(t.sent.map(m => m.to).sort(), [['fan@example.ie'], ['other@example.ie']]);
    for (const m of t.sent) {
      const token = tokenOf(t.env, m.to[0]);
      assert.match(m.html, /https:\/\/iber\.ie\/results/);
      assert.ok(m.html.includes(`/api/unsubscribe?token=${token}`), 'their own unsubscribe link');
      assert.equal(m.headers['List-Unsubscribe'], `<https://iber.ie/api/unsubscribe?token=${token}>`);
      assert.ok(!m.html.includes('never-confirms') && !m.html.includes(m.to[0] === 'fan@example.ie' ? 'other@' : 'fan@'), 'no other address in the email');
    }

    // Unsubscribe from the link: the address is deleted, and the next results go only to the other.
    const un = await t.call(`/api/unsubscribe?token=${tokenOf(t.env, 'fan@example.ie')}`);
    assert.equal(un.status, 303);
    assert.equal(t.env.DB.raw.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE email = 'fan@example.ie'").get().n, 0);
    t.sent.length = 0;
    await t.call('/api/admin/import', { method: 'POST', body: { rows: [{ ...ROW, horse_name: 'Qzxv Mailhorse Two' }], notify: true, decisions: {} } });
    assert.deepEqual(t.sent.map(m => m.to), [['other@example.ie']]);

    // Not ticked: nobody is emailed.
    t.sent.length = 0;
    await t.call('/api/admin/import', { method: 'POST', body: { rows: [{ ...ROW, horse_name: 'Qzxv Mailhorse Three' }], notify: false, decisions: {} } });
    assert.equal(t.sent.length, 0);
  } finally { t.restore(); }
});

test('the email list is private: no public page or API shows an address, and the owner list is a 404 without the owner login', async () => {
  const t = setup(mailOn);
  try {
    await t.call('/api/subscribe', { method: 'POST', body: { email: 'secret@example.ie' } });
    // From the real domain with no owner login: the plain 404 a missing page gives.
    for (const path of ['/api/admin/subscribers', '/api/admin/summary']) {
      const res = await t.call(path, { host: 'iber.ie' });
      assert.equal(res.status, 404, path);
      assert.ok(!(await res.text()).includes('secret@'));
    }
    const post = await t.call('/api/admin/subscribers', { method: 'POST', host: 'iber.ie', body: { action: 'seen' } });
    assert.equal(post.status, 404);
    // The sign-up answer is the same whether or not the address is already on the list.
    const again = await t.call('/api/subscribe', { method: 'POST', body: { email: 'secret@example.ie' } });
    assert.deepEqual(await again.json(), { ok: true });
    // A bad address is refused and not stored.
    const bad = await t.call('/api/subscribe', { method: 'POST', body: { email: 'not an email' } });
    assert.equal(bad.status, 400);
    // The owner (signed in) sees it, flagged new, and Mark as seen clears the flag.
    const list = await (await t.call('/api/admin/subscribers')).json();
    assert.deepEqual(list.subscribers.map(s => [s.email, s.confirmed, s.new]), [['secret@example.ie', 0, 1]]);
    assert.equal('token' in list.subscribers[0], false, "the owner list doesn't carry the private links");
    assert.equal((await (await t.call('/api/admin/summary')).json()).signups, 1);
    await t.call('/api/admin/subscribers', { method: 'POST', body: { action: 'seen' } });
    assert.equal((await (await t.call('/api/admin/summary')).json()).signups, 0);
    // Tokens are long random strings, so a link can't be guessed.
    assert.match(tokenOf(t.env, 'secret@example.ie'), /^[0-9a-f]{48}$/);
  } finally { t.restore(); }
});

test('when the mail service refuses, the owner is told the email failed (the results are still saved)', async () => {
  const t = setup({ ...mailOn, failMail: true });
  try {
    t.env.DB.raw.exec("INSERT INTO subscribers (email, confirmed, token) VALUES ('a@example.ie', 1, 'tok1')");
    const out = await (await t.call('/api/admin/import', { method: 'POST', body: { rows: [ROW], notify: true, decisions: {} } })).json();
    assert.equal(out.emailStatus, 'failed');
    assert.match(out.emailError, /401/);
    assert.ok(out.results >= 1, 'results saved');
  } finally { t.restore(); }
});

test('with email not set up, the owner is told nothing was sent', async () => {
  const t = setup();
  try {
    t.env.DB.raw.exec("INSERT INTO subscribers (email, confirmed, token) VALUES ('a@example.ie', 1, 'tok1')");
    const out = await (await t.call('/api/admin/import', { method: 'POST', body: { rows: [ROW], notify: true, decisions: {} } })).json();
    assert.deepEqual([out.emailStatus, out.emailed], ['not-set-up', 0]);
  } finally { t.restore(); }
});
