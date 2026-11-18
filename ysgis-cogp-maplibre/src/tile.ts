import { type CogpReader, tileBounds, tileResolution, toMvt } from 'ysgis-cogp-core';
import type { CogpConfig, CogpLayer } from './url.js';

export type GetReader = (url: string) => Promise<CogpReader>;

export async function renderTile(
  config: CogpConfig, z: number, x: number, y: number, getReader: GetReader, signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const parts = await Promise.all(config.layers.map(async layer => {
    const reader = await getReader(layer.url);
    signal?.throwIfAborted();
    return renderLayer(layer, reader, z, x, y, signal);
  }));
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const tile = new Uint8Array(total);
  let offset = 0;
  // An MVT Tile is a protobuf message with repeated top-level layer fields.
  // Concatenating single-layer Tiles produces the same wire representation.
  for (const part of parts) {
    tile.set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }
  return tile.buffer;
}

async function renderLayer(
  layer: CogpLayer, reader: CogpReader, z: number, x: number, y: number, signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const geometry = reader.primaryGeometryColumn;
  const columns = layer.properties === undefined
    ? undefined
    : [geometry, ...new Set(Object.values(layer.properties))];
  const batch = await reader.read({
    bbox: tileBounds(z, x, y),
    maxLevel: reader.selectLevel(tileResolution(z, y)),
    columns,
    maxRows: layer.maxRowsPerTile,
    useOverview: true,
    signal,
  });
  signal?.throwIfAborted();
  let properties = batch.columns;
  if (layer.properties !== undefined) {
    const mapped: Record<string, ArrayLike<unknown>> = Object.create(null);
    for (const [name, path] of Object.entries(layer.properties)) {
      const values = batch.columns[path];
      if (!values) throw new Error(`COGP property path ${path} was not read`);
      Object.defineProperty(mapped, name, { value: values, enumerable: true });
    }
    properties = mapped;
  }
  return toMvt(
    { geometry: batch.geometry!, rowIndex: batch.rowIndex, columns: properties },
    { z, x, y, layer: layer.name, signal },
  );
}

