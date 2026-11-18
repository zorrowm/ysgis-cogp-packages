import type { CogpBatchResult, CogpReadBatchOptions } from './core-types.js';

export type CogpRowLimitPolicy = 'coarsen' | 'truncate';

interface ViewportOptions extends Omit<CogpReadBatchOptions, 'bbox' | 'maxLevel'> {
  boxes: readonly [number, number, number, number][];
  maxRows: number;
  rowLimitPolicy?: CogpRowLimitPolicy;
}

/** Read all parts of a geographic viewport at one LoD, retaining stable source rows. */
export async function readCogpViewport(
  dataset: { readBatch(options: CogpReadBatchOptions): Promise<CogpBatchResult> },
  { boxes, rowLimitPolicy = 'coarsen', ...query }: ViewportOptions,
) {
  if (boxes.length === 0) throw new RangeError('COGP viewport requires at least one bounding box');
  let maxLevel: number | undefined;
  let requestedLevel: number | undefined;
  for (;;) {
    query.signal?.throwIfAborted();
    const results = await Promise.all(boxes.map(bbox => dataset.readBatch({ ...query, bbox, maxLevel })));
    query.signal?.throwIfAborted();
    const level = results[0]!.level;
    requestedLevel ??= level;
    const rows = new Map<number, { result: CogpBatchResult; index: number }>();
    for (const result of results) {
      for (let index = 0; index < result.batch.length; index++) {
        rows.set(result.batch.rowIndex[index]!, { result, index });
      }
    }
    const truncated = rows.size > query.maxRows || results.some(result => result.truncated);
    if (!truncated || rowLimitPolicy === 'truncate' || level === 0) {
      return { rows: [...rows].sort(([a], [b]) => a - b).slice(0, query.maxRows), level, requestedLevel, truncated };
    }
    maxLevel = level - 1;
  }
}
