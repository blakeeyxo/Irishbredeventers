/*
 * Results sent as a spreadsheet (IBER_weekly_template.xlsx, or the rows copied out of it): one row per placing.
 *
 *   Event | Event dates | Class | Place | Horse line | Dressage | XC | SJ | Total | Sum check | Class note
 *
 * Columns are found by their headings, in any order; a Country, Owner or Rider column is used when there is one.
 * The horse line is read exactly as in the Word files (parseEntry, or the showjumping reader on IBSR), so the
 * output is the same as parseResults and the preview and import don't change. Scores come from their own columns.
 *
 * As everywhere, the reader places what it can and notes its best guesses:
 *  - no country: an earlier upload's country for the same event, else the riders' country when most share one
 *    (noted in the check table only), else the country chosen for the upload
 *  - no dates: the latest dates in the file
 */
import { parseEntry, parseEventLine, matchCountry, countryFromCode } from './parser.js';
import { placingRow } from './parser-sj.js';
import { normaliseName } from './names.js';

const clean = s => String(s ?? '').replace(/[ \s]+/g, ' ').trim();
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Heading → field. The first matching heading wins; "Sum check" is Excel's own check and isn't needed.
const HEADINGS = [
  ['horse', /horse/i],
  ['dates', /date/i],
  ['note', /note|comment/i],
  ['event', /^event|^competition|^show$/i],
  ['class', /^class|^section/i],
  ['place', /^(place|placing|pl|pos|position)\b/i],
  ['dressage', /^(dressage|dr)\b/i],
  ['xc', /^(xc|x-c|cross)/i],
  ['sj', /^(sj|show ?jump|jumping)/i],
  ['total', /^(total|score|final)/i],
  ['country', /^country/i],
  ['owner', /^owner/i],
  ['rider', /^rider/i]
];

function columns(header) {
  const cols = {};
  header.forEach((h, i) => {
    const hit = HEADINGS.find(([key, re]) => re.test(clean(h)) && cols[key] === undefined);
    if (hit && !/sum check/i.test(h)) cols[hit[0]] = i;
  });
  return cols;
}

