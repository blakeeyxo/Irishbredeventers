/*
 * "Send in a result": missing results, corrections and breeding sent in by owners, breeders and riders (IBSR).
 * Each waits in the owner area (Messages) until it is approved; approving puts it live straight away, through the
 * same code as the FEI import (results) and the shared upload (breeding), with "Sent in by owners and breeders"
 * as its source. Contact details stay private.
 */
import { importJumping } from './sj.js';
import { runUpload } from './shared.js';
import { feiName, jumpingScore } from './fei.js';

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
      height_cm: Number(b.height_cm) || null, placing: Number(b.placing) || null, faults: clean(b.faults, 10), time: clean(b.time, 10),
      rider: clean(b.rider, 120), rider_country: clean(b.rider_country, 3).toUpperCase() };
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

const COUNTRY = { ireland: 'IRL', england: 'GBR', 'great britain': 'GBR', uk: 'GBR', scotland: 'GBR', wales: 'GBR', 'northern ireland': 'GBR',
  france: 'FRA', belgium: 'BEL', netherlands: 'NED', holland: 'NED', germany: 'GER', italy: 'ITA', spain: 'ESP', portugal: 'POR',
  usa: 'USA', 'united states': 'USA', canada: 'CAN', mexico: 'MEX', switzerland: 'SUI', austria: 'AUT', sweden: 'SWE', poland: 'POL' };
const countryCode = c => { const s = clean(c, 40); return /^[A-Za-z]{3}$/.test(s) ? s.toUpperCase() : COUNTRY[s.toLowerCase()] || s.toUpperCase().slice(0, 3); };

/** A submission's result as a horse in readFeiPaste's shape, for importJumping. */
function asHorse(s) {
  const r = JSON.parse(s.result_json);
  const faults = r.faults !== '' && !isNaN(Number(r.faults)) ? Number(r.faults) : null;
  const time = r.time !== '' && !isNaN(Number(r.time)) ? Number(r.time) : null;
  const score = faults === null ? '' : `${faults}${time === null ? '' : `/${time}`}`;
  return {
    line: 1, name: feiName(s.horse_name), fei_id: s.fei_id, foaled_year: s.foaled_year, sex: '', colour: '', studbook: 'ISH',
    irish: true, discipline: 'jumping',
    results: [{ line: 1, date: r.date, time: '', show: r.show, country: countryCode(r.country), event: r.level || 'Other',
      competition: r.class_name || (r.height_cm ? `${r.height_cm}` : 'Class'), height_m: r.height_cm ? r.height_cm / 100 : null,
      athlete: r.rider, athlete_country: r.rider_country, position: r.placing, status: '',
      faults, rounds: '', time_s: time, score_text: score || jumpingScore('').text }]
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

/** Approve: put it live (results through the FEI import's code, breeding through the shared upload). */
export async function approveSubmission(db, site, id, user = '') {
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
    done = r.saved ? 'Breeding saved.' : 'This breeding was already on file.';
  } else {
    const r = await importJumping(db, { horses: [asHorse(s)], problems: [] }, { save: true, user, label: `Sent in: ${s.horse_name}`, sourceSlug: 'owners' });
    if (r.counts.held) throw new Error(`Not saved: ${(r.horses[0] && r.horses[0].notes || []).join(' ') || 'the horse could match more than one on file.'}`);
    done = r.counts.results ? 'Result added.' : r.counts.updated ? 'Result corrected.' : 'This result was already on file.';
  }
  await db.prepare("UPDATE submission SET status = 'approved', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?").bind(user, done, id).run();
  return { message: done };
}

export async function rejectSubmission(db, site, id, user = '', note = '') {
  const r = await db.prepare("UPDATE submission SET status = 'rejected', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ? AND site = ? AND status = 'pending'")
    .bind(user, clean(note, 300), id, site).run();
  if (!r.meta.changes) throw new Error('That submission has already been dealt with.');
}
