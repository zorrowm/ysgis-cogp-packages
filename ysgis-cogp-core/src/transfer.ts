import type { CogpBatch } from './reader.js';

export function sliceBatch(batch: CogpBatch, count: number): CogpBatch {
  if (count >= batch.length) return batch;
  const columns = Object.create(null) as Record<string, ArrayLike<unknown>>;
  for (const [key, values] of Object.entries(batch.columns)) {
    columns[key] = ArrayBuffer.isView(values)
      ? (values as unknown as { slice(start: number, end: number): ArrayLike<unknown> }).slice(0, count)
      : Array.from(values).slice(0, count);
  }
  const geometry = batch.geometry;
  if (!geometry) return { length: count, rowIndex: batch.rowIndex.slice(0, count), columns };
  const polygons = geometry.geometryOffsets[count]!;
  const rings = geometry.polygonOffsets[polygons]!;
  const coords = geometry.ringOffsets[rings]!;
  return {
    length: count, rowIndex: batch.rowIndex.slice(0, count), columns,
    geometry: {
      length: count,
      types: geometry.types.slice(0, count),
      geometryOffsets: geometry.geometryOffsets.slice(0, count + 1),
      polygonOffsets: geometry.polygonOffsets.slice(0, polygons + 1),
      ringOffsets: geometry.ringOffsets.slice(0, rings + 1),
      x: geometry.x.slice(0, coords), y: geometry.y.slice(0, coords),
      ...(geometry.z ? { z: geometry.z.slice(0, coords) } : {}),
      scale: geometry.scale, offset: geometry.offset,
    },
  };
}

/** Only pass caller-owned query results, never Reader caches, to this function. */
export function transferBuffers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object' || visited.has(item)) return;
    visited.add(item);
    if (item instanceof ArrayBuffer) buffers.add(item);
    else if (ArrayBuffer.isView(item)) {
      if (item.buffer instanceof ArrayBuffer) buffers.add(item.buffer);
    } else if (item instanceof Map) {
      for (const [key, entry] of item) { visit(key); visit(entry); }
    } else if (item instanceof Set) {
      for (const entry of item) visit(entry);
    } else for (const entry of Object.values(item)) visit(entry);
  };
  visit(value);
  return [...buffers];
}
