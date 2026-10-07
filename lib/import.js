/*
 * Saves checked results into the breeding tables (sires, dams, breeders, horses, aliases,
 * results) and into the public results pages (events, classes, placings).
 *
 * Safe to repeat: every insert is keyed on a unique identity, so pasting the same week
 * twice adds nothing and reports "0 new results".
 */
import { str } from './http.js';
import { normaliseName, splitTagged, canonObos } from './names.js';
import { planImport, horseKey, displayFields } from './import-plan.js';
import { DOUBT_SQL, PUBLIC_SQL } from './results.js';

const CHUNK = 100;

export async function loadExisting(db) {
  const [sires, dams, breeders, horses, matches] = await db.batch([
    db.prepare(`SELECT s.id, s.name, s.name_normalised, (SELECT COUNT(*) FROM horses h WHERE h.sire_id = s.id) AS horses FROM sires s`),
    db.prepare(`SELECT d.id, d.name, d.name_normalised, s.name AS sire_name, s.name_normalised AS sire_normalised
      FROM dams d LEFT JOIN sires s ON s.id = d.sire_id`),
    db.prepare('SELECT id, name, name_normalised, county FROM breeders'),
    db.prepare(`SELECT h.id, h.name, h.name_normalised, h.birth_year, s.name AS sire_name, s.name_normalised AS sire_normalised,
        d.name AS dam_name, d.name_normalised AS dam_normalised, ds.name_normalised AS damsire_normalised
      FROM horses h LEFT JOIN sires s ON s.id = h.sire_id LEFT JOIN dams d ON d.id = h.dam_id LEFT JOIN sires ds ON ds.id = d.sire_id`),
    db.prepare('SELECT kind, match_key, target_id FROM name_matches')
  ]);
  return { sires: sires.results, dams: dams.results, breeders: breeders.results, horses: horses.results, matches: matches.results };
}

