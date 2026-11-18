import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const upstream = process.argv[2];
if (!upstream) throw new Error('Pass the upstream repository directory');
const root = fileURLToPath(new URL('../', import.meta.url));
const entries = [];
async function record(folder, destination) {
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const original = path.join(folder, item.name);
    const target = path.join(destination, item.name);
    if (item.isDirectory()) { await record(original, target); continue; }
    const bytes = await readFile(original);
    const actual = await readFile(target).catch(() => null);
    entries.push({
      source: path.relative(upstream, original).replaceAll('\\', '/'),
      target: path.relative(root, target).replaceAll('\\', '/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      unchanged: Boolean(actual && bytes.equals(actual)),
    });
  }
}
await record(path.join(upstream, 'js/packages/reader/src'), path.join(root, 'ysgis-cogp-core/src'));
await record(path.join(upstream, 'js/packages/reader/vendor'), path.join(root, 'ysgis-cogp-core/vendor'));
await writeFile(path.join(root, 'ysgis-cogp-core/SOURCE_SYNC.json'), JSON.stringify({
  upstream: 'https://github.com/Kanahiro/cloud-optimized-geoparquet',
  commit: '44f29be34d303fbb1febb154413a5aa7aa568a91',
  hyparquetCommit: '9365a88f34a0816b9a77e08c176ca0c480d3524c', entries,
}, null, 2) + '\n');
