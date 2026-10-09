/*
 * SporthorseData (sporthorse-data.com) horse pages, for filling in breeding on IBSR. SporthorseData agreed to their
 * use, with the site reading at most 1000 horses a day (see migrations-shared/0008).
 *
 * A horse page (https://sporthorse-data.com/pedigree/<slug>) has:
 *   a details list:  <div class="col-xs-4" …>Breed:</div><div class="col-xs-8" …>Irish Sport Horse</div>, then Colour,
 *                    Sex, Date of Birth, Born In, Breeder, and a registration table with UELN and FEI ID;
 *   a pedigree chart: <table class="pedigreetable">, where the sire and dam span 16 rows each, their parents 8:
 *                    <td rowspan="16" …><a …>Cyrano <br><span …>HOL-DE-91-BR</span></a> (studbook-country-year-colour).
 */

const ent = s => String(s ?? '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
const text = s => ent(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// SporthorseData's studbook letters → the codes the shared database already uses (lib/names.js BREED_CODES).
const BOOKS = { HOL: 'HOLST', HAN: 'HANN', HANN: 'HANN', KWPN: 'KWPN', SF: 'SF', BWP: 'BWP', Z: 'ZANG', ZANG: 'ZANG',
  OLD: 'OLD', WESTF: 'WESTF', WEST: 'WESTF', TB: 'TB', ISH: 'ISH', ID: 'ID', TIH: 'ISH', CON: 'CP', AA: 'AA', SWB: 'SWB',
  DWB: 'DWB', TRAK: 'TRAK', SBS: 'SBS', AES: 'AES', SLS: 'SLS', OS: 'OS', RHEIN: 'RHEIN', CH: 'CH', DSP: 'DSP' };
const book = code => { const c = String(code || '').toUpperCase(); return BOOKS[c] || (/^[A-Z]{2,6}$/.test(c) ? c : ''); };

const SEX = { female: 'mare', mare: 'mare', male: 'stallion', stallion: 'stallion', gelding: 'gelding' };
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// Breeders are often written in capitals ("MIGUEL BRAVO"): shown as "Miguel Bravo". Mixed case is kept.
const breederName = s => (s && s === s.toUpperCase()
  ? s.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (m, p, c) => p + c.toUpperCase()).replace(/\b(Mc|Mac|O')([a-z])/g, (m, p, c) => p + c.toUpperCase())
  : s);

/** One pedigree chart cell → { name, studbook, year } */
function parent(cell) {
  if (!cell) return null;
  const a = cell.match(/<a\b[^>]*>([\s\S]*?)<\/a>/);
  if (!a) return null;
  const code = (a[1].match(/<span[^>]*>([\s\S]*?)<\/span>/) || [])[1];
  const name = text(a[1].replace(/<span[\s\S]*?<\/span>/g, ''));
  if (!name || /^unknown$/i.test(name)) return null;
  const parts = text(code).split('-');
  const yy = parts.length >= 3 && /^\d{2}$/.test(parts[2]) ? Number(parts[2]) : null;
  const now = new Date().getUTCFullYear() % 100;
  return { name, studbook: book(parts[0]), year: yy === null ? null : (yy <= now ? 2000 + yy : 1900 + yy) };
}

/**
 * Saved or fetched horse page → { name, url, fei_id, ueln, foaled, foaled_year, sex, colour, breed, born_in,
 *   sire, dam, dam_sire, breeder, breeder_country } (parents as { name, studbook, year }), or null if it isn't one.
 */
export function readShdPage(html) {
  const s = String(html || '');
  if (!/class="pedigreetable"/.test(s) && !/Horse Breeding and Performance Results/.test(s)) return null;
  const field = label => {
    const m = s.match(new RegExp(`>\\s*${label}:\\s*</div>\\s*<div[^>]*>([\\s\\S]*?)</div>`));
    return m ? text(m[1].replace(/<span class="es-listing-pop-box[\s\S]*?<\/span>/g, '')) : '';
  };
  const reg = label => {
    const m = s.match(new RegExp(`${label}:\\s*</strong>\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`));
    const v = m ? text(m[1]) : '';
    return /^unknown$/i.test(v) ? '' : v;
  };
  const title = (s.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const url = (s.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || '';
  const dob = field('Date of Birth').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  const born = dob ? `${dob[3]}-${String(MONTH[dob[2].toLowerCase()] || 1).padStart(2, '0')}-${dob[1].padStart(2, '0')}` : null;
  // The chart: the first two 16-row cells are the sire and the dam; the 8-row cells are their parents, in order.
  const chart = (s.match(/<table class="pedigreetable">([\s\S]*?)<\/table>/) || [])[1] || '';
  const cells = rows => chart.match(new RegExp(`<td rowspan="${rows}"[\\s\\S]*?</td>`, 'g')) || [];
  const [sire, dam] = cells(16).map(parent);
  const gen2 = cells(8).map(parent);
  const breeder = field('Breeder');
  const breederCountry = (s.match(/>\s*Breeder:\s*<\/div>\s*<div[^>]*>\s*<img[^>]*title="([^"]+)"/) || [])[1] || '';
  const fei = reg('International FEI Registration Number').toUpperCase();
  return {
    name: text(title.replace(/\|\s*SporthorseData\s*$/i, '')), url: /^https:\/\/sporthorse-data\.com\//.test(url) ? url : '',
    fei_id: /^[0-9A-Z]{5,8}$/.test(fei) ? fei : '', ueln: reg('UELN Number').replace(/\s/g, ''),
    foaled: born, foaled_year: born ? Number(born.slice(0, 4)) : null, sex: SEX[field('Sex').toLowerCase()] || '',
    colour: field('Colour'), breed: field('Breed'), born_in: field('Born In'),
    sire: sire || null, dam: dam || null, dam_sire: gen2[2] || null,
    breeder: /^(unknown|-)?$/i.test(breeder) ? '' : breederName(breeder), breeder_country: breederCountry
  };
}

/** A parent for the shared upload: "Cyrano (HOLST)". */
export const tagged = p => (p ? (p.studbook ? `${p.name} (${p.studbook})` : p.name) : '');

/**
 * A SporthorseData search results page → the horse pages it links to, e.g. https://sporthorse-data.com/pedigree/touch-royal-cyrano
 * (each is checked against the horse's FEI ID, UELN or name and year before it's used).
 */
export function readShdSearch(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/href="((?:https:\/\/sporthorse-data\.com)?\/pedigree\/[^"?#]+)"/g)) {
    const url = m[1].startsWith('http') ? m[1] : `https://sporthorse-data.com${m[1]}`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
