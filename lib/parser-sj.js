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

const LEVEL_RE = /^(?:CSI|CSIO|CSN|CSIYH|CSIU25|CSIAm|CSIY|CSIJ|CSIP|CSIW)[A-Za-z0-9]*\s*(?:\d\s*\*|\*+)?\s*(?:[-–]\s*[A-Za-z0-9]+)?\s*$/i;
const CLASS_WORDS = /\b(?:Table\s+[A-C]|Grand\s+Prix|Nations\s+Cup|Two\s+Phase|Derby|Speed|Puissance|Accumulator|Six\s+Bar|Jump[\s-]?off|Against\s+the\s+clock|Young\s+Horse|\d\s*[-/]?\s*(?:yo|year[\s-]*olds?)\b)/i;
const HEIGHT_RE = /\b\d\.\d{2}\s?m\b/i;
const looksLikeClass = s => /^[€$£]/.test(s) || CLASS_WORDS.test(s) || HEIGHT_RE.test(s);
const looksLikeHorse = s => /\b(?:by|out of|OIO)\b/i.test(s) || /\b(?:19|20)\d\d\s+(?:gelding|mare|stallion|colt|filly)\b/i.test(s);

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

function placingRow(entry, line, ctx) {
  let position = Number(entry[1]);
  let rest = entry[2];
  const extraIssues = [];
  // "1st 2nd Leestone Mylord Trumps": two placings typed. Keep the first and ask.
  const second = rest.match(/^(\d{1,3})(?:st|nd|rd|th)\b\.?\s+/i);
  if (second) {
    extraIssues.push(`Two placings given ("${line.slice(0, line.indexOf(rest) + second[0].length).trim()}"): ${position} used, check which is right`);
    rest = rest.slice(second[0].length);
  }
  const { text, owner } = takeOwner(clean(rest));
  const row = parseEntry(position, text, ctx);
  row.raw = rest;
  row.line = line;
  row.owner = owner;
  countyFromBreeder(row);
  row.warnings = row.warnings.filter(w => w !== 'No scores given');
  row.issues.push(...extraIssues, ...ctx.event.issues, ...ctx.unsure);
  row.warnings.push(...(ctx.event.notes || []));
  row.verified = row.issues.length === 0;
  return row;
}

/** Whole text → { rows, notes, events, classes, weekLabel }, as parseResults. */
export function parseShowjumping(text, opts = {}) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const title = lines.length ? parseTitle(lines[0]) : null;
  // The year in the file's title ("21.5.24 …") comes first: the owner area always sends this year as the fallback.
  const defaultYear = (title && title.year) || opts.defaultYear || new Date().getFullYear();
  const yearFrom = title && title.year ? 'the file title' : 'the year chosen for the upload';
  const ctx = { country: opts.defaultCountry || '', event: null, cls: '', level: '', unsure: [], defaultYear };
  const rows = [], notes = [];
  const events = new Set(), classes = new Set();
  const setClass = (line, unsure) => {
    const name = line.replace(/[.:\s]+$/, '');
    ctx.cls = ctx.level ? `${ctx.level} · ${name}` : name;
    ctx.unsure = unsure ? [`Class heading not recognised ("${name}"): check it is the class`] : [];
    classes.add(`${ctx.event.name}|${ctx.cls}`);
  };

  lines.forEach((line, i) => {
    if (i === 0 && title) return;
    const entry = line.match(ENTRY_RE);
    if (entry && looksLikeHorse(entry[2])) {
      if (!ctx.event) { notes.push(line); return; }
      rows.push(placingRow(entry, line, ctx));
      return;
    }
    if (!entry && line.length <= 30 && LEVEL_RE.test(line)) {
      ctx.level = line.replace(/\s+/g, ' ').replace(/\s*\*/, '*');
      ctx.cls = ''; ctx.unsure = [];
      return;
    }
    const country = matchCountry(line);
    if (country) { ctx.country = country; ctx.event = null; ctx.cls = ''; ctx.level = ''; return; }

    if (!entry && line.length <= 180 && !/^[€$£]/.test(line) && !HEIGHT_RE.test(line) && !/\bTable\s+[A-C]\b/i.test(line)) {
      const ev = parseEventLine(line, defaultYear);
      if (ev) {
        ev.notes = [];
        ev.issues = [];
        const longYear = line.match(/\b(?:19|20)\d{3,}\b/);
        if (longYear) ev.issues.push(`Year "${longYear[0]}" in the event heading is not a year: ${ev.season} used, check it`);
        else if (!/\b(?:19|20)\d\d\b/.test(line)) ev.notes.push(`No year in the event heading; ${ev.season} taken from ${yearFrom}`);
        ctx.event = ev; ctx.cls = ''; ctx.level = ''; ctx.unsure = [];
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
