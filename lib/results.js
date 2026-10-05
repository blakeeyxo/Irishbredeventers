// Database work for the public results pages. Saving an upload is in import.js.

// Breeding that isn't known: a blank, "unk" or "unknown". Shown on the site as UNK.
const UNK = col => `LOWER(TRIM(${col})) IN ('', 'unk', 'unknown', 'n/a', 'not known')`;
// OIO (Of Irish Origin): any of the breeding (sire, dam or dam sire) isn't known. Not a doubt: it is shown.
export const OIO_SQL = `(${UNK('p.sire')} OR ${UNK('p.dam')} OR ${UNK('p.dam_sire')})`;
// Part of the breeding (sire, dam, dam sire or breeder) isn't known. The site shows it, with UNK for the gaps.
export const GAP_SQL = `(${UNK('p.sire')} OR ${UNK('p.dam')} OR ${UNK('p.dam_sire')} OR ${UNK('p.breeder')})`;
// A breeding line that was read wrongly ("out of" twice), which is a real doubt, not just a gap.
const GARBLED_SQL = `(p.sire LIKE '% out of %' OR p.dam LIKE '% out of %' OR p.dam_sire LIKE '% out of %')`;
// A real problem (conflicting, misread, marked not verified in the article; not just a gap in the breeding).
// Hidden from the public site until Charlie fixes it and marks it verified; listed in the owner area.
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

// What the public site shows: everything except results with a real problem, and except uploads the owner has
// unpublished. (COALESCE: a result with no placing row, or a placing with no upload, counts as shown.)
export const PUBLIC_SQL = `(COALESCE(${DOUBT_SQL}, 0) = 0 AND COALESCE((SELECT b.published FROM batches b WHERE b.id = p.batch_id), 1) = 1)`;
// Listed in the owner area's Unverified tab for Charlie: only the real problems.
export const TO_CHECK_SQL = DOUBT_SQL;

// Newest events first; classes in the order they were uploaded; in each class the placings in order (in the
// owner area, the ones with a real problem at the end).
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
      unverified_count = (SELECT COUNT(*) FROM placings p WHERE p.batch_id = ?1 AND ${DOUBT_SQL})
    WHERE id = ?1`).bind(batchId).run();
}
