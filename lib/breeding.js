// Breeding records: find a horse and correct its sire, dam, dam sire, breeder, year, sex and breed by hand
// (for example from sporthorse-data.com). The horse record is updated, and every result of that horse on the
// site shows the new details at once.
import { normaliseName, splitTagged, displayName, splitBreeder } from './names.js';
import { matchSires } from './stallions.js';
import { DOUBT_SQL } from './results.js';

const isUnk = v => !v || /^(unk|unknown|n\/a|not known)$/i.test(String(v).trim());

const HORSE_SELECT = `SELECT h.id, h.name, h.birth_year, h.sex, h.breed_code, h.tih_flag, h.breeding_source, h.breeding_updated_at,
    s.name AS sire, s.breed_code AS sire_breed, s.tih_flag AS sire_tih,
    d.name AS dam, d.breed_code AS dam_breed, d.tih_flag AS dam_tih,
    ds.name AS dam_sire, ds.breed_code AS dam_sire_breed, ds.tih_flag AS dam_sire_tih,
    b.name AS breeder, b.county AS breeder_county,
    (SELECT COUNT(*) FROM results r WHERE r.horse_id = h.id) AS runs,
    (SELECT MAX(e.start_date) FROM results r JOIN events e ON e.id = r.event_id WHERE r.horse_id = h.id) AS last_run,
    (SELECT GROUP_CONCAT(a.former_name, ', ') FROM horse_aliases a WHERE a.horse_id = h.id) AS former
  FROM horses h LEFT JOIN sires s ON s.id = h.sire_id LEFT JOIN dams d ON d.id = h.dam_id
    LEFT JOIN sires ds ON ds.id = COALESCE(h.damsire_id, d.sire_id) LEFT JOIN breeders b ON b.id = h.breeder_id`;
const UNK_SQL = col => `(${col} IS NULL OR LOWER(TRIM(${col})) IN ('', 'unk', 'unknown', 'n/a', 'not known'))`;
// A horse with any part of its breeding not recorded.
export const HORSE_GAP_SQL = `(${UNK_SQL('s.name')} OR ${UNK_SQL('d.name')} OR ${UNK_SQL('ds.name')} OR ${UNK_SQL('b.name')})`;

/** Horses matching a name (or former name), by a stallion's names, and/or only those with gaps. */
export async function findHorses(db, { q = '', sire = '', gaps = false, limit = 100 } = {}) {
  const where = [], binds = [];
  const key = normaliseName(q);
  if (key) {
    where.push(`(h.name_normalised LIKE ? OR h.id IN (SELECT horse_id FROM horse_aliases WHERE former_name_normalised LIKE ?))`);
    binds.push(`%${key}%`, `%${key}%`);
  }
  if (sire) {
    const ids = (await matchSires(db, sire)).map(s => s.id);
    if (!ids.length) return { horses: [], total: 0 };
    where.push(`h.sire_id IN (${ids.map(() => '?').join(', ')})`);
    binds.push(...ids);
  }
  if (gaps) where.push(HORSE_GAP_SQL);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await db.prepare(`${HORSE_SELECT} ${w} ORDER BY last_run IS NULL, last_run DESC, h.name LIMIT ${Number(limit) || 100}`).bind(...binds).all();
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM horses h LEFT JOIN sires s ON s.id = h.sire_id LEFT JOIN dams d ON d.id = h.dam_id
    LEFT JOIN sires ds ON ds.id = COALESCE(h.damsire_id, d.sire_id) LEFT JOIN breeders b ON b.id = h.breeder_id ${w}`).bind(...binds).first()).n;
  return { horses: results, total };
}

/** How many horses have part of their breeding missing (for the tab's count). */
export async function gapCount(db) {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM horses h LEFT JOIN sires s ON s.id = h.sire_id LEFT JOIN dams d ON d.id = h.dam_id
    LEFT JOIN sires ds ON ds.id = COALESCE(h.damsire_id, d.sire_id) LEFT JOIN breeders b ON b.id = h.breeder_id
    WHERE ${HORSE_GAP_SQL} AND EXISTS (SELECT 1 FROM results r WHERE r.horse_id = h.id)`).first()).n;
}

async function sireId(db, raw) {
  if (isUnk(raw)) return { id: null, show: '' };
  const t = splitTagged(raw);
  if (!t.name || isUnk(t.name)) return { id: null, show: '' };
  const row = await db.prepare(`INSERT INTO sires (name, name_normalised, breed_code, tih_flag) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(name_normalised) DO UPDATE SET breed_code = CASE WHEN ?3 <> '' THEN ?3 ELSE sires.breed_code END,
        tih_flag = MAX(sires.tih_flag, ?4) RETURNING id, name, breed_code, tih_flag`)
    .bind(t.name, normaliseName(t.name), t.breed_code === 'unk' ? '' : t.breed_code, t.tih ? 1 : 0).first();
  return { id: row.id, show: displayName(row.name, row.breed_code, row.tih_flag) };
}
async function damId(db, raw, damSireId) {
  if (isUnk(raw)) return { id: null, show: '' };
  const t = splitTagged(raw);
  if (!t.name || isUnk(t.name)) return { id: null, show: '' };
  const row = await db.prepare(`INSERT INTO dams (name, name_normalised, breed_code, tih_flag, sire_id) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(name_normalised, sire_key) DO UPDATE SET breed_code = CASE WHEN ?3 <> '' THEN ?3 ELSE dams.breed_code END,
        tih_flag = MAX(dams.tih_flag, ?4) RETURNING id, name, breed_code, tih_flag`)
    .bind(t.name, normaliseName(t.name), t.breed_code === 'unk' ? '' : t.breed_code, t.tih ? 1 : 0, damSireId).first();
  return { id: row.id, show: displayName(row.name, row.breed_code, row.tih_flag) };
}
async function breederId(db, raw) {
  if (isUnk(raw)) return { id: null, show: '' };
  const b = splitBreeder(raw);
  if (!b.name || isUnk(b.name)) return { id: null, show: '' };
  const row = await db.prepare(`INSERT INTO breeders (name, name_normalised, county) VALUES (?1, ?2, ?3)
      ON CONFLICT(name_normalised, county) DO UPDATE SET name = breeders.name RETURNING id, name, county`)
    .bind(b.name, normaliseName(b.name), b.county || '').first();
  return { id: row.id, show: `${row.name}${row.county ? ` (${row.county})` : ''}` };
}

