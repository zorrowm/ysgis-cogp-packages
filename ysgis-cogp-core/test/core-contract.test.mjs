import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CogpReader, MVT_EXTENT, toGeoJSON, toMvt } from '../dist/index.js';
import { tileBounds, tileResolution } from '../dist/index.js';

async function fixtureReader(name) {
  const bytes = await readFile(new URL(`../../test-data/${name}.parquet`, import.meta.url));
  return CogpReader.fromAsyncBuffer({
    byteLength: bytes.length,
    slice(start, end = bytes.length) {
      return bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + end);
    },
  }, `fixture:${name}`);
}

test('Core preserves the Reader public contract for a COGP fixture', async () => {
  const reader = await fixtureReader('refinement');
  assert.equal(reader.numRowGroups > 0, true);
  assert.equal(typeof reader.primaryGeometryColumn, 'string');
  const batch = await reader.read({
    bbox: [-180, -90, 180, 90],
    maxLevel: reader.selectLevel(1),
    useOverview: true,
    columns: [reader.primaryGeometryColumn],
  });
  assert.equal(batch.length > 0, true);
  assert.equal(batch.rowIndex.length, batch.length);
  assert.equal(toGeoJSON(batch).features.length, batch.length);
  const tile = toMvt(batch, { z: 0, x: 0, y: 0, layer: 'fixture' });
  assert.equal(tile.byteLength > 0, true);
});

test('Core tile helpers produce Web Mercator tile inputs', () => {
  const bbox = tileBounds(0, 0, 0);
  assert.equal(bbox.length, 4);
  assert.equal(bbox[0] < -180, true);
  assert.equal(bbox[2] > 180, true);
  assert.equal(tileResolution(0, 0) > 0, true);
});
