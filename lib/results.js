// Database work for results: reading them back out, and saving an upload as a batch.
import { str } from './http.js';

export const PLACING_COLUMNS = `
  p.id, p.position, p.horse_name, p.former_name, p.breed, p.foaled, p.sex,
  p.sire, p.dam, p.dam_sire, p.breeder, p.dressage, p.show_jumping, p.cross_country,
  p.score, p.verified, p.batch_id,
  c.name AS class_name, e.id AS event_id, e.name AS event_name, e.date_text, e.start_date,
  e.country, e.season`;

export const PLACING_JOIN = `FROM placings p JOIN classes c ON c.id = p.class_id JOIN events e ON e.id = c.event_id`;

// Newest events first; classes and placings in the order they were uploaded.
export const PLACING_ORDER = `ORDER BY e.start_date DESC, e.id, c.id, p.position, p.id`;

const MAX_ROWS = 2000;

function cleanRow(r, defaultYear) {
  const season = Number(r.season) || defaultYear;
  const foaled = Number(r.foaled);
  const score = r.score === null || r.score === '' || r.score === undefined ? null : Number(r.score);
  return {
    position: Number.isFinite(Number(r.position)) ? Number(r.position) : null,
    horse_name: str(r.horse_name, 120),
    former_name: str(r.former_name, 240),
    breed: str(r.breed, 20),
    foaled: Number.isInteger(foaled) && foaled > 1950 && foaled < 2100 ? foaled : null,
    sex: str(r.sex, 20),
    sire: str(r.sire, 160),
    dam: str(r.dam, 160),
    dam_sire: str(r.dam_sire, 160),
    breeder: str(r.breeder, 200),
    dressage: str(r.dressage, 12),
    show_jumping: str(r.show_jumping, 12),
    cross_country: str(r.cross_country, 12),
    score: Number.isFinite(score) ? score : null,
    verified: r.verified ? 1 : 0,
    country: str(r.country, 60) || 'Other',
    event_name: str(r.event_name, 200) || 'Event not given',
    event_date_text: str(r.event_date_text, 80),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(r.start_date) ? r.start_date : `${season}-01-01`,
    season,
    class_name: str(r.class_name, 160) || 'Class not given'
  };
}

/** Saves parsed rows as one batch. Returns { batchId, rowCount, unverifiedCount }. */
export async function saveBatch(db, rawRows, label) {
  const defaultYear = new Date().getFullYear();
  const rows = rawRows.slice(0, MAX_ROWS).map(r => cleanRow(r, defaultYear)).filter(r => r.horse_name);
  if (!rows.length) throw new Error('No rows with a horse name to publish');
  const unverified = rows.filter(r => !r.verified).length;

  const batch = await db.prepare('INSERT INTO batches (label, row_count, unverified_count) VALUES (?, ?, ?) RETURNING id')
    .bind(str(label, 120), rows.length, unverified).first();
  const batchId = batch.id;

  // Events (reuse one already saved with the same name, start date and country)
  const eventKeys = [...new Map(rows.map(r => [`${r.event_name}|${r.start_date}|${r.country}`, r])).values()];
  const eventRes = await db.batch(eventKeys.map(r => db.prepare(
    `INSERT INTO events (name, date_text, start_date, country, season) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name, start_date, country) DO UPDATE SET date_text = excluded.date_text RETURNING id`
  ).bind(r.event_name, r.event_date_text, r.start_date, r.country, r.season)));
  const eventId = new Map(eventKeys.map((r, i) => [`${r.event_name}|${r.start_date}|${r.country}`, eventRes[i].results[0].id]));

  // Classes
  const classKeys = [...new Map(rows.map(r => {
    const ev = eventId.get(`${r.event_name}|${r.start_date}|${r.country}`);
    return [`${ev}|${r.class_name}`, { ev, name: r.class_name }];
  })).entries()];
  const classRes = await db.batch(classKeys.map(([, c]) => db.prepare(
    `INSERT INTO classes (event_id, name) VALUES (?, ?)
     ON CONFLICT(event_id, name) DO UPDATE SET name = excluded.name RETURNING id`
  ).bind(c.ev, c.name)));
  const classId = new Map(classKeys.map(([k], i) => [k, classRes[i].results[0].id]));

  // Placings, in chunks
  const insert = db.prepare(`INSERT INTO placings (class_id, batch_id, position, horse_name, former_name, breed, foaled, sex,
    sire, dam, dam_sire, breeder, dressage, show_jumping, cross_country, score, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const stmts = rows.map(r => {
    const cid = classId.get(`${eventId.get(`${r.event_name}|${r.start_date}|${r.country}`)}|${r.class_name}`);
    return insert.bind(cid, batchId, r.position, r.horse_name, r.former_name, r.breed, r.foaled, r.sex,
      r.sire, r.dam, r.dam_sire, r.breeder, r.dressage, r.show_jumping, r.cross_country, r.score, r.verified);
  });
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));

  return { batchId, rowCount: rows.length, unverifiedCount: unverified };
}

/** Removes a whole upload, then any events and classes left empty. */
export async function deleteBatch(db, batchId) {
  await db.batch([
    db.prepare('DELETE FROM placings WHERE batch_id = ?').bind(batchId),
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
