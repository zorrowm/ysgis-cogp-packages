import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { requireGeographic } from '../dist/index.js';

test('Core import does not instantiate WASM, create a Worker or access fetch', () => {
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('Unexpected network during import'); };
    globalThis.Worker = class { constructor() { throw new Error('Unexpected Worker during import'); } };
    WebAssembly.instantiate = () => { throw new Error('Unexpected WASM during import'); };
    WebAssembly.compile = () => { throw new Error('Unexpected WASM compile during import'); };
    await import('./dist/index.js');
  `], { cwd: new URL('..', import.meta.url) });
});

test('rendering CRS is conservative about unknown and projected inputs', () => {
  const geo = crs => ({ primary_column: 'geometry', columns: { geometry: { crs } } });
  requireGeographic(geo(undefined));
  requireGeographic(geo({ id: { authority: 'EPSG', code: 4326 } }));
  assert.throws(() => requireGeographic(geo(null)), error => error.code === 'UNSUPPORTED_CRS');
  assert.throws(() => requireGeographic(geo({ id: { authority: 'EPSG', code: 3857 } })), error => error.code === 'UNSUPPORTED_CRS');
  requireGeographic(geo(null), 'OGC:CRS84');
});
