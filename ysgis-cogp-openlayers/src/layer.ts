import VectorTileLayer from 'ol/layer/VectorTile.js';
import type { StyleLike } from 'ol/style/Style.js';
import type RenderFeature from 'ol/render/Feature.js';
import { CogpVectorTileSource, type CogpVectorTileSourceOptions } from './source.js';

export interface CogpVectorTileLayerOptions extends CogpVectorTileSourceOptions {
  style?: StyleLike;
}

export function createCogpVectorTileLayer(options: CogpVectorTileLayerOptions): VectorTileLayer<CogpVectorTileSource, RenderFeature> {
  const { style, ...sourceOptions } = options;
  const source = new CogpVectorTileSource(sourceOptions);
  return new VectorTileLayer({ source, style });
}
