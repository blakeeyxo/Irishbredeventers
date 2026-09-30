/*
 * Reads Charlie's weekly results text (pasted, or from his Word file) into placings.
 *
 * Three line styles are understood:
 *
 *  1. Current (2026):
 *     1st Westwick Rebel [ISH] - 2014 gelding by Flex A Bill (ISH)[TIH] out of Rebels Dream [ISH]
 *       by Rich Rebel (TB). Breeder: John Brady (Wicklow). Rider: Madeline Hartsock (USA) 39.8, 0, 4.0 = 43.8.
 *     Tags: (ISH) or [ISH], [TIH], [was Old Name]. "sire unknown" instead of "by …".
 *
 *  2. Archive (2010):
 *     1 Watervalley Lockey Guy ('04 g Loughehoe Guy (ISH) - Cornamagh (ISH) (Diamond Lad (RID)).
 *       Bd Sean Thomas Lydon. Rd Virginia Wells) 34.0, 0, 0.4 = 34.4
 *
 *  3. Older mockup style: 4th Master Smart (was X) ISH 2013 gelding by … Breeder: … Rider Name (IRL) 38.7, 4, 8.8 = 51.5
 *
 * Headings: a country on its own line ("England."), an event line with dates
 * ("Oxstalls One Day Event (GBR) 4th – 5th April 2026"), then class lines ("Novice Sec A.").
 *
 * Nothing is guessed. A part that can't be read cleanly becomes an issue on the row, and a row
 * with an issue is ticked "Unverified" in the check table. Smaller gaps (no dam sire, no scores,
 * no county) are warnings and don't block the row.
 *
 * Pure JS with no dependencies beyond names.js, so it runs in the Worker, in Node tests and in the browser.
 */
import { splitTagged, splitBreeder, COUNTRY_CODES, BREED_CODES } from './names.js';

export const COUNTRIES = [
  'Ireland', 'Northern Ireland', 'England', 'Scotland', 'Wales', 'Great Britain',
  'France', 'Germany', 'Belgium', 'Netherlands', 'Italy', 'Spain', 'Portugal',
  'Poland', 'Sweden', 'Switzerland', 'Austria', 'Denmark', 'Norway', 'Finland',
  'Czech Republic', 'Hungary', 'United States', 'Canada', 'Australia', 'New Zealand',
  'Japan', 'Brazil', 'South Africa', 'Thailand', 'China', 'United Arab Emirates', 'Other'
];

const COUNTRY_ALIASES = {
  'usa': 'United States', 'us': 'United States', 'u.s.a': 'United States', 'u.s.a.': 'United States',
  'united states of america': 'United States', 'america': 'United States',
  'holland': 'Netherlands', 'the netherlands': 'Netherlands', 'uk': 'Great Britain',
  'republic of ireland': 'Ireland', 'gb': 'Great Britain', 'nz': 'New Zealand', 'tailand': 'Thailand'
};

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};
const MONTH_WORD = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const DAY = '\\d{1,2}(?:st|nd|rd|th)?';
// "3rd – 5th April 2026", "30th March – 2nd April 2026", "31 July – 1 August", "2-3 August"
const DATE_RE = new RegExp(`\\b${DAY}\\s*(?:${MONTH_WORD}\\.?\\s*)?(?:(?:[–—-]|to)\\s*${DAY}\\s*)?${MONTH_WORD}\\b\\.?(?:,?\\s*(?:19|20)\\d\\d)?`, 'i');

const SEX = { g: 'Gelding', gelding: 'Gelding', m: 'Mare', mare: 'Mare', s: 'Stallion', stallion: 'Stallion', c: 'Colt', colt: 'Colt', f: 'Filly', filly: 'Filly', h: 'Horse', horse: 'Horse' };
const SEXES = 'gelding|mare|stallion|colt|filly|horse';
const SCORE_RE = /(\d+(?:\.\d*)?)\s*,\s*(\d+(?:\.\d*)?)\s*,\s*(\d+(?:\.\d*)?)\s*=\s*(\d+(?:\.\d+)?)/g; // \"32.\" is read as 32

const clean = s => String(s || '').replace(/[ \s]+/g, ' ').trim();
const endTrim = s => clean(s).replace(/[.,;:\s]+$/, '');

