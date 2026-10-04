/*
 * Reads one of Charlie's weekly Irish-Bred Results articles on horsesportireland.ie into plain text
 * lines (one per paragraph), ready for parseResults().
 *
 * Pure JS (parser and name helpers only), so it runs in Node scripts and tests.
 */
import { parseResults } from './parser.js';
import { normaliseName } from './names.js';

const ENTITIES = {
  amp: '&', quot: '"', apos: "'", nbsp: ' ', lt: '<', gt: '>', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú'
};

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** "<strong>4<sup>th</sup> </strong><strong>Master Smart</strong>" → "4th Master Smart" */
export function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}

/**
 * Article HTML → { title, date, lines }.
 * lines: the text of every paragraph, heading and list item in the article body, in order.
 */
export function readArticle(html) {
  const s = String(html || '');
  const title = htmlToText((s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || ['', ''])[1]);
  const date = (s.match(/<time datetime="(\d{4}-\d{2}-\d{2})/) || s.match(/"datePublished":"(\d{4}-\d{2}-\d{2})/) || ['', ''])[1];
  const start = s.indexOf('entry-content');
  let body = start >= 0 ? s.slice(s.indexOf('>', start) + 1) : s;
  const end = body.search(/<\/article>|<footer\b|class="(?:sharedaddy|post-navigation|entry-footer)/);
  if (end >= 0) body = body.slice(0, end);
  const lines = [];
  for (const m of body.matchAll(/<(p|h[1-6]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    for (const line of htmlToText(m[2]).split('\n')) if (line) lines.push(line);
  }
  return { title, date, lines };
}

/* ---------- Turning a season of articles into one set of results ---------- */

const LEVEL_RE = /\bCCI[A-Z]*\s*\d\*?(?:[\s-]*(?:Short|Long|Intro|S|L))?/i;
const NOT_VERIFIED_RE = /\s*[-–—,.(]*\s*\b(?:not verified|unverified|yet to be verified)\b.*$/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const weekLabel = iso => `Week of ${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// Venues whose headings carry no country code and whose wording would mislead (Caber Farm Horse Trials
// is in Ontario, Canada, not the United States).
const KNOWN_VENUES = { 'caber farm': 'Canada' };
const knownVenue = name => Object.entries(KNOWN_VENUES).find(([v]) => normaliseName(name).startsWith(v))?.[1] || '';

// An event heading with no country code: wording that only one side of the Atlantic uses.
function countryFromWording(name) {
  if (/\bone day event\b/i.test(name)) return 'Great Britain';
  if (/\bhorse trials\b/i.test(name)) return 'United States';
  return '';
}
const firstWord = name => normaliseName(name).replace(/^the /, '').split(' ')[0] || '';
const overlaps = (a, b) => a.startDate <= (b.endDate || b.startDate) && b.startDate <= (a.endDate || a.startDate);

/**
 * articles: [{ url, title, date, lines }] in any order.
 * Returns { rows, review, articles } where rows are ready for importResults (one per result, the latest
 * version), grouped by the article each came from, and review lists every line that needs a person:
 *   failed    the line could not be read cleanly (saved with parse_ok = 0, shown as unverified)
 *   conflict  the same horse is listed twice in one class of one article (the first is kept, unverified)
 *   check     read, but something was filled in that the article didn't say (a country)
 *   skipped   a horse line with no placing (e.g. team lists), not saved
 */
export function collectResults(articles) {
  const ordered = [...articles].sort((a, b) => a.date.localeCompare(b.date) || a.url.localeCompare(b.url));
  const parsed = ordered.map(a => ({ article: a, out: parseResults(a.lines.join('\n'), { defaultYear: Number(a.date.slice(0, 4)), refDate: a.date }) }));

  // 1. One record per event across all weeks: same country, overlapping dates and the same first word
  //    ("Alnwick International and One Day Event" and "Alnwick International", 25th – 28th June).
  const events = [];
  const coded = new Map(); // normalised name → country, from headings that did give a code
  for (const { out } of parsed) for (const r of out.rows) if (r.event_name && r.country) coded.set(normaliseName(r.event_name), r.country);
  function eventFor(r) {
    const ev = { name: r.event_name, dateText: r.event_date_text, startDate: r.start_date, endDate: r.end_date, country: r.country, season: r.season };
    let found = events.find(e => e.country === ev.country && overlaps(e, ev) && firstWord(e.name) === firstWord(ev.name));
    if (!found) { found = { ...ev, key: events.length }; events.push(found); return found; }
    if (ev.name.length > found.name.length) found.name = ev.name;
    if (ev.startDate < found.startDate || (ev.endDate || ev.startDate) > (found.endDate || found.startDate)) {
      const start = ev.startDate < found.startDate ? ev : found;
      const end = (ev.endDate || ev.startDate) > (found.endDate || found.startDate) ? ev : found;
      found.dateText = start === end ? start.dateText : `${start.dateText.replace(/\s*[–—-].*$/, '').replace(/\s+\d{4}$/, '')} – ${(end.dateText.split(/\s*[–—-]\s*/).pop())}`;
      found.startDate = start.startDate;
      found.endDate = end.endDate || end.startDate;
    }
    return found;
  }

  const review = [];
  const latest = new Map(); // event key | class | horse → row
  const note = (status, row, a, problem) => review.push({
    status, article_date: a.date, article_url: a.url, event: row.event_name || '', class_name: row.class_name || '',
    placing: row.position ?? '', horse: row.horse_name || '', problem, raw_line: row.line || row.raw || ''
  });

  // Event dates against the article date. A year that puts the event in last year's season, when the same
  // day this year falls in the weeks just before the article, is a typo ("8th – 9th August 2025" in an
  // August 2026 article): read with the article's year and flagged. Events after the article are flagged.
  const flaggedDates = new Set();
  function checkDates(r, a) {
    if (!r.start_date || r.event_name.startsWith('Event heading missing')) return;
    const day = iso => Date.parse(`${iso}T00:00:00Z`) / 864e5;
    const articleDay = day(a.date), year = a.date.slice(0, 4);
    const flag = problem => {
      const k = `${a.date}|${r.event_name}`;
      if (!flaggedDates.has(k)) { flaggedDates.add(k); note('check', r, a, problem); }
    };
    if (r.season < Number(year)) {
      const moved = year + r.start_date.slice(4);
      if (articleDay - day(moved) >= 0 && articleDay - day(moved) <= 45) {
        const old = r.event_date_text;
        r.start_date = moved;
        if (r.end_date) r.end_date = year + r.end_date.slice(4);
        r.event_date_text = r.event_date_text.replace(/\b(19|20)\d\d\b/, year);
        r.season = Number(year);
        r.warnings.push(`Year in the article (${old}) read as ${year}`);
        flag(`Event dated "${old}" in the article of ${a.date}; read as ${year}. Please confirm.`);
      }
    } else if (day(r.start_date) > articleDay) {
      flag(`Event dated ${r.event_date_text}, after the article of ${a.date}. Please check the dates.`);
    }
  }

  for (const { article: a, out } of parsed) {
    const seenHere = new Map();
    for (const r of out.rows) {
      r.article_url = a.url;
      r.article_date = a.date;
      r.raw_line = r.line;
      const issues = r.issues;
      const drop = text => { const i = issues.indexOf(text); if (i >= 0) issues.splice(i, 1); return i >= 0; };

      if (drop('No event heading above it')) {
        issues.push('No event heading above it');
        r.event_name = `Event heading missing (HSI article ${Number(a.date.slice(8, 10))} ${MONTHS[Number(a.date.slice(5, 7)) - 1]} ${a.date.slice(0, 4)})`;
        r.event_date_text = ''; r.start_date = a.date; r.end_date = ''; r.season = Number(a.date.slice(0, 4));
        drop('No country for the event');
        r.country = 'Other';
      }
      if (drop('No country for the event')) {
        r.country = knownVenue(r.event_name);
        if (r.country) {
          r.warnings.push(`No country code in the article; ${r.country} (known venue)`);
        } else if ((r.country = coded.get(normaliseName(r.event_name)) || countryFromWording(r.event_name))) {
          r.warnings.push(`No country code in the article; taken as ${r.country}`);
          if (!review.some(x => x.status === 'check' && x.event === r.event_name && x.article_date === a.date)) {
            note('check', r, a, `Event heading has no country code; taken as ${r.country}. Please confirm.`);
          }
        } else {
          issues.push('No country for the event');
          r.country = 'Other';
        }
      }
      if (drop('No class heading above it')) {
        r.class_name = (r.event_name.match(LEVEL_RE) || [r.event_name])[0].trim();
        r.warnings.push('No class heading; the event is the class');
      }
      // A stray ordinal left in front of a class heading: "ThOpen Modified".
      const stray = r.class_name.match(/^(?:st|nd|rd|th|St|Nd|Rd|Th)(?=[A-Z][a-z])/);
      if (stray) { r.class_name = r.class_name.slice(stray[0].length); r.warnings.push(`Class heading began with a stray "${stray[0]}"`); }
      const noMonth = r.warnings.find(w => w.startsWith('No month in the event heading'));
      if (noMonth && !review.some(x => x.status === 'check' && x.event === r.event_name && x.article_date === a.date)) {
        note('check', r, a, `${noMonth}. Please confirm.`);
      }
      checkDates(r, a);
      let flagged = false;
      if (NOT_VERIFIED_RE.test(r.class_name)) {
        r.class_name = r.class_name.replace(NOT_VERIFIED_RE, '').trim() || r.class_name;
        flagged = true;
        r.warnings.push('Marked not verified in the article');
      }

      const ev = eventFor(r);
      r.event = ev;
      r.parse_ok = issues.length === 0;
      r.verified = r.parse_ok && !flagged;
      if (!r.parse_ok) note('failed', r, a, issues.join('; '));

      const key = `${ev.key}|${normaliseName(r.class_name)}|${normaliseName(r.horse_name) || normaliseName(r.raw_line)}`;
      if (seenHere.has(key)) {
        const first = seenHere.get(key);
        first.verified = false;
        note('conflict', r, a, `Listed twice in this class (${first.position} and ${r.position}); kept ${first.position}, shown as unverified`);
        continue;
      }
      seenHere.set(key, r);
      const earlier = latest.get(key);
      // A later article repeating a result confirms it; the later version's details win.
      if (earlier && r.parse_ok && !flagged) r.warnings.push(`Confirmed again in the article of ${a.date}`);
      latest.set(key, r);
    }
    for (const line of out.notes) {
      if (/\b(?:19|20)\d\d\b/.test(line) && /\b(?:by|OIO)\b/.test(line) && /\bRider\b/i.test(line)) {
        note('skipped', { line }, a, 'A horse line with no placing (for example a team list); not saved');
      }
    }
  }

  // 2. Every row takes its event's merged name and dates, so all weeks file under one event.
  const rows = [...latest.values()];
  for (const r of rows) {
    const ev = r.event;
    Object.assign(r, { event_name: ev.name, event_date_text: ev.dateText, start_date: ev.startDate, end_date: ev.endDate, country: ev.country, season: ev.season });
    delete r.event;
  }
  return {
    rows,
    review,
    articles: ordered.map(a => ({ url: a.url, title: a.title, date: a.date, week: weekLabel(a.date), rows: rows.filter(r => r.article_url === a.url).length }))
  };
}

const CSV_COLUMNS = ['status', 'article_date', 'event', 'class_name', 'placing', 'horse', 'problem', 'raw_line', 'article_url'];
const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
export function reviewCsv(review) {
  const order = { failed: 0, conflict: 1, check: 2, skipped: 3, outside: 4 };
  const sorted = [...review].sort((a, b) => order[a.status] - order[b.status] || b.article_date.localeCompare(a.article_date));
  return [CSV_COLUMNS.join(','), ...sorted.map(r => CSV_COLUMNS.map(c => csvCell(r[c] ?? '')).join(','))].join('\n') + '\n';
}
