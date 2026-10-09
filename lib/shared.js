/*
 * The shared horse database (binding SHARED, D1 "irishbredhorses"): stallions, horses, pedigree and breeders that
 * every site reads. Tables are in migrations-shared/.
 *
 * Owner uploads: a spreadsheet saved as CSV (or pasted from Excel), one horse per row. planUpload() works out what
 * each row would do without saving anything; applyUpload() saves a plan in one transaction.
 *
 * Matching (nothing is merged on a guess):
 *   1. UELN or FEI ID: the horse with that number.
 *   2. Otherwise name + year of birth. One horse of that name with no year on file also matches (a sire or dam
 *      first named in someone's pedigree). Several possible horses: the row waits for a decision.
 *   Sires, dams and dam sires are found by name (a dam together with her own sire). One match links to it; none
 *   creates the horse; several hold the row back.
 *   A value already on file is never overwritten unless "replace what's on file" is ticked: a different value holds
 *   the row back and says what differs.
 */
import { normaliseName, splitTagged, splitBreeder, isNearName } from './names.js';

export const MAX_UPLOAD_ROWS = 2000;

/* ---------- Reading the file ---------- */

// RFC 4180 CSV (quotes, doubled quotes, newlines in quotes), or tab-separated text pasted from a spreadsheet.
export function parseDelimited(text) {
  const src = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n', 1)[0];
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t'
    : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// Column headings people actually use → field. Matched ignoring case, spaces and punctuation.
const HEADINGS = {
  name: ['name', 'horse', 'horsename', 'stallion', 'stallionname'],
  sex: ['sex', 'gender'],
  foaled_year: ['year', 'foaled', 'foaledyear', 'yob', 'yearofbirth', 'birthyear', 'born', 'dob', 'dateofbirth'],
  colour: ['colour', 'color'],
  studbook: ['studbook', 'breed', 'breedcode'],
  ueln: ['ueln', 'passport', 'passportnumber', 'uelnnumber'],
  fei_id: ['feiid', 'fei', 'feinumber', 'feipassport', 'feicode', 'feiregistration', 'feiregistrationnumber'],
  sji_id: ['sjiid', 'sji'],
  sire: ['sire', 'sirename', 'father'],
  dam: ['dam', 'damname', 'mother'],
  dam_sire: ['damsire', 'damssire', 'damsiresire', 'broodmaresire', 'bms', 'maternalgrandsire', 'damsirename'],
  breeder: ['breeder', 'breedername', 'bredby'],
  breeder_county: ['breedercounty', 'county'],
  breeder_country: ['breedercountry', 'country'],
  irish_bred: ['irishbred', 'irish'],
  aliases: ['aliases', 'alias', 'aka', 'formername', 'formernames', 'previousnames', 'othernames']
};
const HEADING_OF = Object.fromEntries(Object.entries(HEADINGS).flatMap(([f, hs]) => hs.map(h => [h, f])));
const headingKey = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const SEX = {
  stallion: 'stallion', s: 'stallion', st: 'stallion', entire: 'stallion', stal: 'stallion', h: 'stallion', hengst: 'stallion',
  mare: 'mare', m: 'mare', f: 'mare', female: 'mare', merrie: 'mare',
  gelding: 'gelding', g: 'gelding', geld: 'gelding', w: 'gelding',
  colt: 'colt', c: 'colt', filly: 'filly'
};

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const yes = v => /^(y|yes|true|1|irish|irl|ire)$/i.test(clean(v));
const no = v => /^(n|no|false|0)$/i.test(clean(v));

// A sire or dam as written: "Cruising (ISH)", and a year to tell two of the same name apart: "Casper (2010)".
function parentName(raw) {
  let s = clean(raw), year = null;
  const m = s.match(/\s*[([]\s*((?:19|20)\d{2})\s*[)\]]/);
  if (m) { year = Number(m[1]); s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim(); }
  return { ...splitTagged(s), year };
}

/** File text → { rows: [{ line, ...fields }], ignored: [headings], problems: [{ line, message }] } */
export function readUpload(text) {
  const table = parseDelimited(text);
  if (!table.length) return { rows: [], ignored: [], problems: [{ line: 1, message: 'The file is empty.' }] };
  const heads = table[0].map(h => HEADING_OF[headingKey(h)] || null);
  const ignored = table[0].filter((h, i) => !heads[i] && clean(h));
  const problems = [];
  if (!heads.includes('name')) {
    return { rows: [], ignored, problems: [{ line: 1, message: 'No "Name" column. The first row must be the column headings (see the template).' }] };
  }
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const raw = {};
    heads.forEach((f, j) => { if (f && raw[f] === undefined) raw[f] = clean(table[i][j]); });
    const line = i + 1;
    const named = splitTagged(raw.name);
    if (!named.name) { problems.push({ line, message: 'No horse name: row skipped.' }); continue; }
    const r = { line, name: named.name, studbook: (raw.studbook || named.breed_code || '').toUpperCase().replace(/^UNK$/, '') };
    // Sex and year swapped between their columns (a year under Sex, "Mare" under DOB): each is taken for what it is.
    const sexWord = v => Boolean(v && SEX[v.toLowerCase().replace(/[^a-z]/g, '')]);
    const yearLike = v => /\b(19|20)\d{2}\b/.test(v || '');
    if ((raw.sex && !sexWord(raw.sex) && yearLike(raw.sex)) && (!raw.foaled_year || sexWord(raw.foaled_year))) {
      [raw.sex, raw.foaled_year] = [raw.foaled_year || '', raw.sex];
      problems.push({ line, message: 'Sex and year of birth were in each other\'s columns: read the right way round.' });
    } else if (raw.foaled_year && sexWord(raw.foaled_year) && !raw.sex) {
      [raw.sex, raw.foaled_year] = [raw.foaled_year, ''];
    }
    const sex = raw.sex ? SEX[raw.sex.toLowerCase().replace(/[^a-z]/g, '')] : '';
    if (raw.sex && !sex) problems.push({ line, message: `Sex "${raw.sex}" not understood: left as unknown.` });
    r.sex = sex || '';
    const year = (raw.foaled_year || '').match(/\b(19|20)\d{2}\b/);
    if (raw.foaled_year && !year) problems.push({ line, message: `Year "${raw.foaled_year}" not understood: left empty.` });
    r.foaled_year = year ? Number(year[0]) : null;
    r.colour = raw.colour || '';
    r.ueln = (raw.ueln || '').toUpperCase().replace(/[\s.-]/g, '');
    r.fei_id = (raw.fei_id || '').toUpperCase().replace(/\s/g, '');
    r.sji_id = raw.sji_id || '';
    r.sire = parentName(raw.sire);
    r.dam = parentName(raw.dam);
    r.dam_sire = parentName(raw.dam_sire);
    const breeder = splitBreeder(raw.breeder);
    r.breeder = /^(unk|unknown|n\/?a|-)$/i.test(breeder.name) ? '' : breeder.name;
    r.breeder_county = raw.breeder_county || breeder.county || '';
    r.breeder_country = raw.breeder_country || '';
    r.irish_bred = raw.irish_bred ? (yes(raw.irish_bred) ? 1 : no(raw.irish_bred) ? 0 : null) : null;
    r.aliases = [...new Set([...(raw.aliases || '').split(/[;|]/), named.former].map(clean).filter(Boolean))];
    rows.push(r);
  }
  if (rows.length > MAX_UPLOAD_ROWS) {
    problems.unshift({ line: 1, message: `This file has ${rows.length} horses. Split it into files of ${MAX_UPLOAD_ROWS} or fewer.` });
  }
  return { rows, ignored, problems };
}

