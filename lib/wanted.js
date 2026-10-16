/*
 * For Sale → Looking for: buyers' posts saying what horse they want (migrations-shared/0011_looking_for.sql).
 *
 * A buyer sends one in (draft). The owner approves it and it goes live, free, for the For Sale "Days an ad stays live"
 * setting. Sellers answer with the form under each post; the answer is emailed on to the buyer, whose contact
 * details are never shown. Each site keeps its own posts, shared with the other site only when "Also show on" is
 * ticked, as for ads.
 */
import { siteDisciplines, getSettings } from './listings.js';

const clean = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const longText = (v, max = 3000) => String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const isEmail = v => /^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,}$/.test(v);
const ticked = v => v === true || ['1', 'on', 'true'].includes(String(v));
const STATUSES = ['draft', 'live', 'found', 'removed', 'rejected'];
export const WANTED_SEXES = ['mare', 'gelding', 'stallion'];

// What visitors see: live, not run out, and tagged with this site's discipline.
const SHOWN = `w.status = 'live' AND (w.expires_at IS NULL OR w.expires_at > datetime('now'))`;
const ON_SITE = 'EXISTS (SELECT 1 FROM wanted_discipline wd WHERE wd.wanted_id = w.id AND wd.discipline_code = ?)';
const PUBLIC_COLS = 'w.id, w.title, w.description, w.sex, w.age_min, w.age_max, w.height_min, w.height_max, w.budget_cents, w.level, w.location, w.published_at';