export function matchCountry(line) {
  const key = clean(line).replace(/^country\s*:\s*/i, '').replace(/[:.\s]+$/, '').toLowerCase();
  if (!key || key.length > 30) return null;
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return COUNTRIES.find(c => c.toLowerCase() === key) || null;
}

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "Thoresby International (GBR) 3rd – 5th April 2026" → name, country, dates, season */
export function parseEventLine(line, defaultYear) {
  const m = line.match(DATE_RE);
  if (!m) return null;
  let name = line.slice(0, m.index);
  let rest = line.slice(m.index + m[0].length);
  let dateText = m[0].trim().replace(/\.$/, '');
  const yearHere = rest.match(/^\s*,?\s*((?:19|20)\d\d)\b/);
  if (yearHere) { dateText += ' ' + yearHere[1]; rest = rest.slice(yearHere[0].length); }

  // Country code in brackets before the dates, closed or not: "(GBR)" or "(GBR"
  let country = '';
  const cc = name.match(/\(\s*([A-Z]{3})\s*\)?\s*$/);
  if (cc && COUNTRY_CODES[cc[1]]) { country = COUNTRY_CODES[cc[1]]; name = name.slice(0, cc.index); }
  name = name.replace(/[\s,.–—\-:(]+$/, '').trim();
  if (!name) name = rest.replace(/^[\s,.–—\-:)]+/, '').replace(/[.\s]+$/, '').trim();
  if (!name) return null;

  const parts = [...dateText.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?\\s*(${MONTH_WORD})?`, 'gi'))];
  const lastMonth = MONTHS[(dateText.match(new RegExp(`${MONTH_WORD}(?!.*${MONTH_WORD})`, 'i')) || [''])[0].toLowerCase()];
  const years = dateText.match(/(?:19|20)\d\d/g);
  const year = years ? Number(years[years.length - 1]) : defaultYear;
  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  const startMonth = first[2] ? MONTHS[first[2].toLowerCase()] : lastMonth;
  const endMonth = last && last[2] ? MONTHS[last[2].toLowerCase()] : lastMonth;
  const startYear = startMonth > endMonth ? year - 1 : year; // "30th December – 2nd January 2026"
  return {
    name,
    country,
    dateText: dateText.replace(/\s+/g, ' '),
    startDate: isoDate(startYear, startMonth, Number(first[1])),
    endDate: last ? isoDate(year, endMonth, Number(last[1])) : '',
    season: year
  };
}

/** Title line such as "6.4.26 International Eventing Results." → { label, year }. */
export function parseTitle(line) {
  const m = clean(line).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\b/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { label: `Week of ${Number(m[1])} ${names[month - 1]} ${year}`, year };
}

function emptyRow(position, ctx) {
  return {
    position,
    horse_name: '', former_name: '', breed: '', tih_flag: false, foaled: null, sex: '',
    sire: '', sire_breed: '', sire_tih: false,
    dam: '', dam_breed: '', dam_tih: false,
    dam_sire: '', dam_sire_breed: '', dam_sire_tih: false,
    breeder: '', breeder_county: '',
    rider_name: '', rider_country: '',
    dressage: '', show_jumping: '', cross_country: '', score: null,
    country: ctx.event && ctx.event.country ? ctx.event.country : (ctx.country || ''),
    event_name: ctx.event ? ctx.event.name : '',
    event_date_text: ctx.event ? ctx.event.dateText : '',
    start_date: ctx.event ? ctx.event.startDate : '',
    end_date: ctx.event ? ctx.event.endDate : '',
    season: ctx.event ? ctx.event.season : ctx.defaultYear,
    class_name: ctx.cls || '',
    raw: ''
  };
}

function takeScores(body, row, warnings) {
  const all = [...body.matchAll(SCORE_RE)];
  if (!all.length) { warnings.push('No scores given'); return body; }
  const s = all[all.length - 1];
  const tidy = v => v.replace(/\.$/, '');
  row.dressage = tidy(s[1]); row.show_jumping = tidy(s[2]); row.cross_country = tidy(s[3]); row.score = parseFloat(s[4]);
  return body.slice(0, s.index);
}

function setPerson(row, prefix, part) {
  const t = splitTagged(part);
  row[prefix] = t.name;
  row[`${prefix}_breed`] = t.breed_code;
  row[`${prefix}_tih`] = t.tih;
}

/** "Flex A Bill (ISH)[TIH] out of Rebels Dream [ISH] by Rich Rebel (TB)" → sire, dam, dam sire */
function readBreeding(text, row, issues, warnings) {
  let t = clean(text).replace(/^[-–,.\s]+/, '');
  let sirePart = '';
  let damPart = '';
  const unknownSire = t.match(/^(?:by\s+)?(?:sire\s+)?(?:unknown|not recorded)(?:\s+sire)?\s*(?=out of\b)/i);
  if (unknownSire) {
    damPart = t.slice(unknownSire[0].length).replace(/^out of\s*/i, '');
    warnings.push('Sire unknown');
  } else {
    // "by X out of Y": X is everything up to the "out of" that follows (a sire can be called "Out of Touch").
    const m = t.match(/^by\s+(.+?)\s*\bout of\s+(.+)$/i);
    if (m) { sirePart = m[1]; damPart = m[2]; } else {
      const onlySire = t.match(/^by\s+(.+)$/i);
      if (onlySire) sirePart = onlySire[1];
      issues.push(onlySire ? 'Dam not found' : 'Breeding not found');
    }
  }
  if (sirePart) setPerson(row, 'sire', sirePart);
  if (!damPart) return;
  if (/\bout of\b/i.test(damPart)) issues.push('"out of" appears twice');

  // Dam then " by " dam sire. Prefer a " by " that follows a closing tag, as in "Dream [ISH] by Rich Rebel".
  const bys = [...damPart.matchAll(/\s+by\s+/gi)];
  const afterTag = bys.find(b => /[\])]\s*$/.test(damPart.slice(0, b.index + 1)));
  const by = afterTag || bys[0];
  if (by) {
    setPerson(row, 'dam', damPart.slice(0, by.index));
    setPerson(row, 'dam_sire', damPart.slice(by.index + by[0].length));
  } else {
    setPerson(row, 'dam', damPart);
    warnings.push('No dam sire given');
  }
  if (!row.dam) issues.push('Dam not found');
}

/** Current style and older mockup style. `rest` is the line without its position. */
function parseModern(rest, row, ctx, issues, warnings) {
  let body = takeScores(rest, row, warnings);

  // Rider: "Rider: Name (NAT)" (current), or an unlabelled "Name (NAT)" after the breeder (older style)
  const riderLabel = body.match(/[.,;]?\s*\bRider\s*:\s*(.+?)\s*(?:\(\s*([A-Z]{3})\s*\))?\s*[.,]?\s*$/i);
  if (riderLabel) {
    row.rider_name = endTrim(riderLabel[1]);
    row.rider_country = riderLabel[2] || '';
    body = body.slice(0, riderLabel.index);
  }

  // Header: name and tags, year, sex.  "Name (ISH)[TIH][was X] - 2014 gelding"  or  "Name (was X) ISH 2013 gelding"
  let afterHeader = body;
  const current = body.match(new RegExp(`^(.+?)\\s*[-–—]?\\s*((?:19|20)\\d\\d)\\s+(${SEXES})\\b\\.?`, 'i'));
  if (current) {
    let head = current[1].replace(/\s*[-–—]\s*$/, '');
    const older = head.match(/^(.*?)\s+([A-Za-z]{2,6})$/); // "Master Smart (was X) ISH"
    let t;
    if (!/[\])]\s*$/.test(head) && older && /^[A-Z]{2,6}$|^unk$/.test(older[2])) {
      t = splitTagged(older[1]);
      t.breed_code = older[2] === 'unk' ? 'unk' : older[2].toUpperCase();
    } else {
      t = splitTagged(head);
    }
    row.horse_name = t.name;
    row.former_name = t.former;
    row.breed = t.breed_code;
    row.tih_flag = t.tih;
    row.foaled = Number(current[2]);
    row.sex = SEX[current[3].toLowerCase()];
    afterHeader = body.slice(current[0].length);
    // "2012 gelding OIO by …": OIO is a note Charlie adds; keep it as a note and read on.
    if (/^\s*OIO\b\.?/.test(afterHeader)) { afterHeader = afterHeader.replace(/^\s*OIO\b\.?/, ''); warnings.push('Marked OIO'); }
    if (!row.breed) warnings.push('No breed code for the horse');
  } else {
    const n = body.match(/^(.+?)(?=\s+(?:by|sire unknown)\s)/i);
    if (n) {
      const t = splitTagged(n[1]);
      row.horse_name = t.name; row.former_name = t.former; row.breed = t.breed_code; row.tih_flag = t.tih;
      afterHeader = body.slice(n[0].length);
      const y = row.horse_name.match(/^(.*?)\s*[-–—]\s*((?:19|20)\d\d)$/); // "Kilbrack Echo - 2019" with no sex
      if (y) { row.horse_name = y[1]; row.foaled = Number(y[2]); }
    }
    issues.push(row.foaled ? 'Sex not found' : 'Year or sex not found');
  }
  if (!row.horse_name) issues.push('Horse name not found');

  // Breeder
  const label = afterHeader.match(/[.,;]?\s*\b(?:Bre{1,2}d(?:e|er)?r|Bd)\b\s*[:\-–]?\s*/i);
  let breeding = label ? afterHeader.slice(0, label.index) : afterHeader;
  if (!label && !riderLabel) {
    // No breeder: an unlabelled "Name (NAT)" after the breeding sentence is the rider.
    const r = breeding.match(/\.\s+([^.]+?)\s*\(([A-Z]{3})\)\s*[.,]?\s*$/);
    if (r) { row.rider_name = r[1].trim(); row.rider_country = r[2]; breeding = breeding.slice(0, r.index); }
  }
  let breederPart = label ? afterHeader.slice(label.index + label[0].length) : '';

  if (label && !riderLabel) {
    // Older style: "Edmond Crotty. Tara Dixon (IRL)". The breeder ends at the first full stop after a word.
    const txt = clean(breederPart).replace(/\.$/, '');
    const stop = txt.match(/^(.*?[^\s.]{2,}\)?)\.\s+(.*)$/);
    if (stop) {
      breederPart = stop[1];
      const rider = stop[2].match(/^(.+?)\s*\(([A-Z]{3})\)\s*$/);
      if (rider) { row.rider_name = rider[1].trim(); row.rider_country = rider[2]; }
    } else if (/\([A-Z]{3}\)/.test(txt)) {
      issues.push('Could not tell the breeder from the rider (add a full stop after the breeder)');
      breederPart = '';
    }
  }
  readBreeding(breeding, row, issues, warnings);
  if (label && endTrim(breederPart)) {
    const b = splitBreeder(breederPart);
    row.breeder = b.name; row.breeder_county = b.county;
  } else {
    warnings.push('No breeder given');
  }
}

/** Archive style: "Name ('04 g Sire (ISH) - Dam (ISH) (Damsire (RID)). Bd Breeder. Rd Rider) scores" */
function parseArchive(rest, row, ctx, issues, warnings) {
  const open = rest.indexOf('(');
  row.horse_name = endTrim(rest.slice(0, open));
  // The details run to the bracket that closes the opening one.
  let depth = 0, close = -1;
  for (let i = open; i < rest.length; i++) {
    if (rest[i] === '(') depth++;
    else if (rest[i] === ')') { depth--; if (depth === 0) { close = i; break; } }
  }
  let inner = close > 0 ? rest.slice(open + 1, close) : rest.slice(open + 1);
  if (close < 0) {
    // Unbalanced: the details end at the last ")" before the scores.
    const sc = [...inner.matchAll(SCORE_RE)].pop();
    if (sc) inner = inner.slice(0, sc.index);
    inner = inner.replace(/\)\s*$/, '');
    warnings.push('Brackets do not balance');
  }
  takeScores(close > 0 ? rest.slice(close + 1) : rest, row, warnings);

  const head = inner.match(/^'?\s*(\d{2}|\d{4})\s*([a-z]+)\b\.?\s*/i);
  let t = inner;
  if (head) {
    const yy = Number(head[1]);
    row.foaled = head[1].length === 4 ? yy : yy > 40 ? 1900 + yy : 2000 + yy;
    row.sex = SEX[head[2].toLowerCase()] || '';
    t = inner.slice(head[0].length);
    if (!row.sex) warnings.push(`Unknown sex "${head[2]}"`);
  } else {
    issues.push('Year or sex not found');
  }
  const rd = t.match(/[.,;]?\s*\bRd\b\.?\s*(.+)$/);
  if (rd) { row.rider_name = endTrim(rd[1]); t = t.slice(0, rd.index); }
  const bd = t.match(/[.,;]?\s*\bBd\b\.?\s*(.+)$/);
  if (bd) {
    const b = splitBreeder(bd[1]);
    row.breeder = b.name; row.breeder_county = b.county;
    t = t.slice(0, bd.index);
  } else {
    warnings.push('No breeder given');
  }
  t = endTrim(t);
  // "Sire (ISH) - Dam (ISH) (Damsire (RID))"
  const dash = t.match(/\s+[-–—]\s+/);
  if (!dash) {
    setPerson(row, 'sire', t);
    issues.push('Dam not found');
  } else {
    setPerson(row, 'sire', t.slice(0, dash.index));
    const damPart = t.slice(dash.index + dash[0].length);
    // The last bracket holds the dam sire, which may carry its own code: "(Diamond Lad (RID))", or "(Oakley Dawn RID))" typed without the inner "(".
    const ds = damPart.match(/^(.*?)\s*\(\s*([^()]*(?:\([^()]*\)?)?[^()]*?)\s*\)\)?\s*$/);
    const code = ds && ds[2].trim().toUpperCase();
    if (ds && ds[1] && (/[\s(]/.test(ds[2].trim()) || !BREED_CODES.has(code))) {
      setPerson(row, 'dam', ds[1]);
      setPerson(row, 'dam_sire', ds[2].replace(/\s+([A-Z]{2,6})\)?$/, ' ($1)'));
    } else {
      setPerson(row, 'dam', damPart);
      warnings.push('No dam sire given');
    }
  }
  if (!row.sire) issues.push('Sire not found');
  if (!row.dam && !issues.includes('Dam not found')) issues.push('Dam not found');
}

const ENTRY_RE = /^=?\s*(\d{1,3})\s*(?:st|nd|rd|th)?\s*=?\s*[.)]?\s+(.+)$/i;
const looksLikeModern = s => /\b(by|out of|sire unknown)\b/i.test(s) && /\b((19|20)\d\d)\b/.test(s);
const looksLikeArchive = s => /^[^()]{2,80}\(\s*(?:'?\d{2}\s*[a-z]{1,8}\b|Rd\b)/i.test(s);
const NOTE_RE = /^(\(|only \d+|note\b|see below|these results|n\.?b\.?\b)|results/i;

export function parseEntry(position, rest, ctx) {
  const issues = [], warnings = [];
  const row = emptyRow(position, ctx);
  row.raw = rest;
  if (looksLikeArchive(rest)) parseArchive(clean(rest), row, ctx, issues, warnings);
  else parseModern(clean(rest), row, ctx, issues, warnings);
  if (!ctx.event) issues.push('No event heading above it');
  if (!ctx.cls) issues.push('No class heading above it');
  if (!row.country) issues.push('No country for the event');
  if (row.dressage && row.score !== null) {
    const sum = Math.round((Number(row.dressage) + Number(row.show_jumping) + Number(row.cross_country)) * 10) / 10;
    if (Math.abs(sum - row.score) > 0.05) warnings.push(`Scores add up to ${sum}, not ${row.score}`);
  }
  row.issues = issues;
  row.warnings = warnings;
  row.verified = issues.length === 0;
  return row;
}

/**
 * Whole text → { rows, notes, events, classes, weekLabel }.
 * `notes` lists the lines that were not used, so nothing goes missing silently.
 */
export function parseResults(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const title = lines.length ? parseTitle(lines[0]) : null;
  const defaultYear = opts.defaultYear || (title && title.year) || new Date().getFullYear();
  const ctx = { country: opts.defaultCountry || '', event: null, cls: '', defaultYear };
  const rows = [], notes = [];
  const events = new Set(), classes = new Set();

  lines.forEach((line, i) => {
    if (i === 0 && title) return;
    const entry = line.match(ENTRY_RE);
    if (entry && (looksLikeModern(entry[2]) || looksLikeArchive(entry[2]))) { rows.push(parseEntry(Number(entry[1]), entry[2], ctx)); return; }

    const country = matchCountry(line);
    if (country) { ctx.country = country; ctx.event = null; ctx.cls = ''; return; }

    if (line.length <= 180 && !NOTE_RE.test(line)) {
      const ev = parseEventLine(line, defaultYear);
      if (ev) {
        ctx.event = ev; ctx.cls = '';
        events.add(`${ev.country || ctx.country}|${ev.name}`);
        return;
      }
    }
    // A position followed by a year and sex is a placing even without breeding ("… 2016 gelding OIO.").
    if (entry && ctx.event && new RegExp(`\\b(19|20)\\d\\d\\s+(${SEXES})\\b`, 'i').test(entry[2])) { rows.push(parseEntry(Number(entry[1]), entry[2], ctx)); return; }
    if (NOTE_RE.test(line) || line.length > 110 || !ctx.event) { notes.push(line); return; }
    if (entry) { rows.push(parseEntry(Number(entry[1]), entry[2], ctx)); return; }
    ctx.cls = line.replace(/[.:]\s*$/, '').trim();
    classes.add(`${ctx.event.name}|${ctx.cls}`);
  });

  return { rows, notes, events: events.size, classes: classes.size, weekLabel: title ? title.label : '' };
}
