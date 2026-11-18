import { CogpReader, MVT_BUFFER, MVT_EXTENT, toMvt, type CogpBatch, type OpenOptions } from './reader-index.js';
import type { CogpBatchResult, CogpDatasetInfo, CogpLayerInput, CogpNetworkStats, CogpOpenOptions, CogpReadBatchOptions, CogpReadTileOptions, CogpTileResult } from './core-types.js';
import { CogpError } from './errors.js';
import { requireGeographic } from './crs.js';
import { sliceBatch } from './transfer.js';

let decoder: Promise<{ decompress(input: Uint8Array): Uint8Array }> | undefined;
async function zstdDecoder() {
  decoder ??= import('@hpcc-js/wasm-zstd').then(({ Zstd }) => Zstd.load());
  try { return await decoder; }
  catch (error) { decoder = undefined; throw error; }
}

export interface CogpDataset {
  readonly url: string;
  readonly reader: CogpReader;
  inspect(): CogpDatasetInfo;
  readBatch(options?: CogpReadBatchOptions): Promise<CogpBatchResult>;
  readRow(rowIndex: number, columns?: string[], signal?: AbortSignal): Promise<CogpBatch>;
  readTile(options: CogpReadTileOptions): Promise<CogpTileResult>;
  getStats(): CogpNetworkStats;
  close(): Promise<void>;
}

export async function openCogp(options: CogpOpenOptions): Promise<CogpDataset> {
  const url = validateUrl(options.url);
  const counters: CogpNetworkStats = { requests: 0, bytes: 0 };
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const countedFetch: typeof fetch = async (input, init) => {
    const isRange = new Headers(init?.headers).has('Range');
    if (isRange) counters.requests++;
    const response = await fetchFn(input, init);
    if (isRange && (options.rangePolicy ?? 'allow-full') === 'require' && response.status === 200) {
      await response.body?.cancel();
      throw new CogpError('RANGE_REQUIRED', 'Server ignored the HTTP Range request');
    }
    if (!isRange || !response.body) return response;
    const body = response.body.getReader();
    return new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await body.read();
          if (chunk.done) controller.close();
          else { counters.bytes = (counters.bytes ?? 0) + chunk.value.byteLength; controller.enqueue(chunk.value); }
        } catch (error) { controller.error(error); }
      },
      cancel: reason => body.cancel(reason),
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  options.signal?.throwIfAborted();
  const zstd = options.compressors?.ZSTD ? undefined : await zstdDecoder();
  options.signal?.throwIfAborted();
  let reader: CogpReader | undefined = await CogpReader.open(url, {
    requestInit: options.requestInit, byteLength: options.byteLength,
    rangeCoalescing: options.rangeCoalescing, pageIndexCache: options.pageIndexCache,
    rangeCache: options.rangeCache, signal: options.signal, fetch: countedFetch,
    compressors: { ...(zstd ? { ZSTD: (input: Uint8Array) => zstd.decompress(input) } : {}), ...options.compressors },
  } satisfies OpenOptions);
  let closed = false;
  const active = new Set<AbortController>();
  const ensure = (): CogpReader => {
    if (closed || !reader) throw new CogpError('CLOSED', 'COGP dataset is closed');
    return reader;
  };
  const run = async <T>(signal: AbortSignal | undefined, action: (r: CogpReader, signal: AbortSignal) => Promise<T>): Promise<T> => {
    const r = ensure();
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    active.add(controller);
    try {
      const result = await action(r, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally { active.delete(controller); signal?.removeEventListener('abort', abort); }
  };
  const stats = (): CogpNetworkStats => ({ ...counters });
  return {
    url,
    get reader() { return ensure(); },
    inspect: () => inspectReader(ensure()),
    getStats: () => { ensure(); return stats(); },
    readBatch: (query = {}) => run(query.signal, async (r, signal) => {
      const started = performance.now();
      if (query.resolution !== undefined && (!Number.isFinite(query.resolution) || query.resolution <= 0)) throw new RangeError('Resolution must be positive and finite');
      if (query.columns && query.properties) throw new TypeError('Use columns or properties, not both');
      validateProperties(query.properties);
      const level = query.maxLevel ?? r.selectLevel(query.resolution);
      const resolution = query.resolution ?? r.levels[level]?.resolution;
      if (resolution === undefined) throw new RangeError('Invalid COGP level');
      const selected = query.properties ? Object.values(query.properties) : query.columns;
      const columns = selected === undefined ? undefined : [r.primaryGeometryColumn, ...new Set(selected)];
      const raw = await r.read({ bbox: query.bbox, columns, maxLevel: level, useOverview: query.useOverview ?? true, maxRows: lookahead(query.maxRows), signal });
      const truncated = query.maxRows !== undefined && raw.length > query.maxRows;
      let batch = sliceBatch(raw, Math.min(raw.length, query.maxRows ?? raw.length));
      if (query.properties) batch = { ...batch, columns: mapProperties(batch, query.properties) };
      return { batch, level, resolution, truncated, elapsedMs: performance.now() - started, network: stats() };
    }),
    readRow: (rowIndex, columns, signal) => run(signal, (r, operationSignal) => r.readRow(rowIndex, { columns, signal: operationSignal })),
    readTile: query => run(query.signal, async (r, signal) => {
      requireGeographic(r.geo, options.dataProjection);
      validateLayer(query.layer);
      validateTileCoordinate(query.z, query.x, query.y);
      validateTileSize(query.tileSize ?? 512);
      const started = performance.now();
      const level = r.selectLevel(tileResolution(query.z, query.y, query.tileSize));
      const columns = query.layer.properties === undefined ? undefined : [r.primaryGeometryColumn, ...new Set(Object.values(query.layer.properties))];
      const raw = await r.read({ bbox: tileBounds(query.z, query.x, query.y), maxLevel: level, columns, maxRows: lookahead(query.layer.maxRowsPerTile), useOverview: query.useOverview ?? true, signal });
      const truncated = query.layer.maxRowsPerTile !== undefined && raw.length > query.layer.maxRowsPerTile;
      const batch = sliceBatch(raw, Math.min(raw.length, query.layer.maxRowsPerTile ?? raw.length));
      const data = toMvt({ ...batch, columns: query.layer.properties === undefined ? batch.columns : mapProperties(batch, query.layer.properties) }, { z: query.z, x: query.x, y: query.y, layer: query.layer.name, signal });
      return { data, z: query.z, x: query.x, y: query.y, layerName: query.layer.name, level, truncated, elapsedMs: performance.now() - started, network: stats() };
    }),
    async close() {
      if (closed) return;
      closed = true;
      for (const controller of active) controller.abort(new CogpError('CLOSED', 'COGP dataset closed'));
      reader = undefined;
    },
  };
}

export function inspectReader(reader: CogpReader): CogpDatasetInfo {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let complete = true;
  for (let i = 0; i < reader.numRowGroups; i++) {
    const bbox = reader.rowGroupEnvelope(i);
    if (!bbox) { complete = false; continue; }
    minX = Math.min(minX, bbox.minX); minY = Math.min(minY, bbox.minY);
    maxX = Math.max(maxX, bbox.maxX); maxY = Math.max(maxY, bbox.maxY);
  }
  const declared = reader.geo.columns[reader.primaryGeometryColumn]?.bbox;
  const dataBbox: CogpDatasetInfo['dataBbox'] = declared?.length === 4 && declared.every(Number.isFinite)
    ? [[declared[0]!, declared[1]!], [declared[2]!, declared[3]!]]
    : complete && Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
  return { url: reader.url, geo: reader.geo, columnNames: [...reader.columnNames], numRowGroups: reader.numRowGroups, byteLength: reader.byteLength, dataBbox, hasOverviews: reader.hasOverviews };
}

export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  validateTileCoordinate(z, x, y);
  const tiles = 2 ** z;
  const padding = MVT_BUFFER / MVT_EXTENT;
  return [((x - padding) / tiles) * 360 - 180, tileYToLatitude(y + 1 + padding, tiles), ((x + 1 + padding) / tiles) * 360 - 180, tileYToLatitude(y - padding, tiles)];
}

