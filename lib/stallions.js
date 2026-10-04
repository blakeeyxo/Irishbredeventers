// Stallion listings and their progeny, pulled from the breeding records (sires → horses → results).
// Every count uses the same rolling window: the current month and the eleven before it, worked out from
// today's date, so it moves forward by itself at the start of each month.
import { normaliseName, editDistance } from './names.js';

// A sire name as typed in the owner area, reduced to how it is stored: no breed or [TIH] codes, any case or
// spacing. "Imperial Heights (ISH)[TIH]" → "imperial heights".
export const sireCore = name => normaliseName(String(name || '').replace(/\s*[([][^)\]]*[)\]]/g, ' '));
export const sireKeys = names => [...new Set(String(names || '').split(',').map(sireCore).filter(Boolean))];

// How far a spelling may be from the name typed and still count: typos in the articles ("Imperial Hights",
// "Cruising Micky Finn") are filed as their own sire records. Short names must match exactly.
const allowedTypos = compact => (compact.length >= 14 ? 2 : compact.length >= 8 ? 1 : 0);

/**
 * Every sire record that matches the listing's names: the same name, the same with spaces or punctuation
 * different, or a small typo away. Returns [{ id, name }].
 */
export async function matchSires(db, sireNames) {
  const keys = sireKeys(sireNames);
  if (!keys.length) return [];
  const { results: all } = await db.prepare('SELECT id, name, name_normalised FROM sires').all();
  const out = new Map();
  for (const key of keys) {
    const ck = key.replace(/ /g, ''), max = allowedTypos(ck);
    for (const s of all) {
      const cs = String(s.name_normalised || '').replace(/ /g, '');
      if (!cs) continue;
      if (cs === ck || (max && editDistance(cs, ck, max) <= max)) out.set(s.id, { id: s.id, name: s.name });
    }
  }
  return [...out.values()];
}

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

/** Every result in the window for horses by any of the matching sires, newest first. */
export async function progeny(db, sireNames, win = rollingWindow(), sires = null) {
  const ids = (sires || await matchSires(db, sireNames)).map(s => s.id);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(', ');
  const { results } = await db.prepare(`SELECT h.id AS horse_id, h.name AS horse, h.birth_year, h.sex, d.name AS dam,
      r.placing, r.class_name, r.verified, e.name AS event_name, e.date_text, e.start_date, e.country, e.season, p.id AS placing_id
    FROM results r JOIN horses h ON h.id = r.horse_id JOIN sires s ON s.id = h.sire_id
      JOIN events e ON e.id = r.event_id LEFT JOIN dams d ON d.id = h.dam_id LEFT JOIN placings p ON p.result_id = r.id
    WHERE s.id IN (${marks}) AND e.start_date BETWEEN ? AND ?
    ORDER BY e.start_date DESC, r.placing LIMIT 3000`).bind(...ids, win.start, win.end).all();
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
