// Breeding records: find a horse and correct its sire, dam, dam sire, breeder, year, sex and breed by hand. All
// breeding comes from the submitted results and Charlie's records; no source is shown anywhere. The horse record is
// updated, and every result of that horse on the site shows the new details at once.
import { normaliseName, splitTagged, displayName, splitBreeder, sireFamily, SIRE_FAMILIES } from './names.js';
import { matchSires, matchAmong } from './stallions.js';
import { DOUBT_SQL } from './results.js';

const isUnk = v => !v || /^(unk|unknown|n\/a|not known)$/i.test(String(v).trim());

const HORSE_SELECT = `SELECT h.id, h.name, h.birth_year, h.sex, h.breed_code, h.tih_flag, h.breeding_source, h.breeding_updated_at,
    s.name AS sire, s.breed_code AS sire_breed, s.tih_flag AS sire_tih,
    d.name AS dam, d.breed_code AS dam_breed, d.tih_flag AS dam_tih,
    ds.name AS dam_sire, ds.breed_code AS dam_sire_breed, ds.tih_flag AS dam_sire_tih,
    b.name AS breeder, b.county AS breeder_county,
    (SELECT COUNT(*) FROM results r WHERE r.horse_id = h.id) AS runs,
    (SELECT MAX(e.start_date) FROM results r JOIN events e ON e.id = r.event_id WHERE r.horse_id = h.id) AS last_run,
    (SELECT GROUP_CONCAT(a.former_name, ', ') FROM horse_aliases a WHERE a.horse_id = h.id) AS former,
    (SELECT MAX(p.id) FROM placings p JOIN results r ON r.id = p.result_id WHERE r.horse_id = h.id) AS placing_id
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

  // The same horse already on record under these details: move this one's results across and remove it.
  const other = await db.prepare(`SELECT id FROM horses WHERE identity_key = ? AND id <> ?`)
    .bind(`${horse.name_normalised}|${year || 0}|${sire.id || 0}|${dam.id || 0}`, id).first();
  let target = id, merged = false;
  if (other) { target = other.id; merged = true; await mergeHorse(db, id, target); }
  await db.prepare(`UPDATE horses SET birth_year = ?, sex = ?, breed_code = ?, tih_flag = ?, sire_id = ?, dam_id = ?, damsire_id = ?, breeder_id = ?,
      breeding_updated_at = datetime('now') WHERE id = ?`)
    .bind(year, sex, breed, tih, sire.id, dam.id, damSire.id, breeder.id, target).run();
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

/** Joins two records of the same horse: results, former names and remembered spellings move to `into`. */
export async function mergeHorse(db, from, into) {
  await db.batch([
    db.prepare('UPDATE OR IGNORE results SET horse_id = ? WHERE horse_id = ?').bind(into, from),
    db.prepare('DELETE FROM placings WHERE result_id IN (SELECT id FROM results WHERE horse_id = ?)').bind(from),
    db.prepare('DELETE FROM results WHERE horse_id = ?').bind(from),
    db.prepare('UPDATE OR IGNORE horse_aliases SET horse_id = ? WHERE horse_id = ?').bind(into, from),
    db.prepare('DELETE FROM horse_aliases WHERE horse_id = ?').bind(from),
    db.prepare("UPDATE name_matches SET target_id = ? WHERE kind = 'horse' AND target_id = ?").bind(into, from),
    db.prepare('UPDATE horses SET sex = CASE WHEN sex = \'\' THEN (SELECT sex FROM horses WHERE id = ?1) ELSE sex END, breeder_id = IFNULL(breeder_id, (SELECT breeder_id FROM horses WHERE id = ?1)), damsire_id = IFNULL(damsire_id, (SELECT damsire_id FROM horses WHERE id = ?1)) WHERE id = ?2').bind(from, into),
    db.prepare('DELETE FROM horses WHERE id = ?').bind(from)
  ]);
}

/* ---------- Stallions and sires ---------- */

const SIRE_DISPLAY = alias => `${alias}.name || CASE WHEN ${alias}.breed_code <> '' THEN ' (' || ${alias}.breed_code || ')' ELSE '' END || CASE WHEN ${alias}.tih_flag = 1 THEN '[TIH]' ELSE '' END`;

/** Every result of horses by (or out of a mare by) this sire shows its current name, code and [TIH]. */
async function refreshSireDisplay(db, sireId) {
  await db.batch([
    db.prepare(`UPDATE placings SET sire = (SELECT ${SIRE_DISPLAY('s')} FROM results r JOIN horses h ON h.id = r.horse_id JOIN sires s ON s.id = h.sire_id WHERE r.id = placings.result_id)
      WHERE result_id IN (SELECT r.id FROM results r JOIN horses h ON h.id = r.horse_id WHERE h.sire_id = ?)`).bind(sireId),
    db.prepare(`UPDATE placings SET dam_sire = (SELECT ${SIRE_DISPLAY('s')} FROM results r JOIN horses h ON h.id = r.horse_id LEFT JOIN dams d ON d.id = h.dam_id
        JOIN sires s ON s.id = COALESCE(h.damsire_id, d.sire_id) WHERE r.id = placings.result_id)
      WHERE result_id IN (SELECT r.id FROM results r JOIN horses h ON h.id = r.horse_id LEFT JOIN dams d ON d.id = h.dam_id
        WHERE COALESCE(h.damsire_id, d.sire_id) = ?)`).bind(sireId)
  ]);
}

/** Sires by name (or all, most progeny first), with how many horses they appear for and likely duplicate spellings. */
export async function findSires(db, { q = '', limit = 60 } = {}) {
  const key = normaliseName(q);
  const { results } = await db.prepare(`SELECT s.id, s.name, s.breed_code, s.tih_flag, s.birth_year, s.ped_sire, s.ped_dam, s.ped_dam_sire, s.ped_breeder,
      (SELECT COUNT(*) FROM horses h WHERE h.sire_id = s.id) AS progeny,
      (SELECT COUNT(*) FROM horses h LEFT JOIN dams d ON d.id = h.dam_id WHERE COALESCE(h.damsire_id, d.sire_id) = s.id) AS as_dam_sire,
      (SELECT COUNT(*) FROM results r JOIN horses h ON h.id = r.horse_id WHERE h.sire_id = s.id) AS results
    FROM sires s WHERE (? = '' OR s.name_normalised LIKE ?) ORDER BY progeny DESC, s.name LIMIT ${Number(limit) || 60}`).bind(key, `%${key}%`).all();
  const all = (await db.prepare('SELECT id, name, name_normalised FROM sires').all()).results;
  for (const s of results) s.similar = matchAmong(all, s.name).filter(x => x.id !== s.id).map(x => x.name);
  return results;
}

/**
 * Saves a sire: { name, breed, tih, merge_into }. A new name that is already another sire's (or merge_into)
 * joins this record into that one: its horses, mares and dam-sire links all move across. Returns { id, merged }.
 */
export async function saveSire(db, id, f) {
  const sire = await db.prepare('SELECT * FROM sires WHERE id = ?').bind(id).first();
  if (!sire) throw new Error('That sire is not in the records.');
  // His own breeding, edited like a horse's: as typed, blank or UNK means not known.
  const year = Number(f.birth_year) || null;
  if (year && (year < 1950 || year > new Date().getFullYear())) throw new Error('The year of birth does not look right.');
  const own = k => (isUnk(f[k]) ? '' : String(f[k]).trim().slice(0, 160));
  const ped = { birth_year: year, ped_sire: own('sire'), ped_dam: own('dam'), ped_dam_sire: own('dam_sire'), ped_breeder: own('breeder') };
  const t = splitTagged(f.name || sire.name);
  const name = t.name || sire.name;
  const breed = String(f.breed ?? t.breed_code ?? sire.breed_code).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 8);
  const tih = f.tih || t.tih ? 1 : 0;
  let into = null;
  if (f.merge_into) {
    into = await db.prepare('SELECT id FROM sires WHERE name_normalised = ?').bind(sireCoreName(f.merge_into)).first();
    if (!into) throw new Error(`There is no sire called "${f.merge_into}" to join this one into.`);
  } else {
    into = await db.prepare('SELECT id FROM sires WHERE name_normalised = ? AND id <> ?').bind(normaliseName(name), id).first();
  }
  if (into && into.id === id) into = null;
  if (!into) {
    await db.prepare('UPDATE sires SET name = ?, name_normalised = ?, breed_code = ?, tih_flag = ?, birth_year = ?, ped_sire = ?, ped_dam = ?, ped_dam_sire = ?, ped_breeder = ? WHERE id = ?')
      .bind(name, normaliseName(name), breed, tih, ped.birth_year, ped.ped_sire, ped.ped_dam, ped.ped_dam_sire, ped.ped_breeder, id).run();
    await refreshSireDisplay(db, id);
    return { id, merged: false };
  }
  // Joined into the other record: what was typed fills any gap there; what is already there stays.
  await db.prepare(`UPDATE sires SET birth_year = COALESCE(birth_year, ?), ped_sire = CASE WHEN ped_sire = '' THEN ? ELSE ped_sire END, ped_dam = CASE WHEN ped_dam = '' THEN ? ELSE ped_dam END,
      ped_dam_sire = CASE WHEN ped_dam_sire = '' THEN ? ELSE ped_dam_sire END, ped_breeder = CASE WHEN ped_breeder = '' THEN ? ELSE ped_breeder END WHERE id = ?`)
    .bind(ped.birth_year, ped.ped_sire, ped.ped_dam, ped.ped_dam_sire, ped.ped_breeder, into.id).run();
  await mergeSire(db, id, into.id);
  if (breed || tih) await db.prepare("UPDATE sires SET breed_code = CASE WHEN breed_code = '' THEN ? ELSE breed_code END, tih_flag = MAX(tih_flag, ?) WHERE id = ?").bind(breed, tih, into.id).run();
  await refreshSireDisplay(db, into.id);
  return { id: into.id, merged: true };
}
const sireCoreName = s => normaliseName(splitTagged(s).name || s);

/** Moves everything from one sire record to another (a typo: "Imperial Hights" → "Imperial Heights"). */
export async function mergeSire(db, from, into) {
  // Mares by the old record: onto the same mare under the new one if she is already there, otherwise re-pointed.
  for (const d of (await db.prepare('SELECT id, name_normalised FROM dams WHERE sire_id = ?').bind(from).all()).results) {
    const same = await db.prepare('SELECT id FROM dams WHERE name_normalised = ? AND sire_id = ?').bind(d.name_normalised, into).first();
    if (!same) { await db.prepare('UPDATE dams SET sire_id = ? WHERE id = ?').bind(into, d.id).run(); continue; }
    await moveHorses(db, 'dam_id', d.id, same.id);
    await db.prepare('DELETE FROM dams WHERE id = ?').bind(d.id).run();
  }
  await moveHorses(db, 'sire_id', from, into);
  await db.batch([
    db.prepare('UPDATE horses SET damsire_id = ? WHERE damsire_id = ?').bind(into, from),
    db.prepare("UPDATE name_matches SET target_id = ? WHERE kind = 'sire' AND target_id = ?").bind(into, from),
    db.prepare('DELETE FROM sires WHERE id = ?').bind(from)
  ]);
}
// Re-points horses' sire or dam; a horse that becomes the same as one already on record is joined to it.
async function moveHorses(db, col, from, into) {
  for (const h of (await db.prepare(`SELECT id, name_normalised, birth_year, sire_id, dam_id FROM horses WHERE ${col} = ?`).bind(from).all()).results) {
    const sire = col === 'sire_id' ? into : h.sire_id, dam = col === 'dam_id' ? into : h.dam_id;
    const other = await db.prepare('SELECT id FROM horses WHERE identity_key = ? AND id <> ?')
      .bind(`${h.name_normalised}|${h.birth_year || 0}|${sire || 0}|${dam || 0}`, h.id).first();
    if (other) await mergeHorse(db, h.id, other.id);
    else await db.prepare(`UPDATE horses SET ${col} = ? WHERE id = ?`).bind(into, h.id).run();
  }
}

/**
 * Links every spelling of a known stallion (see SIRE_FAMILIES) to its one record: the same sire, as sire and as dam
 * sire. Mares by a variant move to the same mare by the standard record, and horses that become the same are joined.
 * Returns how many spellings were joined. Safe to run any time; nothing changes when there is nothing to join.
 */
export async function tidyKnownSires(db) {
  const all = (await db.prepare('SELECT id, name, name_normalised FROM sires').all()).results;
  let joined = 0;
  for (const fam of SIRE_FAMILIES) {
    const target = all.find(s => s.name_normalised === normaliseName(fam.name));
    if (!target) continue;
    const variants = all.filter(s => s.id !== target.id && sireFamily(s.name) === fam.name);
    for (const v of variants) { await mergeSire(db, v.id, target.id); joined++; }
    if (variants.length) await refreshSireDisplay(db, target.id);
  }
  return joined;
}

/**
 * The stallions to show alongside the horses when a name or a sire is searched: sires whose name matches, or the
 * sire(s) a "progeny of" search is for. Each with how many horses he has and likely other spellings.
 */
export async function findStallions(db, { q = '', sire = '' } = {}) {
  if (sire) {
    const ids = new Set((await matchSires(db, sire)).map(x => x.id));
    const all = await findSires(db, { q: '', limit: 5000 });
    return all.filter(x => ids.has(x.id));
  }
  return q ? findSires(db, { q, limit: 12 }) : [];
}
