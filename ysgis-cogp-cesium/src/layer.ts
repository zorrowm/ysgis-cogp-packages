import { Cartesian2, CustomDataSource, Entity, SceneMode, type Color, type Viewer } from 'cesium';
import { createCogpClient, type CogpClient, type CogpDatasetHandle } from 'ysgis-cogp-core/runtime';
import { decodeGeometry, readCogpViewport, requireGeographic, type CogpOpenOptions, type CogpRowLimitPolicy } from 'ysgis-cogp-core';
import { geometryEntities } from './entities.js';

export interface CogpCesiumStyle {
  pointColor?: Color;
  pointSize?: number;
  lineColor?: Color;
  lineWidth?: number;
  fillColor?: Color;
  outlineColor?: Color;
  outlineWidth?: number;
}
export interface CogpCesiumLayerOptions extends Omit<CogpOpenOptions, 'fetch' | 'signal' | 'compressors'> {
  client?: CogpClient;
  columns?: string[];
  properties?: Record<string, string>;
  maxRows?: number;
  /** Use a complete coarser LoD before truncating rows (default: coarsen). */
  rowLimitPolicy?: CogpRowLimitPolicy;
  maxCoordinates?: number;
  maxEntities?: number;
  debounceMs?: number;
  useOverview?: boolean;
  heightMode?: 'clamp' | 'absolute';
  style?: CogpCesiumStyle | ((properties: Record<string, unknown>, rowIndex: number) => CogpCesiumStyle);
  onError?: (error: unknown) => void;
  onLoad?: (result: { rows: number; entities: number; level: number; requestedLevel: number; truncated: boolean }) => void;
}

export class CogpCesiumLayer {
  readonly dataSource = new CustomDataSource('cogp');
  private readonly client: CogpClient;
  private readonly ownsClient: boolean;
  private readonly options: CogpCesiumLayerOptions;
  private datasetPromise?: Promise<CogpDatasetHandle>;
  private opening?: AbortController;
  private viewer?: Viewer;
  private removeCameraListener?: () => void;
  private observer?: ResizeObserver;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private destroyed = false;
  private controller?: AbortController;