const whole = (v, lo, hi) => { const n = Number(clean(v, 3)); return clean(v) && Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const hands = v => { const s = clean(v, 5).replace(',', '.'); return /^\d{2}(\.[0-3])?$/.test(s) && Number(s) >= 10 && Number(s) <= 19 ? Number(s) : null; };

/** Form fields → { values, buyer, errors }. */
export function readWanted(f) {
  const errors = [];
  const budget = clean(f.budget, 12).replace(/[€,\s]/g, '');
  const values = {
    title: clean(f.title, 100),
    description: longText(f.description) || null,
    sex: WANTED_SEXES.includes(clean(f.sex).toLowerCase()) ? clean(f.sex).toLowerCase() : null,
    age_min: whole(f.age_min, 0, 30), age_max: whole(f.age_max, 0, 30),
    height_min: hands(f.height_min), height_max: hands(f.height_max),
    budget_cents: /^\d{1,7}$/.test(budget) && Number(budget) > 0 ? Number(budget) * 100 : null,
    level: clean(f.level, 120) || null,
    location: clean(f.location, 80) || null
  };
  const buyer = { name: clean(f.buyer_name, 80), email: clean(f.buyer_email, 200).toLowerCase(), phone: clean(f.buyer_phone, 40) || null };
  if (!values.title) errors.push('Say in a line what you are looking for, e.g. "1.20m schoolmaster for a teenager".');
  if (clean(f.age_min) && values.age_min === null) errors.push('The youngest age doesn\'t look right.');
  if (clean(f.age_max) && values.age_max === null) errors.push('The oldest age doesn\'t look right.');
  if (values.age_min !== null && values.age_max !== null && values.age_min > values.age_max) errors.push('The youngest age is above the oldest.');
  if (clean(f.height_min) && values.height_min === null) errors.push('Heights are in hands, e.g. 16.2.');
  else if (clean(f.height_max) && values.height_max === null) errors.push('Heights are in hands, e.g. 16.2.');
  if (values.height_min !== null && values.height_max !== null && values.height_min > values.height_max) errors.push('The smallest height is above the tallest.');
  if (budget && values.budget_cents === null) errors.push('Give the budget in euro, e.g. 15000, or leave it empty.');
  if (!buyer.name) errors.push('Add your name.');
  if (!isEmail(buyer.email)) errors.push('Add an email address, so sellers\' answers can reach you.');
  return { values, buyer, errors };
}

export async function createWanted(db, { values, buyer }, { site, share }) {
  const cols = Object.keys(values);
  const row = await db.prepare(`INSERT INTO wanted (submitted_site, buyer_name, buyer_email, buyer_phone, ${cols.join(', ')})
      VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')}) RETURNING id`)
    .bind(site, buyer.name, buyer.email, buyer.phone, ...cols.map(c => values[c])).first();
  await db.batch(siteDisciplines(site, ticked(share)).map(d => db.prepare('INSERT INTO wanted_discipline (wanted_id, discipline_code) VALUES (?, ?)').bind(row.id, d)));
  return row.id;
}

/** The live posts on one site, newest first. */
export async function listPublicWanted(db, discipline) {
  const { results } = await db.prepare(`SELECT ${PUBLIC_COLS} FROM wanted w WHERE ${SHOWN} AND ${ON_SITE} ORDER BY w.published_at DESC LIMIT 100`).bind(discipline).all();
  return results;
}

/* ---------- Sellers answer a post ---------- */

export function readReply(f) {
  const r = { name: clean(f.name, 80), email: clean(f.email, 200).toLowerCase(), phone: clean(f.phone, 40), message: longText(f.message) };
  const errors = [];
  if (!r.name) errors.push('Add your name.');
  if (!isEmail(r.email)) errors.push('Add your email so the buyer can reply.');
  if (!r.message) errors.push('Tell the buyer about your horse.');
  return { reply: r, errors };
}

/** Saves an answer to a live post; returns the post with the buyer's email, or null if it isn't shown here. */
export async function addReply(db, id, discipline, r) {
  const w = await db.prepare(`SELECT w.id, w.title, w.buyer_name, w.buyer_email FROM wanted w WHERE w.id = ? AND ${SHOWN} AND ${ON_SITE}`).bind(id, discipline).first();
  if (!w) return null;
  const row = await db.prepare('INSERT INTO wanted_reply (wanted_id, name, email, phone, message) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(id, r.name, r.email, r.phone || null, r.message).first();
  return { wanted: w, replyId: row.id };
}

/* ---------- Owner area ---------- */

/** The queue for one site's owner area: counts by status and the posts in one status, with their answers counted. */
export async function listWantedForOwner(db, status, siteId) {
  const st = STATUSES.includes(status) ? status : 'draft';
  const [counts, rows] = await db.batch([
    db.prepare("SELECT CASE WHEN status = 'live' AND expires_at <= datetime('now') THEN 'ended' ELSE status END AS s, COUNT(*) AS n FROM wanted WHERE submitted_site = ? GROUP BY s").bind(siteId),
    db.prepare(`SELECT w.*, (SELECT COUNT(*) FROM wanted_reply r WHERE r.wanted_id = w.id) AS replies,
        (SELECT group_concat(discipline_code) FROM wanted_discipline d WHERE d.wanted_id = w.id) AS disciplines
      FROM wanted w WHERE w.submitted_site = ? AND ${st === 'live' ? "w.status = 'live'" : 'w.status = ?'} ORDER BY w.created_at DESC LIMIT 200`)
      .bind(...(st === 'live' ? [siteId] : [siteId, st]))
  ]);
  return {
    counts: Object.fromEntries(counts.results.map(c => [c.s, c.n])),
    wanted: rows.results.map(r => ({ ...r, disciplines: (r.disciplines || '').split(',').filter(Boolean), ended: r.status === 'live' && r.expires_at && r.expires_at <= new Date().toISOString().slice(0, 19).replace('T', ' ') }))
  };
}

export async function repliesFor(db, id) {
  const { results } = await db.prepare('SELECT id, name, email, phone, message, emailed, created_at FROM wanted_reply WHERE wanted_id = ? ORDER BY id DESC').bind(id).all();
  return results;
}

const getWanted = (db, id) => db.prepare('SELECT * FROM wanted WHERE id = ?').bind(id).first();

/**
 * One owner action. Returns { wanted, email } where email names the message for the buyer ('live', 'rejected').
 *   approve   → live for the settings' number of days (also puts an ended post back up)
 *   found | remove | reject { reason } | note { note }
 */
export async function wantedAction(db, id, action, f = {}) {
  const w = await getWanted(db, id);
  if (!w) throw new Error('That post no longer exists.');
  let email = null;
  if (action === 'approve') {
    const { listing_days } = await getSettings(db);
    await db.prepare(`UPDATE wanted SET status = 'live', published_at = datetime('now'), expires_at = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`)
      .bind(`+${listing_days} days`, id).run();
    email = w.status === 'live' ? null : 'live';
  } else if (['found', 'removed'].includes(action)) {
    await db.prepare("UPDATE wanted SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(action, id).run();
  } else if (action === 'reject') {
    await db.prepare("UPDATE wanted SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?").bind(longText(f.reason, 1000) || null, id).run();
    email = 'rejected';
  } else if (action === 'note') {
    await db.prepare("UPDATE wanted SET owner_note = ?, updated_at = datetime('now') WHERE id = ?").bind(longText(f.note, 2000) || null, id).run();
  } else {
    throw new Error('Unknown action.');
  }
  return { wanted: await getWanted(db, id), email };
}

export async function deleteWanted(db, id) {
  await db.prepare('DELETE FROM wanted WHERE id = ?').bind(id).run();
}

/** "Mare or gelding · 5 to 9 years · 16.0 to 17.0hh · up to €20,000" for cards and emails. */
export function wantedFacts(w) {
  const range = (a, b, fmt) => (a !== null && a !== undefined && b !== null && b !== undefined ? (a === b ? fmt(a) : `${fmt(a)} to ${fmt(b)}`)
    : a !== null && a !== undefined ? `${fmt(a)} or over` : b !== null && b !== undefined ? `up to ${fmt(b)}` : '');
  const hh = v => `${Number(v).toFixed(1)}hh`;
  return [w.sex ? w.sex[0].toUpperCase() + w.sex.slice(1) : '', range(w.age_min, w.age_max, v => `${v} yrs`), range(w.height_min, w.height_max, hh),
    w.budget_cents ? `up to €${(w.budget_cents / 100).toLocaleString('en-IE')}` : ''].filter(Boolean).join(' · ');
}
