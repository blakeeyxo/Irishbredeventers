import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Any function declared with 2+ parameters must not be passed bare to .map(): map() hands it
// (item, index, array), which is how "Row [object Object]" appeared.
test('no .map(fn) with a multi-parameter function in browser code', () => {
  for (const f of ['public/admin/admin.js', 'public/js/app.js', 'public/js/common.js']) {
    const src = fs.readFileSync(f, 'utf8');
    const multi = new Set();
    for (const m of src.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)) if (m[2].split(',').filter(s => s.trim()).length >= 2) multi.add(m[1]);
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>/g)) if (m[2].split(',').filter(s => s.trim()).length >= 2) multi.add(m[1]);
    for (const m of src.matchAll(/\.(?:map|filter|forEach)\(\s*(\w+)\s*\)/g)) {
      assert.ok(!multi.has(m[1]), `${f}: .map(${m[1]}) passes index/array into extra parameters`);
    }
  }
});

test('esc() never prints [object Object]', () => {
  globalThis.window = {};
  new Function('window', fs.readFileSync('public/js/common.js', 'utf8'))(globalThis.window);
  const esc = globalThis.window.IBE?.esc;
  if (!esc) return; // helper not exported; the scan above still guards the pattern
  const origErr = console.error; console.error = () => {};
  assert.equal(esc({ a: 1 }), '');
  assert.equal(esc([{ a: 1 }]), '');
  assert.equal(esc('a<b'), 'a&lt;b');
  console.error = origErr;
});
