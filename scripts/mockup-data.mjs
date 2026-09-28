// Pulls the sample horses and news out of the approved mockup in /reference.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REF = fileURLToPath(new URL('../reference/irishbredeventers-mockup-v2.html', import.meta.url));

function grabArray(src, name) {
  const start = src.indexOf(`const ${name} = [`);
  const open = src.indexOf('[', start);
  let depth = 0, i = open, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
  }
  return vm.runInNewContext('(' + src.slice(open, i + 1) + ')');
}

export function mockupData() {
  const src = readFileSync(REF, 'utf8');
  return { horses: grabArray(src, 'horses'), articles: grabArray(src, 'articles') };
}

// Rebuild the text the way Charlie writes it, rider and all.
export function horsesToText(horses) {
  const out = [];
  let country, event, cls;
  for (const h of horses) {
    if (h.country !== country) { out.push(h.country); country = h.country; event = null; }
    if (h.event !== event) { out.push(`${h.event}, ${h.eventDate}`); event = h.event; cls = null; }
    if (h.cls !== cls) { out.push(h.cls); cls = h.cls; }
    const suf = ['th', 'st', 'nd', 'rd'][(h.place % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][h.place % 100] || 'th';
    const was = h.former ? ` (was ${h.former})` : '';
    const ds = h.damsire ? ` by ${h.damsire}` : '';
    const breeder = /not recorded/.test(h.breeder) ? '' : ` Breeder: ${h.breeder}.`;
    out.push(`${h.place}${suf} ${h.name}${was} ${h.breed} ${h.foaled} ${h.sex.toLowerCase()} by ${h.sire} out of ${h.dam}${ds}.${breeder} ${h.rider} (${h.nat}) ${h.d1}, ${h.d2}, ${h.d3} = ${h.score}`);
  }
  return out.join('\n');
}