/** A date Excel keeps as a day number (45941) → "8 October 2025". */
function excelDate(v) {
  if (!/^\d{5}(?:\.\d+)?$/.test(v)) return v;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "Rider: Camille Guyot (SUI)" in each line → "Switzerland" when at least half the riders share it. */
function ridersCountry(lines) {
  const codes = lines.map(l => (l.match(/\bRider\s*:[^()]*\(\s*([A-Z]{3})\s*\)/i) || [])[1]).filter(Boolean);
  if (!codes.length) return null;
  const counts = {};
  codes.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const [code, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const country = countryFromCode(code);
  return country && n * 2 >= lines.length ? { country, code } : null;
}

const num = v => (v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * table: rows of cells (lib/xlsx.js). opts: discipline ('eventing' | 'showjumping'), defaultYear, defaultCountry,
 * knownCountries ({ normalised event name: country } from earlier uploads).
 */
export function parseSheet(table, opts = {}) {
  const discipline = opts.discipline || 'eventing';
  const defaultYear = opts.defaultYear || new Date().getFullYear();
  const known = opts.knownCountries || {};
  const out = { rows: [], notes: [], events: 0, classes: 0, weekLabel: '' };
  const headAt = table.slice(0, 10).findIndex(r => r.some(c => /horse/i.test(c)));
  if (headAt < 0) { out.notes.push('No "Horse line" heading found in the sheet, so nothing was read. Keep the template\'s first row of headings.'); return out; }
  const cols = columns(table[headAt]);
  const cell = (r, key) => (cols[key] === undefined ? '' : clean(r[cols[key]]));
  const data = table.slice(headAt + 1).filter(r => cell(r, 'horse'));

  // 1. The events, in the order they come.
  const events = new Map();
  for (const r of data) {
    const key = `${cell(r, 'event')}|${excelDate(cell(r, 'dates'))}`;
    if (!events.has(key)) events.set(key, { nameCell: cell(r, 'event'), datesCell: excelDate(cell(r, 'dates')), countryCell: cell(r, 'country'), rows: [] });
    events.get(key).rows.push(r);
  }
  for (const ev of events.values()) {
    ev.guesses = [];
    let name = ev.nameCell;
    const cc = name.match(/\(\s*([A-Z]{3,4})\s*\)/);
    const codeCountry = cc && countryFromCode(cc[1]);
    if (codeCountry) name = clean(name.slice(0, cc.index) + name.slice(cc.index + cc[0].length));
    ev.name = name;
    const read = ev.datesCell ? parseEventLine(`${name || 'Event'} ${ev.datesCell}`, defaultYear) : null;
    if (read) Object.assign(ev, { dateText: read.dateText, startDate: read.startDate, endDate: read.endDate, season: read.season });
    else if (ev.datesCell) ev.badDates = ev.datesCell;
    const fromColumn = ev.countryCell && (matchCountry(ev.countryCell) || countryFromCode(ev.countryCell.toUpperCase()));
    const fromRiders = ridersCountry(ev.rows.map(r => cell(r, 'horse')));
    ev.country = fromColumn || codeCountry || known[normaliseName(name)] || '';
    // Noted in the owner area's check table only: the event's country is not a detail of the horse.
    if (!ev.country && fromRiders) { ev.country = fromRiders.country; ev.quiet = [`Event country taken as ${fromRiders.country} (most riders are ${fromRiders.code}): add a Country column to be sure`]; }
    if (!ev.country && opts.defaultCountry) ev.country = opts.defaultCountry;
  }
  // 2. An event with no dates (or none that can be read) takes the latest dates in the file.
  const dated = [...events.values()].filter(e => e.startDate);
  const latest = dated.sort((a, b) => (b.endDate || b.startDate).localeCompare(a.endDate || a.startDate))[0];
  for (const ev of events.values()) {
    if (ev.startDate) continue;
    const said = ev.badDates ? `Event dates "${ev.badDates}" could not be read` : 'No event dates given';
    if (latest) {
      Object.assign(ev, { dateText: latest.dateText, startDate: latest.startDate, endDate: latest.endDate, season: latest.season });
      ev.guesses.push(`${said}; taken as ${latest.dateText}`);
    } else {
      Object.assign(ev, { dateText: '', startDate: '', endDate: '', season: defaultYear });
      ev.guesses.push(`${said}; filed under ${defaultYear}`);
    }
  }

  // 3. The placings.
  const eventNames = new Set(), classNames = new Set(), classNotes = new Set();
  for (const ev of events.values()) {
    const event = { name: ev.name, country: ev.country, dateText: ev.dateText, startDate: ev.startDate, endDate: ev.endDate, season: ev.season };
    eventNames.add(`${ev.country}|${ev.name}`);
    for (const r of ev.rows) {
      const cls = cell(r, 'class');
      if (cls) classNames.add(`${ev.name}|${cls}`);
      const note = cell(r, 'note');
      if (note) classNotes.add(`${ev.name}${cls ? ` · ${cls}` : ''}: ${note}`);
      const placeCell = cell(r, 'place');
      const pm = placeCell.match(/^=?\s*(\d{1,3})/);
      const position = pm ? Number(pm[1]) : null;
      let horse = cell(r, 'horse');
      if (cell(r, 'rider') && !/\bRider\s*:/i.test(horse)) horse = `${horse.replace(/[.\s]+$/, '')}. Rider: ${cell(r, 'rider')}`;
      if (cell(r, 'owner') && !/\bOwners?\s*:/i.test(horse)) horse = `${horse.replace(/[.\s]+$/, '')}. Owner: ${cell(r, 'owner')}`;
      const line = `${placeCell} ${horse}`.trim();
      let row;
      if (discipline === 'showjumping') {
        row = placingRow(position, horse, line, { country: ev.country, event: { ...event, notes: ev.guesses }, cls, level: '', unsure: [], team: null, defaultYear });
      } else {
        row = parseEntry(position, horse, { country: ev.country, event, cls, defaultYear });
        row.line = line;
        row.warnings.push(...ev.guesses);
        row.guesses.push(...ev.guesses);
        scores(row, cell(r, 'dressage'), cell(r, 'xc'), cell(r, 'sj'), cell(r, 'total'));
      }
      row.warnings.push(...(ev.quiet || []));
      if (position === null) row.issues.push(placeCell ? `Place "${placeCell}" is not a number` : 'No place given');
      row.verified = row.issues.length === 0;
      out.rows.push(row);
    }
  }
  out.events = eventNames.size;
  out.classes = classNames.size;
  out.notes.push(...classNotes);
  return out;
}

/** Scores from their own columns (they replace any typed into the horse line). */
function scores(row, dressage, xc, sj, total) {
  if (![dressage, xc, sj, total].some(Boolean)) return;
  row.warnings = row.warnings.filter(w => w !== 'No scores given' && !w.startsWith('Scores add up to'));
  row.dressage = dressage; row.cross_country = xc; row.show_jumping = sj;
  const parts = [dressage, xc, sj].map(num);
  const sum = parts.every(n => n !== null) ? Math.round(parts.reduce((a, n) => a + n, 0) * 10) / 10 : null;
  row.score = num(total);
  if (row.score === null && sum !== null) { row.score = sum; row.warnings.push(`No total given; worked out as ${sum}`); }
  else if (row.score !== null && sum !== null && Math.abs(sum - row.score) > 0.05) row.warnings.push(`Scores add up to ${sum}, not ${row.score}`);
}
