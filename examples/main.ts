import { createCogpClient } from 'ysgis-cogp-core/runtime';

const params = new URL(location.href).searchParams;
const selector = document.querySelector<HTMLSelectElement>('#engine')!;
const dataset = document.querySelector<HTMLSelectElement>('#data')!;
const status = document.querySelector<HTMLElement>('#status')!;
const container = document.querySelector<HTMLElement>('#map')!;
for (const select of [selector, dataset]) {
  const value = params.get(select.id);
  if (value && Array.from(select.options).some(option => option.value === value)) select.value = value;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    url.searchParams.set(select.id, select.value);
    location.href = url.href;
  });
}
const diagnostics = { loaded: false, errors: [] as string[], rows: 0, largestTile: 0, level: -1, requestedLevel: -1, truncated: false };
Object.assign(window, { cogpExample: diagnostics });
const onError = (error: unknown): void => {
  diagnostics.errors.push(String(error));
  status.title = String(error);
  status.textContent = '加载失败';
};
const pois = dataset.value === 'pois';
const onLoad = (rows?: number): void => {
  diagnostics.loaded = true;
  diagnostics.rows = rows ?? 0;
  if (!diagnostics.errors.length) {
    status.textContent = rows === undefined ? '已加载' : `${rows.toLocaleString('zh-CN')} ${pois ? '点' : '要素'}`;
  }
};
function onViewportLoad({ rows, level, requestedLevel, truncated }: { rows: number; level: number; requestedLevel: number; truncated: boolean }) {
  Object.assign(diagnostics, { level, requestedLevel, truncated });
  if (pois) status.title = `LoD ${level + 1} / ${requestedLevel + 1}${truncated ? '（已截断）' : ''}`;
  onLoad(rows);
}
const url = new URL(pois ? '/data/pois.cogp.parquet' : '/fixtures/refinement.parquet', location.href).href;
const center: [number, number] = pois ? [-98, 39] : [0, 0];
const viewport = { lng: center[0], lat: center[1], alt: pois ? 4_500_000 : 8_000_000, pitch: -90 };
const color = '#df371f';
const groundColor = '#e1e5e8';
const layerName = pois ? 'pois' : 'lines';
const client = createCogpClient();
Object.assign(window, { cogpClient: client });
const onPageHide = (dispose: () => void) => window.addEventListener('pagehide', () => {
  try { dispose(); } finally { client.dispose(); }
}, { once: true });
const options = { url, client, properties: {}, useOverview: pois, onError };

async function start() {
  if (selector.value === 'maplibre') {
    const maplibre = await import('maplibre-gl');
    await import('maplibre-gl/dist/maplibre-gl.css');
    const { default: workerUrl } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
    maplibre.setWorkerUrl(workerUrl);
    const { cogpUrl, registerCogpProtocol } = await import('ysgis-cogp-maplibre');
    registerCogpProtocol(maplibre);
    const source = { source: 'sample', 'source-layer': layerName };
    const map = new maplibre.Map({
      container, center, zoom: pois ? 3 : 1,
      style: {
        version: 8,
        sources: { sample: { type: 'vector', maxzoom: 24, tiles: [cogpUrl({ [layerName]: { url, properties: {} } })] } },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': groundColor } },
          pois
            ? { id: layerName, ...source, type: 'circle', paint: { 'circle-color': color, 'circle-radius': 2.5 } }
            : { id: layerName, ...source, type: 'line', paint: { 'line-color': color, 'line-width': 5 } },
        ],
      },
    });
    map.on('error', event => onError(event.error));
    map.once('idle', () => { if (!diagnostics.errors.length) onLoad(); });
    Object.assign(window, { cogpMap: map });
    onPageHide(() => map.remove());
  } else if (selector.value === 'mars3d') {
    Object.assign(globalThis, { CESIUM_BASE_URL: '/mars3d-cesium/' });
    await import('mars3d-cesium/Build/Cesium/Widgets/widgets.css');
    await import('mars3d/mars3d.css');
    const mars3d = await import('mars3d');
    const { CogpMars3dLayer } = await import('ysgis-cogp-mars3d');
    const map = new mars3d.Map('map', {
      basemaps: [], terrain: { show: false },
      scene: { center: viewport, skyBox: false, skyAtmosphere: false, requestRenderMode: true },
    });
    map.scene.globe.baseColor = mars3d.Cesium.Color.fromCssColorString(groundColor);
    const layer = new CogpMars3dLayer({
      ...options, maxRows: pois ? 15_000 : 1000,
      style: { lineColor: color, lineWidth: 5, pointColor: color, pointSize: 5 }, onLoad: onViewportLoad,
    });
    Object.assign(window, { cogpLayer: layer, cogpMap: map });
    onPageHide(() => { void layer.destroy(); map.destroy(); });
    await layer.attach(map);
  } else if (selector.value === 'cesium') {
    Object.assign(globalThis, { CESIUM_BASE_URL: '/cesium/' });
    const Cesium = await import('cesium');
    await import('cesium/Build/Cesium/Widgets/widgets.css');
    const { CogpCesiumLayer } = await import('ysgis-cogp-cesium');
    const viewer = new Cesium.Viewer('map', {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false,
      homeButton: false, sceneModePicker: false, navigationHelpButton: false,
      fullscreenButton: false, baseLayer: false, skyBox: false, skyAtmosphere: false,
      requestRenderMode: true,
    });
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString(groundColor);
    viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(viewport.lng, viewport.lat, viewport.alt) });
    const renderColor = Cesium.Color.fromCssColorString(color);
    const layer = new CogpCesiumLayer({
      ...options, maxRows: pois ? 15_000 : 1000,
      style: { lineColor: renderColor, lineWidth: 5, pointColor: renderColor, pointSize: 5 }, onLoad: onViewportLoad,
    });
    Object.assign(window, { cogpLayer: layer, cogpMap: viewer });
    onPageHide(() => { void layer.destroy(); viewer.destroy(); });
    await layer.attach(viewer);
  } else {
    const [{ default: Map }, { default: View }, { default: VectorTileLayer }, { fromLonLat }, styles, { CogpVectorTileSource }] = await Promise.all([
      import('ol/Map.js'), import('ol/View.js'), import('ol/layer/VectorTile.js'), import('ol/proj.js'),
      import('ol/style.js'), import('ysgis-cogp-openlayers'),
    ]);
    await import('ol/ol.css');
    const source = new CogpVectorTileSource({
      ...options, layerName,
      onTileLoad({ level, features, truncated }) {
        if (features > diagnostics.largestTile) {
          diagnostics.largestTile = features;
          diagnostics.level = level;
        }
        diagnostics.truncated ||= truncated;
        if (features > 0) onLoad();
      },
    });
    const style = pois
      ? new styles.Style({ image: new styles.Circle({ radius: 2.5, fill: new styles.Fill({ color }) }) })
      : new styles.Style({ stroke: new styles.Stroke({ color, width: 5 }) });
    const layer = new VectorTileLayer({ source, style });
    const map = new Map({ target: container, layers: [layer], view: new View({ center: fromLonLat(center), zoom: pois ? 4 : 2 }) });
    Object.assign(window, { cogpLayer: layer, cogpMap: map });
    onPageHide(() => { map.dispose(); source.dispose(); });
  }
}
void start().catch(onError);
