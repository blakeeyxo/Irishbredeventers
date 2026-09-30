/*
 * Works out what an import will do, without touching the database:
 * which sires, dams, breeders and horses already exist, which are new, and which new
 * names look like an existing record ("Flex A Bill" vs "Flex-a-Bill", "Satisfation" vs
 * "Satisfaction") so Charlie can choose "same" or "different".
 *
 * Pure JS: used by the Worker (lib/import.js), the tests and the design preview.
 */
import { normaliseName, isNearName, displayName } from './names.js';

const MAX_CANDIDATES = 3;

export const sireKey = name => normaliseName(name);
export const damKey = (name, damSire) => `${normaliseName(name)}|${normaliseName(damSire)}`;
export const breederKey = (name, county) => `${normaliseName(name)}|${String(county || '').trim().toLowerCase()}`;
export const horseKey = r => `${normaliseName(r.horse_name)}|${Number(r.foaled) || 0}|${normaliseName(r.sire)}|${damKey(r.dam, r.dam_sire)}`;

/**
 * existing = {
 *   sires:    [{ id, name, name_normalised, horses }],
 *   dams:     [{ id, name, name_normalised, sire_name, sire_normalised }],
 *   breeders: [{ id, name, name_normalised, county }],
 *   horses:   [{ id, name, name_normalised, birth_year, sire_normalised, dam_normalised, damsire_normalised, sire_name, dam_name }]
 * }
 * decisions = { "sire:flex a bill": 12 | "new", ... }
 */
