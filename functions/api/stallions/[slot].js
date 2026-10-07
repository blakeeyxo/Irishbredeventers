// One stallion listing and every result of its progeny in the rolling 12 months (the page builds the
// breakdown from these rows).
import { json, bad } from '../../../lib/http.js';
import { progeny, summary, rollingWindow, matchSires, sireKeys } from '../../../lib/stallions.js';

export async function onRequestGet({ env, params }) {
  const slot = Number(params.slot);
  if (!(slot >= 1 && slot <= 6)) return bad('Not found', 404);
  const s = await env.DB.prepare(`SELECT slot, name, blurb, link, image_key, sire_names FROM stallions WHERE slot = ? AND name <> ''`).bind(slot).first();
  if (!s) return bad('Not found', 404);
  const win = rollingWindow();
  const rows = await progeny(env.DB, s.sire_names, win);
  const { sire_names, ...pub } = s;
  // His own breeding, when it has been filled in (Breeding records in the owner area).
  const matched = await matchSires(env.DB, sire_names);
  const first = sireKeys(sire_names)[0];
  const main = matched.find(m => String(m.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === first) || matched[0];
  const own = main ? await env.DB.prepare('SELECT birth_year, ped_sire, ped_dam, ped_dam_sire, ped_breeder FROM sires WHERE id = ?').bind(main.id).first() : null;
  const pedigree = own && (own.ped_sire || own.ped_dam || own.ped_dam_sire || own.ped_breeder || own.birth_year)
    ? { foaled: own.birth_year, sire: own.ped_sire, dam: own.ped_dam, dam_sire: own.ped_dam_sire, breeder: own.ped_breeder } : null;
  return json({ stallion: pub, pedigree, window: win, totals: summary(rows), rows }, { headers: { 'cache-control': 'public, max-age=120' } });
}
