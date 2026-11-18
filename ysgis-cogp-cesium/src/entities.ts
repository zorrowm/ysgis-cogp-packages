import { Cartesian3, Color, Entity, HeightReference, PolygonHierarchy } from 'cesium';
import type { CogpCesiumStyle } from './layer.js';

type Position = number[];
interface Geometry { type: string; coordinates: unknown }
export interface CogpFeatureRef { datasetId: string; rowIndex: number; partIndex: number }

export function geometryEntities(datasetId: string, rowIndex: number, geometry: unknown, properties: Record<string, unknown>, style: CogpCesiumStyle = {}, absolute = false): Entity[] {
  if (!geometry) return [];
  const g = geometry as Geometry;
  const entities: Entity[] = [];
  const base = (partIndex: number): { id: string; properties: Record<string, unknown> } => ({
    id: `${datasetId}:${rowIndex}:${partIndex}`,
    properties: { ...properties, _cogp: { datasetId, rowIndex, partIndex } satisfies CogpFeatureRef },
  });
  const position = (p: Position): Cartesian3 => Cartesian3.fromDegrees(p[0]!, p[1]!, absolute && Number.isFinite(p[2]) ? p[2]! : 0);
  const point = (p: Position, i: number): void => {
    if (p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    entities.push(new Entity({ ...base(i), position: position(p), point: { color: style.pointColor ?? Color.YELLOW, pixelSize: style.pointSize ?? 6, heightReference: absolute ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND } }));
  };
  const line = (p: Position[], i: number): void => {
    if (p.length < 2) return;
    entities.push(new Entity({ ...base(i), polyline: { positions: p.map(position), width: style.lineWidth ?? 2, material: style.lineColor ?? Color.CYAN, clampToGround: !absolute } }));
  };
  const polygon = (rings: Position[][], i: number): void => {
    const [outer, ...holes] = rings;
    if (!outer || outer.length < 3) return;
    entities.push(new Entity({ ...base(i), polygon: {
      hierarchy: new PolygonHierarchy(outer.map(position), holes.filter(hole => hole.length >= 3).map(hole => new PolygonHierarchy(hole.map(position)))),
      material: style.fillColor ?? Color.DODGERBLUE.withAlpha(0.45),
      outline: true, outlineColor: style.outlineColor ?? Color.WHITE, outlineWidth: style.outlineWidth ?? 1,
      ...(absolute ? { perPositionHeight: true } : { height: 0, heightReference: HeightReference.CLAMP_TO_GROUND }),
    } }));
  };
  if (g.type === 'Point') point(g.coordinates as Position, 0);
  else if (g.type === 'MultiPoint') (g.coordinates as Position[]).forEach(point);
  else if (g.type === 'LineString') line(g.coordinates as Position[], 0);
  else if (g.type === 'MultiLineString') (g.coordinates as Position[][]).forEach(line);
  else if (g.type === 'Polygon') polygon(g.coordinates as Position[][], 0);
  else if (g.type === 'MultiPolygon') (g.coordinates as Position[][][]).forEach(polygon);
  return entities;
}
