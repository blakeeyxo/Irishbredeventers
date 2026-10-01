// Helpers for turning a LOCAL database into migration SQL. Rows are linked by their natural identity
// (a sire by name, a horse by name + year + sire + dam, an event by name + start date + country) instead of
// internal ids, so the SQL can run on a database that already holds some of the same content.
import { spawnSync } from 'node:child_process';

export function queryLocal(persist, sql) {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'irishbredeventers', '--local', '--persist-to', persist, '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0].results;
}

// Line breaks inside text values are held as NL until add() has tidied the SQL layout, so paragraphs survive.
export const NL = '\u0001';
export const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''").replace(/\n/g, NL)}'`;
export const sireId = n => n ? `(SELECT id FROM sires WHERE name_normalised = ${q(n)})` : 'NULL';
export const damId = (n, sireN) => n ? `(SELECT id FROM dams WHERE name_normalised = ${q(n)} AND sire_key = IFNULL(${sireId(sireN)}, 0))` : 'NULL';
export const breederId = (n, county) => n ? `(SELECT id FROM breeders WHERE name_normalised = ${q(n)} AND county = ${q(county || '')})` : 'NULL';
export const horseId = h => `(SELECT id FROM horses WHERE name_normalised = ${q(h.h_norm)} AND IFNULL(birth_year, 0) = ${Number(h.h_year) || 0}
    AND IFNULL(sire_id, 0) = IFNULL(${sireId(h.h_sire)}, 0) AND IFNULL(dam_id, 0) = IFNULL(${damId(h.h_dam, h.h_dam_sire)}, 0))`;
export const eventId = e => `(SELECT id FROM events WHERE name = ${q(e.ev_name)} AND start_date = ${q(e.ev_start)} AND country = ${q(e.ev_country)})`;
export const classId = e => `(SELECT id FROM classes WHERE event_id = ${eventId(e)} AND name = ${q(e.cl_name)})`;
export const batchId = label => label ? `(SELECT id FROM batches WHERE label = ${q(label)} ORDER BY id LIMIT 1)` : 'NULL';

// Columns that identify a horse (joined into several queries below)
export const HORSE_KEY = `h.name_normalised AS h_norm, h.birth_year AS h_year, hs.name_normalised AS h_sire, hd.name_normalised AS h_dam, hds.name_normalised AS h_dam_sire`;
export const HORSE_JOIN = `LEFT JOIN sires hs ON hs.id = h.sire_id LEFT JOIN dams hd ON hd.id = h.dam_id LEFT JOIN sires hds ON hds.id = hd.sire_id`;
export const EVENT_KEY = `e.name AS ev_name, e.start_date AS ev_start, e.country AS ev_country`;
