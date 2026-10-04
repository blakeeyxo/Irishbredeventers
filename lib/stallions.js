// Stallion listings and their progeny, pulled from the breeding records (sires → horses → results).
// Every count uses the same rolling window: the current month and the eleven before it, worked out from
// today's date, so it moves forward by itself at the start of each month.
import { normaliseName } from './names.js';

export const sireKeys = names => [...new Set(String(names || '').split(',').map(normaliseName).filter(Boolean))];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = n => String(n).padStart(2, '0');

/**
 * The last 12 months as of `now`: { start: '2025-11-01', end: '2026-10-31', label: 'Last 12 months (Nov 2025 – Oct 2026)' }.
 * A result counts when its event starts on or between start and end.
 */
export function rollingWindow(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // 0-based
  const startY = m >= 11 ? y : y - 1, startM = (m + 1) % 12; // eleven months back
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return {
    start: `${startY}-${pad(startM + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(lastDay)}`,
    label: `Last 12 months (${MONTHS[startM]} ${startY} – ${MONTHS[m]} ${y})`
  };
}

/** Every result in the window for horses by any of the listed sire spellings, newest first. */
export async function progeny(db, sireNames, win = rollingWindow()) {
  const keys = sireKeys(sireNames);
  if (!keys.length) return [];
  const marks = keys.map(() => '?').join(', ');
  const { results } = await db.prepare(`SELECT h.id AS horse_id, h.name AS horse, h.birth_year, h.sex, d.name AS dam,
      r.placing, r.class_name, r.verified, e.name AS event_name, e.date_text, e.start_date, e.country, e.season, p.id AS placing_id
    FROM results r JOIN horses h ON h.id = r.horse_id JOIN sires s ON s.id = h.sire_id
      JOIN events e ON e.id = r.event_id LEFT JOIN dams d ON d.id = h.dam_id LEFT JOIN placings p ON p.result_id = r.id
    WHERE s.name_normalised IN (${marks}) AND e.start_date BETWEEN ? AND ?
    ORDER BY e.start_date DESC, r.placing LIMIT 3000`).bind(...keys, win.start, win.end).all();
  return results;
}

/** Headline numbers: mentions are every appearance in the results (every placing, not only wins). */
export function summary(rows) {
  return {
    mentions: rows.length,
    horses: new Set(rows.map(r => r.horse_id)).size,
    wins: rows.filter(r => r.placing === 1).length,
    top3: rows.filter(r => r.placing && r.placing <= 3).length
  };
}

/** The sires mentioned most in the window: every appearance of a sire's progeny in the results. */
export async function topSires(db, win = rollingWindow(), limit = 10) {
  const { results } = await db.prepare(`SELECT s.name, COUNT(*) AS mentions, COUNT(DISTINCT h.id) AS horses,
      SUM(r.placing = 1) AS wins, SUM(r.placing BETWEEN 1 AND 3) AS top3
    FROM results r JOIN horses h ON h.id = r.horse_id JOIN sires s ON s.id = h.sire_id JOIN events e ON e.id = r.event_id
    WHERE e.start_date BETWEEN ? AND ? AND s.name_normalised NOT IN ('', 'unknown', 'sire unknown')
    GROUP BY s.id ORDER BY mentions DESC, wins DESC, s.name LIMIT ?`).bind(win.start, win.end, limit).all();
  return results;
}
