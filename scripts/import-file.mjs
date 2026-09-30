// Import a results file into the LOCAL site, the same way the owner area does (read → check → confirm).
//   npm run import:local -- seed/sample-results-2-weeks.txt [--near new|same] [--same sire,dam] [--year 2010] [--country England]
// --near answers every near-match question the same way; --same answers "same" only for those kinds (the rest "different");
// --different lists questions to answer "different" regardless, e.g. --different "sire:guidam".
// Needs `npm run dev` running. Refuses anything but localhost, so it can never touch the live database.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const valueArgs = new Set(['--year', '--country', '--near', '--url', '--same', '--different'].map(opt).filter(Boolean));
const differentKeys = (opt('--different') || '').split(',').map(s => s.trim()).filter(Boolean);
const sameKinds = (opt('--same') || '').split(',').filter(Boolean);
const answering = opt('--near') || sameKinds.length;
const file = args.find(a => !a.startsWith('--') && !valueArgs.has(a));
const base = opt('--url') || 'http://localhost:8787';
if (!file) { console.log('Usage: npm run import:local -- <file.docx|file.txt> [--near new|same] [--year 2010] [--country England]'); process.exit(1); }
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) { console.error('Local only: --url must be http://localhost…'); process.exit(1); }

async function call(path, init) {
  const res = await fetch(base + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}

// Split a file holding several weeks: each week starts with its title line, e.g. "16.3.26 International Eventing Results."
const raw = readFileSync(file);
const weeks = /\.docx$/i.test(file) ? [null] : raw.toString('utf8').split(/\n(?=\d{1,2}\.\d{1,2}\.\d{2,4}\s)/);

for (const week of weeks) {
  const form = new FormData();
  if (week === null) form.append('file', new Blob([raw]), basename(file));
  else form.append('text', week);
  if (opt('--year')) form.append('year', opt('--year'));
  if (opt('--country')) form.append('country', opt('--country'));
  const parsed = await call('/api/admin/parse', { method: 'POST', body: form });
  const rows = parsed.rows.map(r => ({ ...r }));
  const check = await call('/api/admin/import/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows }) });
  const decisions = {};
  for (const q of check.questions) {
    if (!answering) {
      console.log(`\nNear match: ${q.kind} "${q.name}" (${q.context}) looks like: ${q.candidates.map(c => `${c.label} [${c.detail}]`).join(' / ')}`);
    }
    decisions[q.key] = !differentKeys.includes(q.key) && (opt('--near') === 'same' || sameKinds.includes(q.kind)) ? q.candidates[0].id : 'new';
  }
  if (check.questions.length && !answering) { console.log('\nAnswer these in the owner area, or rerun with --near new|same.'); process.exit(1); }
  const out = await call('/api/admin/import', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows, decisions, weekLabel: parsed.weekLabel, notify: false }) });
  console.log(`${parsed.weekLabel || basename(file)}: ${out.results} new results (${out.alreadySaved} already saved), ${out.horses} new horses, ${out.sires} new sires, ${out.dams} new dams, ${out.breeders} new breeders. ${parsed.rows.filter(r => r.issues.length).length} unverified.`);
}
