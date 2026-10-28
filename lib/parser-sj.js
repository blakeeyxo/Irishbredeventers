/*
 * Showjumping results files (Charlie's weekly Word files for IBSR), e.g.
 *
 *   21.5.24 International Showjumping Results
 *   Lexington International (USA) 14th – 18th May
 *   CSI 3*
 *   € 125,000 US Grand Prix. Table A. One round against the clock, jump off against the clock 1.50m
 *   8th Ultimately Cooley (ISH) – 2014 gelding by OBOS Quality 004 (OLD) out of Tiamo Diamant (SF) by Diamant De Semilly (SF).
 *       Breeder: Patrick J. Kearns. Owner: Orpen Horses Ltd. Rider: Loic Cannaert (BEL).
 *
 * Same output as parseResults (lib/parser.js), so the preview and import are IBER's. Differences:
 *  - a level line ("CSI 3*", "CSIO 3*") goes in front of the class: "CSI 3* · € 125,000 US Grand Prix. …"
 *  - class lines can be long and keep their prize money as written
 *  - a line inside an event that is neither a class nor a placing is used as the class but flagged, never dropped
 *  - placings only: no scores, faults or times
 *  - each row also has `owner`
 */
import { parseTitle, parseEventLine, parseEntry, matchCountry, ENTRY_RE } from './parser.js';
import { IRISH_COUNTIES } from './names.js';

const clean = s => String(s || '').replace(/[ \s]+/g, ' ').trim();

// "CSI 3*", "CSIO 5*", "CSI1*", "CSIYH", "CSI Ch Amateur": a short line naming the level.
const LEVEL_RE = /^(?:CSI|CSIO|CSN|CSIYH|CSIU25|CSIAm|CSIY|CSIJ|CSIP|CSIW|CH)(?=[\s\d*\-–]|$)[^€$£]{0,24}$/i;
const CLASS_WORDS = /\b(?:Table\s+[A-C]|Grand\s+Prix|Nations\s+Cup|Two\s+Phase|Derby|Speed|Puissance|Accumulator|Six\s+Bar|Jump[\s-]?off|Against\s+the\s+clock|Young\s+Horse|\d\s*[-/]?\s*(?:yo|year[\s-]*olds?)\b)/i;
const HEIGHT_RE = /\b\d\.\d{2}\s?m\b/i;
const looksLikeClass = s => /^[€$£]/.test(s) || CLASS_WORDS.test(s) || HEIGHT_RE.test(s);
const looksLikeHorse = s => /\b(?:by|out of|OIO)\b/i.test(s) || /\b(?:19|20)\d\d\s+(?:gelding|mare|stallion|colt|filly)\b/i.test(s);

// "In 2nd Team": the horses listed under it (with no placing of their own) placed with their team.
const TEAM_RE = /^In\s+(\d{1,3})\s*(?:st|nd|rd|th)?\s+team\b\.?$/i;
// A title line: "21.5.24 International Showjumping Results" or "12th – 18th October International Showjumping Results".
const TITLE_RE = /\bshow\s*jumping\s+results\b/i;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Typos with one reading only. */
const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
const tidyLine = t => t.replace(/\)(by|out of)\s/gi, ') $1 ');

/** Owner out of the line ("Owner: X." / "Breeder and owner: X."), so the breeder stops at the breeder. */
function takeOwner(text) {
  let owner = '';
  let t = text.replace(/\b(?:Breeder\s+(?:and|&)\s+owner|Owner\s+(?:and|&)\s+breeder)\s*:\s*(.+?)\.?(?=\s+Rider\b|$)/i, (_, name) => {
    owner = name.trim();
    return `Breeder: ${owner}.`;
  });
  if (!owner) {
    t = t.replace(/[.,;]?\s*\bOwners?\s*:\s*(.+?)\.?(?=\s+Rider\b|$)/i, (_, name) => { owner = name.trim(); return '.'; })
      .replace(/\.\s*\./g, '.');
  }
  return { text: t, owner: owner.replace(/[.,;\s]+$/, '') };
}

