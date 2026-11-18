import type { CogpBatchResult, CogpDatasetInfo, CogpNetworkStats, CogpReadBatchOptions, CogpReadTileOptions, CogpTileResult } from './core-types.js';
import type { CogpBatch } from './reader.js';
import type { RuntimeOptions, WorkerOpenOptions, WorkerPayload, WorkerRequest, WorkerResponse, WorkerResult } from './worker-protocol.js';
import { CogpError, abortError } from './errors.js';

export interface CogpClientOptions extends RuntimeOptions {
  workerFactory?: () => Worker;
  workerUrl?: string | URL;
  ownsWorker?: boolean;
}
export interface CogpClient {
  openDataset(options: WorkerOpenOptions, signal?: AbortSignal): Promise<CogpDatasetHandle>;
  dispose(): void;
}
export interface CogpDatasetHandle {
  readonly id: string;
  inspect(): Promise<CogpDatasetInfo>;
  readBatch(options?: CogpReadBatchOptions): Promise<CogpBatchResult>;
  readRow(rowIndex: number, columns?: string[], signal?: AbortSignal): Promise<CogpBatch>;
  readTile(options: CogpReadTileOptions): Promise<CogpTileResult>;
  getStats(): Promise<CogpNetworkStats>;
  close(): Promise<void>;
}
interface Pending {
  resolve: (result: WorkerResult) => void;
  reject: (error: unknown) => void;
  handle?: string;
  cleanup(): void;
}

export function createCogpClient(options: CogpClientOptions = {}): CogpClient {
  let worker: Worker | undefined;
  let disposed = false;
  let failure: Error | undefined;
  let nextId = 0;
  let initialization: Promise<unknown> | undefined;
  const pending = new Map<number, Pending>();
  const handles = new Set<string>();
  const abandonedOpens = new Set<number>();

  const message = (event: MessageEvent<WorkerResponse>): void => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) {
      // An open can finish just as its consumer aborts. Release its orphan handle.
      if (abandonedOpens.delete(response.id) && response.ok && 'datasetId' in response.result) {
        worker?.postMessage({ id: ++nextId, type: 'release', datasetId: response.result.datasetId } satisfies WorkerRequest);
      }
      return;
    }
    pending.delete(response.id); request.cleanup();
    if (response.ok) request.resolve(response.result);
    else {
      const error = new CogpError(response.code ?? (response.name === 'AbortError' ? 'ABORTED' : 'READ_FAILURE'), response.error);
      error.name = response.name;
      request.reject(error);
    }
  };
  const fail = (event: Event): void => {
    failure = new CogpError('WORKER_FAILURE', typeof ErrorEvent !== 'undefined' && event instanceof ErrorEvent ? event.message : 'COGP worker failed or message could not be decoded');
    for (const request of pending.values()) { request.cleanup(); request.reject(failure); }
    pending.clear(); cleanupWorker();
  };
  const cleanupWorker = (): void => {
    worker?.removeEventListener('message', message);
    worker?.removeEventListener('error', fail);
    worker?.removeEventListener('messageerror', fail);
    if (options.ownsWorker !== false) worker?.terminate();
    worker = undefined;
  };
  const getWorker = (): Worker => {
    if (disposed) throw new CogpError('CLOSED', 'COGP client is disposed');
    if (failure) throw failure;
    if (!worker) {
      worker = options.workerFactory ? options.workerFactory()
        : options.workerUrl ? new Worker(options.workerUrl, { type: 'module' })
        : new Worker(new URL('./worker-entry.js', import.meta.url), { type: 'module' });
      worker.addEventListener('message', message);
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
    }
    return worker;
  };
  const call = <T extends WorkerResult>(payload: WorkerPayload, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => {
        if (!pending.delete(id)) return;
        if (payload.type === 'open') abandonedOpens.add(id);
        signal?.removeEventListener('abort', abort);
        worker?.postMessage({ id: ++nextId, type: 'cancel', requestId: id } satisfies WorkerRequest);
        reject(abortError(signal));
      };
      pending.set(id, { resolve: value => resolve(value as T), reject, handle: 'datasetId' in payload ? payload.datasetId : undefined, cleanup: () => signal?.removeEventListener('abort', abort) });
      signal?.addEventListener('abort', abort, { once: true });
      try { getWorker().postMessage({ ...payload, id } satisfies WorkerRequest); }
      catch (error) { pending.delete(id); signal?.removeEventListener('abort', abort); reject(error); }
    });
  };
  const ready = (): Promise<unknown> => initialization ??= call({ type: 'configure', options: { maxReaders: options.maxReaders, maxConcurrentReads: options.maxConcurrentReads, maxConcurrentRequests: options.maxConcurrentRequests } });
  return {
    async openDataset(openOptions, signal) {
      signal?.throwIfAborted();
      await ready(); signal?.throwIfAborted();
      const { datasetId: id } = await call<{ datasetId: string }>({ type: 'open', options: {
        ...openOptions, requestInit: openOptions.requestInit ? { ...openOptions.requestInit, headers: [...new Headers(openOptions.requestInit.headers).entries()] } : undefined,
      } }, signal);
      if (disposed) throw new CogpError('CLOSED', 'COGP client disposed while opening dataset');
      handles.add(id);
      let closed = false;
      const invoke = <T extends WorkerResult>(payload: WorkerPayload, operationSignal?: AbortSignal): Promise<T> => {
        if (closed) return Promise.reject(new CogpError('CLOSED', 'COGP dataset handle is closed'));
        return call<T>(payload, operationSignal);
      };
      return {
        id,
        inspect: () => invoke<CogpDatasetInfo>({ type: 'inspect', datasetId: id }),
        getStats: () => invoke<CogpNetworkStats>({ type: 'stats', datasetId: id }),
        readBatch: (query = {}) => {
          const { signal: readSignal, ...wire } = query;
          return invoke<CogpBatchResult>({ type: 'readBatch', datasetId: id, options: wire }, readSignal);
        },
        readRow: (rowIndex, columns, readSignal) => invoke<CogpBatch>({ type: 'readRow', datasetId: id, rowIndex, columns }, readSignal),
        readTile: query => {
          const { signal: readSignal, ...wire } = query;
          return invoke<CogpTileResult>({ type: 'readTile', datasetId: id, options: wire }, readSignal);
        },
        async close() {
          if (closed) return;
          closed = true; handles.delete(id);
          for (const [requestId, request] of pending) {
            if (request.handle !== id) continue;
            pending.delete(requestId); request.cleanup();
            request.reject(new CogpError('CLOSED', 'COGP dataset handle closed'));
          }
          if (!disposed && !failure) await call({ type: 'release', datasetId: id });
        },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [id, request] of pending) {
        worker?.postMessage({ id: ++nextId, type: 'cancel', requestId: id } satisfies WorkerRequest);
        request.cleanup(); request.reject(new CogpError('CLOSED', 'COGP client disposed'));
      }
      pending.clear();
      for (const id of handles) worker?.postMessage({ id: ++nextId, type: 'release', datasetId: id } satisfies WorkerRequest);
      handles.clear(); cleanupWorker();
    },
  };
}
