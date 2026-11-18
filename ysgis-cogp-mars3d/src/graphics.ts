import * as mars3d from 'mars3d';

type Position = number[];
interface Geometry { type: string; coordinates: unknown }

export interface CogpGraphicRef {
  datasetId: string;
  rowIndex: number;
  partIndex: number;
}

export interface CogpMars3dGraphicStyle {
  pointColor?: string | object;
  pointSize?: number;
  lineColor?: string | object;
  lineWidth?: number;
  fillColor?: string | object;
  outlineColor?: string | object;
  outlineWidth?: number;
}

type Graphic = ReturnType<typeof createPoint> | ReturnType<typeof createLine> | ReturnType<typeof createPolygon>;

export function geometryGraphics(
  datasetId: string,
  rowIndex: number,
  geometry: unknown,
  properties: Record<string, unknown>,
  style: CogpMars3dGraphicStyle = {},
  absolute = false,
): Graphic[] {
  if (!geometry) return [];
  const g = geometry as Geometry;
  const graphics: Graphic[] = [];
  const base = (partIndex: number) => ({
    id: `${datasetId}:${rowIndex}:${partIndex}`,
    attr: { ...properties, _cogp: { datasetId, rowIndex, partIndex } satisfies CogpGraphicRef },
  });
  const point = (position: Position, partIndex: number): void => {
    if (!validPosition(position)) return;
    graphics.push(createPoint({ ...base(partIndex), position }, style, absolute));
  };
  const line = (positions: Position[], partIndex: number): void => {
    const valid = positions.filter(validPosition);
    if (valid.length < 2) return;
    graphics.push(createLine({ ...base(partIndex), positions: valid }, style, absolute));
  };
  const polygon = (rings: Position[][], partIndex: number): void => {
    const valid = rings.map(ring => ring.filter(validPosition)).filter(ring => ring.length >= 3);
    if (!valid[0]) return;
    graphics.push(createPolygon({ ...base(partIndex), positions: valid }, style, absolute));
  };
  switch (g.type) {
    case 'Point': point(g.coordinates as Position, 0); break;
    case 'MultiPoint': (g.coordinates as Position[]).forEach(point); break;
    case 'LineString': line(g.coordinates as Position[], 0); break;
    case 'MultiLineString': (g.coordinates as Position[][]).forEach(line); break;
    case 'Polygon': polygon(g.coordinates as Position[][], 0); break;
    case 'MultiPolygon': (g.coordinates as Position[][][]).forEach(polygon); break;
  }
  return graphics;
}

function validPosition(position: Position): boolean {
  return position.length >= 2 && Number.isFinite(position[0]) && Number.isFinite(position[1]);
}

function positionWithHeight(position: Position, absolute: boolean): number[] {
  return [position[0]!, position[1]!, absolute && Number.isFinite(position[2]) ? position[2]! : 0];
}

function createPoint(
  input: { id: string; attr: Record<string, unknown>; position: Position },
  style: CogpMars3dGraphicStyle,
  absolute: boolean,
): mars3d.graphic.PointEntity {
  return new mars3d.graphic.PointEntity({
    id: input.id,
    position: positionWithHeight(input.position, absolute),
    attr: input.attr,
    style: {
      pixelSize: style.pointSize ?? 6,
      color: style.pointColor ?? '#ffe600',
      clampToGround: !absolute,
      ...(absolute ? {} : { heightReference: mars3d.Cesium.HeightReference.CLAMP_TO_GROUND }),
    },
  });
}

function createLine(
  input: { id: string; attr: Record<string, unknown>; positions: Position[] },
  style: CogpMars3dGraphicStyle,
  absolute: boolean,
): mars3d.graphic.PolylineEntity {
  return new mars3d.graphic.PolylineEntity({
    id: input.id,
    positions: input.positions.map(position => positionWithHeight(position, absolute)),
    attr: input.attr,
    style: {
      width: style.lineWidth ?? 2,
      color: style.lineColor ?? '#00ffff',
      clampToGround: !absolute,
    },
  });
}

function createPolygon(
  input: { id: string; attr: Record<string, unknown>; positions: Position[][] },
  style: CogpMars3dGraphicStyle,
  absolute: boolean,
): mars3d.graphic.PolygonEntity {
  return new mars3d.graphic.PolygonEntity({
    id: input.id,
    positions: input.positions.map(ring => ring.map(position => positionWithHeight(position, absolute))),
    attr: input.attr,
    style: {
      color: style.fillColor ?? '#1976d2',
      opacity: 0.45,
      outline: true,
      outlineColor: style.outlineColor ?? '#ffffff',
      outlineWidth: style.outlineWidth ?? 1,
      clampToGround: !absolute,
      ...(absolute ? { perPositionHeight: true } : {}),
    },
  });
}
