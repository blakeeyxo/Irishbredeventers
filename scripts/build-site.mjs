// Builds a site's static files into dist/<id>: node scripts/build-site.mjs ibsr
// IBER is served straight from public/; building it (node scripts/build-site.mjs iber) is only a check.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES, clientConfig } from '../lib/sites.js';
import { transformFile } from '../lib/build-site.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const site = SITES[id];
if (!site) {
  console.error(`Usage: node scripts/build-site.mjs <${Object.keys(SITES).join('|')}>`);
  process.exit(1);
}

const src = join(root, 'public');
const out = join(root, 'dist', id);
rmSync(out, { recursive: true, force: true });

const walk = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

let count = 0;
for (const file of walk(src)) {
  const rel = relative(src, file).split(sep).join('/');
  const dest = join(out, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, transformFile(rel, readFileSync(file), site, clientConfig(site)));
  count++;
}
console.log(`Built ${site.name} (${count} files) into dist/${id}`);
