/*
 * "Send in a result": missing results, corrections and breeding sent in by owners, breeders and riders (IBSR).
 * Each waits in the owner area (Messages) until it is approved. Submissions are kept in the shared database.
 * Approving a result puts it live on the site through the same import as an uploaded results file (lib/import.js,
 * into the site's own database); approving breeding saves it to the shared horse database (lib/shared.js), the
 * "main brain" both sites fill their gaps from. Contact details stay private.
 */
import { runUpload } from './shared.js';
import { feiName } from './fei.js';
import { cleanRows, importResults } from './import.js';
import { COUNTRY_CODES } from './names.js';

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const KINDS = ['missing_result', 'result_correction', 'breeding'];
export const KIND_LABEL = { missing_result: 'Missing result', result_correction: 'Correction to a result', breeding: 'Breeding' };

/** Checks a form from the site → { row } to save, or { error }. */
export function readSubmission(b) {
  const kind = KINDS.includes(b.kind) ? b.kind : '';
  if (!kind) return { error: 'Choose what you are sending in.' };
  const horse = clean(b.horse_name, 120);
  if (!horse) return { error: 'Add the horse\'s name.' };
  const fei = clean(b.fei_id, 10).toUpperCase().replace(/\s/g, '');
  if (fei && !/^[0-9A-Z]{5,8}$/.test(fei)) return { error: 'That FEI ID doesn\'t look right (e.g. 109WK62). Leave it empty if you don\'t know it.' };
  const year = Number(b.foaled_year) || null;
  if (year && (year < 1970 || year > new Date().getUTCFullYear())) return { error: 'Check the year of birth.' };
  const name = clean(b.contact_name, 120), email = clean(b.contact_email, 200);
  if (!name || !/^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/.test(email)) return { error: 'Add your name and email, so Charlie can check with you.' };
  let result = null, breeding = null;
  if (kind !== 'breeding') {
    const date = clean(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Add the date of the class.' };
    const show = clean(b.show, 120);
    if (!show) return { error: 'Add the show (venue).' };
    result = { date, show, country: clean(b.country, 40), level: clean(b.level, 30), class_name: clean(b.class_name, 120),
      height_cm: Number(b.height_cm) || null, placing: Number(b.placing) || null,
      rider: clean(b.rider, 120), rider_country: clean(b.rider_country, 3).toUpperCase(), owner: clean(b.owner, 160) };
    if (!result.placing) return { error: 'Add the placing (1 for first).' };
  } else {
    breeding = { sire: clean(b.sire, 120), dam: clean(b.dam, 120), dam_sire: clean(b.dam_sire, 120), breeder: clean(b.breeder, 160) };
    if (!breeding.sire && !breeding.dam && !breeding.dam_sire && !breeding.breeder) return { error: 'Add the sire, dam, dam sire or breeder.' };
  }
  return { row: { kind, horse_name: horse, fei_id: fei, foaled_year: year, result, breeding, message: clean(b.message, 2000),
    contact_name: name, contact_email: email, relation: clean(b.relation, 20) } };
}

export async function saveSubmission(db, site, row) {
  await db.prepare(`INSERT INTO submission (site, kind, horse_name, fei_id, foaled_year, result_json, breeding_json, message, contact_name, contact_email, relation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(site, row.kind, row.horse_name, row.fei_id, row.foaled_year,
    row.result ? JSON.stringify(row.result) : null, row.breeding ? JSON.stringify(row.breeding) : null, row.message,
    row.contact_name, row.contact_email, row.relation).run();
}

// "Ireland", "IRL" or "irl" → the country name used on the results pages.
function countryName(c) {
  const s = clean(c, 40);
  if (/^[A-Za-z]{3}$/.test(s) && COUNTRY_CODES[s.toUpperCase()]) return COUNTRY_CODES[s.toUpperCase()];
  return s ? s[0].toUpperCase() + s.slice(1) : 'Other';
}

/** A result sent in, as a row for the upload import. Its breeding comes from the horse's latest result on the site. */
async function asRow(siteDb, s) {
  const r = JSON.parse(s.result_json);
  const known = await siteDb.prepare(`SELECT p.horse_name, p.breed, p.foaled, p.sex, p.sire, p.dam, p.dam_sire, p.breeder FROM placings p
      WHERE p.horse_name = ? COLLATE NOCASE AND (? IS NULL OR p.foaled IS NULL OR p.foaled = ?) ORDER BY p.id DESC LIMIT 1`)
    .bind(feiName(s.horse_name), s.foaled_year, s.foaled_year).first();
  const cls = [r.level, r.class_name, r.height_cm ? `${(r.height_cm / 100).toFixed(2)}m` : ''].filter(Boolean).join(' · ') || 'Class not given';
  const tag = known && known.breed ? known.breed.match(/^([^[]*)(\[TIH\])?$/) : null;
  return {
    position: r.placing, horse_name: known ? known.horse_name : feiName(s.horse_name), foaled: known ? known.foaled : s.foaled_year,
    breed: tag ? tag[1] : 'ISH', tih_flag: !!(tag && tag[2]), sex: known ? known.sex : '',
    sire: known ? known.sire : '', dam: known ? known.dam : '', dam_sire: known ? known.dam_sire : '', breeder: known ? known.breeder : '',
    rider_name: r.rider, rider_country: r.rider_country, owner: r.owner || '',
    country: countryName(r.country), event_name: r.show, start_date: r.date, season: Number(r.date.slice(0, 4)),
    class_name: cls, verified: true, raw_line: `Sent in by ${s.contact_name} (${s.relation || 'other'})`, parse_ok: true
  };
}

export async function listSubmissions(db, site, status = 'pending') {
  const [rows, counts] = await db.batch([
    db.prepare('SELECT * FROM submission WHERE site = ? AND status = ? ORDER BY created_at DESC LIMIT 200').bind(site, status),
    db.prepare('SELECT status, COUNT(*) AS n FROM submission WHERE site = ? GROUP BY status').bind(site)
  ]);
  return {
    submissions: rows.results.map(s => ({ ...s, result: s.result_json ? JSON.parse(s.result_json) : null, breeding: s.breeding_json ? JSON.parse(s.breeding_json) : null })),
    counts: Object.fromEntries(counts.results.map(c => [c.status, c.n]))
  };
}

/**
 * Approve: put it live. A result goes into the site's own database (siteDb) through the upload import; a correction
 * replaces the horse's result in that class. Breeding goes to the shared horse database (db).
 */
export async function approveSubmission(db, site, id, user = '', { siteDb, withOwner = true } = {}) {
  const s = await db.prepare('SELECT * FROM submission WHERE id = ? AND site = ?').bind(id, site).first();
  if (!s) throw new Error('That submission is no longer there.');
  if (s.status !== 'pending') throw new Error('That submission has already been dealt with.');
  let done;
  if (s.kind === 'breeding') {
    const b = JSON.parse(s.breeding_json);
    const owners = (await db.prepare("SELECT id FROM source WHERE slug = 'owners'").first()).id;
    const cell = v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const csv = `Name,FEI ID,Year,Sire,Dam,Dam sire,Breeder\n${[feiName(s.horse_name), s.fei_id, s.foaled_year || '', b.sire, b.dam, b.dam_sire, b.breeder].map(cell).join(',')}`;
    const r = await runUpload(db, csv, { sourceId: owners, save: true, overwrite: true, label: `Sent in: ${s.horse_name}`, user });
    if (r.counts.held) throw new Error(`Not saved: ${(r.rows[0] && r.rows[0].notes || []).join(' ')}`);
    done = r.saved ? 'Breeding saved to the shared horse database.' : 'This breeding was already on file.';
  } else {
    if (!siteDb) throw new Error('The results database is not connected.');
    const rows = cleanRows([await asRow(siteDb, s)], new Date().getUTCFullYear());
    let corrected = false;
    if (s.kind === 'result_correction') {
      // The horse's result at that show (the event running on that date) is replaced by the corrected one. When the
      // horse ran in more than one class there, the class sent in has to match one of them.
      const { results: found } = await siteDb.prepare(`SELECT p.id, p.result_id, c.name AS class_name, e.name AS event_name, e.country, e.start_date, e.end_date
          FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id
          WHERE p.horse_name = ? COLLATE NOCASE AND e.start_date <= ? AND (CASE WHEN e.end_date = '' THEN e.start_date ELSE e.end_date END) >= ?`)
        .bind(rows[0].horse_name, rows[0].start_date, rows[0].start_date).all();
      const sent = String(JSON.parse(s.result_json).class_name || '').toLowerCase();
      const old = found.length === 1 ? found[0] : found.find(f => sent && f.class_name.toLowerCase().includes(sent));
      if (!old) throw new Error(found.length ? 'Not saved: the horse ran in more than one class at that show. Fix it in Results → Edit instead.' : 'Not saved: no result for this horse at a show on that date. Approve it as a missing result instead, or fix it in Results → Edit.');
      Object.assign(rows[0], { class_name: old.class_name, event_name: old.event_name, country: old.country, start_date: old.start_date, end_date: old.end_date });
      await siteDb.batch([siteDb.prepare('DELETE FROM placings WHERE id = ?').bind(old.id), siteDb.prepare('DELETE FROM results WHERE id = ?').bind(old.result_id)]);
      corrected = true;
    }
    const out = await importResults(siteDb, rows, { decisions: {}, weekLabel: `Sent in: ${s.horse_name}`, withOwner });
    if (out.needsDecision) throw new Error('Not saved: a name in it looks like one already on file. Add it through Results → upload instead, where you can say whether it is the same.');
    done = corrected ? 'Result corrected.' : out.results ? 'Result added.' : 'This result was already on file.';
  }
  await db.prepare("UPDATE submission SET status = 'approved', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?").bind(user, done, id).run();
  return { message: done };
}

export async function rejectSubmission(db, site, id, user = '', note = '') {
  const r = await db.prepare("UPDATE submission SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND site = ? AND status = 'pending'")
    .bind(user, clean(note, 300), id, site).run();
  if (!r.meta.changes) throw new Error('That submission has already been dealt with.');
}
