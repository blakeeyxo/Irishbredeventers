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
// A result the article filed under no event at all is always held back, whatever else is true of it.
const NO_EVENT_SQL = `p.class_id IN (SELECT c.id FROM classes c JOIN events e ON e.id = c.event_id WHERE e.name LIKE 'Event heading missing%')`;
export const DOUBT_SQL = `(p.verified = 0 AND (NOT (${GAP_SQL} AND NOT ${GARBLED_SQL}) OR ${NO_EVENT_SQL}))`;

// The rider comes from the linked result. It is shown on the results pages but is not in the search
// index (placings_fts), so a search never matches a rider.
export const PLACING_COLUMNS = `
  p.id, p.position, p.horse_name, p.former_name, p.breed, p.foaled, p.sex,
  p.sire, p.dam, p.dam_sire, p.breeder, p.dressage, p.show_jumping, p.cross_country,
  p.score, p.verified, (${OIO_SQL}) AS oio, (${GAP_SQL}) AS breeding_gap, (${DOUBT_SQL}) AS doubtful, p.batch_id, IFNULL(r.rider_name, '') AS rider_name, IFNULL(r.rider_country, '') AS rider_country,
  c.name AS class_name, e.id AS event_id, e.name AS event_name, e.date_text, e.start_date,
  e.country, e.season`;

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

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinalDay = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`;
function dateText(start, end) {
  const s = new Date(`${start}T00:00:00Z`), e = end && end !== start ? new Date(`${end}T00:00:00Z`) : null;
  const one = d => `${ordinalDay(d.getUTCDate())} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!e) return one(s);
  return s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear()
    ? `${ordinalDay(s.getUTCDate())} – ${one(e)}` : `${ordinalDay(s.getUTCDate())} ${MONTHS_LONG[s.getUTCMonth()]} – ${one(e)}`;
}

/**
 * Gives an event its real name, dates and country (for results the article filed under a placeholder event).
 * If an event with that name, start date and country already exists, the classes and results join it.
 * Returns { id, merged, results }.
 */
export async function renameEvent(db, id, f) {
  const ev = await db.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
  if (!ev) throw new Error('That event is not in the records.');
  const name = String(f.name || '').trim().slice(0, 200), country = String(f.country || '').trim().slice(0, 60);
  if (!name) throw new Error("Give the event's name.");
  if (!DAY.test(f.start_date || '')) throw new Error('Give the date the event started.');
  const end = DAY.test(f.end_date || '') && f.end_date >= f.start_date ? f.end_date : '';
  if (!country) throw new Error('Choose the country.');
  const season = Number(f.start_date.slice(0, 4));
  const text = String(f.date_text || '').trim().slice(0, 80) || dateText(f.start_date, end);
  const other = await db.prepare('SELECT id FROM events WHERE name = ? AND start_date = ? AND country = ? AND id <> ?').bind(name, f.start_date, country, id).first();
  let target = id, merged = false;
  if (!other) {
    await db.prepare('UPDATE events SET name = ?, start_date = ?, end_date = ?, date_text = ?, country = ?, season = ? WHERE id = ?')
      .bind(name, f.start_date, end, text, country, season, id).run();
  } else {
    target = other.id; merged = true;
    for (const c of (await db.prepare('SELECT id, name FROM classes WHERE event_id = ?').bind(id).all()).results) {
      await db.prepare('INSERT OR IGNORE INTO classes (event_id, name) VALUES (?, ?)').bind(target, c.name).run();
      const tc = await db.prepare('SELECT id FROM classes WHERE event_id = ? AND name = ?').bind(target, c.name).first();
      await db.batch([
        db.prepare('UPDATE OR IGNORE results SET event_id = ? WHERE event_id = ? AND class_name = ?').bind(target, id, c.name),
        db.prepare('UPDATE OR IGNORE placings SET class_id = ? WHERE class_id = ?').bind(tc.id, c.id)
      ]);
    }
    await db.batch([
      db.prepare('DELETE FROM placings WHERE class_id IN (SELECT id FROM classes WHERE event_id = ?)').bind(id),
      db.prepare('DELETE FROM results WHERE event_id = ?').bind(id),
      db.prepare('DELETE FROM classes WHERE event_id = ?').bind(id),
      db.prepare('DELETE FROM events WHERE id = ?').bind(id)
    ]);
  }
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM results WHERE event_id = ?').bind(target).first()).n;
  return { id: target, merged, results: n };
}