/**
 * Saves a horse's breeding. f: { sire, dam, dam_sire, breeder, birth_year, sex, breed, tih, source }, names as
 * typed ("Womanizer (KWPN)", "Mary Brennan (Kilkenny)"); blank or UNK means not known. If the corrected details
 * make it the same horse as another record (same name, year, sire and dam), the two are merged.
 * Returns { id, results, merged }.
 */
export async function saveBreeding(db, id, f) {
  const horse = await db.prepare('SELECT id, name, name_normalised FROM horses WHERE id = ?').bind(id).first();
  if (!horse) throw new Error('That horse is not in the records.');
  const year = Number(f.birth_year) || null;
  if (year && (year < 1950 || year > new Date().getFullYear())) throw new Error('The year of birth does not look right.');
  const sire = await sireId(db, f.sire), damSire = await sireId(db, f.dam_sire);
  const dam = await damId(db, f.dam, damSire.id), breeder = await breederId(db, f.breeder);
  const breedTag = splitTagged(f.breed || '');
  const breed = String(breedTag.breed_code || f.breed || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 8);
  const tih = f.tih || breedTag.tih ? 1 : 0;
  const sex = String(f.sex || '').trim().slice(0, 20);
  const source = String(f.source || '').trim().slice(0, 300);

  // The same horse already on record under these details: move this one's results across and remove it.
  const other = await db.prepare(`SELECT id FROM horses WHERE identity_key = ? AND id <> ?`)
    .bind(`${horse.name_normalised}|${year || 0}|${sire.id || 0}|${dam.id || 0}`, id).first();
  let target = id, merged = false;
  if (other) {
    target = other.id; merged = true;
    await db.batch([
      db.prepare('UPDATE OR IGNORE results SET horse_id = ? WHERE horse_id = ?').bind(target, id),
      db.prepare('DELETE FROM placings WHERE result_id IN (SELECT id FROM results WHERE horse_id = ?)').bind(id),
      db.prepare('DELETE FROM results WHERE horse_id = ?').bind(id),
      db.prepare('UPDATE OR IGNORE horse_aliases SET horse_id = ? WHERE horse_id = ?').bind(target, id),
      db.prepare('DELETE FROM horse_aliases WHERE horse_id = ?').bind(id),
      db.prepare("DELETE FROM name_matches WHERE kind = 'horse' AND target_id = ?").bind(id),
      db.prepare('DELETE FROM horses WHERE id = ?').bind(id)
    ]);
  }
  await db.prepare(`UPDATE horses SET birth_year = ?, sex = ?, breed_code = ?, tih_flag = ?, sire_id = ?, dam_id = ?, damsire_id = ?, breeder_id = ?,
      breeding_source = ?, breeding_updated_at = datetime('now') WHERE id = ?`)
    .bind(year, sex, breed, tih, sire.id, dam.id, damSire.id, breeder.id, source, target).run();
  // Results that were on the site only because the gap in their breeding was the one thing wrong: with the
  // breeding filled in they would otherwise count as a problem and drop off the site, so they are now verified.
  const gapOnly = (await db.prepare(`SELECT p.id, p.result_id FROM placings p JOIN results r ON r.id = p.result_id
      WHERE r.horse_id = ? AND p.verified = 0 AND NOT ${DOUBT_SQL}`).bind(target).all()).results;
  // Every result of the horse shows the new details (the search index follows by trigger).
  await db.prepare(`UPDATE placings SET sire = ?, dam = ?, dam_sire = ?, breeder = ?, foaled = ?, sex = ?, breed = ?
      WHERE result_id IN (SELECT id FROM results WHERE horse_id = ?)`)
    .bind(sire.show, dam.show, dam.id ? damSire.show : '', breeder.show, year, sex, breed + (tih ? '[TIH]' : ''), target).run();
  if (gapOnly.length) {
    await db.batch(gapOnly.flatMap(g => [
      db.prepare('UPDATE placings SET verified = 1 WHERE id = ?').bind(g.id),
      db.prepare('UPDATE results SET verified = 1 WHERE id = ?').bind(g.result_id)
    ]));
  }
  const results = (await db.prepare('SELECT COUNT(*) AS n FROM results WHERE horse_id = ?').bind(target).first()).n;
  return { id: target, results, merged };
}
