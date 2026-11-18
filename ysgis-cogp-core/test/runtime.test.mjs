import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CogpWorkerRuntime } from '../dist/worker-runtime.js';
import { transferBuffers } from '../dist/transfer.js';
import { createCogpClient } from '../dist/runtime.js';
import { openCogp } from '../dist/index.js';

async function fixtureFetch() {
  const bytes = await readFile(new URL('../../test-data/refinement.parquet', import.meta.url));
  let heads = 0;
  const fetch = async (_input, init) => {
    if (init?.method === 'HEAD') { heads++; return new Response(null, { headers: { 'Content-Length': String(bytes.length) } }); }
    const range = new Headers(init?.headers).get('Range');
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range);
    return new Response(bytes.subarray(Number(from), Number(to) + 1), { status: 206, headers: { 'Content-Range': `bytes ${from}-${to}/${bytes.length}` } });
  };
  return { fetch, get heads() { return heads; } };
}

test('runtime shares Reader across independent handles and isolates close', async () => {
  const transport = await fixtureFetch();
  const runtime = new CogpWorkerRuntime(transport.fetch);
  let sequence = 0;
  const call = async payload => {
    const response = await runtime.dispatch({ id: ++sequence, ...payload });
    assert.equal(response.ok, true, response.error);
    return response.result;
  };
  try {
    const options = { url: 'https://example.com/data.parquet' };
    const [first, second] = await Promise.all([call({ type: 'open', options }), call({ type: 'open', options })]);
    assert.notEqual(first.datasetId, second.datasetId);
    assert.equal(transport.heads, 1);
    await call({ type: 'release', datasetId: first.datasetId });
    const result = await call({ type: 'readBatch', datasetId: second.datasetId, options: { columns: [], maxRows: 1 } });
    assert.equal(result.batch.length, 1);
    assert.ok(result.batch.geometry);
    assert.deepEqual(Object.keys(result.batch.columns), []);
    assert.equal(result.truncated, true);
    const transferred = structuredClone(result, { transfer: transferBuffers(result) });
    assert.equal(result.batch.rowIndex.byteLength, 0);
    assert.equal(transferred.batch.length, 1);
    const again = await call({ type: 'readBatch', datasetId: second.datasetId, options: { columns: [], maxRows: 2 } });
    assert.equal(again.batch.length, 2);
    assert.equal(again.truncated, false);
    assert.ok(again.batch.geometry.x.byteLength);
    const stats = await call({ type: 'stats', datasetId: second.datasetId });
    assert.ok(stats.requests > 0);
    assert.ok(stats.bytes > 0); // No Content-Length on Range responses.
    await call({ type: 'release', datasetId: second.datasetId });
  } finally { await runtime.dispose(); }
});

test('direct Core reads retain geometry with columns and distinguish exact cap', async () => {
  const { fetch } = await fixtureFetch();
  const dataset = await openCogp({ url: 'https://example.com/data.parquet', fetch });
  try {
    const result = await dataset.readBatch({ columns: [], maxRows: 2 });
    assert.ok(result.batch.geometry);
    assert.equal(result.truncated, false);
    const zero = await dataset.readBatch({ columns: [], maxRows: 0 });
    assert.equal(zero.batch.length, 0);
    await assert.rejects(dataset.readTile({ layer: { name: 'x' }, z: -1, x: 0, y: 0 }), /tile coordinate/);
  } finally { await dataset.close(); }
  await assert.rejects(dataset.readBatch(), error => error.code === 'CLOSED');
});

test('strict Range policy rejects full response without consuming the file', async () => {
  let cancelled = false;
  const fetch = async (_input, init) => init?.method === 'HEAD'
    ? new Response(null, { headers: { 'Content-Length': '1000000' } })
    : new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 200 });
  await assert.rejects(openCogp({ url: 'https://example.com/data.parquet', fetch, rangePolicy: 'require' }), error => error.code === 'RANGE_REQUIRED');
  assert.equal(cancelled, true);
});

test('Reader limit rejects pinned eviction and permits idle replacement', async () => {
  const transport = await fixtureFetch();
  const runtime = new CogpWorkerRuntime(transport.fetch);
  try {
    await runtime.dispatch({ id: 1, type: 'configure', options: { maxReaders: 1 } });
    const first = await runtime.dispatch({ id: 2, type: 'open', options: { url: 'https://example.com/a' } });
    const busy = await runtime.dispatch({ id: 3, type: 'open', options: { url: 'https://example.com/b' } });
    assert.equal(busy.ok, false); assert.equal(busy.code, 'RESOURCE_LIMIT');
    await runtime.dispatch({ id: 4, type: 'release', datasetId: first.result.datasetId });
    const second = await runtime.dispatch({ id: 5, type: 'open', options: { url: 'https://example.com/b' } });
    assert.equal(second.ok, true);
  } finally { await runtime.dispose(); }
});

test('single HTTP slot survives HEAD fallback, length probe and transient retry', { timeout: 5000 }, async () => {
  const transport = await fixtureFetch();
  let retries = 0;
  const runtime = new CogpWorkerRuntime(async (input, init) => {
    if (init?.method === 'HEAD') return new Response('forbidden', { status: 403 });
    if (new Headers(init?.headers).get('Range') !== 'bytes=0-0' && retries++ === 0) return new Response('busy', { status: 503 });
    return transport.fetch(input, init);
  });
  try {
    await runtime.dispatch({ id: 1, type: 'configure', options: { maxConcurrentRequests: 1 } });
    const response = await runtime.dispatch({ id: 2, type: 'open', options: { url: 'https://example.com/a' } });
    assert.equal(response.ok, true, response.error);
  } finally { await runtime.dispose(); }
});

class LocalWorker extends EventTarget {
  terminated = false;
  sent = [];
  constructor(runtime) { super(); this.runtime = runtime; }
  postMessage(message) {
    this.sent.push(message);
    void this.runtime.dispatch(structuredClone(message)).then(response => {
      if (response && !this.terminated) this.dispatchEvent(new MessageEvent('message', { data: structuredClone(response, { transfer: response.ok ? transferBuffers(response.result) : [] }) }));
    });
  }
  terminate() { this.terminated = true; void this.runtime.dispose(); }
}

test('client close is idempotent and sharing handles does not terminate the Worker', async () => {
  const transport = await fixtureFetch();
  const worker = new LocalWorker(new CogpWorkerRuntime(transport.fetch));
  const client = createCogpClient({ workerFactory: () => worker });
  try {
    const first = await client.openDataset({ url: 'https://example.com/a' });
    const second = await client.openDataset({ url: 'https://example.com/a' });
    await first.close(); await first.close();
    await assert.rejects(first.inspect(), error => error.code === 'CLOSED');
    assert.ok((await second.readBatch({ columns: [] })).batch.geometry);
    assert.equal(worker.terminated, false);
    assert.equal(transport.heads, 1);
    await second.close();
    assert.equal(worker.sent.filter(message => message.type === 'release').length, 2);
  } finally { client.dispose(); }
  assert.equal(worker.terminated, true);
});
