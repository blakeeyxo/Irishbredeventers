// Try the parser on one of Charlie's files without touching the website or the database.
//   npm run parse -- "path/to/6 April 2026.docx" [--year 2010] [--country England] [--all]
// Prints every row that needs checking, and why. --all prints every row.
import { readFileSync } from 'node:fs';
import { docxToText } from '../lib/docx.js';
import { parseResults } from '../lib/parser.js';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const valueArgs = new Set(['--year', '--country'].map(opt).filter(Boolean));
const file = args.find(a => !a.startsWith('--') && !valueArgs.has(a));
if (!file) { console.log('Usage: npm run parse -- <file.docx|file.txt> [--year 2010] [--country England] [--all]'); process.exit(1); }

const buf = readFileSync(file);
const text = /\.docx$/i.test(file) ? await docxToText(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : buf.toString('utf8');
const r = parseResults(text, { defaultYear: Number(opt('--year')) || undefined, defaultCountry: opt('--country') || '' });
const flagged = r.rows.filter(x => x.issues.length);
const tag = (n, b, t) => n ? `${n}${b ? ` (${b})` : ''}${t ? '[TIH]' : ''}` : '?';

for (const row of args.includes('--all') ? r.rows : r.rows.filter(x => x.issues.length || x.warnings.length)) {
  console.log(`\n${row.issues.length ? 'CHECK' : row.warnings.length ? 'NOTE ' : 'OK   '} ${row.position} ${tag(row.horse_name, row.breed, row.tih_flag)}${row.former_name ? ` [was ${row.former_name}]` : ''} ${row.foaled || '?'} ${row.sex}  [${row.country} / ${row.event_name} / ${row.class_name}]`);
  console.log(`      by ${tag(row.sire, row.sire_breed, row.sire_tih)} out of ${tag(row.dam, row.dam_breed, row.dam_tih)} by ${tag(row.dam_sire, row.dam_sire_breed, row.dam_sire_tih)}`);
  console.log(`      Breeder: ${row.breeder || '?'}${row.breeder_county ? ` (${row.breeder_county})` : ''} · Rider: ${row.rider_name || '?'}${row.rider_country ? ` (${row.rider_country})` : ''} · ${row.dressage}, ${row.show_jumping}, ${row.cross_country} = ${row.score ?? '?'}`);
  if (row.issues.length) console.log(`      issues: ${row.issues.join('; ')}`);
  if (row.warnings.length) console.log(`      notes: ${row.warnings.join('; ')}`);
  if (row.issues.length) console.log(`      line: ${row.raw}`);
}
if (r.notes.length) { console.log(`\nLines not used (${r.notes.length}):`); r.notes.forEach(n => console.log('  - ' + n.slice(0, 140))); }
console.log(`\n${r.weekLabel || '(no title line)'}: ${r.rows.length} placings, ${r.events} events, ${r.classes} classes. ${r.rows.length - flagged.length} read cleanly, ${flagged.length} need checking (${r.rows.length ? Math.round(100 * (r.rows.length - flagged.length) / r.rows.length) : 0}% clean).`);
