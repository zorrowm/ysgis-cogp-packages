# ysgis-cogp

Cloud Optimized GeoParquet 的 TypeScript 扩展，包含五个独立 ESM 包，当前版本为 0.0.1。

| 包 | 职责 |
|---|---|
| `ysgis-cogp-core` | 自有 COGP Reader、WKB/列式几何、MVT/GeoJSON/GeoArrow、HTTP Range、LoD、缓存、Worker 运行时 |
| `ysgis-cogp-openlayers` | OpenLayers 原生 VectorTileSource 与图层工厂 |
| `ysgis-cogp-cesium` | Cesium 3D 相机视口读取与 CustomDataSource/Entity |
| `ysgis-cogp-mars3d` | Mars3D 3D 相机视口读取与 GraphicLayer/Graphic |
| `ysgis-cogp-maplibre` | MapLibre GL JS COGP 协议与 MVT source adapter |

Core 承接参考 `@cogp/reader` 的实现并独立维护，项目不依赖该 npm 包。参考代码、测试数据及第三方许可证见 `ysgis-cogp-core/SOURCE_SYNC.md` 和 `THIRD_PARTY_NOTICES.md`。

## 发布构建

各包版本统一为 `0.0.1`。`pnpm build` 会先生成 TypeScript 声明，再对 `dist` 下 JavaScript 做压缩和标识符混淆；构建关闭 source map/declaration map，并清理已有 `.map` 文件。

## 开发

```sh
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm dev
```

浏览器打开终端给出的 localhost 地址，可切换 OpenLayers、Cesium、MapLibre 和 Mars3D。默认数据为 [全球 POI GeoParquet](https://cogp-demo.spatialty.io/v2.2.2/pois.cogp.parquet)，按地图视口和缩放级别请求 HTTP Range，不下载整份文件。

数据菜单可切回本地 GeoParquet（`?data=cogp`），无需网络。两套示例均无需 Cesium ion token 或远程底图；须先构建适配包。POI 源站未开放 CORS，Vite 开发和预览服务均提供同源 `/data/pois.cogp.parquet` Range 转发；部署静态产物时也需要配置该路由。使用代理联网时，Node 24.5+ 可设置 `NODE_USE_ENV_PROXY=1`，使转发生效。Core 基础 API 要求 Node >=18。

```sh
pnpm build:examples
pnpm test:browser
pnpm test:browser --pois
pnpm test:packages
```

浏览器测试使用 Playwright，优先检测本机 Chrome/Edge，也支持 `COGP_CHROME` 环境变量指定浏览器；没有本机浏览器时先运行 `pnpm exec playwright install chromium`。默认测试使用本地 GeoParquet；传入 `--pois` 则联网验证默认 POI 示例。截图保存到 `artifacts/`。包测试将 tarball 安装到独立目录，并验证导出、Reader 和 TypeScript 声明。

## 使用边界

- 输入须包含有效 `geo.lod`；普通 GeoParquet 无此扩展时会明确报错。
- Core 的 bbox/resolution 使用数据自身 CRS 单位；MVT、Cesium 和 Mars3D 适配器要求经纬度 XY。省略 GeoParquet CRS 使用规范默认 CRS84，显式 null 是未知 CRS。
- Worker 默认要求 HTTP 206 Range；需要整文件回退时显式配置 `rangePolicy: 'allow-full'`。
- Reader 保持列式原始属性；上游兼容 MVT 编码把属性转成展示字符串，不保存 Z。详情/完整几何使用 `readRow`。
- OpenLayers 和 MapLibre 默认按相同的 512 像素 Web Mercator 瓦片尺度选择 LoD，不截断行。显式设置 `maxRowsPerTile` 会按源顺序截断，可能造成瓦片间密度不一致。
- Cesium 与 Mars3D 默认采用 10,000 行、1,000,000 坐标、20,000 个渲染对象预算。行数超限时，先尝试较粗的完整 LoD，只有最粗一级仍超限或显式指定 `rowLimitPolicy: 'truncate'` 才按源顺序截断。截断不是空间均匀抽样。
