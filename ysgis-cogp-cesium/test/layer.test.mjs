import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomDataSource, DataSourceCollection, Ellipsoid, Event, SceneMode, JulianDate } from 'cesium';
import { geometryColumnFromWkb } from 'ysgis-cogp-core';
import { CogpCesiumLayer } from '../dist/index.js';
import { geometryEntities } from '../dist/entities.js';

const point = (x, y) => ({ type: 'Point', coordinates: [x, y] });
test('Cesium multipart geometry preserves parts and polygon holes', () => {
  const entities = geometryEntities('ds', 9, { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, { name: 'test' });
  assert.equal(entities.length, 2);
  assert.notEqual(entities[0].id, entities[1].id);
  const polygon = geometryEntities('ds', 2, { type: 'Polygon', coordinates: [[[0,0],[4,0],[4,4],[0,0]], [[1,1],[2,1],[1,2],[1,1]]] }, {});
  assert.equal(polygon[0].polygon.hierarchy.getValue(JulianDate.now()).holes.length, 1);
  assert.equal(geometryEntities('ds', 1, null, {}).length, 0);
});

function batchAt(x) {
  const view = new DataView(new ArrayBuffer(21));
  view.setUint8(0, 1); view.setUint32(1, 1, true); view.setFloat64(5, x, true); view.setFloat64(13, 0, true);
  return { length: 1, rowIndex: new Float64Array([7]), columns: { value: [x] }, geometry: geometryColumnFromWkb([new Uint8Array(view.buffer)]) };
}

test('Cesium refresh retains entity identity and detach removes listeners', async () => {
  const cameraEvent = new Event();
  let coordinate = 1, requests = 0, closed = 0, terminated = 0;
  const client = { openDataset: async () => ({ id: 'ds', inspect: async () => ({ geo: { primary_column: 'geometry', columns: { geometry: {} } } }), readBatch: async () => ({ batch: batchAt(coordinate), level: 0, truncated: false }), close: async () => { closed++; } }), dispose() { terminated++; } };
  const viewer = {
    dataSources: new DataSourceCollection(), canvas: { clientWidth: 800, clientHeight: 600 },
    camera: { moveEnd: cameraEvent, computeViewRectangle: () => ({ west: -1, east: 1, south: -1, north: 1 }), pickEllipsoid: () => undefined },
    scene: { mode: SceneMode.SCENE3D, globe: { ellipsoid: Ellipsoid.WGS84 }, requestRender() { requests++; } },
  };
  const layer = new CogpCesiumLayer({ url: 'https://example.com/a', client });
  await layer.attach(viewer);
  assert.equal(layer.dataSource.entities.values.length, 1);
  const entity = layer.dataSource.entities.values[0];
  coordinate = 2;
  await layer.refresh();
  assert.equal(layer.dataSource.entities.values[0], entity);
  assert.equal(entity.properties.value.getValue(), 2);
  await layer.attach(viewer);
  assert.equal(cameraEvent.numberOfListeners, 1);
  layer.detach(); assert.equal(cameraEvent.numberOfListeners, 0);
  assert.equal(viewer.dataSources.length, 0);
  await layer.destroy();
  assert.equal(closed, 1); assert.equal(terminated, 0); assert.ok(requests >= 2);
});

test('destroy cancels pending opens without disposing a borrowed client', async () => {
  const client = { openDataset: async (_options, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })), dispose() { throw new Error('Borrowed client must survive'); } };
  const layer = new CogpCesiumLayer({ url: 'https://example.com/a', client });
  const inspect = assert.rejects(layer.inspect(), error => error.name === 'AbortError');
  await layer.destroy();
  await inspect;
});