export function tileResolution(z: number, y: number, tileSize = 512): number {
  validateTileCoordinate(z, 0, y); validateTileSize(tileSize);
  const latitude = tileYToLatitude(y + 0.5, 2 ** z);
  return (360 * Math.cos(latitude * Math.PI / 180)) / (tileSize * 2 ** z);
}

function tileYToLatitude(y: number, tiles: number): number {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / tiles))) * 180 / Math.PI;
}

export function validateUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new CogpError('INVALID_URL', 'COGP URL must be absolute HTTP(S)'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new CogpError('INVALID_URL', 'COGP URL must be absolute HTTP(S)');
  url.hash = '';
  return url.href;
}

function lookahead(limit?: number): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit >= Number.MAX_SAFE_INTEGER) throw new RangeError('Row limit must be a non-negative safe integer below MAX_SAFE_INTEGER');
  return limit + 1;
}

function validateProperties(properties?: Record<string, string>): void {
  if (properties === undefined) return;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new TypeError('Properties must map names to column paths');
  for (const [name, path] of Object.entries(properties)) {
    if (!name || typeof path !== 'string' || !path) throw new TypeError('Properties require non-empty names and paths');
  }
}

function mapProperties(batch: CogpBatch, properties: Record<string, string>): Record<string, ArrayLike<unknown>> {
  const mapped = Object.create(null) as Record<string, ArrayLike<unknown>>;
  for (const [name, path] of Object.entries(properties)) {
    const values = batch.columns[path];
    if (!values) throw new Error(`COGP property path ${path} was not read`);
    mapped[name] = values;
  }
  return mapped;
}

function validateLayer(layer: CogpLayerInput): void {
  if (!layer || typeof layer.name !== 'string' || !layer.name) throw new TypeError('COGP layer name must not be empty');
  validateProperties(layer.properties); lookahead(layer.maxRowsPerTile);
}

function validateTileCoordinate(z: number, x: number, y: number): void {
  if (![z, x, y].every(Number.isSafeInteger) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new RangeError('Invalid COGP tile coordinates');
}

function validateTileSize(size: number): void {
  if (!Number.isSafeInteger(size) || size <= 0) throw new RangeError('Tile size must be a positive integer');
}
