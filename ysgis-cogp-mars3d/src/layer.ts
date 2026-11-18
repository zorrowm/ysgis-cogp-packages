import * as mars3d from 'mars3d';
import { createCogpClient, type CogpClient, type CogpDatasetHandle } from 'ysgis-cogp-core/runtime';
import { decodeGeometry, readCogpViewport, requireGeographic, type CogpOpenOptions, type CogpRowLimitPolicy } from 'ysgis-cogp-core';
import { geometryGraphics, type CogpMars3dGraphicStyle } from './graphics.js';

export interface CogpMars3dStyle extends CogpMars3dGraphicStyle {}

export interface CogpMars3dLayerOptions extends Omit<CogpOpenOptions, 'fetch' | 'signal' | 'compressors'> {
  client?: CogpClient;
  columns?: string[];
  properties?: Record<string, string>;
  maxRows?: number;
  /** Use a complete coarser LoD before truncating rows (default: coarsen). */
  rowLimitPolicy?: CogpRowLimitPolicy;
  maxCoordinates?: number;
  maxGraphics?: number;
  debounceMs?: number;
  useOverview?: boolean;
  heightMode?: 'clamp' | 'absolute';
  style?: CogpMars3dStyle | ((properties: Record<string, unknown>, rowIndex: number) => CogpMars3dStyle);
  onError?: (error: unknown) => void;
  onLoad?: (result: { rows: number; graphics: number; level: number; requestedLevel: number; truncated: boolean }) => void;
}

export class CogpMars3dLayer {
  readonly graphicLayer = new mars3d.layer.GraphicLayer({ id: 'cogp', name: 'COGP' });
  private readonly client: CogpClient;
  private readonly ownsClient: boolean;
  private readonly options: CogpMars3dLayerOptions;
  private datasetPromise?: Promise<CogpDatasetHandle>;
  private opening?: AbortController;
  private map?: mars3d.Map;
  private observer?: ResizeObserver;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;
  private revision = 0;
  private destroyed = false;
  private readonly onCameraMoveEnd = (): void => this.scheduleRefresh();

  constructor(options: CogpMars3dLayerOptions) {
    this.options = options;
    this.client = options.client ?? createCogpClient();
    this.ownsClient = !options.client;
    for (const value of [options.maxRows, options.maxCoordinates, options.maxGraphics]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError('COGP render budgets must be non-negative safe integers');
    }
  }