export function planImport(rows, existing, decisions = {}) {
  const ex = {
    sires: existing.sires || [], dams: existing.dams || [], breeders: existing.breeders || [], horses: existing.horses || []
  };
  const siresByNorm = new Map(ex.sires.map(s => [s.name_normalised, s]));
  const damsByKey = new Map(ex.dams.map(d => [`${d.name_normalised}|${d.sire_normalised || ''}`, d]));
  const breedersByKey = new Map(ex.breeders.map(b => [`${b.name_normalised}|${(b.county || '').toLowerCase()}`, b]));
  const sireNormById = new Map(ex.sires.map(s => [s.id, s.name_normalised]));
  const damById = new Map(ex.dams.map(d => [d.id, d]));
  const horsesByKey = new Map(ex.horses.map(h => [`${h.name_normalised}|${h.birth_year || 0}|${h.sire_normalised || ''}|${h.dam_normalised || ''}|${h.damsire_normalised || ''}`, h]));

  const plan = { sires: new Map(), dams: new Map(), breeders: new Map(), horses: new Map(), questions: [], pending: [] };
  // Spellings already confirmed as "same" in an earlier paste.
  const remembered = new Map((existing.matches || []).map(m => [`${m.kind}:${m.match_key}`, m.target_id]));

  // Earlier names in this same paste that look alike ("Je T'Aime Flaminco" / "Je T'Aime Flamenco").
  // Choosing one of these links both spellings to one new record.
  const inPaste = (map, test) => [...map.values()].filter(e => !e.sameAs && test(e))
    .map(e => ({ id: `paste:${e.key}`, label: e.name, detail: 'also new in this paste' }));

  function decide(kind, key, name, context, exact, candidatesFn) {
    if (exact) return { id: exact.id, isNew: false };
    const qKey = `${kind}:${key}`;
    if (remembered.has(qKey)) return { id: remembered.get(qKey), isNew: false, remembered: true };
    const candidates = candidatesFn().slice(0, MAX_CANDIDATES);
    if (!candidates.length) return { id: null, isNew: true };
    const question = { kind, key: qKey, name, context, candidates };
    plan.questions.push(question);
    const choice = decisions[qKey];
    if (choice === undefined || choice === null || choice === '') { plan.pending.push(question); return { id: null, isNew: true, pending: true }; }
    if (choice === 'new') return { id: null, isNew: true };
    const picked = candidates.find(c => String(c.id) === String(choice));
    if (!picked) { plan.pending.push(question); return { id: null, isNew: true, pending: true }; }
    if (String(picked.id).startsWith('paste:')) return { id: null, isNew: false, sameAs: String(picked.id).slice(6) };
    return { id: picked.id, isNew: false };
  }

  function addSire(name, breed, tih) {
    const key = sireKey(name);
    if (!key || plan.sires.has(key)) return;
    const r = decide('sire', key, name, 'Sire or dam sire', siresByNorm.get(key), () =>
      ex.sires.filter(s => isNearName(key, s.name_normalised))
        .map(s => ({ id: s.id, label: s.name, detail: s.horses ? `${s.horses} horse${s.horses === 1 ? '' : 's'} by this sire` : 'on record' }))
        .concat(inPaste(plan.sires, e => e.isNew && isNearName(key, e.key))));
    plan.sires.set(key, { key, name, breed_code: breed || '', tih: !!tih, ...r });
  }

  for (const row of rows) {
    addSire(row.sire, row.sire_breed, row.sire_tih);
    addSire(row.dam_sire, row.dam_sire_breed, row.dam_sire_tih);
  }

  for (const row of rows) {
    // Dam: same name + same sire is one mare. Same name with a different or missing sire is a question.
    const dk = damKey(row.dam, row.dam_sire);
    const damNorm = normaliseName(row.dam), dsNorm = normaliseName(row.dam_sire);
    if (damNorm && !plan.dams.has(dk)) {
      // Look the mare up under her sire's confirmed spelling ("Coolcorran" = Coolcorron), as for horses.
      const dsEnt = plan.sires.get(dsNorm);
      const canonDsForDam = dsEnt && dsEnt.id && sireNormById.has(dsEnt.id) ? sireNormById.get(dsEnt.id) : dsNorm;
      const r = decide('dam', dk, row.dam, row.dam_sire ? `by ${row.dam_sire}` : 'no dam sire given', damsByKey.get(dk) || damsByKey.get(`${damNorm}|${canonDsForDam}`), () =>
        ex.dams.filter(d => (d.name_normalised === damNorm && (d.sire_normalised || '') !== dsNorm)
          || (isNearName(damNorm, d.name_normalised) && (!dsNorm || !d.sire_normalised || d.sire_normalised === dsNorm)))
          .map(d => ({ id: d.id, label: d.name, detail: d.sire_name ? `by ${d.sire_name}` : 'no dam sire on record' }))
          .concat(inPaste(plan.dams, e => e.isNew && isNearName(damNorm, normaliseName(e.name)) && (!dsNorm || !e.sireKey || e.sireKey === dsNorm))));
      plan.dams.set(dk, { key: dk, name: row.dam, breed_code: row.dam_breed || '', tih: !!row.dam_tih, sireKey: dsNorm, ...r });
    }

    const bNorm = normaliseName(row.breeder);
    const bk = breederKey(row.breeder, row.breeder_county);
    if (bNorm && !plan.breeders.has(bk)) {
      const county = (row.breeder_county || '').toLowerCase();
      const r = decide('breeder', bk, row.breeder, row.breeder_county ? `(${row.breeder_county})` : 'no county given', breedersByKey.get(bk), () =>
        ex.breeders.filter(b => (b.name_normalised === bNorm && (b.county || '').toLowerCase() !== county)
          || (isNearName(bNorm, b.name_normalised) && (b.county || '').toLowerCase() === county))
          .map(b => ({ id: b.id, label: b.name, detail: b.county ? `(${b.county})` : 'no county on record' }))
          .concat(inPaste(plan.breeders, e => e.isNew && isNearName(bNorm, normaliseName(e.name)) && (e.county || '').toLowerCase() === county)));
      plan.breeders.set(bk, { key: bk, name: row.breeder, county: row.breeder_county || '', ...r });
    }

    const hNorm = normaliseName(row.horse_name);
    const hk = horseKey(row);
    if (hNorm && !plan.horses.has(hk)) {
      const year = Number(row.foaled) || 0;
      const sNorm = normaliseName(row.sire);
      // Match on the records the sire and dam resolved to, so a confirmed spelling ("Sligo Candyboy" = Sligo Candy Boy) finds the horse too.
      const sEnt = plan.sires.get(sNorm), dEnt = plan.dams.get(dk);
      const canonSire = sEnt && sEnt.id && sireNormById.has(sEnt.id) ? sireNormById.get(sEnt.id) : sNorm;
      const dRec = dEnt && dEnt.id ? damById.get(dEnt.id) : null;
      const canonDam = dRec ? dRec.name_normalised : damNorm;
      const canonDs = dRec ? (dRec.sire_normalised || '') : dsNorm;
      const exact = horsesByKey.get(`${hNorm}|${year}|${canonSire}|${canonDam}|${canonDs}`)
        || horsesByKey.get(`${hNorm}|${year}|${canonSire}|${canonDam}|`);
      const r = decide('horse', hk, row.horse_name,
        `${year || 'year?'}, by ${row.sire || 'sire unknown'} out of ${row.dam || 'dam unknown'}`, exact, () =>
          ex.horses.filter(h => (h.birth_year || 0) === year && (
            (h.name_normalised === hNorm) || (isNearName(hNorm, h.name_normalised) && (h.sire_normalised || '') === canonSire)))
            .map(h => ({ id: h.id, label: h.name, detail: `${h.birth_year || 'year?'}, by ${h.sire_name || 'sire unknown'} out of ${h.dam_name || 'dam unknown'}` })));
      plan.horses.set(hk, {
        key: hk, name: row.horse_name, birth_year: year || null, sex: row.sex || '', breed_code: row.breed || '', tih: !!row.tih_flag,
        sireKey: sNorm, damKey: dk, damsireKey: dsNorm, breederKey: bNorm ? bk : '', former: row.former_name || '', ...r
      });
    }
  }

  const count = m => [...m.values()].filter(v => v.isNew).length;
  plan.newCounts = { horses: count(plan.horses), sires: count(plan.sires), dams: count(plan.dams), breeders: count(plan.breeders) };
  return plan;
}

/** Public display strings for a parsed row (the results pages show sire and dam with their codes). */
export function displayFields(row) {
  return {
    sire: displayName(row.sire, row.sire_breed, row.sire_tih),
    dam: displayName(row.dam, row.dam_breed, row.dam_tih),
    dam_sire: displayName(row.dam_sire, row.dam_sire_breed, row.dam_sire_tih),
    breeder: row.breeder ? `${row.breeder}${row.breeder_county ? ` (${row.breeder_county})` : ''}` : ''
  };
}
