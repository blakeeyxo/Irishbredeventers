/*
 * Name helpers shared by the parser, the import and the owner-area preview.
 * Pure JS with no dependencies.
 */

/**
 * The matching form of a name: lowercase, apostrophes dropped, other punctuation turned
 * into spaces, repeated spaces collapsed. "Flex A Bill" and "Flex-a-Bill" both become
 * "flex a bill"; "O'Sullivan" and "OSullivan" both become "osullivan".
 */
export function normaliseName(s) {
  return String(s || '')
    // Dots never make a different name. A run of dotted initials is one word, with or without spaces between them:
    // "O.B.O.S." = "O. B. O. S" = "OBOS", "J. W. Rosbotham" = "JW Rosbotham"; other dots ("St.", "Mr.") are dropped.
    .replace(/\b(?:[A-Za-z]\.)+[A-Za-z]\b/g, run => run.replace(/\./g, ''))
    .replace(/\b(?:[A-Za-z]\.\s?){2,}/g, run => `${run.replace(/[.\s]/g, '')} `)
    .replace(/\b([A-Za-z])\.(?=[A-Za-z]\b|\s|$|[^A-Za-z0-9])/g, '$1')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Stallions that appear under several spellings and always link to one record. A spelling belongs to the family when,
 * ignoring case, dots, spacing and breed codes, it is the name itself, within two letters of it (a typo), or one of the
 * short forms. Any digits must be the stallion's own, and nothing may be added in front: "Lagans OBOS Quality" and
 * "Lagos OBOS Quality" are a different stallion (a son), so a horse's sire, dam sire and grandsire never get mixed up.
 */
export const SIRE_FAMILIES = [
  { name: 'OBOS Quality 004', digits: '004', short: ['obosquality', 'obos004'] }
];
export function sireFamily(raw) {
  const core = normaliseName(String(raw || '').replace(/\s*[([][^)\]]*[)\]]/g, ' ')).replace(/ /g, '');
  if (!core) return null;
  const digits = core.replace(/\D/g, '');
  for (const f of SIRE_FAMILIES) {
    const own = normaliseName(f.name).replace(/ /g, '');
    if (digits && digits !== f.digits) continue;
    if (core === own || f.short.includes(core) || editDistance(core, own, 2) <= 2) return f.name;
  }
  return null;
}
/** The family's standard name for a sire written any of those ways; any other name is returned as it is. */
export const canonicalSire = raw => sireFamily(raw) || raw;

/** OBOS is stored one way whatever the article wrote ("O.B.O.S.", "O. B. O. S"); the site shows the owner's choice. */
export const canonObos = s => String(s ?? '').replace(/\bO\.\s?B\.\s?O\.\s?S\b\.?/gi, 'OBOS');

/** Normalised with the spaces taken out as well, for near-match checks ("flexabill"). */
export const compactName = s => normaliseName(s).replace(/ /g, '');

/** Edit distance, stopping early once it passes `max`. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Two different normalised names that are probably the same (typo, spacing, punctuation). */
export function isNearName(a, b) {
  if (!a || !b || a === b) return false;
  const ca = a.replace(/ /g, ''), cb = b.replace(/ /g, '');
  if (ca === cb) return true;
  if (Math.min(ca.length, cb.length) < 5) return false;
  const allowed = ca.length >= 10 ? 2 : 1;
  return editDistance(ca, cb, allowed) <= allowed;
}

// Studbook and breed codes seen in the results. Anything else in brackets is kept as a note.
export const BREED_CODES = new Set([
  'ISH', 'TB', 'ID', 'RID', 'AID', 'CP', 'P', 'KWPN', 'KWNP', 'HANN', 'HOLST', 'HOLS', 'OLD', 'SF', 'BWP', 'ZANG', 'SWB',
  'WESTF', 'WEWB', 'AES', 'TRAK', 'SBS', 'AA', 'BEP', 'DWB', 'SEL', 'BAD', 'BAVAR', 'WURTT', 'MECKL', 'TRAKEHNER',
  'AAC', 'CDE', 'KWPN-NA', 'NRPS', 'ISF', 'IHR', 'UNK', 'WB', 'CH', 'OS', 'RHEIN', 'HANNOVERIAN', 'DSP', 'LUS', 'PRE', 'SLS', 'SI'
]);
const COUNTRY_TAGS = new Set(['IRL', 'GBR', 'GB', 'FR', 'FRA', 'USA', 'GER', 'NZL', 'AUS', 'IRE']);

/**
 * "Kilpatrick Pip (ISH)[TIH]" → { name: 'Kilpatrick Pip', breed_code: 'ISH', tih: true, former: '', notes: [] }
 * Handles (ISH) or [ISH], [TIH], (P), [IRL], [was Old Name] / (was Old Name), and "sire unknown".
 */
