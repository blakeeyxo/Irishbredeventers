import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readArticle, collectResults, reviewCsv, weekLabel } from '../lib/hsi.js';

const page = body => `<html><body><article><h1>Irish Breeders win again</h1><time datetime="2026-09-28 10:00:00">28 September 2026</time>
  <div class="entry-content">${body}</div></article><footer>Footer</footer></body></html>`;
const p = s => `<p class="wp-block-paragraph">${s}</p>`;
const line = (pos, name, extra = '') => `<strong>${pos}<sup>${pos === 1 ? 'st' : pos === 2 ? 'nd' : 'th'}</sup> ${name} (ISH)</strong> &#8211; 2015 gelding by Flex A Bill (ISH) out of Rebels Dream (ISH) by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: Jane O&#8217;Hara (IRL) 30.0, 0, 4.0 = 34.0${extra}`;

test('an article becomes one line per paragraph, with tags and entities tidied', () => {
  const a = readArticle(page(p('<strong>See below the up-to-date results</strong>') + p('<strong><u>Tedworth One Day Event (GBR) 10<sup>th</sup> &#8211; 12<sup>th</sup> April 2026</u></strong>') + p(line(1, 'Westwick Rebel'))));
  assert.equal(a.title, 'Irish Breeders win again');
  assert.equal(a.date, '2026-09-28');
  assert.deepEqual(a.lines.slice(0, 2), ['See below the up-to-date results', 'Tedworth One Day Event (GBR) 10th – 12th April 2026']);
  assert.match(a.lines[2], /^1st Westwick Rebel \(ISH\) – 2015 gelding .* Rider: Jane O’Hara \(IRL\)/);
  assert.equal(weekLabel('2026-09-07'), 'Week of 7 September 2026');
});

const article = (date, lines) => ({ url: `https://www.horsesportireland.ie/${date}/`, title: date, date, lines });

test('weeks merge: one event across articles, the latest version wins and confirms, rider kept, raw line kept', () => {
  const week1 = article('2026-06-29', [
    'Alnwick International and One Day Event (GBR) 25th – 28th June 2026',
    'CCI 2* Short Sec E',
    '2nd Cooley Top Boy (ISH) – 2018 gelding by Ramiro B (BWP) out of Bonahmon Three Star (unk). Breeder: Richard Fitzgerald. Rider: Jago Jackson (GBR) 23.1, 4, 0.0 = 27.1',
    'CCI3* – Not verified at time of posting.'
  ]);
  const week2 = article('2026-07-06', [
    'Alnwick International (GBR) 25th – 28th June 2026 Late Verification from Last week.',
    'CCI 3* Short Sec A',
    '3rd Brookfield Future News (ISH)[was Future News] – 2015 gelding by Future Trend (OLD) out of Cashmere Breeze (AEAS) by Last News (TB). Breeder: Hilary Furlonger (Antrim). Rider: Tom McEwen (GBR) 30.1, 0, 0.0 = 30.1',
    'CCI 2* Short Sec E',
    '2nd Cooley Top Boy (ISH) – 2018 gelding by Ramiro B (BWP) out of Bonahmon Three Star (unk). Breeder: Richard Fitzgerald. Rider: Jago Jackson (GBR) 23.1, 4, 0.4 = 27.5'
  ]);
  const { rows, review } = collectResults([week2, week1]);
  assert.equal(new Set(rows.map(r => r.event_name)).size, 1);
  assert.equal(rows[0].event_name, 'Alnwick International and One Day Event');
  const top = rows.find(r => r.horse_name === 'Cooley Top Boy');
  assert.equal(rows.filter(r => r.horse_name === 'Cooley Top Boy').length, 1);
  assert.deepEqual([top.score, top.article_date, top.verified, top.parse_ok], [27.5, '2026-07-06', true, true]);
  assert.ok(top.warnings.includes('Confirmed again in the article of 2026-07-06'));
  assert.deepEqual([top.rider_name, top.rider_country], ['Jago Jackson', 'GBR']);
  assert.match(top.raw_line, /^2nd Cooley Top Boy/);
  assert.equal(review.length, 0);
});

test('lines that fail are kept with parse_ok off; conflicts, country checks and skipped lines are listed', () => {
  const { rows, review } = collectResults([article('2026-07-20', [
    'Upton House One Day Event 14th – 16th July 2026',
    'Novice Sec A',
    '4th Ballytemple Jackson (ISH) – 2018 gelding by Womanizer (KWPN) out of Newmarket Wonder One (ISH) by Harlequin Du Carel (SF). Breeder: Kelly Taylor (USA) 40.2, 0, 12.4 = 52.6',
    '8th Mile Beach (ISH) – 2017 gelding by Beach Ball (ISH) out of Lanmore (SIES). Breeder: G Gault. Rider: Wills Oakden (GBR) 30.0, 0, 4.0 = 34.0',
    '9th Mile Beach (ISH) – 2017 gelding by Beach Ball (ISH) out of Lanmore (SIES). Breeder: G Gault. Rider: Wills Oakden (GBR) 30.8, 0, 4.0 = 34.8',
    'Ireland',
    'Essenar Double Dutch (ISH) – 2011 mare by Luidam (KWPN) out of Touch of Dutch (ISH). Breeder: San Norris. Rider: Anna Radford (IRL)'
  ])]);
  assert.equal(rows.length, 2);
  const failed = rows.find(r => r.horse_name === 'Ballytemple Jackson');
  assert.deepEqual([failed.parse_ok, failed.verified, failed.country], [false, false, 'Great Britain']);
  const mile = rows.find(r => r.horse_name === 'Mile Beach');
  assert.deepEqual([mile.position, mile.verified], [8, false]);
  assert.deepEqual(review.map(r => r.status).sort(), ['check', 'conflict', 'failed', 'skipped']);
  const csv = reviewCsv(review).split('\n');
  assert.equal(csv[0], 'status,article_date,event,class_name,placing,horse,problem,raw_line,article_url');
  assert.match(csv[1], /^failed,2026-07-20,Upton House One Day Event,Novice Sec A,4,Ballytemple Jackson,/);
});

test('results under an event with no class heading take the level from the event name', () => {
  const { rows } = collectResults([article('2026-04-27', [
    'Defender Kentucky CCI 5* Long (USA) 22nd – 26th April 2026',
    '2nd HSH Blake (ISH)[was Galwaybay Blake & Galwaybay HSH Redfield]- 2015 gelding by Tolan R (KWPN) out of Doughiska Lass (ISH) by Kannan (KWPN). Breeder: Justin Burke. Rider: Caroline Pamukcu (USA) 26.6, 0, 2.0 = 28.6'
  ])]);
  assert.deepEqual([rows[0].class_name, rows[0].parse_ok, rows[0].former_name], ['CCI 5* Long', true, 'Galwaybay Blake & Galwaybay HSH Redfield']);
});

test('an event year a season behind the article is read as the article year and flagged', () => {
  const { rows, review } = collectResults([article('2026-08-10', [
    'Fair Hills Horse Trials (USA) 8th – 9th August 2025',
    'Open Novice',
    '1st A Horse (ISH) – 2015 mare by B (KWPN) out of C (ISH). Breeder: E. Rider: F (USA) 30, 0, 0 = 30'
  ])]);
  assert.deepEqual([rows[0].start_date, rows[0].season], ['2026-08-08', 2026]);
  assert.match(review[0].problem, /read as 2026/);
});
