import { openCogp, validateUrl, type CogpDataset } from './core.js';
import { CogpError } from './errors.js';
import { raceAbort } from './abort.js';
import { Semaphore } from './scheduler.js';
import type { RuntimeOptions, WorkerOpenOptions, WorkerRequest, WorkerResponse, WorkerResult } from './worker-protocol.js';

interface Entry {
  key: string;
  promise: Promise<CogpDataset>;
  controller: AbortController;
  refs: number;
  used: number;
}

/** Each handle owns requests; multiple handles can share a single Reader entry. */
export class CogpWorkerRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly handles = new Map<string, Entry>();
  private readonly jobs = new Map<number, { controller: AbortController; handle?: string }>();
  private readQueue = new Semaphore(4);
  private httpQueue = new Semaphore(8);
  private maxReaders = 2;
  private sequence = 0;
  private closed = false;
  private readonly namespace = globalThis.crypto?.randomUUID() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async dispatch(request: WorkerRequest): Promise<WorkerResponse | undefined> {
    if (this.closed) return undefined;
    if (request.type === 'cancel') { this.jobs.get(request.requestId)?.controller.abort(); return undefined; }
    const controller = new AbortController();
    this.jobs.set(request.id, { controller, handle: 'datasetId' in request ? request.datasetId : undefined });
    try {
      const result = await this.execute(request, controller.signal);
      controller.signal.throwIfAborted();
      return { id: request.id, ok: true, result };
    } catch (error) {
      const cause = error as Error & { code?: string };
      return { id: request.id, ok: false, name: cause.name ?? 'Error', code: cause.code, error: cause.message ?? String(error) };
    } finally { this.jobs.delete(request.id); }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    this.handles.clear();
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      void entry.promise.then(dataset => dataset.close()).catch(() => undefined);
    }
    this.entries.clear();
  }

  private async execute(request: Exclude<WorkerRequest, { type: 'cancel' }>, signal: AbortSignal): Promise<WorkerResult> {
    if (request.type === 'configure') {
      if (this.entries.size) throw new CogpError('INVALID_STATE', 'Configure before opening datasets');
      this.configure(request.options);
      return { ready: true };
    }
    if (request.type === 'open') return this.open(request.options, signal);
    const entry = this.handles.get(request.datasetId);
    if (!entry) throw new CogpError('CLOSED', 'COGP dataset handle is closed');
    if (request.type === 'release') {
      this.handles.delete(request.datasetId);
      entry.refs--; entry.used = ++this.sequence;
      for (const [id, job] of this.jobs) {
        if (id !== request.id && job.handle === request.datasetId) job.controller.abort();
      }
      return { datasetId: request.datasetId };
    }
    return this.readQueue.run(async () => {
      const dataset = await entry.promise;
      signal.throwIfAborted();
      if (request.type === 'inspect') return dataset.inspect();
      if (request.type === 'stats') return dataset.getStats();
      if (request.type === 'readRow') return dataset.readRow(request.rowIndex, request.columns, signal);
      if (request.type === 'readBatch') return dataset.readBatch({ ...request.options, signal });
      return dataset.readTile({ ...request.options, signal });
    }, signal);
  }

  private configure(options: RuntimeOptions): void {
    this.readQueue = new Semaphore(options.maxConcurrentReads ?? 4);
    this.httpQueue = new Semaphore(options.maxConcurrentRequests ?? 8);
    const max = options.maxReaders ?? 2;
    if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('maxReaders must be a positive integer');
    this.maxReaders = max;
  }

  private async open(options: WorkerOpenOptions, signal: AbortSignal): Promise<{ datasetId: string }> {
    const normalized = { ...options, url: validateUrl(options.url), rangePolicy: options.rangePolicy ?? 'require' };
    const headers = [...new Headers(options.requestInit?.headers).entries()].sort(([a], [b]) => a.localeCompare(b));
    const key = stableKey({ ...normalized, requestInit: { ...normalized.requestInit, headers } });
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxReaders) {
        const idle = [...this.entries.values()].filter(candidate => candidate.refs === 0).sort((a, b) => a.used - b.used)[0];
        if (!idle) throw new CogpError('RESOURCE_LIMIT', 'Reader pool is full; close a dataset or raise maxReaders');
        this.entries.delete(idle.key);
        idle.controller.abort();
        void idle.promise.then(dataset => dataset.close()).catch(() => undefined);
      }
      const controller = new AbortController();
      const fresh: Entry = { key, controller, refs: 0, used: ++this.sequence, promise: openCogp({ ...normalized, signal: controller.signal, fetch: this.limitedFetch }) };
      this.entries.set(key, fresh);
      void fresh.promise.catch(() => { if (this.entries.get(key) === fresh) this.entries.delete(key); });
      entry = fresh;
    }
    entry.refs++;
    try {
      await raceAbort(entry.promise, signal);
      signal.throwIfAborted();
      const datasetId = `${this.namespace}:${++this.sequence}`;
      this.handles.set(datasetId, entry);
      return { datasetId };
    } catch (error) {
      entry.refs--;
      if (entry.refs === 0 && signal.aborted) {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        entry.controller.abort();
        void entry.promise.then(dataset => dataset.close()).catch(() => undefined);
      }
      throw error;
    }
  }

  private limitedFetch: typeof fetch = async (input, init) => {
    const signal = init?.signal ?? undefined;
    const release = await this.httpQueue.acquire(signal);
    try {
      const response = await this.fetchFn(input, init);
      if (!response.body) { release(); return response; }
      // Retry responses and the one-byte length probe are not consumed by the Reader.
      // Drain/cancel them here so a held HTTP permit cannot deadlock later requests.
      if (response.status >= 400) {
        await response.body.cancel(); release();
        return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      if (response.status === 206 && new Headers(init?.headers).get('Range') === 'bytes=0-0') {
        const bytes = await response.arrayBuffer(); release();
        return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const body = response.body.getReader();
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await body.read();
            if (chunk.done) { release(); controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { release(); controller.error(error); }
        },
        async cancel(reason) { try { await body.cancel(reason); } finally { release(); } },
      }), { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { release(); throw error; }
  };
}

function stableKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableKey(item)}`).join(',')}}`;
}
