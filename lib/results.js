// Database work for the public results pages. Saving an upload is in import.js.

// Breeding that isn't known: a blank, "unk" or "unknown". Shown on the site as UNK.
const UNK = col => `LOWER(TRIM(${col})) IN ('', 'unk', 'unknown', 'n/a', 'not known')`;
// OIO (Of Irish Origin): the sire or dam isn't known. Not in doubt, so it keeps its place in the class.
export const OIO_SQL = `(${UNK('p.sire')} OR ${UNK('p.dam')})`;
// Part of the breeding (sire, dam, dam sire or breeder) isn't known. The site shows UNK and no "Unverified";
// the owner area still lists the horse for Charlie to check.
export const GAP_SQL = `(${UNK('p.sire')} OR ${UNK('p.dam')} OR ${UNK('p.dam_sire')} OR ${UNK('p.breeder')})`;
// A breeding line that was read wrongly ("out of" twice), which is a real doubt, not just a gap.
const GARBLED_SQL = `(p.sire LIKE '% out of %' OR p.dam LIKE '% out of %' OR p.dam_sire LIKE '% out of %')`;
// Shown as "Unverified" on the site: genuinely in doubt (conflicting, misread, marked not verified), not just a
// gap in the breeding.
// Listed in the owner area for Charlie to check: every unverified result, including the breeding gaps the site
// now shows as OIO / UNK.
export const TO_CHECK_SQL = `(p.verified = 0)`;
export const DOUBT_SQL = `(p.verified = 0 AND NOT (${GAP_SQL} AND NOT ${GARBLED_SQL}))`;

// The rider comes from the linked result. It is shown on the results pages but is not in the search
// index (placings_fts), so a search never matches a rider.
export const PLACING_COLUMNS = `
  p.id, p.position, p.horse_name, p.former_name, p.breed, p.foaled, p.sex,
  p.sire, p.dam, p.dam_sire, p.breeder, p.dressage, p.show_jumping, p.cross_country,
  p.score, p.verified, (${OIO_SQL}) AS oio, (${GAP_SQL}) AS breeding_gap, (${DOUBT_SQL}) AS doubtful, p.batch_id, IFNULL(r.rider_name, '') AS rider_name, IFNULL(r.rider_country, '') AS rider_country,
  c.name AS class_name, e.id AS event_id, e.name AS event_name, e.date_text, e.start_date,
  e.country, e.season, e.article_url`;

export const PLACING_JOIN = `FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id
  LEFT JOIN results r ON r.id = p.result_id`;

// Newest events first; classes in the order they were uploaded; in each class the placings in order, with
// the ones genuinely in doubt at the end. A gap in the breeding (OIO / UNK) keeps its place.
export const PLACING_ORDER = `ORDER BY e.start_date DESC, e.id, c.id, ${DOUBT_SQL} ASC, p.position, p.id`;

/** Removes a whole upload, then any events and classes left empty. */
export async function deleteBatch(db, batchId) {
  await db.batch([
    db.prepare('DELETE FROM placings WHERE batch_id = ?').bind(batchId),
    db.prepare('DELETE FROM results WHERE batch_id = ?').bind(batchId),
    db.prepare('DELETE FROM batches WHERE id = ?').bind(batchId),
    db.prepare('DELETE FROM classes WHERE id NOT IN (SELECT DISTINCT class_id FROM placings)'),
    db.prepare('DELETE FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM classes)')
  ]);
}

export async function refreshBatchCounts(db, batchId) {
  if (!batchId) return;
  await db.prepare(`UPDATE batches SET
      row_count = (SELECT COUNT(*) FROM placings WHERE batch_id = ?1),
      unverified_count = (SELECT COUNT(*) FROM placings WHERE batch_id = ?1 AND verified = 0)
    WHERE id = ?1`).bind(batchId).run();
}
