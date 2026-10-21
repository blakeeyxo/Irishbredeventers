// Step 1 of the weekly upload: read the Word file (or pasted text) and return rows to check.
import { json, bad } from '../../../lib/http.js';
import { docxToText } from '../../../lib/docx.js';
import { parseResults } from '../../../lib/parser.js';
import { parseShowjumping } from '../../../lib/parser-sj.js';
import { siteFor } from '../../../lib/sites.js';

const MAX_BYTES = 10 * 1024 * 1024;

export async function onRequestPost({ env, request }) {
  const form = await request.formData().catch(() => null);
  if (!form) return bad('Bad request');
  let text = String(form.get('text') || '');
  const file = form.get('file');
  if (file && typeof file === 'object' && file.size) {
    if (file.size > MAX_BYTES) return bad('That file is too big (10 MB max).');
    try {
      if (/\.docx$/i.test(file.name)) text = await docxToText(await file.arrayBuffer());
      else if (/\.doc$/i.test(file.name)) return bad('That is an old .doc file. In Word, choose Save As → Word Document (.docx), then upload again.');
      else text = await file.text();
    } catch (e) {
      return bad('That file could not be read. Paste the text into the box instead.');
    }
  }
  if (!text.trim()) return bad('Choose a file or paste the results first.');
  // IBSR: Charlie's showjumping results files (lib/parser-sj.js); IBER: the weekly eventing articles.
  const parse = siteFor(env).discipline === 'showjumping' ? parseShowjumping : parseResults;
  let result;
  try {
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