export function splitTagged(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '').trim();
  const out = { name: '', breed_code: '', tih: false, former: '', notes: [] };
  // Tags at the end, in any order: (X) [X] or a mismatched [X)
  let m;
  s = s.replace(/[{]/g, '(').replace(/[}]/g, ')');   // "[ISH}" typo
  while ((s = s.replace(/[\s–—-]+$/, ''), m = s.match(/\s*[[(]\s*([^[\]()]{1,60}?)\s*[\])]\s*$/))) {
    const tag = m[1].trim();
    const was = tag.match(/^(?:was|ex|formerly|previously|fka)\s+(.+)$/i);
    if (was) out.former = out.former ? `${was[1].trim()} & ${out.former}` : was[1].trim();
    else if (/^tih$/i.test(tag)) out.tih = true;
    else if (/^unk(nown)?$/i.test(tag)) out.breed_code = out.breed_code || 'unk';
    else if (COUNTRY_TAGS.has(tag.toUpperCase()) && !BREED_CODES.has(tag.toUpperCase())) out.notes.push(tag.toUpperCase());
    else if ((/^[A-Za-z-]{1,11}$/.test(tag) && BREED_CODES.has(tag.toUpperCase())) || /^[A-Z]{2,6}$/.test(tag)) {
      const code = tag.toUpperCase();
      if (code === 'P') out.notes.push('P');
      else if (!out.breed_code) out.breed_code = code;
    } else if (COUNTRY_TAGS.has(tag.toUpperCase())) out.notes.push(tag.toUpperCase());
    else break; // part of the name, e.g. "Breeder (Limerick)" is handled elsewhere
    s = s.slice(0, m.index).trim();
  }
  // A tag left dangling without its closing bracket: "Beach Ball [ISH"
  const dangling = s.match(/\s*[[(]\s*([A-Za-z]{2,6})\s*$/);
  if (dangling && BREED_CODES.has(dangling[1].toUpperCase())) {
    out.breed_code = out.breed_code || dangling[1].toUpperCase();
    s = s.slice(0, dangling.index).trim();
  }
  out.name = s.replace(/[.,;:\s]+$/, '').trim();
  if (/^(sire|dam)?\s*(unknown|not recorded|unk)$/i.test(out.name)) out.name = '';
  return out;
}

/** Display form used on the public pages: "Kilpatrick Pip (ISH)[TIH]". */
export function displayName(name, breed, tih) {
  if (!name) return '';
  return `${name}${breed ? ` (${breed})` : ''}${tih ? '[TIH]' : ''}`;
}

export const IRISH_COUNTIES = new Set([
  'antrim', 'armagh', 'carlow', 'cavan', 'clare', 'cork', 'derry', 'londonderry', 'donegal', 'down', 'dublin', 'fermanagh',
  'galway', 'kerry', 'kildare', 'kilkenny', 'laois', 'leitrim', 'limerick', 'longford', 'louth', 'mayo', 'meath',
  'monaghan', 'offaly', 'roscommon', 'sligo', 'tipperary', 'tyrone', 'waterford', 'westmeath', 'wexford', 'wicklow'
]);

/** "Fiona Hickey (Limerick)" → { name: 'Fiona Hickey', county: 'Limerick' }. "Co. Cork" also works. */
export function splitBreeder(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '').trim();
  const m = s.match(/^(.*?)\s*\(\s*(?:co\.?\s*)?([A-Za-z]+)\s*\)$/i);
  if (m && IRISH_COUNTIES.has(m[2].toLowerCase())) {
    const c = m[2].toLowerCase();
    return { name: m[1].trim(), county: c[0].toUpperCase() + c.slice(1) };
  }
  return { name: s, county: '' };
}

// Country codes used in event lines, e.g. "Oxstalls One Day Event (GBR)".
export const COUNTRY_CODES = {
  IRL: 'Ireland', GBR: 'Great Britain', ENG: 'England', SCO: 'Scotland', WAL: 'Wales', NIR: 'Northern Ireland',
  USA: 'United States', CAN: 'Canada', FRA: 'France', GER: 'Germany', DEU: 'Germany', BEL: 'Belgium', NED: 'Netherlands',
  NLD: 'Netherlands', ITA: 'Italy', ESP: 'Spain', POR: 'Portugal', POL: 'Poland', SWE: 'Sweden', SUI: 'Switzerland',
  AUT: 'Austria', DEN: 'Denmark', NOR: 'Norway', FIN: 'Finland', CZE: 'Czech Republic', HUN: 'Hungary', AUS: 'Australia',
  NZL: 'New Zealand', JPN: 'Japan', BRA: 'Brazil', RSA: 'South Africa', THA: 'Thailand', CHN: 'China', UAE: 'United Arab Emirates',
  IND: 'India', HKG: 'Hong Kong'
};
