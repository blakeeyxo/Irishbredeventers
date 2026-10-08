/*
 * Reads FEI "Horse Performance" pages copied from the FEI database (Ctrl+A, Ctrl+C on the page, then paste).
 * One paste can hold several horses. Jumping pages are read; eventing pages are recognised and left out.
 *
 * A horse block looks like:
 *   Horse Performance
 *   Name   ABC MAYFLOWER
 *   FEI ID 109WK62
 *   Age    5 - 08/05/2021
 *   Sex    Mare            Color  Bay
 *   Studbook ISH - Irish Sport Horse Studbook (ISH)
 *   Start Date  Show  NF  Event  Competition  Obst. Height  Article  PG  #  FEI ID  Athlete  WC Nom.  Pos.  Score
 *   20/09/2026 08:30  Lanaken  BEL  CH-M-YH-S  Final for the …  125  221.4.3(ii)  12  10090233  Gemma PHELAN (IRL)
 *   19
 *   4(4+0)/72.11
 * The FEI page puts the placing and the score on lines of their own after each result.
 */

// Studbooks that make a horse Irish-bred. A horse with another studbook, or none, is not counted as Irish-bred on
// a guess: it is listed for the owner to decide.
export const IRISH_STUDBOOKS = new Set(['ISH', 'ID', 'IDHB', 'IHB', 'CPBS', 'CONNEMARA', 'IRISH DRAUGHT', 'IRL']);

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/;
const iso = m => `${m[3]}-${m[2]}-${m[1]}`;
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** FEI writes names in capitals. "ABC MAYFLOWER" → "Abc Mayflower", "JARGON DN" → "Jargon DN", "VAN DE" → "van de". */
export function feiName(raw) {
  const s = clean(raw);
  if (s !== s.toUpperCase()) return s; // already mixed case: keep as written
  return s.toLowerCase().replace(/[a-zà-ÿ'’]+/g, (w, i) => {
    if (/^(van|de|der|den|du|des|la|le|di|del|da|von|d'|v\/d|z)$/.test(w) && i > 0) return w === 'z' ? 'Z' : w;
    if (w.length <= 3 && !/[aeiouy]/.test(w)) return w.toUpperCase(); // DN, VDL, HHS
    return w[0].toUpperCase() + w.slice(1);
  }).replace(/\b(Mc|Mac|O')([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

/** "Gemma PHELAN (IRL)" → { name: 'Gemma Phelan', country: 'IRL' } */
export function athlete(raw) {
  const m = clean(raw).match(/^(.*?)\s*\(([A-Z]{3})\)$/);
  const name = m ? m[1] : clean(raw);
  return { name: name.split(' ').map(w => (w === w.toUpperCase() && w.length > 1 ? feiName(w) : w)).join(' '), country: m ? m[2] : '' };
}

/** "4(4+0)/72.11" → faults 4, time 72.11; "0/67.39"; "EL", "RT", "WD", "-". */
export function jumpingScore(raw) {
  const s = clean(raw);
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:\(([^)]*)\))?\s*(?:\/\s*(\d+(?:\.\d+)?))?$/);
  if (m) return { faults: Number(m[1]), rounds: m[2] || '', time: m[3] !== undefined ? Number(m[3]) : null, text: s };
  return { faults: null, rounds: '', time: null, text: s };
}

function headerFields(lines) {
  const out = {};
  const want = { name: /^Name$/i, fei_id: /^FEI ID$/i, age: /^Age$/i, sex: /^Sex$/i, colour: /^Colou?r$/i, studbook: /^Studbook$/i, registration: /^Registration$/i, nf: /^Admin NF$/i };
  for (const line of lines) {
    const cells = line.split('\t').map(clean);
    for (let i = 0; i < cells.length - 1; i += 2) {
      for (const [k, re] of Object.entries(want)) if (re.test(cells[i]) && out[k] === undefined) out[k] = cells[i + 1];
    }
  }
  return out;
}

/**
 * Paste → { horses: [{ name, fei_id, foaled, foaled_year, sex, colour, studbook, studbook_name, irish, discipline, results: [...] }], problems }
 * Each result: { line, date, time, show, country, event, competition, height_m, athlete, athlete_country, position, status,
 *   faults, rounds, time_s, score_text }
 */
export function readFeiPaste(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = src.split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^\s*Name\t/.test(l)) starts.push(i); });
  const horses = [], problems = [];
  if (!starts.length) return { horses, problems: [{ message: 'No FEI horse pages found. On the FEI horse page, select everything (Ctrl+A), copy it and paste it here.' }] };
  for (let n = 0; n < starts.length; n++) {
    const block = lines.slice(starts[n], n + 1 < starts.length ? starts[n + 1] : lines.length);
    const lineNo = starts[n] + 1;
    const head = headerFields(block.slice(0, 15));
    const age = clean(head.age).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const sb = clean(head.studbook);
    const code = (sb.match(/\(([^)]+)\)\s*$/) || sb.match(/^([A-Z]{2,10})\b/) || [])[1] || '';
    const sex = clean(head.sex).toLowerCase();
    const horse = {
      line: lineNo,
      name: feiName(head.name), fei_id: clean(head.fei_id).toUpperCase(),
      foaled: age ? iso(age) : null, foaled_year: age ? Number(age[3]) : null,
      sex: ['mare', 'gelding', 'stallion', 'colt', 'filly'].includes(sex) ? sex : '',
      colour: clean(head.color || head.colour), studbook: code.toUpperCase(), studbook_name: sb,
      nf: clean(head.nf).slice(0, 3), results: []
    };
    horse.irish = horse.studbook ? IRISH_STUDBOOKS.has(horse.studbook) : null; // null: no studbook, can't tell
    if (!horse.name) { problems.push({ line: lineNo, message: 'A horse page without a name: left out.' }); continue; }
    // The results table: its heading tells eventing from jumping.
    const hIdx = block.findIndex(l => /^Start Date\t/.test(l));
    if (hIdx < 0) { horse.discipline = 'unknown'; horses.push(horse); continue; }
    const heads = block[hIdx].split('\t').map(clean);
    horse.discipline = heads.includes('Obst. Height') || heads.includes('Competition') ? 'jumping' : heads.includes('XC obs') || heads.includes('D') ? 'eventing' : 'unknown';
    if (horse.discipline !== 'jumping') { horses.push(horse); continue; }
    const col = name => heads.indexOf(name);
    const iAthlete = col('Athlete');
    // Group each result's lines: its dated line plus the placing and score lines after it.
    const rows = [];
    for (let i = hIdx + 1; i < block.length; i++) {
      const l = block[i];
      if (/Competition\(s\)\s*\/\s*\d+\s*Page/.test(l)) break;
      if (DATE.test(clean(l))) rows.push({ line: starts[n] + i + 1, first: l, more: [] });
      else if (rows.length && clean(l)) rows[rows.length - 1].more.push(clean(l));
    }
    for (const r of rows) {
      const cells = r.first.split('\t');
      const d = clean(cells[0]).match(DATE);
      // Everything after the rider, in order: [WC nomination], placing, score (blank cells don't count).
      const tail = [...cells.slice(iAthlete + 1).map(clean), ...r.more].filter(Boolean);
      const score = tail.length ? tail[tail.length - 1] : '';
      const pos = tail.length >= 2 ? tail[tail.length - 2] : '';
      const position = /^\d+$/.test(pos) ? Number(pos) : null;
      const status = position ? '' : (pos || (/^[A-Z]{2,3}$/.test(score) ? score : ''));
      const sc = jumpingScore(/^[A-Z]{2,3}$/.test(score) && !position ? '' : score);
      const height = Number(clean(cells[col('Obst. Height')]));
      const a = athlete(cells[iAthlete]);
      const res = {
        line: r.line, date: iso(d), time: d[4] || '', show: clean(cells[col('Show')]), country: clean(cells[col('NF')]),
        event: clean(cells[col('Event')]), competition: clean(cells[col('Competition')]).replace(/\.\.\.$/, '…'),
        height_m: Number.isFinite(height) && height > 50 && height < 250 ? height / 100 : null,
        athlete: a.name, athlete_country: a.country, position, status,
        faults: sc.faults, rounds: sc.rounds, time_s: sc.time, score_text: status && !sc.text ? status : sc.text
      };
      if (!res.show || !res.event) problems.push({ line: r.line, message: `${horse.name}: a result line that could not be read was left out.` });
      else horse.results.push(res);
    }
    horses.push(horse);
  }
  return { horses, problems };
}