/* ---------- Planning ---------- */

const keyOf = s => normaliseName(s);
const HORSE_FIELDS = ['sex', 'foaled_year', 'colour', 'studbook', 'ueln', 'fei_id', 'sji_id', 'sire_id', 'dam_id', 'breeder_id', 'irish_bred'];
const empty = (field, v) => v === null || v === undefined || v === '' || (field === 'sex' && v === 'unknown') || (field === 'irish_bred' && v === 0);

/** Everything the matching needs from the database, read once. */
export async function loadIndex(db) {
  const [horses, aliases, parties] = await db.batch([
    db.prepare(`SELECT id, name, name_key, sex, foaled_year, colour, studbook, ueln, fei_id, sji_id, sire_id, dam_id, breeder_id,
                       irish_bred FROM horse`),
    db.prepare('SELECT horse_id, alias, alias_key FROM horse_alias'),
    db.prepare('SELECT id, name, name_key, county, country FROM party')
  ]);
  return makeIndex(horses.results, aliases.results, parties.results);
}

export function makeIndex(horses = [], aliases = [], parties = []) {
  const ix = { horses: new Map(), byKey: new Map(), byUeln: new Map(), byFei: new Map(), aliases: new Set(), parties: new Map(), partyByKey: new Map() };
  for (const h of horses) addHorse(ix, { ...h });
  for (const a of aliases) {
    ix.aliases.add(`${a.horse_id}|${a.alias_key}`);
    const list = ix.byKey.get(a.alias_key) || [];
    if (!list.includes(a.horse_id)) list.push(a.horse_id);
    ix.byKey.set(a.alias_key, list);
  }
  for (const p of parties) addParty(ix, { ...p });
  return ix;
}
function addHorse(ix, h) {
  ix.horses.set(h.id, h);
  const list = ix.byKey.get(h.name_key) || [];
  list.push(h.id);
  ix.byKey.set(h.name_key, list);
  if (h.ueln) ix.byUeln.set(h.ueln, h.id);
  if (h.fei_id) ix.byFei.set(h.fei_id, h.id);
}
function addParty(ix, p) {
  ix.parties.set(p.id, p);
  const list = ix.partyByKey.get(p.name_key) || [];
  list.push(p.id);
  ix.partyByKey.set(p.name_key, list);
}

