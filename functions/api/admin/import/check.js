// Before saving: which names already exist, which are new, and which look like an existing record.
import { json, bad, readJson } from '../../../../lib/http.js';
import { cleanRows, loadExisting } from '../../../../lib/import.js';
import { planImport } from '../../../../lib/import-plan.js';

export async function onRequestPost({ env, request }) {
  const b = await readJson(request);
  if (!b || !Array.isArray(b.rows)) return bad('Bad request');
  const rows = cleanRows(b.rows, new Date().getFullYear());
  const plan = planImport(rows, await loadExisting(env.DB), b.decisions || {});
  return json({ questions: plan.questions, pending: plan.pending.length, newCounts: plan.newCounts, rows: rows.length });
}
