# 调查发现

日期：2026-11-18。最终架构与验收计划见 DESIGN.md；Core 细节见 `ysgis-cogp-core/DESIGN.md`。

## 仓库现状

- 调查初始三个引擎目录为空；现已实现 Core/OpenLayers/Cesium 0.1.0、workspace、锁文件、测试、示例和文档。Mars3D 仍为后续目录。
- 未发现适用的 AGENTS.md；用户已授权按设计开发，验证结果见 progress.md。

## 参考源码结论

- 本地参考包 @cogp/maplibre 和 @cogp/reader 的 package.json 均标记 2.1.4；尚未验证 npm 可用版本。
- MapLibre 适配链路：protocol → Worker → Reader 按 bbox/LoD/字段读取 → toMvt → transferable ArrayBuffer。
- Reader 输出 CogpBatch：rowIndex、GeometryColumn 和属性列；支持六类基本/multi 几何，当前不支持 GeometryCollection。
- LoD 是 CRS 单位/像素对应的累计 row-group 前缀；同一批源行可能因 LoD 改变 overview 几何。
- bbox 是包围盒筛选；maxRows 是源顺序截断，不是空间均匀抽样或完整查询。
- toMvt 输入必须是经纬度 XY，输出丢失 Z，属性均为展示字符串；Cesium 直接使用批次可保留原始属性类型。
- GeometryColumn 的量化坐标需按 offset + scale * coordinate 还原；overview 通常只含 XY，不能据此恢复真实高度。
- Reader 默认每实例 64 MiB page-index + 32 MiB range-cache；参考 MapLibre Worker 最多 8 Reader，配置容量合计约 768 MiB，尚未包括解码和渲染开销。
- Reader 的 HTTP 实现接受 200 整文件回退和 206；已有网络/429/502/503/504 重试。严格 Range 策略是新扩展的显式选择，不能误写成上游现有行为。
- 上游代码 MIT 许可；复制或改写参考实现需保留版权和许可说明。

## 北美 POI 密度复测

- 上游 MapLibre 示例使用 512 CSS px XYZ 瓦片做 LoD 选择，未设置每瓦片的行数上限。当前 POI 文件在 LoD 4 的 `3/1/2`、`3/1/3` 含 4,179、4,026 行，旧的 2,500 行示例配置让完整瓦片丢失部分覆盖。
- 1280 × 800 测试视口下，Cesium 请求 LoD 5，完整查询返回 27,282 行，旧示例也只渲染 2,500 行。回退到完整 LoD 4 后，Cesium 与 Mars3D 都渲染 8,487 行。截图中的不同底图、符号样式和视口范围未作为数据数量的直接对照。

## 最终推荐

- 三个公开包：`ysgis-cogp-core`、`ysgis-cogp-openlayers`、`ysgis-cogp-cesium`；Core 完整替换 `@cogp/reader`，自带 Reader 读取源码、vendored hyparquet、编码、Worker 和 runtime。
- Core 提供兼容 Reader API、惰性 client、Reader handle/pool、请求队列、取消、tile/batch/readRow、统计与释放；两个适配器只依赖 Core 和各自引擎。
- OpenLayers：CogpVectorTileSource + 原生 VectorTileLayer/MVT；一个 source 对应一个逻辑文件，多文件先由 LayerGroup 组合。
- Cesium：CogpCesiumLayer 控制 CustomDataSource/Entity；相机视口读取、跨日期变更线拆分/去重、稳定源行 ID 与 part ID、按 revision 提交。
- 首版要求经纬度 XY；GeoParquet 省略 CRS 按规范默认 CRS84，显式 null 为未知。非默认/未知 CRS 不静默猜测。
- 首版原生引擎适配，不引入 xgis-ol、Vue、Quasar、Mars3D 依赖；xgis-ol-skill 中业务项目封装规则不适用于本独立库。
- 初始建议每 client 并发读取 4、最多 2 Reader；Cesium 行预算 10,000 并另外保护实体/坐标转换预算，均需实测校准。

## 已知限制和待验证

- 已验证 TypeScript 5.9.3、OpenLayers 10.11.0、Cesium 1.147.0、模块 Worker/WASM 生产布局；Core 自有读取器以参考 2.1.4 为兼容基线。
- 参考 `@cogp/reader` 的公开 index 暴露 CogpReader、CogpBatch、GeometryColumn、toMvt、toGeoJSON、toGeoArrow 和 metadata/cache 类型；Core 以此确定兼容 API，但实现迁移到 Core 自有模块，不保留对参考包私有路径的依赖。
- `vendor/hyparquet` 是 fork commit `9365a88f34a0816b9a77e08c176ca0c480d3524c`，提供 Reader 所需的 `onColumnView`/page planning；Core 必须携带并维护这一 fork，不能依赖 `@cogp/reader` 间接提供。
- Reader fixtures 覆盖 HTTP range、coalescing、range/page cache、LoD/overview、字段投影、并发取消、MVT/GeoArrow；Core 必须迁移 Reader 格式读取测试，并新增 runtime/transfer 测试。
- OL 是否可仅通过公共 API 完整取消离屏 tile 必须验证，不假设其自带 MapLibre 式 AbortSignal。
- Cesium 倾斜、高纬度、视口不交地球、requestRenderMode 和 LoD 几何更新均列入浏览器验收。
- 完整功能测试、生产页面、截图像素与 tarball 安装测试已执行；性能指标仍需指定业务数据、硬件与网络后实测。
- Core 替换 Reader 后需要维护源码同步基线：记录参考 Reader commit、vendor hyparquet commit、迁移文件清单和每次同步差异；不能只复制一次后失去来源追踪。
- Core 的格式读取 API 与 Worker runtime API 必须分层测试：前者验证与 `@cogp/reader` 的兼容结果，后者验证请求所有权、取消和传输，不能用 Worker mock 替代真实读取回归。
