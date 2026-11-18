import type { CogpBatchResult, CogpDatasetInfo, CogpNetworkStats, CogpOpenOptions, CogpReadBatchOptions, CogpReadTileOptions, CogpTileResult } from './core-types.js';
import type { CogpBatch } from './reader.js';

export type WorkerOpenOptions = Omit<CogpOpenOptions, 'signal' | 'fetch' | 'compressors'>;
export interface RuntimeOptions { maxReaders?: number; maxConcurrentReads?: number; maxConcurrentRequests?: number }
export type WorkerPayload =
  | { type: 'configure'; options: RuntimeOptions }
  | { type: 'open'; options: WorkerOpenOptions }
  | { type: 'inspect'; datasetId: string }
  | { type: 'readBatch'; datasetId: string; options: Omit<CogpReadBatchOptions, 'signal'> }
  | { type: 'readTile'; datasetId: string; options: Omit<CogpReadTileOptions, 'signal'> }
  | { type: 'readRow'; datasetId: string; rowIndex: number; columns?: string[] }
  | { type: 'stats'; datasetId: string }
  | { type: 'release'; datasetId: string };
export type WorkerRequest = (WorkerPayload & { id: number }) | { id: number; type: 'cancel'; requestId: number };
export type WorkerResult = CogpDatasetInfo | CogpBatchResult | CogpTileResult | CogpBatch | CogpNetworkStats | { datasetId: string } | { ready: true };
export type WorkerResponse =
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; name: string; code?: string; error: string };
