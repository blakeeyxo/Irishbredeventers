// Try the parser on one of Charlie's files without touching the website.
//   npm run parse -- "path/to/6 April 2026.docx" [--year 2010] [--country England] [--all]
// Prints every row that would be marked unverified, and why. --all prints every row.
import { readFileSync } from 'node:fs';
import { docxToText } from '../lib/docx.js';
import { parseResults } from '../lib/parser.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !/^\d{4}$/.test(a) && args[args.indexOf(a) - 1] !== '--country');
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.log('Usage: npm run parse -- <file.docx|file.txt> [--year 2010] [--country England] [--all]'); process.exit(1); }

const buf = readFileSync(file);
const text = /\.docx$/i.test(file) ? await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : buf.toString('utf8');
const r = parseResults(text, { defaultYear: Number(opt('--year')) || undefined, defaultCountry: opt('--country') || '' });
const flagged = r.rows.filter(x => x.issues.length);

for (const row of args.includes('--all') ? r.rows : flagged) {
  console.log(`\n${row.issues.length ? 'CHECK' : 'OK   '} ${row.position} ${row.horse_name || '?'}  [${row.country} / ${row.event_name} / ${row.class_name}]`);
  console.log(`      by ${row.sire || '?'} out of ${row.dam || '?'} by ${row.dam_sire || '–'} · Breeder: ${row.breeder || '?'} · ${row.dressage}, ${row.show_jumping}, ${row.cross_country} = ${row.score ?? '?'}`);
  if (row.issues.length) console.log(`      issues: ${row.issues.join('; ')}`);
  if (row.warnings.length) console.log(`      notes: ${row.warnings.join('; ')}`);
}
if (r.notes.length) { console.log(`\nLines not used (${r.notes.length}):`); r.notes.forEach(n => console.log('  - ' + n.slice(0, 140))); }
console.log(`\n${r.rows.length} placings, ${r.events} events, ${r.classes} classes. ${r.rows.length - flagged.length} read cleanly, ${flagged.length} need checking (${r.rows.length ? Math.round(100 * (r.rows.length - flagged.length) / r.rows.length) : 0}% clean).`);