  async attach(map: mars3d.Map): Promise<void> {
    if (this.destroyed) throw new Error('COGP Mars3D layer is destroyed');
    if (this.map === map) return;
    this.detach();
    this.map = map;
    await map.addLayer(this.graphicLayer);
    if (this.destroyed || this.map !== map) { map.removeLayer(this.graphicLayer, false); return; }
    map.on(mars3d.EventType.cameraMoveEnd, this.onCameraMoveEnd);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.onCameraMoveEnd);
      this.observer.observe(map.container);
    }
    await this.refresh();
  }

  detach(): void {
    this.revision++;
    this.controller?.abort(); this.controller = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    if (this.map) this.map.off(mars3d.EventType.cameraMoveEnd, this.onCameraMoveEnd);
    this.observer?.disconnect(); this.observer = undefined;
    if (this.map?.hasLayer(this.graphicLayer)) this.map.removeLayer(this.graphicLayer, false);
    this.map = undefined;
  }

  async inspect() { return (await this.dataset()).inspect(); }
  async getStats() { return (await this.dataset()).getStats(); }
  async readRow(rowIndex: number, columns?: string[], signal?: AbortSignal) {
    return (await this.dataset()).readRow(rowIndex, columns, signal);
  }

  scheduleRefresh(): void {
    if (this.destroyed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; void this.refresh(); }, this.options.debounceMs ?? 150);
  }

  async refresh(): Promise<void> {
    this.controller?.abort();
    const revision = ++this.revision;
    const map = this.map;
    if (this.destroyed || !map || map.canvas.clientWidth <= 0 || map.canvas.clientHeight <= 0) return;
    const extent = map.getExtent();
    if (!extent || !Number.isFinite(extent.xmin) || !Number.isFinite(extent.xmax) || !Number.isFinite(extent.ymin) || !Number.isFinite(extent.ymax)) return;
    const boxes = extent.xmin <= extent.xmax
      ? [[extent.xmin, extent.ymin, extent.xmax, extent.ymax] as [number, number, number, number]]
      : [[extent.xmin, extent.ymin, 180, extent.ymax], [-180, extent.ymin, extent.xmax, extent.ymax]] as [number, number, number, number][];
    const resolution = viewResolution(map, extent.xmin <= extent.xmax ? extent.xmax - extent.xmin : 360 - extent.xmin + extent.xmax);
    const controller = new AbortController(); this.controller = controller;
    try {
      const handle = await this.dataset();
      controller.signal.throwIfAborted();
      const maxRows = this.options.maxRows ?? 10_000;
      const { rows: selected, level, requestedLevel, truncated } = await readCogpViewport(handle, {
        boxes, resolution, columns: this.options.columns, properties: this.options.properties,
        useOverview: this.options.useOverview ?? this.options.heightMode !== 'absolute',
        maxRows, rowLimitPolicy: this.options.rowLimitPolicy, signal: controller.signal,
      });
      if (this.destroyed || revision !== this.revision || controller.signal.aborted) return;
      let coordinates = 0;
      for (const [, { result, index }] of selected) {
        const geometry = result.batch.geometry;
        if (!geometry) continue;
        const start = geometry.ringOffsets[geometry.polygonOffsets[geometry.geometryOffsets[index]!]!]!;
        const end = geometry.ringOffsets[geometry.polygonOffsets[geometry.geometryOffsets[index + 1]!]!]!;
        coordinates += end - start;
      }
      if (coordinates > (this.options.maxCoordinates ?? 1_000_000)) throw new Error('COGP coordinate budget exceeded');
      const graphics: Array<ReturnType<typeof geometryGraphics>[number]> = [];
      for (const [rowIndex, { result, index }] of selected) {
        const geometry = result.batch.geometry;
        if (!geometry) continue;
        const properties = Object.fromEntries(Object.entries(result.batch.columns).map(([key, values]) => [key, values[index]]));
        const style = typeof this.options.style === 'function' ? this.options.style(properties, rowIndex) : this.options.style;
        graphics.push(...geometryGraphics(handle.id, rowIndex, decodeGeometry(geometry, index), properties, style, this.options.heightMode === 'absolute'));
        if (graphics.length > (this.options.maxGraphics ?? 20_000)) throw new Error('COGP graphic budget exceeded');
      }
      if (this.destroyed || revision !== this.revision || controller.signal.aborted) return;
      const remaining = new Set((this.graphicLayer.getGraphics() as Array<{ id: string }>).map(graphic => String(graphic.id)));
      for (const graphic of graphics) {
        remaining.delete(String(graphic.id));
        const existing = this.graphicLayer.getGraphicById(graphic.id) as { setOptions?: (options: unknown) => unknown } | undefined;
        if (existing?.setOptions) existing.setOptions(graphic);
        else this.graphicLayer.addGraphic(graphic);
      }
      for (const id of remaining) {
        const graphic = this.graphicLayer.getGraphicById(id);
        if (graphic) this.graphicLayer.removeGraphic(graphic, true);
      }
      this.options.onLoad?.({ rows: selected.length, graphics: graphics.length, level, requestedLevel, truncated });
    } catch (error) {
      if (!this.destroyed && revision === this.revision && !controller.signal.aborted) this.options.onError?.(error);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detach();
    this.opening?.abort();
    this.graphicLayer.clear(true);
    this.graphicLayer.destroy();
    if (this.ownsClient) this.client.dispose();
    await this.datasetPromise?.then(handle => handle.close()).catch(() => undefined);
  }

  private dataset(): Promise<CogpDatasetHandle> {
    if (this.destroyed) return Promise.reject(new Error('COGP Mars3D layer is destroyed'));
    if (!this.datasetPromise) {
      const { url, requestInit, byteLength, pageIndexCache, rangeCache, rangePolicy, rangeCoalescing, dataProjection, version } = this.options;
      this.opening = new AbortController();
      this.datasetPromise = this.client.openDataset({ url, requestInit, byteLength, pageIndexCache, rangeCache, rangePolicy, rangeCoalescing, dataProjection, version }, this.opening.signal).then(async handle => {
        try { requireGeographic((await handle.inspect()).geo, dataProjection); return handle; }
        catch (error) { await handle.close(); throw error; }
      });
    }
    return this.datasetPromise;
  }
}

function viewResolution(map: mars3d.Map, width: number): number {
  return Math.max(1e-9, width / Math.max(1, map.canvas.clientWidth));
}
