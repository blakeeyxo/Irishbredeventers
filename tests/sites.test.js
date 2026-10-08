import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { SITES, siteFor, clientConfig } from '../lib/sites.js';
import { transformFile, applyHtml, applyCss } from '../lib/build-site.js';
import { confirmEmail, resultsEmail } from '../lib/mail.js';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const walk = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(PUBLIC).map(p => ({ rel: relative(PUBLIC, p).split(sep).join('/'), buf: readFileSync(p) }));
const build = site => Object.fromEntries(files.map(f => [f.rel, transformFile(f.rel, f.buf, site, clientConfig(site))]));
const asText = v => Buffer.isBuffer(v) ? v.toString('utf8') : v;

test('IBER built from sites/iber.js is byte for byte the site in public/', () => {
  const out = build(SITES.iber);
  for (const f of files) assert.equal(asText(out[f.rel]), f.buf.toString('utf8'), `${f.rel} differs from its config`);
});

test('IBSR has its own name, look and wording, with no eventing branding left', () => {
  const out = build(SITES.ibsr);
  const pages = ['index.html', 'admin/index.html', 'js/site.js'];
  for (const p of pages) {
    assert.doesNotMatch(out[p], /IrishBredEventingResults \(IBER\)|IrishBred<wbr><span>Eventing|>IBER</, p);
    assert.match(out[p], /IrishBredShowjumpingResults|IBSR/, p);
  }
  assert.doesNotMatch(out['index.html'], /eventing result|Thoresby|cross-country fence/i);
  // Same green as IBER: identical stylesheet, favicon and browser colour.
  const iber = build(SITES.iber);
  assert.equal(out['css/site.css'], asText(iber['css/site.css']));
  assert.equal(out['img/favicon.svg'], iber['img/favicon.svg']);
  assert.match(out['index.html'], /<meta name="theme-color" data-site-attr="content=themeColor" content="#0F6741">/);
});

test('every site config has the same text keys and theme tokens as IBER', () => {
  const keys = o => Object.keys(o).sort();
  for (const site of Object.values(SITES)) {
    assert.deepEqual(keys(site.text), keys(SITES.iber.text), `${site.id} text`);
    assert.deepEqual(keys(site.theme), keys(SITES.iber.theme), `${site.id} theme`);
    assert.deepEqual(keys(site.mail), keys(SITES.iber.mail), `${site.id} mail`);
  }
});

test('siteFor picks the site from SITE_ID and defaults to IBER', () => {
  assert.equal(siteFor({}).id, 'iber');
  assert.equal(siteFor({ SITE_ID: 'ibsr' }).id, 'ibsr');
  assert.throws(() => siteFor({ SITE_ID: 'dressage' }), /Unknown SITE_ID/);
});

test('markers: inner HTML, attributes (escaped), nested tags, and clear errors', () => {
  const site = { id: 't', name: 'N', text: { a: 'x<b>y</b>', q: 'say "hi" & go' } };
  assert.equal(applyHtml('<p data-site="a">old</p>', site), '<p data-site="a">x<b>y</b></p>');
  assert.equal(applyHtml('<i data-site-attr="title=q" title="old">k</i>', site), '<i data-site-attr="title=q" title="say &quot;hi&quot; &amp; go">k</i>');
  assert.equal(applyHtml('<span data-site="a">A<span>B</span>C</span>!', site), '<span data-site="a">x<b>y</b></span>!');
  assert.equal(applyHtml('<b data-site-attr="title=name" title="">x</b>', site), '<b data-site-attr="title=name" title="N">x</b>');
  assert.throws(() => applyHtml('<p data-site="missing">x</p>', site), /no text\.missing/);
  assert.throws(() => applyHtml('<p data-site="a">x', site), /never closed/);
});

test('CSS: theme must cover every colour token, and only colour tokens change', () => {
  const css = ':root {\n  --navy: #000; /* note */\n  --page: 1320px;\n  --x-rgb: 1, 2, 3;\n}\n.a { color: var(--navy); }';
  assert.equal(applyCss(css, { '--navy': '#111', '--x-rgb': '4, 5, 6' }),
    ':root {\n  --navy: #111; /* note */\n  --page: 1320px;\n  --x-rgb: 4, 5, 6;\n}\n.a { color: var(--navy); }');
  assert.throws(() => applyCss(css, { '--navy': '#111' }), /--x-rgb is not in the site theme/);
  assert.throws(() => applyCss(css, { '--navy': '#111', '--x-rgb': '1', '--new': '#fff' }), /not in :root: --new/);
});

test('emails carry each site\'s name, subject and colours', () => {
  const iber = confirmEmail(SITES.iber, 'a@b.ie', 'https://x/confirm');
  assert.equal(iber.subject, 'Confirm your IrishBredEventingResults emails');
  assert.match(iber.html, /border-top:4px solid #B01029;/);
  assert.match(iber.html, />IrishBredEventingResults</);
  const ibsr = resultsEmail(SITES.ibsr, 'a@b.ie', 'https://x/results', 'https://x/u', '3 new results');
  assert.equal(ibsr.subject, 'New Irish-bred showjumping results are up');
  assert.match(ibsr.html, />IrishBredShowjumpingResults</);
  assert.match(ibsr.html, /background:#0F6741;/);
  assert.doesNotMatch(ibsr.html, /Eventing/);
});