const describe = h => `${h.name}${h.foaled_year ? ` (${h.foaled_year})` : ''}${h.studbook ? ` ${h.studbook}` : ''}${h.ueln ? `, UELN ${h.ueln}` : ''}`;

/**
 * rows (from readUpload) + index → plan. Each row gets { outcome: 'new'|'updated'|'same'|'held', notes, ... }.
 * The plan holds new records with ids from nextIds, so applyUpload can write them in one batch.
 */
export function planUpload(rows, ix, { overwrite = false, nextHorseId = 1, nextPartyId = 1 } = {}) {
  let hid = nextHorseId, pid = nextPartyId;
  const created = [];          // new horses in creation order (parents before children)
  const createdParties = [];
  const updates = new Map();   // horse id → { field: [old, new] }
  const newAliases = [];       // { horse_id, alias, alias_key }
  const candidates = [];       // { a, b, reason } possible duplicates to review
  const out = [];
  const journal = [];          // every change to the index, so a held row can be rolled back
  const createdIds = new Set();
  const nearBuckets = new Map(); // first letter → name keys, for the similar-name check
  for (const k of ix.byKey.keys()) bucket(k).push(k);
  function bucket(k) { const b = k[0] || ''; if (!nearBuckets.has(b)) nearBuckets.set(b, []); return nearBuckets.get(b); }

  const isNew = id => createdIds.has(id);
  const horsesNamed = key => (ix.byKey.get(key) || []).map(id => ix.horses.get(id));

  function createHorse(fields) {
    const h = { id: hid++, name_key: keyOf(fields.name), sex: 'unknown', foaled_year: null, colour: '', studbook: '', ueln: '',
      fei_id: '', sji_id: '', sire_id: null, dam_id: null, breeder_id: null, irish_bred: 0, ...fields };
    // A new name close to one already on file is saved separately and listed to check, never merged.
    const len = h.name_key.replace(/ /g, '').length;
    for (const k of bucket(h.name_key)) {
      if (k === h.name_key || Math.abs(k.replace(/ /g, '').length - len) > 2 || !isNearName(k, h.name_key)) continue;
      for (const id of ix.byKey.get(k) || []) {
        if (id !== h.id) { candidates.push({ a: id, b: h.id, reason: `similar name: ${ix.horses.get(id).name} / ${h.name}` }); journal.push({ type: 'candidate' }); }
      }
    }
    const isNewKey = !ix.byKey.has(h.name_key);
    addHorse(ix, h);
    if (isNewKey) bucket(h.name_key).push(h.name_key);
    created.push(h);
    createdIds.add(h.id);
    journal.push({ type: 'horse', h, isNewKey });
    return h;
  }

  // A sire or dam named in a row. Returns { id } or { problem }.
  function findParent(tagged, role, damSireId) {
    if (!tagged.name) return { id: null };
    const key = keyOf(tagged.name);
    let list = horsesNamed(key);
    if (tagged.year) list = list.filter(h => !h.foaled_year || h.foaled_year === tagged.year);
    if (role === 'sire') {
      const males = list.filter(h => h.sex !== 'mare' && h.sex !== 'filly');
      if (tagged.breed_code && males.length > 1) {
        const sameBook = males.filter(h => !h.studbook || h.studbook === tagged.breed_code);
        if (sameBook.length) list = sameBook; else list = males;
      } else list = males;
    } else {
      list = list.filter(h => h.sex !== 'stallion' && h.sex !== 'gelding' && h.sex !== 'colt');
      if (damSireId !== undefined && list.length > 1) {
        const bySire = list.filter(h => h.sire_id === damSireId || h.sire_id === null);
        if (bySire.length) list = bySire;
      }
    }
    if (list.length === 1) {
      const h = list[0];
      if (role === 'dam' && damSireId && h.sire_id && h.sire_id !== damSireId) {
        // Same name, different dam sire: a different mare.
        return { id: createHorse({ name: tagged.name, sex: 'mare', studbook: tagged.breed_code, sire_id: damSireId }).id, created: true };
      }
      if (role === 'dam' && damSireId && !h.sire_id) setField(h, 'sire_id', damSireId);
      return { id: h.id };
    }
    if (list.length > 1) {
      return { problem: `${list.length} horses called ${tagged.name} could be the ${role === 'dam' ? 'dam' : 'sire'} (${list.slice(0, 3).map(describe).join('; ')}). Write it with its year to say which, e.g. ${tagged.name} (${list.find(h => h.foaled_year)?.foaled_year || 2010})${role === 'dam' ? ', or add the dam sire' : ''}.` };
    }
    return { id: createHorse({ name: tagged.name, sex: role === 'sire' ? 'stallion' : 'mare', studbook: tagged.breed_code, foaled_year: tagged.year, sire_id: role === 'dam' ? (damSireId || null) : null }).id, created: true };
  }

  function findBreeder(r) {
    if (!r.breeder) return { id: null };
    const key = keyOf(r.breeder);
    let list = (ix.partyByKey.get(key) || []).map(id => ix.parties.get(id));
    if (r.breeder_county) list = list.filter(p => !p.county || p.county.toLowerCase() === r.breeder_county.toLowerCase());
    if (list.length === 1) return { id: list[0].id };
    if (list.length > 1) return { problem: `${list.length} breeders called ${r.breeder} (${list.map(p => p.county || 'no county').join(', ')}). Add the county.` };
    const p = { id: pid++, name: r.breeder, name_key: key, kind: 'person', county: r.breeder_county, country: r.breeder_country };
    addParty(ix, p);
    createdParties.push(p);
    journal.push({ type: 'party', p });
    return { id: p.id };
  }

  // Sets a value on a horse already on file (or one created earlier in this file).
  function setField(h, field, value) {
    if (h[field] === value) return;
    const entry = { type: 'field', h, field, old: h[field], hadUpdates: updates.has(h.id), prev: updates.get(h.id)?.[field] };
    if (!isNew(h.id)) {
      const u = updates.get(h.id) || {};
      u[field] = [u[field] ? u[field][0] : h[field], value];
      updates.set(h.id, u);
    }
    if (field === 'ueln' || field === 'fei_id') {
      const map = field === 'ueln' ? ix.byUeln : ix.byFei;
      if (h[field]) map.delete(h[field]);
      if (value) map.set(value, h.id);
    }
    h[field] = value;
    journal.push(entry);
  }

  function rollback(mark) {
    while (journal.length > mark) {
      const e = journal.pop();
      if (e.type === 'candidate') candidates.pop();
      else if (e.type === 'party') {
        createdParties.pop(); pid--;
        ix.parties.delete(e.p.id);
        ix.partyByKey.set(e.p.name_key, ix.partyByKey.get(e.p.name_key).filter(id => id !== e.p.id));
      } else if (e.type === 'horse') {
        created.pop(); createdIds.delete(e.h.id); hid--;
        ix.horses.delete(e.h.id);
        const left = ix.byKey.get(e.h.name_key).filter(id => id !== e.h.id);
        if (left.length) ix.byKey.set(e.h.name_key, left); else ix.byKey.delete(e.h.name_key);
        if (e.isNewKey) { const b = bucket(e.h.name_key); b.splice(b.lastIndexOf(e.h.name_key), 1); }
        if (e.h.ueln) ix.byUeln.delete(e.h.ueln);
        if (e.h.fei_id) ix.byFei.delete(e.h.fei_id);
      } else if (e.type === 'field') {
        if (e.field === 'ueln' || e.field === 'fei_id') {
          const map = e.field === 'ueln' ? ix.byUeln : ix.byFei;
          if (e.h[e.field]) map.delete(e.h[e.field]);
          if (e.old) map.set(e.old, e.h.id);
        }
        e.h[e.field] = e.old;
        if (!e.hadUpdates) updates.delete(e.h.id);
        else if (e.prev === undefined) delete updates.get(e.h.id)[e.field];
        else updates.get(e.h.id)[e.field] = e.prev;
      }
    }
  }

  function matchRow(r) {
    const byUeln = r.ueln ? ix.byUeln.get(r.ueln) : undefined;
    const byFei = r.fei_id ? ix.byFei.get(r.fei_id) : undefined;
    if (byUeln && byFei && byUeln !== byFei) {
      return { problem: `UELN ${r.ueln} is ${describe(ix.horses.get(byUeln))} but FEI ID ${r.fei_id} is ${describe(ix.horses.get(byFei))}.` };
    }
    if (byUeln || byFei) return { horse: ix.horses.get(byUeln || byFei), by: byUeln ? 'UELN' : 'FEI ID' };
    const named = horsesNamed(keyOf(r.name));
    // A horse with a different passport number is a different horse.
    const possible = named.filter(h => !(r.ueln && h.ueln && h.ueln !== r.ueln) && !(r.fei_id && h.fei_id && h.fei_id !== r.fei_id));
    if (r.foaled_year) {
      const sameYear = possible.filter(h => h.foaled_year === r.foaled_year);
      if (sameYear.length === 1) return { horse: sameYear[0], by: 'name and year' };
      if (sameYear.length > 1) return { problem: `${sameYear.length} horses called ${r.name} born ${r.foaled_year} are on file. Add the UELN to say which.` };
      const noYear = possible.filter(h => !h.foaled_year);
      if (noYear.length === 1 && possible.length === 1) return { horse: noYear[0], by: 'name (no year on file)' };
      if (noYear.length > 1) return { problem: `${noYear.length} horses called ${r.name} with no year on file. Add the UELN to say which.` };
      return { horse: null };
    }
    if (possible.length === 1) return { horse: possible[0], by: 'name' };
    if (possible.length > 1) return { problem: `${possible.length} horses called ${r.name} are on file (${possible.slice(0, 3).map(describe).join('; ')}). Add the year or UELN.` };
    return { horse: null };
  }

  for (const r of rows) {
    const result = { line: r.line, name: r.name, outcome: 'same', notes: [] };
    out.push(result);
    // Check everything before changing anything, so a held row leaves no trace.
    const m = matchRow(r);
    if (m.problem) { result.outcome = 'held'; result.notes.push(m.problem); continue; }
    const mark = journal.length;
    const undo = () => rollback(mark);
    const damSire = r.dam.name ? findParent(r.dam_sire, 'sire') : { id: null };
    const sire = findParent(r.sire, 'sire');
    const dam = damSire.problem ? damSire : findParent(r.dam, 'dam', damSire.id || undefined);
    const breeder = findBreeder(r);
    const problems = [sire, dam, damSire, breeder].map(x => x.problem).filter(Boolean);
    if (problems.length) { undo(); result.outcome = 'held'; result.notes.push(...new Set(problems)); continue; }
    if (r.dam_sire.name && !r.dam.name) result.notes.push('Dam sire given without a dam: not saved.');

    const values = {
      sex: r.sex || null, foaled_year: r.foaled_year, colour: r.colour || null, studbook: r.studbook || null, ueln: r.ueln || null,
      fei_id: r.fei_id || null, sji_id: r.sji_id || null, sire_id: sire.id, dam_id: dam.id, breeder_id: breeder.id,
      irish_bred: r.irish_bred
    };
    // Passport numbers are unique: one that belongs to another horse holds the row.
    const taken = [['ueln', ix.byUeln], ['fei_id', ix.byFei]].find(([f, map]) => values[f] && map.has(values[f]) && (!m.horse || map.get(values[f]) !== m.horse.id));
    if (taken) { undo(); result.outcome = 'held'; result.notes.push(`${taken[0] === 'ueln' ? 'UELN' : 'FEI ID'} ${values[taken[0]]} already belongs to ${describe(ix.horses.get(taken[1].get(values[taken[0]])))}.`); continue; }

    if (!m.horse) {
      const fields = { name: r.name };
      for (const f of HORSE_FIELDS) if (!empty(f, values[f]) || (f === 'irish_bred' && values[f] !== null)) fields[f] = values[f];
      const h = createHorse(fields);
      result.outcome = 'new';
      result.horse_id = h.id;
      addAliases(h, r);
      continue;
    }

    const h = m.horse;
    result.horse_id = h.id;
    if (m.by !== 'name' && m.by !== 'name and year' && keyOf(r.name) !== h.name_key) result.notes.push(`Found by ${m.by}; on file as ${h.name}, so "${r.name}" is kept as another name.`);
    const conflicts = [];
    for (const f of HORSE_FIELDS) {
      const v = values[f];
      if (v === null || v === undefined || v === '') continue;
      if (f === 'irish_bred' && v === h[f]) continue;
      if (empty(f, h[f]) || overwrite) { if (h[f] !== v) setField(h, f, v); }
      else if (h[f] !== v) conflicts.push(`${label(f)} on file is ${show(ix, f, h[f])}, this file says ${show(ix, f, v)}`);
    }
    if (conflicts.length) { undo(); result.outcome = 'held'; result.notes.push(...conflicts, 'Tick "Replace what\'s on file" to use this file\'s values.'); continue; }
    addAliases(h, r);
    if (keyOf(r.name) !== h.name_key) addAlias(h, r.name, r.line);
    const touched = isNew(h.id) || updates.has(h.id) || newAliases.some(a => a.horse_id === h.id && a.line === r.line);
    result.outcome = isNew(h.id) ? 'new' : touched ? 'updated' : 'same';
  }

  function addAliases(h, r) { for (const a of r.aliases) addAlias(h, a, r.line); }
  function addAlias(h, alias, line) {
    const k = keyOf(alias);
    if (!k || k === h.name_key || ix.aliases.has(`${h.id}|${k}`)) return;
    ix.aliases.add(`${h.id}|${k}`);
    newAliases.push({ horse_id: h.id, alias, alias_key: k, line });
  }

  const count = o => out.filter(x => x.outcome === o).length;
  return {
    rows: out, created, createdParties, updates, newAliases, candidates,
    counts: { rows: out.length, new: count('new'), updated: count('updated'), same: count('same'), held: count('held'),
      horsesAdded: created.length, horsesUpdated: updates.size, breedersAdded: createdParties.length }
  };
}

