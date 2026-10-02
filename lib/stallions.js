// Stallion listings and their progeny, pulled from the breeding records (sires → horses → results).
import { normaliseName } from './names.js';

export const sireKeys = names => [...new Set(String(names || '').split(',').map(normaliseName).filter(Boolean))];

/** Every result for horses by any of the listed sire spellings, newest first. */
export async function progeny(db, sireNames) {
  const keys = sireKeys(sireNames);
  if (!keys.length) return [];
  const marks = keys.map(() => '?').join(', ');
  const { results } = await db.prepare(`SELECT h.id AS horse_id, h.name AS horse, h.birth_year, h.sex, d.name AS dam,
      r.placing, r.class_name, r.verified, e.name AS event_name, e.date_text, e.start_date, e.country, e.season, p.id AS placing_id
    FROM results r JOIN horses h ON h.id = r.horse_id JOIN sires s ON s.id = h.sire_id
      JOIN events e ON e.id = r.event_id LEFT JOIN dams d ON d.id = h.dam_id LEFT JOIN placings p ON p.result_id = r.id
    WHERE s.name_normalised IN (${marks})
    ORDER BY e.start_date DESC, r.placing LIMIT 3000`).bind(...keys).all();
  return results;
}

/** Headline numbers for a listing card. */
export function summary(rows) {
  return {
    horses: new Set(rows.map(r => r.horse_id)).size,
    placings: rows.length,
    wins: rows.filter(r => r.placing === 1).length,
    top3: rows.filter(r => r.placing && r.placing <= 3).length
  };
}
