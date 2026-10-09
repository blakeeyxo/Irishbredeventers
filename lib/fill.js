/*
 * IBER: fill gaps in its own breeding records from the shared horse database (the "main brain" both sites read).
 * Only what is missing is filled (sire, dam, dam sire, breeder); nothing already recorded is changed. A shared horse is
 * only used when it is certainly the same horse: the same name, and the same year of birth where both have one, with
 * no second horse of that name it could be. Only sources allowed to show on the sites are used.
 */
import { findHorses, saveBreeding } from './breeding.js';
import { normaliseName } from './names.js';

const UNK = v => !v || /^(unk|unknown|n\/a|not known)$/i.test(String(v).trim());
const tag = (name, book, tih) => (name ? `${name}${book ? ` (${book})` : ''}${tih ? '[TIH]' : ''}` : '');

/** → [{ id, name, birth_year, adds: { sire, dam, dam_sire, breeder } }] for IBER horses whose gaps the shared file fills. */
export async function fillPlan(iber, shared, { limit = 2000 } = {}) {
  const { horses } = await findHorses(iber, { gaps: true, limit });
  if (!horses.length) return [];
  const keys = [...new Set(horses.map(h => normaliseName(h.name)).filter(Boolean))];
  const found = [];
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const { results } = await shared.prepare(`SELECT h.id, h.name_key, h.foaled_year, s.name AS sire, s.studbook AS sire_book,
        d.name AS dam, d.studbook AS dam_book, ds.name AS dam_sire, ds.studbook AS dam_sire_book, b.name AS breeder, b.county AS breeder_county
      FROM horse h LEFT JOIN horse s ON s.id = h.sire_id LEFT JOIN horse d ON d.id = h.dam_id LEFT JOIN horse ds ON ds.id = d.sire_id
      LEFT JOIN party b ON b.id = h.breeder_id
      WHERE h.name_key IN (${part.map(() => '?').join(',')}) AND h.source_id IN (SELECT id FROM source WHERE can_display = 1)`).bind(...part).all();
    found.push(...results);
  }
  const plan = [];
  for (const h of horses) {
    const same = found.filter(x => x.name_key === normaliseName(h.name));
    const fit = same.filter(x => !h.birth_year || !x.foaled_year || x.foaled_year === h.birth_year);
    if (fit.length !== 1) continue;                                   // none, or could be either of two
    const x = fit[0];
    if ((!h.birth_year || !x.foaled_year) && same.length > 1) continue; // a year is missing and the name isn't unique
    const adds = {};
    if (UNK(h.sire) && x.sire) adds.sire = tag(x.sire, x.sire_book);
    if (UNK(h.dam) && x.dam) adds.dam = tag(x.dam, x.dam_book);
    if (UNK(h.dam_sire) && x.dam_sire) adds.dam_sire = tag(x.dam_sire, x.dam_sire_book);
    if (UNK(h.breeder) && x.breeder) adds.breeder = `${x.breeder}${x.breeder_county ? ` (${x.breeder_county})` : ''}`;
    if (Object.keys(adds).length) plan.push({ id: h.id, name: h.name, birth_year: h.birth_year, runs: h.runs, adds, current: h });
  }
  return plan;
}

/** Fills the planned gaps (only the chosen horses, if ids given). Keeps everything already recorded. */
export async function fillApply(iber, shared, { ids = null, user = '' } = {}) {
  const plan = (await fillPlan(iber, shared)).filter(p => !ids || ids.includes(p.id)).slice(0, 300);
  let filled = 0;
  for (const p of plan) {
    const h = p.current;
    const saved = await saveBreeding(iber, p.id, {
      sire: p.adds.sire || tag(h.sire, h.sire_breed, h.sire_tih), dam: p.adds.dam || tag(h.dam, h.dam_breed, h.dam_tih),
      dam_sire: p.adds.dam_sire || tag(h.dam_sire, h.dam_sire_breed, h.dam_sire_tih),
      breeder: p.adds.breeder || (h.breeder ? `${h.breeder}${h.breeder_county ? ` (${h.breeder_county})` : ''}` : ''),
      birth_year: h.birth_year, sex: h.sex, breed: h.breed_code, tih: h.tih_flag, source: `Shared horse database${user ? ` (${user})` : ''}`
    });
    await iber.prepare('UPDATE horses SET breeding_source = ? WHERE id = ?').bind('Shared horse database', saved.id).run();
    filled++;
  }
  return { filled };
}