/** "John McKibbin, Co. Down" → breeder John McKibbin, county Down. */
function countyFromBreeder(row) {
  const m = row.breeder.match(/^(.*?),?\s+(?:Co\.?|County)\s+([A-Za-z]+)$/i);
  if (m && IRISH_COUNTIES.has(m[2].toLowerCase())) {
    const c = m[2].toLowerCase();
    row.breeder = m[1].replace(/[,\s]+$/, '');
    row.breeder_county = c[0].toUpperCase() + c.slice(1);
  }
}

// The reader places what it can and notes what it guessed (extraWarnings); extraIssues hold a result back, only for what
// it really can't place.
function placingRow(position, rest, line, ctx, extraIssues = [], extraWarnings = []) {
  // "1st 2nd Leestone Mylord Trumps": two placings typed. The first is used.
  const second = rest.match(/^(\d{1,3})(?:st|nd|rd|th)\b\.?\s+/i);
  if (second && position !== null) {
    extraWarnings.push(`Two placings given ("${line.slice(0, line.indexOf(rest) + second[0].length).trim()}"): ${ordinal(position)} used`);
    rest = rest.slice(second[0].length);
  }
  // "1st team Donogue Doctor George": a team class.
  if (/^team\s+/i.test(rest)) { rest = rest.replace(/^team\s+/i, ''); extraWarnings.push('Placed as part of a team'); }
  const { text, owner } = takeOwner(tidyLine(clean(rest)));
  // Under a level line with no class line yet ("CSI 2*" then a horse), the level is the class.
  const row = parseEntry(position, text, ctx.cls || !ctx.level ? ctx : { ...ctx, cls: ctx.level });
  row.raw = rest;
  row.line = line;
  row.owner = owner;
  countyFromBreeder(row);
  // "Breeder: Tom & Linda Magee. Bosch Sporthorses & Mulder Sporthorses." – a second name with no label: the owner.
  const parts = row.breeder.split(/\.\s+(?=[A-Z])/);
  if (parts.length > 1 && parts[parts.length - 1].split(' ').length > 1) {
    if (!row.owner) {
      row.owner = parts.slice(1).join('. ');
      row.breeder = parts[0];
      extraWarnings.push(`"${row.owner}" read as the owner (it had no "Owner:" label)`);
    } else {
      extraWarnings.push(`The breeder reads "${row.breeder}"`);
    }
  }
  row.warnings = row.warnings.filter(w => w !== 'No scores given');
  row.issues.push(...extraIssues);
  row.warnings.push(...extraWarnings, ...(ctx.event.notes || []), ...ctx.unsure);
  // Everything noted here was a best guess (two placings, a team placing, an owner with no label, an odd event date or
  // class heading): shown with the result on the site too.
  row.guesses.push(...extraWarnings.filter(w => w !== 'Placed as part of a team'), ...(ctx.event.notes || []), ...ctx.unsure);
  row.verified = row.issues.length === 0;
  return row;
}

/** An event heading, also when a day in it can't be read ("15th – 187th October 2026"): the bad day is left out and flagged. */
function readEvent(line, defaultYear) {
  const ev = parseEventLine(line, defaultYear);
  const badDay = line.match(/\b(\d{3,})(?:st|nd|rd|th)\b/i) || line.match(/\b(3[2-9]|[4-9]\d)(?:st|nd|rd|th)\b/i);
  if (ev && !badDay) return { ev, issues: [] };
  if (!badDay) return null;
  const fixed = parseEventLine(line.replace(new RegExp(`\\s*[–—-]?\\s*\\b${badDay[0]}`), ' '), defaultYear);
  return fixed ? { ev: fixed, issues: [`The day "${badDay[0]}" in the event heading isn't a date: dated from ${fixed.dateText}`] } : null;
}

/** Title line → { label, year } (either form of title), or null. */
function readTitle(line, defaultYear) {
  const t = parseTitle(line);
  if (t) return t;
  if (!TITLE_RE.test(line)) return null;
  const when = line.replace(/\s*(?:International\s+)?Show\s*jumping\s+Results\.?\s*$/i, '').trim();
  const year = (when.match(/\b((?:19|20)\d\d)\b/) || [])[1];
  return { label: when ? `Week of ${when.replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/g, '$1')}${year ? '' : ` ${defaultYear}`}` : '', year: year ? Number(year) : null };
}

