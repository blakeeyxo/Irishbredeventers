/*
 * Reads Charlie's weekly results text (from his Word file) into placings.
 *
 * The file is prose, one sentence per placing, under country, event and class headings:
 *
 *   England
 *   Thoresby International and One Day Event, 3rd – 5th April 2026
 *   CCI 4* Short Sec G
 *   4th Master Smart (was Ballinaclough Satisfied) ISH 2013 gelding by Satisfation 1 (HANN)
 *     out of Kilpatrick Pip (ISH)[TIH] by Master Imp (TB). Breeder: Edmond Crotty.
 *     Tara Dixon (IRL) 38.7, 4, 8.8 = 51.5
 *
 * Rules:
 *  - The rider is never kept. Anything between the breeder and the score is dropped.
 *  - Nothing is guessed. When a part can't be read cleanly the row gets an issue,
 *    and any row with an issue is ticked "Unverified" in the check table.
 *
 * Pure JS with no dependencies, so it runs in Pages Functions and in Node tests.
 */

export const COUNTRIES = [
  'Ireland', 'Northern Ireland', 'England', 'Scotland', 'Wales', 'Great Britain',
  'France', 'Germany', 'Belgium', 'Netherlands', 'Italy', 'Spain', 'Portugal',
  'Poland', 'Sweden', 'Switzerland', 'Austria', 'Denmark', 'Norway', 'Finland',
  'Czech Republic', 'Hungary', 'United States', 'Canada', 'Australia', 'New Zealand',
  'Japan', 'Brazil', 'South Africa', 'Other'
];

const COUNTRY_ALIASES = {
  'usa': 'United States', 'us': 'United States', 'u.s.a.': 'United States',
  'united states of america': 'United States', 'america': 'United States',
  'holland': 'Netherlands', 'the netherlands': 'Netherlands',
  'republic of ireland': 'Ireland', 'gb': 'Great Britain', 'nz': 'New Zealand'
};

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const MONTH_WORD = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const DAY = '\\d{1,2}(?:st|nd|rd|th)?';
// "3rd – 5th April 2026", "30th March – 2nd April 2026", "12 September", "3-5 April 2026"
const DATE_RE = new RegExp(`\\b${DAY}\\s*(?:${MONTH_WORD}\\.?\\s*)?(?:[–—-]|to)?\\s*(?:${DAY}\\s*)?${MONTH_WORD}\\b\\.?(?:,?\\s+(?:19|20)\\d\\d)?`, 'i');

const SEXES = 'gelding|mare|stallion|colt|filly|horse';
const HEADER_RE = new RegExp(`^(.+?)\\s+\\(?([A-Za-z]{2,6})\\)?\\s+((?:19|20)\\d\\d)\\s+(${SEXES})\\b\\.?`, 'i');
const ORDINAL_ENTRY_RE = /^=?\s*(\d{1,3})\s*(?:st|nd|rd|th)\b\s*=?\s*[.):–-]?\s*(.+)$/i;
const NUMBER_ENTRY_RE = /^=?\s*(\d{1,3})\s*=?\s*[.)]\s+(.+)$/;
const BREEDER_LABEL_RE = /[.,;]?\s*\bBre{1,2}d(?:e|er)?r\b\s*[:\-–]?\s*/i; // Breeder, Breder, Bredeer
const SCORE_RE = /(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)/g;
const FINAL_ONLY_RE = /(?:^|\s)[\d.,+\s]*=\s*(\d+(?:\.\d+)?)/g;
const PROSE_LENGTH = 110;

const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const stripEndDot = s => clean(s).replace(/[.,;:\s]+$/, '');
const cap = w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w);

export function matchCountry(line) {
  const key = clean(line).replace(/^country\s*:\s*/i, '').replace(/[:.\s]+$/, '').toLowerCase();
  if (!key || key.length > 30) return null;
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return COUNTRIES.find(c => c.toLowerCase() === key) || null;
}