  constructor(options: CogpCesiumLayerOptions) {
    this.options = options;
    this.client = options.client ?? createCogpClient();
    this.ownsClient = !options.client;
    for (const value of [options.maxRows, options.maxCoordinates, options.maxEntities]) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError('COGP render budgets must be non-negative safe integers');
    }
  }

  async attach(viewer: Viewer): Promise<void> {
    if (this.destroyed) throw new Error('COGP Cesium layer is destroyed');
    if (this.viewer === viewer) return;
    this.detach();
    this.viewer = viewer;
    await viewer.dataSources.add(this.dataSource);
    if (this.destroyed || this.viewer !== viewer) { viewer.dataSources.remove(this.dataSource, false); return; }
    const listener = (): void => this.scheduleRefresh();
    this.removeCameraListener = viewer.camera.moveEnd.addEventListener(listener);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(listener);
      this.observer.observe(viewer.canvas);
    }
    await this.refresh();
  }

  detach(): void {
    this.revision++;
    this.controller?.abort(); this.controller = undefined;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.removeCameraListener?.(); this.removeCameraListener = undefined;
    this.observer?.disconnect(); this.observer = undefined;
    this.viewer?.dataSources.remove(this.dataSource, false);
    this.viewer = undefined;
  }

  async inspect() { return (await this.dataset()).inspect(); }
  async getStats() { return (await this.dataset()).getStats(); }
  async readRow(rowIndex: number, columns?: string[], signal?: AbortSignal) {
    return (await this.dataset()).readRow(rowIndex, columns, signal);
  }

  scheduleRefresh(): void {
    if (this.destroyed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { void this.refresh(); }, this.options.debounceMs ?? 150);
  }

  async refresh(): Promise<void> {
    this.controller?.abort();
    const revision = ++this.revision;
    if (this.destroyed || !this.viewer) return;
    const viewer = this.viewer;
    if (viewer.scene.mode !== SceneMode.SCENE3D) return;
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    if (!rectangle || viewer.canvas.clientWidth <= 0 || viewer.canvas.clientHeight <= 0) return;
    const west = degrees(rectangle.west), east = degrees(rectangle.east);
    const south = degrees(rectangle.south), north = degrees(rectangle.north);
    const boxes: Array<[number, number, number, number]> = west <= east
      ? [[west, south, east, north]] : [[west, south, 180, north], [-180, south, east, north]];
    const resolution = viewResolution(viewer, west <= east ? east - west : 360 - west + east);
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
        const g = result.batch.geometry;
        if (g) coordinates += g.ringOffsets[g.polygonOffsets[g.geometryOffsets[index + 1]!]!]! - g.ringOffsets[g.polygonOffsets[g.geometryOffsets[index]!]!]!;
      }
      if (coordinates > (this.options.maxCoordinates ?? 1_000_000)) throw new Error('COGP coordinate budget exceeded');
      const entities: Entity[] = [];
      for (const [rowIndex, { result, index }] of selected) {
        const geometry = result.batch.geometry;
        if (!geometry) continue;
        const properties = Object.fromEntries(Object.entries(result.batch.columns).map(([key, values]) => [key, values[index]]));
        const style = typeof this.options.style === 'function' ? this.options.style(properties, rowIndex) : this.options.style;
        entities.push(...geometryEntities(handle.id, rowIndex, decodeGeometry(geometry, index), properties, style, this.options.heightMode === 'absolute'));
        if (entities.length > (this.options.maxEntities ?? 20_000)) throw new Error('COGP entity budget exceeded');
      }
      if (this.destroyed || revision !== this.revision || controller.signal.aborted) return;
      const collection = this.dataSource.entities;
      collection.suspendEvents();
      try {
        const remaining = new Set(collection.values.map(entity => entity.id));
        for (const entity of entities) {
          remaining.delete(entity.id);
          const existing = collection.getById(entity.id);
          if (!existing) collection.add(entity);
          else {
            existing.position = entity.position; existing.properties = entity.properties;
            existing.point = entity.point; existing.polyline = entity.polyline; existing.polygon = entity.polygon;
          }
        }
        for (const id of remaining) collection.removeById(id);
      } finally { collection.resumeEvents(); }
      viewer.scene.requestRender();
      this.options.onLoad?.({ rows: selected.length, entities: entities.length, level, requestedLevel, truncated });
    } catch (error) {
      if (!this.destroyed && revision === this.revision && !controller.signal.aborted) this.options.onError?.(error);
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true; this.detach();
    this.opening?.abort();
    this.dataSource.entities.removeAll();
    if (this.ownsClient) this.client.dispose();
    await this.datasetPromise?.then(handle => handle.close()).catch(() => undefined);
  }

  private dataset(): Promise<CogpDatasetHandle> {
    if (this.destroyed) return Promise.reject(new Error('COGP Cesium layer is destroyed'));
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

function degrees(value: number): number { return value * 180 / Math.PI; }

function viewResolution(viewer: Viewer, width: number): number {
  const estimates = [Math.max(width / viewer.canvas.clientWidth, 1e-9)];
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const x = viewer.canvas.clientWidth / 2, y = viewer.canvas.clientHeight / 2;
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const a = viewer.camera.pickEllipsoid(new Cartesian2(x, y), ellipsoid);
    const b = viewer.camera.pickEllipsoid(new Cartesian2(x + dx!, y + dy!), ellipsoid);
    if (!a || !b) continue;
    const ca = ellipsoid.cartesianToCartographic(a), cb = ellipsoid.cartesianToCartographic(b);
    const longitude = Math.abs(degrees(ca.longitude - cb.longitude));
    const increment = Math.max(Math.min(longitude, 360 - longitude), Math.abs(degrees(ca.latitude - cb.latitude)));
    if (increment > 0 && Number.isFinite(increment)) estimates.push(increment);
  }
  return Math.max(1e-9, Math.min(...estimates));
}