/** Tidy the rows sent back from the browser (Charlie may have edited them). */
export function cleanRows(raw, defaultYear) {
  const bool = v => v === true || v === 1 || v === '1' || v === 'true';
  const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));
  // A name typed with its codes ("Kannan (KWPN)[TIH]") is split the same way the parser does.
  const splitName = (r, f, breedF, tihF) => {
    if (!/[[(]/.test(r[f] || '')) return;
    const t = splitTagged(r[f]);
    r[f] = t.name;
    if (breedF && !r[breedF] && t.breed_code) r[breedF] = t.breed_code;
    if (tihF && t.tih) r[tihF] = true;
    if (f === 'horse_name' && t.former && !r.former_name) r.former_name = t.former;
  };
  return (Array.isArray(raw) ? raw : []).slice(0, 2000).filter(r => r && !r.skip).map(src => {
    const r = { ...src };
    for (const f of ['horse_name', 'former_name', 'sire', 'dam', 'dam_sire']) if (r[f]) r[f] = canonObos(r[f]);
    splitName(r, 'horse_name', 'breed', 'tih_flag');
    splitName(r, 'sire', 'sire_breed', 'sire_tih');
    splitName(r, 'dam', 'dam_breed', 'dam_tih');
    splitName(r, 'dam_sire', 'dam_sire_breed', 'dam_sire_tih');
    const year = num(r.foaled);
    const season = num(r.season) || defaultYear;
    return {
      position: num(r.position),
      horse_name: str(r.horse_name, 120), former_name: str(r.former_name, 240),
      breed: str(r.breed, 12), tih_flag: bool(r.tih_flag), foaled: year && year > 1950 && year < 2100 ? year : null, sex: str(r.sex, 20),
      sire: str(r.sire, 120), sire_breed: str(r.sire_breed, 12), sire_tih: bool(r.sire_tih),
      dam: str(r.dam, 120), dam_breed: str(r.dam_breed, 12), dam_tih: bool(r.dam_tih),
      dam_sire: str(r.dam_sire, 120), dam_sire_breed: str(r.dam_sire_breed, 12), dam_sire_tih: bool(r.dam_sire_tih),
      breeder: str(r.breeder, 160), breeder_county: str(r.breeder_county, 40),
      rider_name: str(r.rider_name, 120), rider_country: str(r.rider_country, 3).toUpperCase(),
      dressage: str(r.dressage, 12), show_jumping: str(r.show_jumping, 12), cross_country: str(r.cross_country, 12), score: num(r.score),
      country: str(r.country, 60) || 'Other',
      event_name: str(r.event_name, 200) || 'Event not given',
      event_date_text: str(r.event_date_text, 80),
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(r.start_date) ? r.start_date : `${season}-01-01`,
      end_date: /^\d{4}-\d{2}-\d{2}$/.test(r.end_date) ? r.end_date : '',
      season,
      class_name: str(r.class_name, 160) || 'Class not given',
      verified: bool(r.verified),
      // Where the line came from: the line as written, whether it read cleanly, and the source article.
      raw_line: str(r.raw_line || r.line || r.raw, 1000),
      parse_ok: r.parse_ok !== undefined ? bool(r.parse_ok) : !(Array.isArray(r.issues) && r.issues.length),
      article_url: str(r.article_url, 300),
      article_date: /^\d{4}-\d{2}-\d{2}$/.test(r.article_date) ? r.article_date : ''
    };
  }).filter(r => r.horse_name);
}

async function runChunks(db, stmts) {
  const out = [];
  for (let i = 0; i < stmts.length; i += CHUNK) out.push(...await db.batch(stmts.slice(i, i + CHUNK)));
  return out;
}
const firstId = res => (res && res.results && res.results[0] ? res.results[0].id : null);

/**
 * rows: cleaned rows. decisions: answers to near-match questions.
 * Returns { needsDecision: [...] } when a near-match still needs an answer, otherwise the summary.
 */
export async function importResults(db, rows, { decisions = {}, weekLabel = '', sourceNotes = '' } = {}) {
  const existing = await loadExisting(db);
  const plan = planImport(rows, existing, decisions);
  if (plan.pending.length) return { needsDecision: plan.pending };

  const before = {
    sires: new Set(existing.sires.map(x => x.id)), dams: new Set(existing.dams.map(x => x.id)),
    breeders: new Set(existing.breeders.map(x => x.id)), horses: new Set(existing.horses.map(x => x.id))
  };

  // 1. Sires and dam sires
  const sireIds = new Map();
  const sireList = [...plan.sires.values()].filter(s => !s.sameAs);
  const sireRes = await runChunks(db, sireList.map(s => s.id
    ? db.prepare(`UPDATE sires SET breed_code = CASE WHEN breed_code = '' THEN ?1 ELSE breed_code END, tih_flag = MAX(tih_flag, ?2) WHERE id = ?3 RETURNING id`)
      .bind(s.breed_code, s.tih ? 1 : 0, s.id)
    : db.prepare(`INSERT INTO sires (name, name_normalised, breed_code, tih_flag) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(name_normalised) DO UPDATE SET breed_code = CASE WHEN sires.breed_code = '' THEN excluded.breed_code ELSE sires.breed_code END,
          tih_flag = MAX(sires.tih_flag, excluded.tih_flag) RETURNING id`)
      .bind(s.name, s.key, s.breed_code, s.tih ? 1 : 0)));
  sireList.forEach((s, i) => sireIds.set(s.key, firstId(sireRes[i])));
  for (const s of plan.sires.values()) if (s.sameAs) sireIds.set(s.key, sireIds.get(s.sameAs));

  // 2. Dams, linked to their own sire
  const damIds = new Map();
  const damList = [...plan.dams.values()].filter(d => !d.sameAs);
  const damRes = await runChunks(db, damList.map(d => d.id
    ? db.prepare(`UPDATE dams SET breed_code = CASE WHEN breed_code = '' THEN ?1 ELSE breed_code END, tih_flag = MAX(tih_flag, ?2),
        sire_id = IFNULL(sire_id, ?3) WHERE id = ?4 RETURNING id`).bind(d.breed_code, d.tih ? 1 : 0, sireIds.get(d.sireKey) || null, d.id)
    : db.prepare(`INSERT INTO dams (name, name_normalised, breed_code, tih_flag, sire_id) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(name_normalised, sire_key) DO UPDATE SET breed_code = CASE WHEN dams.breed_code = '' THEN excluded.breed_code ELSE dams.breed_code END,
          tih_flag = MAX(dams.tih_flag, excluded.tih_flag) RETURNING id`)
      .bind(d.name, normaliseName(d.name), d.breed_code, d.tih ? 1 : 0, sireIds.get(d.sireKey) || null)));
  damList.forEach((d, i) => damIds.set(d.key, firstId(damRes[i])));
  for (const d of plan.dams.values()) if (d.sameAs) damIds.set(d.key, damIds.get(d.sameAs));

  // 3. Breeders
  const breederIds = new Map();
  const breederList = [...plan.breeders.values()].filter(b => !b.sameAs);
  const breederRes = await runChunks(db, breederList.map(b => b.id
    ? db.prepare('SELECT id FROM breeders WHERE id = ?').bind(b.id)
    : db.prepare(`INSERT INTO breeders (name, name_normalised, county) VALUES (?1, ?2, ?3)
        ON CONFLICT(name_normalised, county) DO UPDATE SET name = breeders.name RETURNING id`)
      .bind(b.name, normaliseName(b.name), b.county)));
  breederList.forEach((b, i) => breederIds.set(b.key, firstId(breederRes[i])));
  for (const b of plan.breeders.values()) if (b.sameAs) breederIds.set(b.key, breederIds.get(b.sameAs));

  // 4. Horses (name + year + sire + dam is one horse), filling in anything missing on an existing record
  const horseIds = new Map();
  const horseList = [...plan.horses.values()];
  const horseRes = await runChunks(db, horseList.map(h => {
    const sireId = sireIds.get(h.sireKey) || null, damId = damIds.get(h.damKey) || null;
    const damsireId = sireIds.get(h.damsireKey) || null, breederId = h.breederKey ? breederIds.get(h.breederKey) || null : null;
    if (h.id) {
      return db.prepare(`UPDATE horses SET
          sex = CASE WHEN sex = '' THEN ?1 ELSE sex END,
          breed_code = CASE WHEN breed_code = '' THEN ?2 ELSE breed_code END,
          tih_flag = MAX(tih_flag, ?3), damsire_id = IFNULL(damsire_id, ?4), breeder_id = IFNULL(breeder_id, ?5)
        WHERE id = ?6 RETURNING id`).bind(h.sex, h.breed_code, h.tih ? 1 : 0, damsireId, breederId, h.id);
    }
    return db.prepare(`INSERT INTO horses (name, name_normalised, birth_year, sire_id, dam_id, sex, breed_code, tih_flag, damsire_id, breeder_id)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(identity_key) DO UPDATE SET
          sex = CASE WHEN horses.sex = '' THEN excluded.sex ELSE horses.sex END,
          breed_code = CASE WHEN horses.breed_code = '' THEN excluded.breed_code ELSE horses.breed_code END,
          tih_flag = MAX(horses.tih_flag, excluded.tih_flag),
          damsire_id = IFNULL(horses.damsire_id, excluded.damsire_id),
          breeder_id = IFNULL(horses.breeder_id, excluded.breeder_id)
        RETURNING id`)
      .bind(h.name, normaliseName(h.name), h.birth_year, sireId, damId, h.sex, h.breed_code, h.tih ? 1 : 0, damsireId, breederId);
  }));
  horseList.forEach((h, i) => horseIds.set(h.key, firstId(horseRes[i])));

  // 5. Former names
  const aliasStmts = [];
  for (const h of horseList) {
    for (const former of String(h.former || '').split(/\s*(?:&|,)\s*/).filter(Boolean)) {
      aliasStmts.push(db.prepare('INSERT OR IGNORE INTO horse_aliases (horse_id, former_name, former_name_normalised) VALUES (?, ?, ?)')
        .bind(horseIds.get(h.key), former, normaliseName(former)));
    }
  }
  await runChunks(db, aliasStmts);

  // 6. Events and classes (shared with the public results pages)
  const evKey = r => `${r.event_name}|${r.start_date}|${r.country}`;
  // The latest article that reported an event is kept on the event.
  const events = [...new Map(rows.map(r => [evKey(r), r])).values()];
  for (const ev of events) ev.article = rows.filter(r => evKey(r) === evKey(ev)).reduce((a, r) => (r.article_date > a.article_date ? r : a), ev);
  const evRes = await runChunks(db, events.map(r => db.prepare(
    `INSERT INTO events (name, date_text, start_date, end_date, country, season, source_notes, article_url, article_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name, start_date, country) DO UPDATE SET date_text = excluded.date_text,
       end_date = CASE WHEN events.end_date = '' THEN excluded.end_date ELSE events.end_date END,
       article_url = CASE WHEN excluded.article_date > events.article_date THEN excluded.article_url ELSE events.article_url END,
       article_date = MAX(events.article_date, excluded.article_date) RETURNING id`
  ).bind(r.event_name, r.event_date_text, r.start_date, r.end_date, r.country, r.season, sourceNotes, r.article.article_url, r.article.article_date)));
  const eventId = new Map(events.map((r, i) => [evKey(r), firstId(evRes[i])]));
  const classKeys = [...new Map(rows.map(r => [`${eventId.get(evKey(r))}|${r.class_name}`, { ev: eventId.get(evKey(r)), name: r.class_name }])).entries()];
  const clRes = await runChunks(db, classKeys.map(([, c]) => db.prepare(
    `INSERT INTO classes (event_id, name) VALUES (?, ?) ON CONFLICT(event_id, name) DO UPDATE SET name = excluded.name RETURNING id`).bind(c.ev, c.name)));
  const classId = new Map(classKeys.map(([k], i) => [k, firstId(clRes[i])]));

  // 7. One batch per paste, so an upload can still be removed as a whole
  const batch = await db.prepare('INSERT INTO batches (label, row_count, unverified_count) VALUES (?, 0, 0) RETURNING id')
    .bind(str(weekLabel, 120) || `Upload ${new Date().toISOString().slice(0, 10)}`).first();

  // 8. Results: a horse once per class of an event. Existing ones are left alone.
  const resRes = await runChunks(db, rows.map(r => db.prepare(
    `INSERT INTO results (event_id, horse_id, rider_name, rider_country, class_name, placing, dressage, xc_jumping, show_jumping, total, week_label, verified, batch_id,
       raw_line, parse_ok, article_url, article_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, class_name, horse_id) DO NOTHING RETURNING id`
  ).bind(eventId.get(evKey(r)), horseIds.get(horseKey(r)), r.rider_name, r.rider_country, r.class_name, r.position,
    r.dressage, r.cross_country, r.show_jumping, r.score, str(weekLabel, 120), r.verified ? 1 : 0, batch.id,
    r.raw_line, r.parse_ok ? 1 : 0, r.article_url, r.article_date)));

  // 9. Placings for the public pages, one for each new result. A result that was already saved keeps its placing,
  //    even when this paste spells the name slightly differently ("Foody's" / "Foody’s").
  //    The rider stays on the result, out of the search index.
  await runChunks(db, rows.flatMap((r, i) => {
    if (!firstId(resRes[i])) return [];
    const d = displayFields(r);
    return db.prepare(`INSERT OR IGNORE INTO placings (class_id, batch_id, result_id, position, horse_name, former_name, breed, foaled, sex,
        sire, dam, dam_sire, breeder, dressage, show_jumping, cross_country, score, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      classId.get(`${eventId.get(evKey(r))}|${r.class_name}`), batch.id, firstId(resRes[i]), r.position, r.horse_name, r.former_name,
      r.breed + (r.tih_flag ? '[TIH]' : ''), r.foaled, r.sex, d.sire, d.dam, d.dam_sire, d.breeder,
      r.dressage, r.show_jumping, r.cross_country, r.score, r.verified ? 1 : 0);
  }));

  // 10. Remember "same" answers so next week's paste doesn't ask again
  const idMaps = { sire: sireIds, dam: damIds, breeder: breederIds, horse: horseIds };
  const remember = [];
  for (const [kind, entities] of [['sire', plan.sires], ['dam', plan.dams], ['breeder', plan.breeders], ['horse', plan.horses]]) {
    for (const e of entities.values()) {
      const answered = plan.questions.some(q => q.key === `${kind}:${e.key}`);
      if (!answered || e.isNew || e.remembered) continue;
      const target = idMaps[kind].get(e.key);
      if (target) remember.push(db.prepare('INSERT OR REPLACE INTO name_matches (kind, match_key, target_id) VALUES (?, ?, ?)').bind(kind, e.key, target));
    }
  }
  await runChunks(db, remember);

  const newResults = resRes.filter(x => x.results && x.results.length).length;
  // Count what this upload holds rather than trusting the insert's change count (an ignored insert can still report one).
  const newPlacings = (await db.prepare('SELECT COUNT(*) AS n FROM placings WHERE batch_id = ?').bind(batch.id).first()).n;
  if (!newResults && !newPlacings) {
    await db.prepare('DELETE FROM batches WHERE id = ?').bind(batch.id).run();
  } else {
    await db.prepare(`UPDATE batches SET row_count = (SELECT COUNT(*) FROM placings WHERE batch_id = ?1),
      unverified_count = (SELECT COUNT(*) FROM placings p WHERE p.batch_id = ?1 AND ${DOUBT_SQL}) WHERE id = ?1`).bind(batch.id).run();
  }

  // What happened, event by event: rows in this paste, new, already on the site (a duplicate: same event, class
  // and horse), new but held back until checked, and how many results the event has on the site now.
  const isNew = rows.map((r, i) => !!firstId(resRes[i]));
  const held = new Set((await db.prepare(`SELECT p.result_id FROM placings p WHERE p.batch_id = ? AND ${DOUBT_SQL}`).bind(batch.id).all()).results.map(x => x.result_id));
  const isHeld = rows.map((r, i) => isNew[i] && held.has(firstId(resRes[i])));
  const perEvent = [];
  for (const ev of events) {
    const k = evKey(ev), idx = rows.map((r, i) => i).filter(i => evKey(rows[i]) === k), id = eventId.get(k);
    const onSite = (await db.prepare(`SELECT COUNT(*) AS n FROM placings p JOIN classes c ON c.id = p.class_id WHERE c.event_id = ? AND ${PUBLIC_SQL}`).bind(id).first()).n;
    perEvent.push({ id, name: ev.event_name, start_date: ev.start_date, country: ev.country, season: ev.season, rows: idx.length,
      new: idx.filter(i => isNew[i] && !isHeld[i]).length, duplicates: idx.filter(i => !isNew[i]).length, failed: idx.filter(i => isHeld[i]).length, onSite });
  }
  perEvent.sort((a, b) => b.start_date.localeCompare(a.start_date) || a.name.localeCompare(b.name));

  const newOf = (ids, set) => new Set([...ids.values()].filter(id => id && !set.has(id))).size;
  return {
    ok: true,
    batchId: newResults || newPlacings ? batch.id : null,
    rows: rows.length,
    results: newResults,
    alreadySaved: rows.length - newResults,
    // The three numbers the owner area shows: new and on the site, duplicates skipped, and new but failed the
    // checks (saved, but hidden until fixed in the Unverified tab).
    added: isNew.filter((n, i) => n && !isHeld[i]).length,
    duplicates: rows.length - newResults,
    failed: isHeld.filter(Boolean).length,
    events: perEvent,
    horses: newOf(horseIds, before.horses),
    sires: newOf(sireIds, before.sires),
    dams: newOf(damIds, before.dams),
    breeders: newOf(breederIds, before.breeders)
  };
}

