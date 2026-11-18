import MVT from 'ol/format/MVT.js';
import TileState from 'ol/TileState.js';
import VectorTileSource from 'ol/source/VectorTile.js';
import { createXYZ } from 'ol/tilegrid.js';
import BaseEvent from 'ol/events/Event.js';
import type VectorTile from 'ol/VectorTile.js';
import type RenderFeature from 'ol/render/Feature.js';
import type { Extent } from 'ol/extent.js';
import type Projection from 'ol/proj/Projection.js';
import { createCogpClient, type CogpClient, type CogpDatasetHandle } from 'ysgis-cogp-core/runtime';
import type { CogpLayerInput, CogpOpenOptions, CogpTileResult } from 'ysgis-cogp-core';

export type CogpOpenLayersTileInfo = Pick<CogpTileResult, 'z' | 'x' | 'y' | 'level' | 'truncated'> & { features: number };

export interface CogpVectorTileSourceOptions extends Omit<CogpOpenOptions, 'fetch' | 'signal' | 'compressors'> {
  layerName?: string;
  properties?: Record<string, string>;
  maxRowsPerTile?: number;
  tileSize?: number;
  maxZoom?: number;
  minZoom?: number;
  wrapX?: boolean;
  useOverview?: boolean;
  client?: CogpClient;
  onError?: (error: unknown) => void;
  onTileLoad?: (info: CogpOpenLayersTileInfo) => void;
}

export class CogpSourceErrorEvent extends BaseEvent {
  constructor(readonly error: unknown) { super('cogperror'); }
}

export class CogpVectorTileSource extends VectorTileSource<RenderFeature> {
  readonly cogpUrl: string;
  readonly layerName: string;
  private readonly client: CogpClient;
  private readonly ownsClient: boolean;
  private readonly options: CogpVectorTileSourceOptions;
  private datasetPromise?: Promise<CogpDatasetHandle>;
  private opening?: AbortController;
  private generation = 0;
  private readonly requests = new Set<AbortController>();
  private releasePromise: Promise<void> = Promise.resolve();

  constructor(options: CogpVectorTileSourceOptions) {
    const tileSize = options.tileSize ?? 512;
    const format = new MVT<RenderFeature>({ layerName: '_cogpLayer' });
    super({
      format, projection: 'EPSG:3857',
      url: `cogp://${encodeURIComponent(options.url)}/{z}/{x}/{y}`,
      wrapX: options.wrapX ?? true,
      tileGrid: createXYZ({ tileSize, minZoom: options.minZoom ?? 0, maxZoom: options.maxZoom ?? 24 }),
      tileLoadFunction: tile => {
        const vectorTile = tile as VectorTile<RenderFeature>;
        vectorTile.setLoader((extent: Extent, _resolution: number, projection: Projection) => {
          void this.loadTile(vectorTile, extent, projection, format);
        });
      },
    });
    this.options = options;
    this.cogpUrl = options.url;
    this.layerName = options.layerName ?? 'cogp';
    this.client = options.client ?? createCogpClient();
    this.ownsClient = !options.client;
  }

  async inspect() { return (await this.dataset()).inspect(); }
  async getStats() { return (await this.dataset()).getStats(); }
  async readRow(rowIndex: number, columns?: string[], signal?: AbortSignal) {
    return (await this.dataset()).readRow(rowIndex, columns, signal);
  }

  override refresh(): void {
    if (this.disposed) return;
    this.release();
    super.refresh();
  }

  async close(): Promise<void> {
    this.dispose();
    await this.releasePromise;
  }

  protected override disposeInternal(): void {
    this.release();
    this.clear();
    if (this.ownsClient) this.client.dispose();
    super.disposeInternal();
  }

  private release(): void {
    this.generation++;
    this.opening?.abort(); this.opening = undefined;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    const previous = this.datasetPromise;
    this.datasetPromise = undefined;
    this.releasePromise = previous ? previous.then(handle => handle.close()).catch(() => undefined) : this.releasePromise;
  }

  private dataset(): Promise<CogpDatasetHandle> {
    if (this.disposed) return Promise.reject(new Error('COGP source is disposed'));
    if (!this.datasetPromise) {
      const { url, requestInit, byteLength, pageIndexCache, rangeCache, rangePolicy, rangeCoalescing, dataProjection, version } = this.options;
      const generation = this.generation;
      const opening = new AbortController();
      this.opening = opening;
      this.datasetPromise = this.releasePromise.then(() => this.client.openDataset({
        url, requestInit, byteLength, pageIndexCache, rangeCache, rangePolicy, rangeCoalescing, dataProjection,
        version: generation ? `${version ?? ''}:refresh:${generation}` : version,
      }, opening.signal));
    }
    return this.datasetPromise;
  }

  private async loadTile(tile: VectorTile<RenderFeature>, extent: Extent, projection: Projection, format: MVT<RenderFeature>): Promise<void> {
    const generation = this.generation;
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      if (this.disposed) { tile.setFeatures([]); return; }
      const [z, x, y] = tile.getTileCoord();
      if (z === undefined || x === undefined || y === undefined) throw new Error('Incomplete tile coordinate');
      const layer: CogpLayerInput = { name: this.layerName, properties: this.options.properties, maxRowsPerTile: this.options.maxRowsPerTile };
      const handle = await this.dataset();
      controller.signal.throwIfAborted();
      const result = await handle.readTile({ layer, z, x, y, tileSize: this.options.tileSize ?? 512, useOverview: this.options.useOverview, signal: controller.signal });
      if (this.disposed || generation !== this.generation) return;
      // MVT supplies its tile-pixel projection; setting EPSG:3857 here would skip tile decoding.
      const features = format.readFeatures(result.data, { extent, featureProjection: projection });
      tile.setFeatures(features);
      const { level, truncated } = result;
      this.options.onTileLoad?.({ z, x, y, level, truncated, features: features.length });
    } catch (error) {
      if (this.disposed || generation !== this.generation || controller.signal.aborted) tile.setFeatures([]);
      else {
        tile.setState(TileState.ERROR);
        this.dispatchEvent(new CogpSourceErrorEvent(error));
        this.options.onError?.(error);
      }
    } finally { this.requests.delete(controller); }
  }
}
