import { copyFile, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Run once against the explicitly supplied upstream snapshot to normalize fixture paths.
const upstream = process.argv[2];
if (!upstream) throw new Error('Pass the upstream repository directory');
const root = fileURLToPath(new URL('../', import.meta.url));
const core = path.join(root, 'ysgis-cogp-core');
const original = path.join(upstream, 'js/packages/reader/test');
for (const name of await readdir(original)) {
  if (!name.endsWith('.mjs')) continue;
  const source = await readFile(path.join(original, name), 'utf8');
  await writeFile(path.join(core, 'test', name), source
    .replaceAll('../../../../test-data/', '../../test-data/')
    .replaceAll('../../../../cogp-rs/tests/fixtures/', 'fixtures/'), 'utf8');
}
await cp(path.join(original, 'fixtures'), path.join(core, 'test/fixtures'), { recursive: true });
await copyFile(path.join(upstream, 'cogp-rs/tests/fixtures/metadata-overviews.json'), path.join(core, 'test/fixtures/metadata-overviews.json'));
await rm(path.join(core, 'test/reference'), { recursive: true, force: true });
