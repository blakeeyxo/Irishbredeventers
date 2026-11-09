// Owner area → Email, end to end through the Worker. The mail service is replaced by a recorder: nothing is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryD1 } from './d1-shim.js';
import worker from '../src/worker.js';
import { messageHtml, messageText } from '../lib/mail.js';

function setup({ mail = true, failFor = null } = {}) {
  const env = { DB: memoryD1(new URL('../migrations/', import.meta.url)), DEV_MODE: 'true', SITE_URL: 'https://www.iber.ie',
    ...(mail ? { MAIL_API_KEY: 'test-key', MAIL_FROM: 'IrishBredEventingResults <info@iber.ie>' } : {}) };
  env.DB.raw.exec(`INSERT INTO subscribers (email, confirmed, token) VALUES
    ('ann@example.ie', 1, 'tok-ann'), ('bob@example.ie', 1, 'tok-bob'), ('cat@example.ie', 1, 'tok-cat'), ('waiting@example.ie', 0, 'tok-wait')`);
  const sent = [], calls = [];
  const realFetch = globalThis.fetch;
  globalThis.caches ??= { default: { match: async () => undefined, put: async () => {}, delete: async () => false } };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const batch = JSON.parse(init.body);
      calls.push(batch.length);
      if (failFor && batch.some(m => m.to.includes(failFor))) return new Response('{"message":"rate limited"}', { status: 429 });
      sent.push(...batch);
      return new Response('{"data":[]}', { status: 200 });
    }
    return realFetch(url, init);
  };
  const call = async (path, { method = 'GET', body, host = 'localhost' } = {}) => {
    const req = new Request(`http://${host}${path}`, { method, body: body && JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const waits = [];
    const res = await worker.fetch(req, env, { waitUntil: p => waits.push(p), passThroughOnException() {} });
    await Promise.all(waits);
    return res;
  };
  const ids = () => env.DB.raw.prepare('SELECT id, email FROM subscribers').all().reduce((o, r) => ({ ...o, [r.email]: r.id }), {});
  return { env, sent, calls, call, ids, restore: () => { globalThis.fetch = realFetch; } };
}
const NO_RESULTS = {
  kind: 'other', subject: 'No new eventing results this week',
  text: 'Hi,\n\nThere are no new eventing results to post on IBER this week.',
  news: { headline: 'Monarch sale: <b>record</b> prices', summary: 'Irish-bred foals topped the sale.', link: 'https://www.iber.ie/news/12' },
  closing: "We'll keep in touch."
};

test('the page lists confirmed subscribers only; the owner sees their own address for the test', async () => {
  const t = setup();
  try {
    const d = await (await t.call('/api/admin/email')).json();
    assert.deepEqual(d.subscribers.map(s => s.email).sort(), ['ann@example.ie', 'bob@example.ie', 'cat@example.ie']);
    assert.equal('token' in d.subscribers[0], false);
    assert.deepEqual([d.me, d.mailReady], ['dev@localhost', true]);
    for (const [method, body] of [['GET'], ['POST', { action: 'send', ids: [1], subject: 'x', text: 'y' }]]) {
      assert.equal((await t.call('/api/admin/email', { method, body, host: 'www.iber.ie' })).status, 404, 'a stranger gets a 404');
    }
  } finally { t.restore(); }
});

test('send to selected: only the ticked confirmed subscribers, one email each, own unsubscribe link and headers', async () => {
  const t = setup();
  try {
    const id = t.ids();
    // The browser asks for Ann, Bob, the unconfirmed address, a made-up id and junk: only Ann and Bob get it.
    const res = await t.call('/api/admin/email', { method: 'POST', body: { action: 'send', ...NO_RESULTS, ids: [id['ann@example.ie'], id['bob@example.ie'], id['waiting@example.ie'], 999, 'x', id['ann@example.ie']], to: ['evil@example.com'] } });
    const out = await res.json();
    assert.equal(res.status, 200, JSON.stringify(out));
    assert.deepEqual([out.status, out.recipients, out.sent], ['sent', 2, 2]);
    assert.deepEqual(t.sent.map(m => m.to).sort(), [['ann@example.ie'], ['bob@example.ie']]);
    for (const m of t.sent) {
      const tok = m.to[0] === 'ann@example.ie' ? 'tok-ann' : 'tok-bob';
      assert.equal(m.from, 'IrishBredEventingResults <info@iber.ie>');
      assert.equal(m.subject, 'No new eventing results this week');
      assert.ok(m.html.includes(`https://www.iber.ie/api/unsubscribe?token=${tok}`));
      assert.equal(m.headers['List-Unsubscribe'], `<https://www.iber.ie/api/unsubscribe?token=${tok}>`);
      assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      assert.ok(m.html.includes("You're getting this because you signed up for IBER updates at iber.ie."));
      assert.ok(m.text.includes('Unsubscribe: https://www.iber.ie/api/unsubscribe?token=' + tok), 'a text version too');
      assert.ok(m.html.includes('Monarch sale: &lt;b&gt;record&lt;/b&gt; prices'), 'typed HTML is shown, never run');
      assert.ok(m.html.includes('href="https://www.iber.ie/news/12"'));
      assert.ok(m.html.includes('We&#39;ll keep in touch.') || m.html.includes("We'll keep in touch."));
      assert.ok(!m.html.includes(m.to[0] === 'ann@example.ie' ? 'bob@' : 'ann@'), "no other subscriber's address");
    }
    const log = (await (await t.call('/api/admin/email')).json()).log;
    assert.deepEqual([log[0].kind, log[0].subject, log[0].recipients, log[0].sent, log[0].failed.length], ['other', 'No new eventing results this week', 2, 2, 0]);
  } finally { t.restore(); }
});

test('results update: default wording with a See the results button; the optional note goes above it', async () => {
  const t = setup();
  try {
    await t.call('/api/admin/email', { method: 'POST', body: { action: 'send', kind: 'results', subject: 'New results are up on IBER', text: 'Big week for Cooley horses.', ids: [t.ids()['cat@example.ie']] } });
    const m = t.sent[0];
    assert.ok(m.html.includes('New results are up') && m.html.includes('href="https://www.iber.ie/results"') && m.html.includes('See the results'));
    assert.ok(m.html.indexOf('Big week for Cooley horses.') < m.html.indexOf('See the results'));
    assert.ok(m.text.includes('See the results: https://www.iber.ie/results'));
  } finally { t.restore(); }
});

test('send test to me: only the signed-in owner gets it, marked [Test]; logged as a test', async () => {
  const t = setup();
  try {
    const out = await (await t.call('/api/admin/email', { method: 'POST', body: { action: 'test', ...NO_RESULTS, ids: [1, 2, 3] } })).json();
    assert.deepEqual([out.status, out.to], ['sent', 'dev@localhost']);
    assert.deepEqual(t.sent.map(m => [m.to, m.subject]), [[['dev@localhost'], '[Test] No new eventing results this week']]);
    assert.equal((await (await t.call('/api/admin/email')).json()).log[0].test, true);
  } finally { t.restore(); }
});

test('sends in small batches; a refused batch is recorded per person and the rest still go', async () => {
  const t = setup({ failFor: 'bob@example.ie' });
  try {
    t.env.DB.raw.exec("INSERT INTO subscribers (email, confirmed, token) SELECT 'many' || value || '@example.ie', 1, 'tok-m' || value FROM generate_series(1, 120)");
  } catch {
    const ins = t.env.DB.raw.prepare('INSERT INTO subscribers (email, confirmed, token) VALUES (?, 1, ?)');
    for (let i = 1; i <= 120; i++) ins.run(`many${i}@example.ie`, `tok-m${i}`);
  }
  try {
    const all = Object.entries(t.ids()).filter(([e]) => e !== 'waiting@example.ie').map(([, id]) => id);
    const out = await (await t.call('/api/admin/email', { method: 'POST', body: { action: 'send', ...NO_RESULTS, ids: all } })).json();
    assert.equal(out.recipients, 123);
    assert.ok(t.calls.every(n => n <= 50), 'batches of 50 at most');
    assert.equal(out.status, 'partly');
    assert.ok(out.failed.some(f => f.to === 'bob@example.ie' && /429/.test(f.error)));
    assert.equal(out.sent + out.failed.length, 123);
  } finally { t.restore(); }
});

test('nothing goes when email is not set up, when nobody is ticked, or with no subject', async () => {
  const off = setup({ mail: false });
  try {
    assert.equal((await (await off.call('/api/admin/email', { method: 'POST', body: { action: 'send', ...NO_RESULTS, ids: [1] } })).json()).status, 'not-set-up');
  } finally { off.restore(); }
  const t = setup();
  try {
    assert.equal((await t.call('/api/admin/email', { method: 'POST', body: { action: 'send', ...NO_RESULTS, ids: [] } })).status, 400);
    assert.equal((await t.call('/api/admin/email', { method: 'POST', body: { action: 'send', ...NO_RESULTS, subject: ' ', ids: [1] } })).status, 400);
    assert.equal(t.sent.length, 0);
    // The preview never sends.
    const p = await (await t.call('/api/admin/email', { method: 'POST', body: { action: 'preview', ...NO_RESULTS } })).json();
    assert.ok(p.html.includes('Monarch sale'));
    assert.equal(t.sent.length, 0);
  } finally { t.restore(); }
});

test('message text: escaped, paragraphs on blank lines, only http(s) links', () => {
  const html = messageHtml('Hi <script>x</script>\n\nSee https://www.iber.ie/news. [The sale](https://x.ie/a?b=1&c=2)\nnext line\n\n[bad](javascript:alert(1))');
  assert.equal((html.match(/<p /g) || []).length, 3);
  assert.ok(html.includes('&lt;script&gt;') && !html.includes('<script>'));
  assert.ok(html.includes('<a href="https://www.iber.ie/news"') && html.includes('<a href="https://x.ie/a?b=1&amp;c=2"'));
  assert.ok(html.includes('<br>next line'));
  assert.ok(!html.includes('href="javascript'));
  assert.equal(messageText('[The sale](https://x.ie/a)'), 'The sale (https://x.ie/a)');
});
