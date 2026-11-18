import assert from 'node:assert/strict';
import test from 'node:test';
import { readCogpViewport } from '../dist/index.js';

const east = [175, -5, 180, 5];
const west = [-180, -5, -175, 5];
const result = (level, rows, truncated = false) => ({
  level, truncated, batch: { length: rows.length, rowIndex: rows },
});

test('a viewport crossing the antimeridian coarsens both halves together', async () => {
  const attempts = [];
  const dataset = {
    async readBatch({ bbox, maxLevel, maxRows, properties }) {
      attempts.push([bbox, maxLevel]);
      assert.equal(maxRows, 4);
      assert.deepEqual(properties, {});
      const level = maxLevel ?? 3;
      if (level === 3) return result(level, bbox === east ? [0, 2, 3] : [1, 4, 5]);
      return result(level, bbox === east ? [0, 2, 3] : [1, 3]);
    },
  };
  const read = await readCogpViewport(dataset, { boxes: [east, west], maxRows: 4, properties: {} });
  assert.deepEqual(attempts, [[east, undefined], [west, undefined], [east, 2], [west, 2]]);
  assert.equal(read.requestedLevel, 3);
  assert.equal(read.level, 2);
  assert.equal(read.truncated, false);
  assert.deepEqual(read.rows.map(([id]) => id), [0, 1, 2, 3]);
});

test('a one-box overflow coarsens until it fits, or reports truncation at level zero', async () => {
  for (const fits of [true, false]) {
    const dataset = { async readBatch({ maxLevel }) { return result(maxLevel ?? 1, [0, 2], maxLevel !== 0 || !fits); } };
    const read = await readCogpViewport(dataset, { boxes: [east], maxRows: 2 });
    assert.equal(read.requestedLevel, 1);
    assert.equal(read.level, 0);
    assert.equal(read.truncated, !fits);
  }
});

test('truncate keeps the requested LoD and cancellation stops coarser reads', async () => {
  const options = { boxes: [east], maxRows: 2 };
  const dataset = { async readBatch({ maxLevel }) { assert.equal(maxLevel, undefined); return result(3, [1, 2], true); } };
  const read = await readCogpViewport(dataset, { ...options, rowLimitPolicy: 'truncate' });
  assert.equal(read.level, 3);
  assert.equal(read.truncated, true);
  const controller = new AbortController();
  await assert.rejects(readCogpViewport({
    async readBatch(query) {
      assert.equal(query.maxLevel, undefined);
      controller.abort();
      return result(3, [1, 2], true);
    },
  }, { ...options, signal: controller.signal }), { name: 'AbortError' });
});