/** "CSI2*", "CSIO5*-NC", "CH-M-YH-S" … → a level for the filters. */
export function jumpingLevel(event) {
  const e = clean(event).toUpperCase();
  const star = e.match(/^CSIO\s*([1-5])\*/);
  if (star) return `CSIO${star[1]}*`;
  if (/YH|-YH-/.test(e)) return 'Young horses';
  if (/^CSI[JYP]|^CH-[EM]-[JYP]|-J-|-Y-|-CH-/.test(e)) return 'Juniors, young riders and ponies';
  const csi = e.match(/^CSI[A-Z]*\s*([1-5])\*/);
  if (csi) return `CSI${csi[1]}*`;
  if (/^CH-/.test(e)) return 'Championships';
  return 'Other';
}

/*
 * FEI horse search lists (the "1195 Horse(s) / 24 Page(s)" pages): one row per horse with
 *   [status]  FEI ID  Name  Studbook  Registration  Pony  Type  Sex  Date of birth  Admin NF
 * e.g. "Active	109WK62	ABC MAYFLOWER	ISH	S		RC	Mare	08/05/2021 (5 y)	IRL".
 * Returns { horses: [{ fei_id, name, studbook, irish, registration, sex, foaled, nf }], problems }.
 */
export function isFeiList(text) {
  return /FEI ID\tName\tStudbook/.test(text) || /^\s*(Active|Inactive)?\t?[0-9A-Z]{5,8}\t[^\t]+\t[^\t]*\t[^\t]*\t[^\t]*\t[^\t]*\t(Mare|Gelding|Stallion|Colt|Filly)\t\d{2}\/\d{2}\/\d{4}/m.test(text);
}

