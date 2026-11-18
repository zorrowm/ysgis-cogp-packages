import type {
  BboxInput,
  CogpBatch,
  CogpReader,
  GeoMeta,
  PageIndexCacheOptions,
  RangeCacheOptions,
  OpenOptions,
} from './reader-index.js';

export type RangePolicy = 'allow-full' | 'require';

export interface CogpOpenOptions {
  url: string;
  fetch?: typeof fetch;
  requestInit?: Omit<RequestInit, 'cache' | 'signal'>;
  byteLength?: number;
  rangeCoalescing?: boolean;
  pageIndexCache?: PageIndexCacheOptions | false;
  rangeCache?: RangeCacheOptions | false;
  rangePolicy?: RangePolicy;
  signal?: AbortSignal;
  version?: string;
  compressors?: OpenOptions['compressors'];
  dataProjection?: 'OGC:CRS84';
}

export interface CogpDatasetInfo {
  url: string;
  geo: GeoMeta & { lod: NonNullable<CogpReader['geo']['lod']> };
  columnNames: string[];
  numRowGroups: number;
  byteLength: number;
  dataBbox: [[number, number], [number, number]] | null;
  hasOverviews: boolean;
}

export interface CogpNetworkStats {
  requests: number;
  bytes: number | null;
}

export interface CogpBatchResult {
  batch: CogpBatch;
  level: number;
  resolution: number;
  truncated: boolean;
  elapsedMs: number;
  network: CogpNetworkStats;
}

export interface CogpReadBatchOptions {
  bbox?: BboxInput;
  resolution?: number;
  maxLevel?: number;
  columns?: string[];
  properties?: Record<string, string>;
  useOverview?: boolean;
  maxRows?: number;
  signal?: AbortSignal;
}

export interface CogpLayerInput {
  name: string;
  properties?: Record<string, string>;
  maxRowsPerTile?: number;
}

export interface CogpReadTileOptions {
  layer: CogpLayerInput;
  z: number;
  x: number;
  y: number;
  tileSize?: number;
  useOverview?: boolean;
  signal?: AbortSignal;
}

export interface CogpTileResult {
  data: ArrayBuffer;
  z: number;
  x: number;
  y: number;
  layerName: string;
  level: number;
  truncated: boolean;
  elapsedMs: number;
  network: CogpNetworkStats;
}
