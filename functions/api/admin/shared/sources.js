// Owner area: where shared data comes from. GET lists sources, recent uploads and possible duplicates;
// POST { id?, slug, name, kind, licence_status, can_store, can_display, can_republish_commercially, terms_url, contact, notes } saves one.
import { json, bad, readJson, str, text } from '../../../../lib/http.js';
import { withShared } from '../../../../lib/shared-http.js';

const KINDS = ['sales_company', 'federation', 'studbook', 'publisher', 'other'];
const LICENCES = ['unknown', 'requested', 'agreed_in_writing', 'refused'];

export const onRequestGet = ({ env }) => withShared(env, async db => {
  const [sources, uploads, dupes, totals] = await db.batch([
    db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM horse h WHERE h.source_id = s.id) AS horses FROM source s ORDER BY s.name COLLATE NOCASE`),
    db.prepare(`SELECT u.id, u.label, u.filename, u.row_count, u.added, u.updated, u.held, u.created_by, u.created_at, s.name AS source
                FROM upload u JOIN source s ON s.id = u.source_id ORDER BY u.id DESC LIMIT 20`),
    db.prepare(`SELECT m.id, m.reason, a.id AS a_id, a.name AS a_name, a.foaled_year AS a_year, b.id AS b_id, b.name AS b_name, b.foaled_year AS b_year
                FROM horse_match_candidate m JOIN horse a ON a.id = m.horse_a_id JOIN horse b ON b.id = m.horse_b_id
                WHERE m.status = 'pending' ORDER BY m.id DESC LIMIT 50`),
    db.prepare(`SELECT (SELECT COUNT(*) FROM horse) AS horses, (SELECT COUNT(DISTINCT sire_id) FROM horse WHERE sire_id IS NOT NULL) AS sires,
                       (SELECT COUNT(*) FROM party) AS breeders`)
  ]);
  return json({ sources: sources.results, uploads: uploads.results, duplicates: dupes.results, totals: totals.results[0] });
});

export const onRequestPost = async ({ env, request }) => withShared(env, async db => {
  const b = await readJson(request) || {};
  if (b.duplicate) {
    // { duplicate: id, status: 'different' } records a person's answer. 'same' is noted for now; merging comes later.
    const status = b.status === 'same' ? 'same' : 'different';
    await db.prepare("UPDATE horse_match_candidate SET status = ?, reviewed_at = datetime('now') WHERE id = ?").bind(status, Number(b.duplicate)).run();
    return json({ ok: true });
  }
  const name = str(b.name, 120);
  const slug = str(b.slug || name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name || !slug) return bad('Give the source a name.');
  const kind = KINDS.includes(b.kind) ? b.kind : 'other';
  const licence = LICENCES.includes(b.licence_status) ? b.licence_status : 'unknown';
  const flag = v => (v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0);
  const vals = [slug, name, kind, licence, flag(b.can_store), flag(b.can_display), flag(b.can_republish_commercially),
    str(b.terms_url, 500) || null, str(b.contact, 300) || null, text(b.notes, 2000) || null];
  try {
    if (b.id) {
      await db.prepare(`UPDATE source SET slug = ?, name = ?, kind = ?, licence_status = ?, can_store = ?, can_display = ?,
        can_republish_commercially = ?, terms_url = ?, contact = ?, notes = ? WHERE id = ?`).bind(...vals, Number(b.id)).run();
      return json({ ok: true, id: Number(b.id) });
    }
    const r = await db.prepare(`INSERT INTO source (slug, name, kind, licence_status, can_store, can_display, can_republish_commercially,
      terms_url, contact, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...vals).run();
    return json({ ok: true, id: r.meta.last_row_id });
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return bad('A source with that short name already exists.');
    throw e;
  }
});
