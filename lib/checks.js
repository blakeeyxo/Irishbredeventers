// Plain-language reasons a saved result is unverified, for the owner area's Unverified tab: what is wrong with the
// row, in words Charlie can act on.
import { parseResults } from './parser.js';

// Problems that come from where the line sat in the article, not from the line itself.
const CONTEXT_ONLY = /No event heading|No class heading|No country for the event/;
const PLAIN = {
  'Horse name not found': "The horse's name couldn't be found in the line.",
  'Year or sex not found': "The year of birth and sex (e.g. \"2015 gelding\") couldn't be found.",
  'Sex not found': "The sex (gelding, mare or stallion) couldn't be found.",
  'Sire not found': "The sire couldn't be found (no \"by …\").",
  'Dam not found': "The dam couldn't be found (no \"out of …\").",
  'Breeding not found': "Neither the sire nor the dam could be found.",
  '"out of" appears twice': 'The breeding says "out of" twice, so the dam and dam sire are mixed up.'
};
const plain = issue => PLAIN[issue] || `${issue.replace(/\.$/, '')}.`;
const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

/** row: an unverified placing with raw_line, parse_ok, foaled, dressage, show_jumping, cross_country, score, sire, dam… */
export function problemsFor(row) {
  const out = [];
  if (/^Event heading missing/.test(row.event_name || '')) {
    out.push("The article didn't say which event or class this result is from (the heading was missing), so it is filed under a placeholder event. Check the article; if you verify it, it goes live under that placeholder.");
  }
  if (row.raw_line && !row.parse_ok) {
    const parsed = parseResults(row.raw_line, { defaultYear: Number((row.start_date || '').slice(0, 4)) || new Date().getFullYear() });
    const issues = (parsed.rows[0] ? parsed.rows[0].issues : ['The line could not be read as a result']).filter(x => !CONTEXT_ONLY.test(x));
    out.push(...issues.map(plain));
  }
  const year = num(row.foaled), thisYear = new Date().getFullYear();
  if (year !== null && (year < 1980 || year > thisYear)) out.push(`The year of birth (${year}) can't be right.`);
  if (row.foaled === null && !out.some(x => /year/i.test(x))) out.push('No year of birth is given.');
  const parts = [row.dressage, row.show_jumping, row.cross_country].map(num);
  const total = num(row.score);
  if (total !== null && parts.every(p => p !== null)) {
    const sum = Math.round((parts[0] + parts[1] + parts[2]) * 10) / 10;
    if (Math.abs(sum - total) > 0.15) out.push(`The scores don't add up: ${parts.join(' + ')} = ${sum}, but the total is ${total}.`);
  }
  for (const [f, label] of [['sire', 'sire'], ['dam', 'dam'], ['dam_sire', 'dam sire']]) {
    const v = String(row[f] || '');
    if (/\bout of\b/i.test(v)) out.push(`The ${label} reads "${v}", which still has "out of" in it.`);
    else if ((v.match(/\(/g) || []).length !== (v.match(/\)/g) || []).length) out.push(`The ${label}'s breed code isn't closed properly: "${v}".`);
  }
  if (row.position === null || row.position === undefined) out.push('No placing (1st, 2nd …) is given.');
  const unique = [...new Set(out)];
  return unique.length ? unique
    : ['Marked as not verified in the article, or the same horse was listed twice in this class. Check it against the article.'];
}
