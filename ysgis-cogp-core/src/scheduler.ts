import { abortError } from './errors.js';

export class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Concurrency must be a positive integer');
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const remove = (): void => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        signal?.removeEventListener('abort', cancel);
      };
      const cancel = (): void => { remove(); reject(abortError(signal)); };
      const start = (): void => {
        remove();
        this.active++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.active--;
          this.waiting.shift()?.();
        });
      };
      if (this.active < this.limit) start();
      else {
        this.waiting.push(start);
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
  }

  async run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try { signal?.throwIfAborted(); return await action(); }
    finally { release(); }
  }
}