/** Whole text → { rows, notes, events, classes, weekLabel }, as parseResults. */
export function parseShowjumping(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const title = lines.length ? readTitle(lines[0], opts.defaultYear || new Date().getFullYear()) : null;
  // The year in the file's title ("21.5.24 …") comes first: the owner area always sends this year as the fallback.
  const defaultYear = (title && title.year) || opts.defaultYear || new Date().getFullYear();
  const yearFrom = title && title.year ? 'the file title' : 'the year chosen for the upload';
  const ctx = { country: opts.defaultCountry || '', event: null, cls: '', level: '', unsure: [], team: null, defaultYear };
  const rows = [], notes = [];
  const events = new Set(), classes = new Set();
  const setClass = (line, unsure) => {
    const name = line.replace(/[.:\s]+$/, '');
    ctx.cls = ctx.level ? `${ctx.level} · ${name}` : name;
    ctx.unsure = unsure ? [`"${name}" taken as the class heading`] : [];
    ctx.team = null;
    classes.add(`${ctx.event.name}|${ctx.cls}`);
  };

  lines.forEach((line, i) => {
    if (i === 0 && title) return;
    const entry = line.match(ENTRY_RE);
    if (entry && looksLikeHorse(entry[2])) {
      if (!ctx.event) { notes.push(line); return; }
      const notes = ctx.team ? [`Listed under "In ${ctx.team} team" with its own placing: ${ordinal(Number(entry[1]))} used`] : [];
      rows.push(placingRow(Number(entry[1]), entry[2], line, ctx, [], notes));
      return;
    }
    const team = line.match(TEAM_RE);
    if (team && ctx.event) { ctx.team = ordinal(Number(team[1])); ctx.teamPos = Number(team[1]); return; }
    // A horse with no placing of its own: its team's placing, or flagged.
    if (!entry && ctx.event && looksLikeHorse(line) && /\(\s*[A-Z]{2,6}\s*\)/.test(line)) {
      rows.push(ctx.team ? placingRow(ctx.teamPos, line, line, ctx, [], [`Placed with its team (${ctx.team} team)`])
        : placingRow(null, line, line, ctx, ['No placing given for this horse']));
      return;
    }
    if (!entry && line.length <= 30 && LEVEL_RE.test(line)) {
      ctx.level = line.replace(/\s+/g, ' ').replace(/\s*\*/, '*');
      ctx.cls = ''; ctx.unsure = []; ctx.team = null;
      return;
    }
    const country = matchCountry(line);
    if (country) { ctx.country = country; ctx.event = null; ctx.cls = ''; ctx.level = ''; ctx.team = null; return; }

    if (!entry && line.length <= 180 && !/^[€$£]/.test(line) && !HEIGHT_RE.test(line) && !/\bTable\s+[A-C]\b/i.test(line)) {
      const read = readEvent(line, defaultYear);
      if (read) {
        const ev = read.ev;
        ev.notes = [...read.issues];
        const longYear = line.match(/\b(?:19|20)\d{3,}\b/);
        if (longYear) ev.notes.push(`Year "${longYear[0]}" in the event heading is not a year: ${ev.season} used`);
        else if (!/\b(?:19|20)\d\d\b/.test(line)) ev.notes.push(`No year in the event heading; ${ev.season} taken from ${yearFrom}`);
        ctx.event = ev; ctx.cls = ''; ctx.level = ''; ctx.unsure = []; ctx.team = null;
        events.add(`${ev.country || ctx.country}|${ev.name}`);
        return;
      }
    }
    if (!ctx.event) { notes.push(line); return; }
    if (entry) { notes.push(line); return; }  // a numbered line that isn't a horse
    setClass(line, !looksLikeClass(line));
  });

  return { rows, notes, events: events.size, classes: classes.size, weekLabel: title ? title.label : '' };
}