export function readFeiList(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
  const head = lines.find(l => /FEI ID\tName\tStudbook/.test(l));
  const cols = head ? head.split('\t').map(clean) : ['', 'FEI ID', 'Name', 'Studbook', 'Registration', 'Pony', 'Type', 'Sex', 'Date of birth', 'Admin NF'];
  const at = name => cols.indexOf(name);
  const horses = [], problems = [], seen = new Set();
  for (const [i, l] of lines.entries()) {
    const cells = l.split('\t');
    const dob = clean(cells[at('Date of birth')]).match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const fei = clean(cells[at('FEI ID')]).toUpperCase();
    if (!dob || !/^[0-9A-Z]{5,8}$/.test(fei)) continue;
    if (seen.has(fei)) continue;
    seen.add(fei);
    const sb = clean(cells[at('Studbook')]).toUpperCase();
    const code = sb.replace(/\s*\(.*\)\s*$/, '');
    horses.push({
      line: i + 1, fei_id: fei, name: feiName(cells[at('Name')]), studbook: sb, irish: sb ? IRISH_STUDBOOKS.has(code) : null,
      registration: clean(cells[at('Registration')]), sex: clean(cells[at('Sex')]).toLowerCase(), foaled: iso(dob), nf: clean(cells[at('Admin NF')]).slice(0, 3)
    });
  }
  if (!horses.length) problems.push({ message: 'No horses found. Copy the FEI horse search results table (the rows with FEI ID, name, studbook and date of birth).' });
  return { horses, problems };
}
