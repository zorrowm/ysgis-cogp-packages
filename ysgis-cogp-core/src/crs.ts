import type { GeoMeta } from './meta.js';
import { CogpError } from './errors.js';

export function requireGeographic(geo: GeoMeta, override?: 'OGC:CRS84'): void {
  if (override) return;
  const crs = geo.columns[geo.primary_column]?.crs;
  if (crs === undefined) return; // GeoParquet defaults to OGC:CRS84.
  if (typeof crs === 'string' && /^(?:OGC:CRS84|EPSG:4326)$/i.test(crs)) return;
  if (crs && typeof crs === 'object') {
    const id = (crs as { id?: { authority?: string; code?: string | number } }).id;
    if ((id?.authority?.toUpperCase() === 'EPSG' && String(id.code) === '4326')
      || (id?.authority?.toUpperCase() === 'OGC' && String(id.code).toUpperCase() === 'CRS84')) return;
  }
  throw new CogpError('UNSUPPORTED_CRS', 'Rendering requires longitude/latitude XY (OGC:CRS84 or EPSG:4326); unknown/projected CRS needs an explicit verified override');
}
