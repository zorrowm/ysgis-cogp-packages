import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { openCogp } from '../dist/index.js';

test('openCogp reads a COGP file through HTTP range requests', async () => {
  const bytes = await readFile(new URL('../../test-data/refinement.parquet', import.meta.url));
  const server = createServer((request, response) => {
    if (request.method === 'HEAD') {
      response.writeHead(200, { 'Content-Length': bytes.length, 'Accept-Ranges': 'bytes' });
      response.end();
      return;
    }
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range);
      if (!match) { response.writeHead(416); response.end(); return; }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      response.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Accept-Ranges': 'bytes',
      });
      response.end(bytes.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'Content-Length': bytes.length });
    response.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const dataset = await openCogp({ url: `http://127.0.0.1:${address.port}/refinement.parquet` });
    const info = dataset.inspect();
    assert.equal(info.numRowGroups > 0, true);
    const result = await dataset.readBatch({ bbox: [-180, -90, 180, 90], resolution: 1, useOverview: true });
    assert.equal(result.batch.length > 0, true);
    await dataset.close();
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
