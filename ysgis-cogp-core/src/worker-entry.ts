/// <reference lib="webworker" />
import { CogpWorkerRuntime } from './worker-runtime.js';
import { transferBuffers } from './transfer.js';
import type { WorkerRequest } from './worker-protocol.js';

const scope = self as DedicatedWorkerGlobalScope;
const runtime = new CogpWorkerRuntime();
scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  void runtime.dispatch(event.data).then(response => {
    if (response) scope.postMessage(response, response.ok ? transferBuffers(response.result) : []);
  });
});
