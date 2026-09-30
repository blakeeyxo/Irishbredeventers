// Shared checks for news articles and link cards edited in the owner area.
import { str } from './http.js';

export function cleanUrl(raw, required) {
  let url = str(raw, 1000);
  if (!url) { if (required) throw new Error('Add the web address.'); return ''; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { throw new Error('That web address does not look right.'); }
  return url;
}

export function cleanDate(raw) {
  const d = str(raw, 10);
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Dates must look like 2025-12-08.');
  return d;
}

export const snippetOf = body => {
  const flat = String(body).replace(/\s+/g, ' ').trim();
  return flat.length > 220 ? flat.slice(0, 220).replace(/\s+\S*$/, '') + '…' : flat;
};

// Save a new order: ids listed top to bottom.
export async function saveOrder(db, table, ids) {
  if (!['news', 'link_cards'].includes(table)) throw new Error('Unknown list');
  const clean = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger);
  await db.batch(clean.map((id, i) => db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(i + 1, id)));
}
