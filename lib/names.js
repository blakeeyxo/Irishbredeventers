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
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

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
  while ((m = s.match(/\s*[[(]\s*([^[\]()]{1,60}?)\s*[\])]\s*$/))) {
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
  NZL: 'New Zealand', JPN: 'Japan', BRA: 'Brazil', RSA: 'South Africa', THA: 'Thailand', CHN: 'China', UAE: 'United Arab Emirates'
};