/** "Thoresby International, 3rd – 5th April 2026" → name, date text, ISO start date, season */
export function parseEventLine(line, defaultYear) {
  const m = line.match(DATE_RE);
  if (!m) return null;
  let name = line.slice(0, m.index).replace(/[\s,–—\-:(]+$/, '').trim();
  let rest = line.slice(m.index + m[0].length);
  let dateText = m[0].trim();
  const yearHere = rest.match(/^\s*,?\s*((?:19|20)\d\d)\b/);
  if (yearHere) { dateText += ' ' + yearHere[1]; rest = rest.slice(yearHere[0].length); }
  if (!name) name = rest.replace(/^[\s,–—\-:)]+/, '').trim();
  if (!name) return null;

  const first = dateText.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:${MONTH_WORD})?`, 'i'));
  const monthWord = dateText.match(new RegExp(MONTH_WORD, 'i'));
  const year = Number((dateText.match(/(?:19|20)\d\d/) || [])[0]) || defaultYear;
  const month = MONTHS[(first[2] || monthWord[1]).toLowerCase()];
  const day = Number(first[1]);
  const startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { name: name.replace(/\)$/, '').trim(), dateText: dateText.replace(/\s+/g, ' '), startDate, season: year };
}

/** Split "Edmond Crotty. Tara Dixon (IRL)" into the breeder, dropping the rider. */
function splitBreeder(post, issues) {
  const text = clean(post).replace(/\.$/, '');
  if (!text) { issues.push('Breeder not found'); return ''; }
  // First full stop after a word of two or more letters ends the breeder.
  // Initials ("J. P. Finlay", "G.H.S") do not count as the end.
  const stop = text.match(/^(.*?[^\s.]{2,}\)?)\.\s+(.*)$/);
  if (stop) return stripEndDot(stop[1]);
  // No full stop. If a rider with nationality follows, we cannot tell where the breeder ends.
  if (/\([A-Z]{3}\)/.test(text)) {
    issues.push('Could not tell the breeder from the rider (add a full stop after the breeder)');
    return '';
  }
  return stripEndDot(text);
}

/** One placing sentence (without its position) → row fields plus issues. */
export function parseEntry(position, rest, ctx) {
  const issues = [];
  const warnings = [];
  const row = {
    position,
    horse_name: '', former_name: '', breed: '', foaled: null, sex: '',
    sire: '', dam: '', dam_sire: '', breeder: '',
    dressage: '', show_jumping: '', cross_country: '', score: null,
    country: ctx.country || '', event_name: ctx.event ? ctx.event.name : '',
    event_date_text: ctx.event ? ctx.event.dateText : '',
    start_date: ctx.event ? ctx.event.startDate : '',
    season: ctx.event ? ctx.event.season : ctx.defaultYear,
    class_name: ctx.cls || ''
  };
  let body = clean(rest);

  // Score: the last "d, sj, xc = total" in the sentence. Everything after it is dropped.
  const scores = [...body.matchAll(SCORE_RE)];
  if (scores.length) {
    const s = scores[scores.length - 1];
    row.dressage = s[1]; row.show_jumping = s[2]; row.cross_country = s[3]; row.score = parseFloat(s[4]);
    body = body.slice(0, s.index);
  } else {
    const finals = [...body.matchAll(FINAL_ONLY_RE)];
    if (finals.length) {
      const f = finals[finals.length - 1];
      row.score = parseFloat(f[1]);
      body = body.slice(0, f.index);
      warnings.push('Only the final score was read');
    } else {
      issues.push('Score not found');
    }
  }

  // Header: name (and former name), breed, year foaled, sex
  let afterHeader = body;
  const h = body.match(HEADER_RE);
  if (h) {
    let name = h[1];
    const f = name.match(/\s*\(\s*(?:was|ex|formerly|previously|fka)\s+([^)]+?)\s*\)\s*$/i);
    if (f) { row.former_name = clean(f[1]); name = name.slice(0, f.index); }
    row.horse_name = stripEndDot(name);
    row.breed = h[2];
    row.foaled = Number(h[3]);
    row.sex = cap(h[4]);
    afterHeader = body.slice(h[0].length);
  } else {
    const n = body.match(/^(.+?)(?=\s+by\s)/i);
    row.horse_name = n ? stripEndDot(n[1]) : '';
    if (n) afterHeader = body.slice(n[0].length);
    issues.push('Breed, year or sex not found');
  }
  if (!row.horse_name) issues.push('Horse name not found');

  // Breeding and breeder
  const label = afterHeader.match(BREEDER_LABEL_RE);
  const pre = label ? afterHeader.slice(0, label.index) : afterHeader;
  const post = label ? afterHeader.slice(label.index + label[0].length) : '';

  const sire = pre.match(/^\s*by\s+(.+?)\s+out of\s+/i);
  if (sire) row.sire = stripEndDot(sire[1]);
  else issues.push('Sire not found');

  // The dam starts after the sire's "out of" (a sire can be called "Out of Touch").
  const outOf = sire ? [null, pre.slice(sire[0].length)] : pre.match(/\bout of\s+(.+)$/i);
  if (outOf) {
    let tail = outOf[1];
    if (/\bout of\b/i.test(tail)) issues.push('"out of" appears twice');
    // Without a breeder label the sentence may run on into the rider: stop at the first full stop.
    if (!label) tail = tail.split(/\.\s+/)[0];
    const by = tail.match(/^(.+?)\s+by\s+(.+)$/i);
    if (by) { row.dam = stripEndDot(by[1]); row.dam_sire = stripEndDot(by[2]); }
    else { row.dam = stripEndDot(tail); warnings.push('No dam sire given'); }
    if (!row.dam) issues.push('Dam not found');
  } else {
    issues.push('Dam not found');
  }

  if (label) row.breeder = splitBreeder(post, issues);
  else issues.push('Breeder not found');

  if (!ctx.event) issues.push('No event heading above it');
  if (!ctx.cls) issues.push('No class heading above it');
  if (!row.country) issues.push('No country');

  row.issues = issues;
  row.warnings = warnings;
  row.verified = issues.length === 0 && !ctx.unverifiedSection;
  if (ctx.unverifiedSection) warnings.push('Listed under "Unverified" in the file');
  return row;
}

function entryMatch(line) {
  const m = line.match(ORDINAL_ENTRY_RE) || line.match(NUMBER_ENTRY_RE);
  return m ? { position: Number(m[1]), rest: m[2] } : null;
}
const looksLikeBreeding = s => /\bby\b/i.test(s) && /(\bout of\b|bre{1,2}d)/i.test(s);

/**
 * Whole file → { rows, notes, events, classes }.
 * `notes` lists the lines that were not used, so Charlie can see nothing went missing silently.
 */
export function parseResults(text, opts = {}) {
  const defaultYear = opts.defaultYear || new Date().getFullYear();
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const ctx = { country: opts.defaultCountry || '', event: null, cls: '', defaultYear, unverifiedSection: false };
  const rows = [];
  const notes = [];
  const events = new Set();
  const classes = new Set();

  for (const line of lines) {
    const entry = entryMatch(line);
    if (entry && looksLikeBreeding(entry.rest)) { rows.push(parseEntry(entry.position, entry.rest, ctx)); continue; }

    if (/^unverified(\s+results)?\s*:?$/i.test(line)) { ctx.unverifiedSection = true; continue; }

    const country = matchCountry(line);
    if (country) { ctx.country = country; ctx.event = null; ctx.cls = ''; continue; }

    if (line.length <= 160) {
      const ev = parseEventLine(line, defaultYear);
      if (ev) { ctx.event = ev; ctx.cls = ''; events.add(`${ctx.country}|${ev.name}`); continue; }
    }

    // A position with no breeding: still a placing, flagged for checking.
    if (entry && entry.rest.length < PROSE_LENGTH) { rows.push(parseEntry(entry.position, entry.rest, ctx)); continue; }

    if (line.length > PROSE_LENGTH) { notes.push(line); continue; }

    ctx.cls = line.replace(/:$/, '');
    if (ctx.event) classes.add(`${ctx.event.name}|${ctx.cls}`);
  }

  return { rows, notes, events: events.size, classes: classes.size };
}
