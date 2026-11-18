import { execSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = ['ysgis-cogp-core', 'ysgis-cogp-openlayers', 'ysgis-cogp-cesium', 'ysgis-cogp-maplibre', 'ysgis-cogp-mars3d'];
const run = (command, cwd = root) => execSync(command, { cwd, stdio: 'pipe', encoding: 'utf8' });
await mkdir(path.join(root, 'artifacts/packages'), { recursive: true });
for (const name of names) {
  run('pnpm pack --pack-destination ../artifacts/packages', path.join(root, name));
}
const smoke = await mkdtemp(path.join(root, 'artifacts/package-smoke-'));
const dependencies = Object.fromEntries(names.map(name => [name, `file:../packages/${name}-0.0.1.tgz`]));
await writeFile(path.join(smoke, 'package.json'), JSON.stringify({
  private: true, type: 'module', dependencies: { ...dependencies, ol: '10.11.0', cesium: '1.147.0', 'maplibre-gl': '6.18.0', mars3d: '3.12.1', 'mars3d-cesium': '1.147.0', '@turf/turf': '7.4.0' },
}, null, 2));
await writeFile(path.join(smoke, 'pnpm-workspace.yaml'), `packages:\n  - '.'\noverrides:\n  ysgis-cogp-core: '${dependencies['ysgis-cogp-core']}'\n`);
console.log(run('pnpm install --offline --store-dir ../../.pnpm-store', smoke));
await writeFile(path.join(smoke, 'verify.mjs'), `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CogpReader, toGeoJSON } from 'ysgis-cogp-core';
import { createCogpClient } from 'ysgis-cogp-core/runtime';
import { CogpVectorTileSource } from 'ysgis-cogp-openlayers';
import { CogpCesiumLayer } from 'ysgis-cogp-cesium';
import { cogpUrl, registerCogpProtocol } from 'ysgis-cogp-maplibre';
const bytes = await readFile(new URL('test-data/refinement.parquet', ${JSON.stringify(new URL('../', import.meta.url).href)}));
const reader = await CogpReader.fromAsyncBuffer({ byteLength: bytes.length, slice(start, end = bytes.length) { return bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + end); } }, 'fixture:packed');
assert.ok(toGeoJSON(await reader.read({ useOverview: true })).features.length);
assert.equal(typeof createCogpClient, 'function');
assert.equal(typeof CogpVectorTileSource, 'function');
assert.equal(typeof CogpCesiumLayer, 'function');
assert.equal(typeof cogpUrl, 'function');
assert.equal(typeof registerCogpProtocol, 'function');
console.log('Packed Reader, runtime and all engine exports work independently');
`);
// The smoke verifier receives fixture bytes from the workspace; all library imports resolve only from tarballs.
console.log(run('node verify.mjs', smoke));
await writeFile(path.join(smoke, 'verify.ts'), `
import { CogpReader, type CogpBatch, openCogp } from 'ysgis-cogp-core';
import { createCogpClient } from 'ysgis-cogp-core/runtime';
import { CogpVectorTileSource } from 'ysgis-cogp-openlayers';
import { CogpCesiumLayer } from 'ysgis-cogp-cesium';
import { cogpUrl, registerCogpProtocol } from 'ysgis-cogp-maplibre';
import { CogpMars3dLayer } from 'ysgis-cogp-mars3d';
const client = createCogpClient();
const source = new CogpVectorTileSource({url: 'https://example.com/a', client});
const layer = new CogpCesiumLayer({url: 'https://example.com/a', client});
void [CogpReader, openCogp, source, layer, cogpUrl, registerCogpProtocol];
void CogpMars3dLayer;
let batch: CogpBatch | undefined; void batch;
`);
console.log(run('node ../../ysgis-cogp-core/node_modules/typescript/bin/tsc verify.ts --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2022,DOM,DOM.Iterable --skipLibCheck', smoke));
console.log('All five tarballs and public TypeScript declarations verified');
