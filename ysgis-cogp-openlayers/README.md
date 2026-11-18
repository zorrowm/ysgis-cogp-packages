# ysgis-cogp-openlayers

OpenLayers 10.11 的原生 `VectorTileSource`，使用 Core Worker 按 XYZ 瓦片读取 COGP。

```ts
import VectorTileLayer from 'ol/layer/VectorTile.js';
import { CogpVectorTileSource } from 'ysgis-cogp-openlayers';

const source = new CogpVectorTileSource({
  url: 'https://example.com/buildings.cogp.parquet',
  layerName: 'buildings',
  properties: { height: 'details.height' },
  maxRowsPerTile: 10_000,
  onError: console.error,
});
const layer = new VectorTileLayer({ source, style: buildingStyle });
map.addLayer(layer);
const info = await source.inspect();
const stats = await source.getStats();
// 完整源属性及主几何：source.readRow(feature.getId(), ['geometry', 'name'])
map.removeLayer(layer);
await source.close();
```

也可使用 `createCogpVectorTileLayer({ ...sourceOptions, style })`。style 使用 OpenLayers 原生类型；MVT 属性均为字符串，按数值分级时需转换。`_cogpLayer` 是 MVT 源层属性保留名，应避免同名业务字段。

默认 Web Mercator、512 像素瓦片、zoom 0–24，支持 wrapX；经纬度源坐标由 Core 转为 MVT，OpenLayers 解码为地图坐标。发布的 peer 范围只承诺已验证主版本。

省略 `maxRowsPerTile` 时由文件 LoD 决定瓦片密度；显式限行会按源顺序截断，密集 POI 可能出现瓦片间密度差异。可用 `onTileLoad({ z, x, y, level, features, truncated })` 观察实际 LoD（从 0 开始）、解码要素数（含瓦片缓冲区）和截断状态。

`source.dispose()` 遵循 OpenLayers 原生同步语义，`source.close()` 可等待异步 handle 释放。`refresh()` 取消在途请求、清空渲染缓存，并使用新 Reader 版本重开同一 URL。`client` 可注入多个图层及 Cesium 图层共享；source 不终止注入的 client。`cogperror` 事件携带 error，同时保留原生 tileloadstart/end/error。

可透传 requestInit、rangePolicy、pageIndexCache、rangeCache、version 和 dataProjection。`useOverview: false` 可显式使用主几何。数据必须含有效 geo.lod，输入 CRS 需为经纬度。完整运行示例和浏览器测试在仓库根目录。