const LABELS = { sex: 'Sex', foaled_year: 'Year', colour: 'Colour', studbook: 'Studbook', ueln: 'UELN', fei_id: 'FEI ID', sji_id: 'SJI ID', sire_id: 'Sire', dam_id: 'Dam', breeder_id: 'Breeder', irish_bred: 'Irish-bred' };
const label = f => LABELS[f] || f;
function show(ix, f, v) {
  if (f === 'sire_id' || f === 'dam_id') return ix.horses.get(v) ? describe(ix.horses.get(v)) : 'none';
  if (f === 'breeder_id') return ix.parties.get(v) ? ix.parties.get(v).name : 'none';
  if (f === 'irish_bred') return v ? 'yes' : 'no';
  return String(v);
}

/* ---------- Saving ---------- */

/** Saves a plan in one D1 batch (all or nothing). Returns the upload id. */
export async function applyUpload(db, plan, { sourceId, label: uploadLabel = '', filename = '', user = '', uploadId }) {
  const s = [];
  const change = (table, id, field, oldV, newV) => s.push(db.prepare(
    'INSERT INTO upload_change (upload_id, table_name, row_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(uploadId, table, id, field, oldV === null || oldV === undefined ? null : String(oldV), newV === null || newV === undefined ? null : String(newV)));

  s.push(db.prepare('INSERT INTO upload (id, source_id, label, filename, row_count, added, updated, held, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(uploadId, sourceId, uploadLabel, filename, plan.counts.rows, plan.counts.horsesAdded, plan.counts.horsesUpdated, plan.counts.held, user));
  for (const p of plan.createdParties) {
    s.push(db.prepare('INSERT INTO party (id, name, name_key, kind, county, country, source_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(p.id, p.name, p.name_key, 'person', p.county || null, p.country || null, sourceId));
    change('party', p.id, '*', null, p.name);
  }
  // New horses go in first without their sire and dam, then the links are written, so the order never matters.
  for (const h of plan.created) {
    s.push(db.prepare(`INSERT INTO horse (id, name, name_key, sex, foaled_year, colour, studbook, ueln, fei_id, sji_id, sire_id, dam_id,
                                          breeder_id, irish_bred, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(h.id, h.name, h.name_key, h.sex || 'unknown', h.foaled_year ?? null, h.colour || null, h.studbook || null, h.ueln || null,
        h.fei_id || null, h.sji_id || null, null, null, h.breeder_id ?? null, h.irish_bred ? 1 : 0, sourceId));
    change('horse', h.id, '*', null, h.name);
  }
  for (const h of plan.created) {
    if (h.sire_id || h.dam_id) s.push(db.prepare('UPDATE horse SET sire_id = ?, dam_id = ? WHERE id = ?').bind(h.sire_id ?? null, h.dam_id ?? null, h.id));
  }
  for (const [id, fields] of plan.updates) {
    const names = Object.keys(fields);
    s.push(db.prepare(`UPDATE horse SET ${names.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .bind(...names.map(f => fields[f][1] ?? null), id));
    for (const f of names) change('horse', id, f, fields[f][0], fields[f][1]);
  }
  for (const a of plan.newAliases) {
    s.push(db.prepare('INSERT OR IGNORE INTO horse_alias (horse_id, alias, alias_key, source_id) VALUES (?, ?, ?, ?)')
      .bind(a.horse_id, a.alias, a.alias_key, sourceId));
    change('horse_alias', a.horse_id, 'alias', null, a.alias);
  }
  for (const c of plan.candidates) {
    const [a, b] = c.a < c.b ? [c.a, c.b] : [c.b, c.a];
    s.push(db.prepare('INSERT OR IGNORE INTO horse_match_candidate (horse_a_id, horse_b_id, reason) VALUES (?, ?, ?)').bind(a, b, c.reason));
  }
  await db.batch(s);
  return uploadId;
}

/** Reads the database, plans the file and (when save is true) saves it. */
export async function runUpload(db, text, { sourceId, overwrite = false, save = false, label: uploadLabel, filename, user }) {
  const source = await db.prepare('SELECT id, slug, name, licence_status, can_store, can_display FROM source WHERE id = ?').bind(sourceId).first();
  if (!source) throw new Error('Choose where this data comes from (the source).');
  const read = readUpload(text);
  if (read.rows.length > MAX_UPLOAD_ROWS) throw new Error(read.problems[0].message);
  const [ix, ids] = await Promise.all([
    loadIndex(db),
    db.prepare('SELECT (SELECT IFNULL(MAX(id), 0) FROM horse) AS h, (SELECT IFNULL(MAX(id), 0) FROM party) AS p, (SELECT IFNULL(MAX(id), 0) FROM upload) AS u').first()
  ]);
  const plan = planUpload(read.rows, ix, { overwrite, nextHorseId: ids.h + 1, nextPartyId: ids.p + 1 });
  const warnings = [];
  if (!source.can_store) warnings.push(`${source.name} is not marked as allowed to store this data (licence: ${source.licence_status.replace(/_/g, ' ')}). Check its terms before saving.`);
  if (!source.can_display) warnings.push(`${source.name} is not marked as allowed to show on the sites, so these horses stay hidden from visitors until it is.`);
  const summary = { source, counts: plan.counts, rows: plan.rows, problems: read.problems, ignored: read.ignored, warnings, possibleDuplicates: plan.candidates.length };
  if (!save) return summary;
  if (!plan.created.length && !plan.updates.size && !plan.newAliases.length) return { ...summary, saved: false, message: 'Nothing new to save.' };
  const uploadId = ids.u + 1;
  await applyUpload(db, plan, { sourceId, label: uploadLabel, filename, user, uploadId });
  return { ...summary, saved: true, uploadId };
}

/* ---------- Reading for the sites ---------- */

// A horse shows on the sites only when its source allows display.
const VISIBLE = 'source_id IN (SELECT id FROM source WHERE can_display = 1)';

/** Stallions: horses with progeny on file, or entered as stallions. Most progeny first. */
export async function listStallions(db, { q = '', limit = 50, offset = 0 } = {}) {
  const key = normaliseName(q);
  const where = [`h.${VISIBLE}`];
  const binds = [];
  if (key) { where.push(`(h.name_key LIKE ? OR h.id IN (SELECT horse_id FROM horse_alias WHERE alias_key LIKE ?))`); binds.push(`%${key}%`, `%${key}%`); }
  const { results } = await db.prepare(`
    SELECT h.id, h.name, h.studbook, h.foaled_year, h.colour, h.irish_bred,
           s.name AS sire_name, d.name AS dam_name, ds.name AS dam_sire_name,
           (SELECT COUNT(*) FROM horse c WHERE c.sire_id = h.id) AS progeny
    FROM horse h
    LEFT JOIN horse s ON s.id = h.sire_id
    LEFT JOIN horse d ON d.id = h.dam_id
    LEFT JOIN horse ds ON ds.id = d.sire_id
    WHERE ${where.join(' AND ')} AND (h.sex = 'stallion' OR EXISTS (SELECT 1 FROM horse c WHERE c.sire_id = h.id))
    ORDER BY progeny DESC, h.name COLLATE NOCASE
    LIMIT ? OFFSET ?`).bind(...binds, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0)).all();
  return results;
}

/** One horse: details, three generations of pedigree, other names, breeder and progeny. */
export async function getHorse(db, id) {
  const h = await db.prepare(`SELECT h.id, h.name, h.sex, h.foaled_year, h.colour, h.studbook, h.ueln, h.fei_id, h.irish_bred,
      h.sire_id, h.dam_id, p.name AS breeder, p.county AS breeder_county, src.name AS source
    FROM horse h LEFT JOIN party p ON p.id = h.breeder_id JOIN source src ON src.id = h.source_id
    WHERE h.id = ? AND h.${VISIBLE}`).bind(id).first();
  if (!h) return null;
  const { results: line } = await db.prepare(`
    WITH RECURSIVE ped (pos, id, gen) AS (
      SELECT 's', sire_id, 1 FROM horse WHERE id = ?1 AND sire_id IS NOT NULL
      UNION ALL SELECT 'd', dam_id, 1 FROM horse WHERE id = ?1 AND dam_id IS NOT NULL
      UNION ALL SELECT ped.pos || 's', x.sire_id, ped.gen + 1 FROM ped JOIN horse x ON x.id = ped.id WHERE x.sire_id IS NOT NULL AND ped.gen < 3
      UNION ALL SELECT ped.pos || 'd', x.dam_id, ped.gen + 1 FROM ped JOIN horse x ON x.id = ped.id WHERE x.dam_id IS NOT NULL AND ped.gen < 3
    )
    SELECT ped.pos, x.id, x.name, x.studbook, x.foaled_year FROM ped JOIN horse x ON x.id = ped.id WHERE x.${VISIBLE}`).bind(id).all();
  const [aliases, progeny] = await db.batch([
    db.prepare('SELECT alias FROM horse_alias WHERE horse_id = ? ORDER BY alias').bind(id),
    db.prepare(`SELECT c.id, c.name, c.sex, c.foaled_year, c.studbook, d.name AS dam_name, ds.name AS dam_sire_name
      FROM horse c LEFT JOIN horse d ON d.id = c.dam_id LEFT JOIN horse ds ON ds.id = d.sire_id
      WHERE (c.sire_id = ?1 OR c.dam_id = ?1) AND c.${VISIBLE}
      ORDER BY c.foaled_year DESC, c.name COLLATE NOCASE LIMIT 500`).bind(id)
  ]);
  const pedigree = Object.fromEntries(line.map(p => [p.pos, { id: p.id, name: p.name, studbook: p.studbook, foaled_year: p.foaled_year }]));
  delete h.sire_id; delete h.dam_id;
  return { ...h, pedigree, aliases: aliases.results.map(a => a.alias), progeny: progeny.results };
}

/* ---------- Owner area: browsing the shared horse database (not shown on the public sites) ---------- */

/** Horses and stallions on file, every source (hidden ones marked), with pedigree, breeder and progeny count. */
export async function ownerFindHorses(db, { q = '', stallions = false, limit = 100 } = {}) {
  const where = [], binds = [];
  const key = normaliseName(q);
  if (key) { where.push('(h.name_key LIKE ? OR h.id IN (SELECT horse_id FROM horse_alias WHERE alias_key LIKE ?) OR upper(IFNULL(h.fei_id, \'\')) = ? OR IFNULL(h.ueln, \'\') = ?)'); binds.push(`%${key}%`, `%${key}%`, q.trim().toUpperCase(), q.trim()); }
  if (stallions) where.push("(h.sex = 'stallion' OR EXISTS (SELECT 1 FROM horse c WHERE c.sire_id = h.id))");
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await db.batch([
    db.prepare(`SELECT h.id, h.name, h.sex, h.foaled_year, h.studbook, h.colour, h.ueln, h.fei_id,
        s.name AS sire, s.studbook AS sire_book, d.name AS dam, ds.name AS dam_sire, ds.studbook AS dam_sire_book,
        b.name AS breeder, b.county AS breeder_county, src.name AS source, src.can_display,
        (SELECT COUNT(*) FROM horse c WHERE c.sire_id = h.id) AS progeny,
        (SELECT COUNT(*) FROM result r WHERE r.horse_id = h.id) AS results
      FROM horse h LEFT JOIN horse s ON s.id = h.sire_id LEFT JOIN horse d ON d.id = h.dam_id LEFT JOIN horse ds ON ds.id = d.sire_id
      LEFT JOIN party b ON b.id = h.breeder_id LEFT JOIN source src ON src.id = h.source_id
      ${cond} ORDER BY progeny DESC, h.name COLLATE NOCASE LIMIT ?`).bind(...binds, Math.min(Number(limit) || 100, 500)),
    db.prepare(`SELECT COUNT(*) AS n FROM horse h ${cond}`).bind(...binds)
  ]);
  return { horses: rows.results, total: count.results[0].n };
}

/** A stallion's (or mare's) progeny on file, for the owner area. */
export async function ownerProgeny(db, id) {
  const { results } = await db.prepare(`SELECT c.id, c.name, c.sex, c.foaled_year, d.name AS dam, ds.name AS dam_sire
      FROM horse c LEFT JOIN horse d ON d.id = c.dam_id LEFT JOIN horse ds ON ds.id = d.sire_id
      WHERE c.sire_id = ?1 OR c.dam_id = ?1 ORDER BY c.foaled_year DESC, c.name COLLATE NOCASE LIMIT 500`).bind(id).all();
  return results;
}
