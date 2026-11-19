# ysgis-cogp-mars3d

<p><a href="https://www.npmjs.com/package/ysgis-cogp-mars3d"><img src="https://img.shields.io/npm/v/ysgis-cogp-mars3d?color=orange&logo=npm" /></a></p>

> 基于 Mars3D 的 Cloud Optimized GeoParquet 图层适配器，复用 Core Reader/Worker 并渲染到 GraphicLayer。

## 版本记录

- v0.0.1 首个公开版本。

## 安装

```sh
pnpm add ysgis-cogp-mars3d mars3d mars3d-cesium
```

Cloud Optimized GeoParquet rendering for Mars3D. The adapter shares the `ysgis-cogp-core` reader/runtime with the OpenLayers and Cesium packages and renders geographic Point, MultiPoint, LineString, MultiLineString, Polygon, and MultiPolygon rows through a Mars3D `GraphicLayer`.

```ts
import * as mars3d from 'mars3d'
import { CogpMars3dLayer } from 'ysgis-cogp-mars3d'

const map = new mars3d.Map('mars3dContainer', { basemaps: [] })
const layer = new CogpMars3dLayer({ url: '/data/example.parquet' })
await layer.attach(map)
```

The source data must use geographic `OGC:CRS84` coordinates. `heightMode: 'clamp'` is the default and uses Mars3D terrain/model clamping; use `heightMode: 'absolute'` for Z coordinates. Call `detach()` for a temporary map removal and `destroy()` when the layer is no longer needed.

When a viewport exceeds `maxRows` (10,000 by default), the layer tries coarser LoDs before truncating. Use `rowLimitPolicy: 'truncate'` to keep the requested LoD and apply the row limit directly. The `onLoad` callback reports the zero-based `level` and `requestedLevel`, and whether the final result was `truncated`.

The package does not bundle Mars3D. Install `mars3d` and its normal `mars3d-cesium` peer in the application that owns the map.




## 示例

![Openlayers调用](https://zorrowm.github.io/npm/cogp2.png)

![Cesium调用](https://zorrowm.github.io/npm/cogp1.png)
