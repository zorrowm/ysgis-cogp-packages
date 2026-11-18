import assert from 'node:assert/strict';
import test from 'node:test';
import { get as getProjection } from 'ol/proj.js';
import TileState from 'ol/TileState.js';
import { geometryColumnFromWkb, toMvt } from 'ysgis-cogp-core';
import { CogpVectorTileSource } from '../dist/index.js';

function pointTile() {
  const view = new DataView(new ArrayBuffer(21));
  view.setUint8(0, 1); view.setUint32(1, 1, true);
  view.setFloat64(5, 10, true); view.setFloat64(13, 10, true);
  return toMvt({ geometry: geometryColumnFromWkb([new Uint8Array(view.buffer)]), rowIndex: [17], columns: { height: [42] } }, { z: 0, x: 0, y: 0, layer: 'buildings' });
}

test('native OpenLayers tile loading reaches Core and decodes projected features', async () => {
  let closed = 0;
  const requests = [];
  const loaded = [];
  const client = { openDataset: async () => ({
    readTile: async request => { requests.push(request); return { data: pointTile(), level: 2, truncated: true }; },
    close: async () => { closed++; },
  }), dispose() { throw new Error('Borrowed client must survive'); } };
  const source = new CogpVectorTileSource({ url: 'https://example.com/a', client, onTileLoad: info => loaded.push(info) });
  const tile = source.getTile(0, 0, 0, 1, getProjection('EPSG:3857'));
  tile.load();
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tile did not finish loading')), 2000);
    const check = () => {
      if (tile.getState() === TileState.ERROR) { clearTimeout(timeout); reject(new Error('Tile failed')); }
      if (tile.getState() === TileState.LOADED) { clearTimeout(timeout); resolve(); }
    };
    tile.addEventListener('change', check); check();
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(loaded, [{ z: 0, x: 0, y: 0, level: 2, truncated: true, features: 1 }]);
  const feature = tile.sourceTiles[0].getFeatures()[0];
  assert.equal(feature.getId(), 17);
  assert.equal(feature.get('height'), '42');
  const [x, y] = feature.getFlatCoordinates();
  assert.ok(Math.abs(x - 1113194.9) < 15000);
  assert.ok(Math.abs(y - 1118889.9) < 15000);
  await source.close();
  assert.equal(source.disposed, true);
  assert.equal(closed, 1);
});

test('closing a source cancels its pending open on a borrowed client', async () => {
  let started;
  const opening = new Promise(resolve => { started = resolve; });
  const client = { openDataset: async (_options, signal) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, dispose() { throw new Error('Borrowed client must survive'); } };
  const source = new CogpVectorTileSource({ url: 'https://example.com/a', client });
  const inspect = source.inspect();
  const rejected = assert.rejects(inspect, error => error.name === 'AbortError');
  await opening;
  await source.close();
  await rejected;
});
