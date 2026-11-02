/*
 * The cells of an Excel .xlsx sheet, as rows of text: [['Event', 'Event dates', …], […], …].
 *
 * An .xlsx is a zip like a .docx: the sheet's cells are in xl/worksheets/sheetN.xml, and most text is kept once in
 * xl/sharedStrings.xml and pointed to by number. Needs no packages (lib/docx.js reads the zip).
 * The sheet named "Results" is read; failing that, the first sheet.
 */
import { readZipEntry, decodeXml } from './docx.js';

const WHAT = 'Excel (.xlsx)';
const text = async (buf, name) => new TextDecoder().decode(await readZipEntry(buf, name, WHAT));
const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
// The text of a shared string or inline string: every <t> in it (rich text has several runs).
const runs = xml => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join('');

/** "C12" → 2 (the column, counted from 0). */
function colIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** A number as written in a cell, without the float noise Excel stores (12.399999999 → "12.4"). */
const tidyNumber = v => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : v;
};

export async function xlsxToTable(buf) {
  const workbook = await text(buf, 'xl/workbook.xml');
  const rels = await text(buf, 'xl/_rels/workbook.xml.rels');
  const sheets = [...workbook.matchAll(/<sheet\s[^>]*>/g)].map(m => ({ name: decodeXml(attr(m[0], 'name') || ''), rid: attr(m[0], 'r:id') }));
  if (!sheets.length) throw new Error('No sheets in that file');
  const sheet = sheets.find(s => /^results$/i.test(s.name.trim())) || sheets[0];
  const rel = [...rels.matchAll(/<Relationship\s[^>]*>/g)].map(m => m[0]).find(t => attr(t, 'Id') === sheet.rid);
  const target = (attr(rel || '', 'Target') || 'worksheets/sheet1.xml').replace(/^\/?xl\//, '').replace(/^\//, '');
  const xml = await text(buf, `xl/${target}`);
  let shared = [];
  try { shared = [...(await text(buf, 'xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => runs(m[1])); } catch { /* a sheet with no text */ }

  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r');
      const type = attr(c[1], 't');
      const inner = c[2] || '';
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = runs(inner);
      else if (type === 'str' || type === 'e') val = v === undefined ? '' : decodeXml(v); // a formula's text result
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) val = tidyNumber(v);
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push('');
      row[i] = String(val).trim();
    }
    rows.push(row);
  }
  return { sheet: sheet.name, rows };
}

/** Rows copied out of Excel or Google Sheets and pasted: tab-separated, or comma-separated (.csv). */
export function delimitedToTable(textIn) {
  const lines = String(textIn || '').split(/\r?\n/);
  const tab = lines.some(l => l.includes('\t'));
  return lines.map(line => {
    if (tab) return line.split('\t').map(v => v.replace(/^"(.*)"$/, '$1').replace(/""/g, '"').trim());
    // CSV: commas inside "quoted cells" stay in the cell.
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/** The table back as tab-separated text, for the owner area's text box (a second "Read" reads it the same way). */
export const tableToText = rows => rows.filter(r => r.some(Boolean)).map(r => r.join('\t')).join('\n');
