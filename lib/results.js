// Database work for the public results pages. Saving an upload is in import.js.

// The rider comes from the linked result. It is shown on the results pages but is not in the search
// index (placings_fts), so a search never matches a rider.
export const PLACING_COLUMNS = `
  p.id, p.position, p.horse_name, p.former_name, p.breed, p.foaled, p.sex,
  p.sire, p.dam, p.dam_sire, p.breeder, p.dressage, p.show_jumping, p.cross_country,
  p.score, p.verified, p.batch_id, IFNULL(r.rider_name, '') AS rider_name, IFNULL(r.rider_country, '') AS rider_country,
  c.name AS class_name, e.id AS event_id, e.name AS event_name, e.date_text, e.start_date,
  e.country, e.season, e.article_url`;

export const PLACING_JOIN = `FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id
  LEFT JOIN results r ON r.id = p.result_id`;

// Newest events first; classes in the order they were uploaded; in each class the verified placings in
// order, then the unverified ones at the end of that class.
export const PLACING_ORDER = `ORDER BY e.start_date DESC, e.id, c.id, p.verified DESC, p.position, p.id`;

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
