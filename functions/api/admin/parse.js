// Step 1 of the weekly upload: read the Word file (or pasted text) and return rows to check.
import { json, bad } from '../../../lib/http.js';
import { docxToText } from '../../../lib/docx.js';
import { parseResults } from '../../../lib/parser.js';
import { parseShowjumping } from '../../../lib/parser-sj.js';
import { siteFor } from '../../../lib/sites.js';
import { xlsxToTable, delimitedToTable, tableToText } from '../../../lib/xlsx.js';
import { parseSheet } from '../../../lib/parser-sheet.js';
import { normaliseName } from '../../../lib/names.js';

const MAX_BYTES = 10 * 1024 * 1024;

export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  let text = String(form.get('text') || '');
  let table = null;
  const file = form.get('file');
  if (file && typeof file === 'object' && file.size) {
    if (file.size > MAX_BYTES) return bad('That file is too big (10 MB max).');
    try {
      if (/\.docx$/i.test(file.name)) text = await docxToText(await file.arrayBuffer());
      else if (/\.doc$/i.test(file.name)) return bad('That is an old .doc file. In Word, choose Save As → Word Document (.docx), then upload again.');
      else if (/\.xlsx$/i.test(file.name)) table = (await xlsxToTable(await file.arrayBuffer())).rows;
      else if (/\.xls$/i.test(file.name)) return bad('That is an old .xls file. In Excel, choose Save As → Excel Workbook (.xlsx), then upload again.');
      else if (/\.csv$/i.test(file.name)) table = delimitedToTable(await file.text());
      else text = await file.text();
    } catch (e) {
      return bad('That file could not be read. Paste the text into the box instead.');
    }
    if (table) text = tableToText(table);
  }
  if (!text.trim()) return bad('Choose a file or paste the results first.');
  // Rows copied out of the spreadsheet and pasted (tab-separated, headings first) read as the spreadsheet does.
  if (!table && isPastedTable(text)) table = delimitedToTable(text);
  // IBSR: Charlie's showjumping results files (lib/parser-sj.js); IBER: the weekly eventing articles.
  const parse = siteFor(env).discipline === 'showjumping' ? parseShowjumping : parseResults;
  let result;
  try {
    if (table) {
      result = parseSheet(table, {
        discipline: siteFor(env).discipline,
        defaultCountry: String(form.get('country') || ''),
        defaultYear: Number(form.get('year')) || new Date().getFullYear(),
        knownCountries: await knownCountries(env)
      });
      return json({ text, ...result });
    }
    result = parse(text, {
      defaultCountry: String(form.get('country') || ''),
      defaultYear: Number(form.get('year')) || new Date().getFullYear()
    });
  } catch (e) {
    console.error('results reader failed', e && e.stack || e);
    return bad('The results could not be read: a line in them confused the reader. Nothing was saved. Send the file to Emer so the reader can be fixed.');
  }
  return json({ text, ...result });
}

// The first line is a row of headings, tab-separated, one of them for the horse.
const isPastedTable = text => {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  return first.includes('\t') && /horse/i.test(first);
};

// The country each event had in earlier uploads, for a sheet with no Country column.
async function knownCountries(env) {
  const out = {};
  try {
    const { results } = await env.DB.prepare("SELECT name, country FROM events WHERE country NOT IN ('', 'Other') ORDER BY start_date").all();
    for (const e of results || []) out[normaliseName(e.name)] = e.country;
  } catch (e) { console.error('known countries failed', e); }
  return out;
}
