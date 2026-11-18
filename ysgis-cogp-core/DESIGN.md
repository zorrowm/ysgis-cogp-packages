# ysgis-cogp-core 专项设计与实施计划

日期：2026-11-18。状态：MVP 已实现。这个包是 `ysgis-cogp-openlayers` 和 `ysgis-cogp-cesium` 的无引擎公共内核，参考源码为 `D:\学习资料\cloud-optimized-geoparquet\js\packages\reader` 及同级 `maplibre` 的 Worker/瓦片实现。实际 API 以 README/源码声明为准，源码迁移保留原始平铺目录以便比较同步，新增运行时模块单独维护。

## 1. 设计结论

`ysgis-cogp-core` 是 `@cogp/reader` 的替代实现，不是适配层或薄封装。它拥有完整的格式读取代码和跨引擎运行时：

- 从参考 `reader` 包迁移 Parquet/GeoParquet/COGP 读取器、GeoArrow 几何、WKB、MVT、GeoJSON、HTTP Range、page index、range cache、LoD 和 overview 代码。
- 携带并维护参考 Reader 所需的 vendored hyparquet fork；该 fork 的 `onColumnView`、page planning 和声明文件是 COGP overview/page pruning 的内部实现基础。
- 在兼容 Reader API 的基础上增加 DatasetSession、Worker client/runtime、Reader pool、请求调度、取消隔离、统计、传输和 tile/batch 高层接口。
- `ysgis-cogp-openlayers` 与 `ysgis-cogp-cesium` 只依赖 Core，不再依赖或调用 `@cogp/reader`。
- Core 的公开 Reader API 以参考 `@cogp/reader@2.1.4` 为兼容起点；新增运行时 API 放在独立子路径，避免污染格式读取 API。

这会引入底层代码维护责任，但它是用户要求 Core 替换 Reader 后唯一能保证读取行为、运行时和版本治理统一的方案。

## 2. Core 的职责边界

Core 应该回答“如何解析和读取 COGP、如何调度浏览器资源、如何把稳定的批次/瓦片结果交给引擎”，不应知道地图容器、图层、样式或 Cesium/OpenLayers 类型。

### 负责

- URL/请求参数校验和可序列化的 `RequestInit` 规范化。
- `CogpReader.open/fromAsyncBuffer`、`read`、`readRow`、`selectLevel`、`rowGroupEnvelope` 的完整实现和公开兼容 API。
- `inspect`：`geo`、列名、row group 数量、文件字节数、数据 bbox、LoD 和 overview 能力。
- `readBatch`：bbox、CRS 单位/像素分辨率、level、字段投影、overview、行数上限和 AbortSignal。
- `readTile`：XYZ 瓦片 bbox、分辨率、`toMvt` 编码、layer name、属性映射和 ArrayBuffer transfer。
- Reader 缓存、Range/page cache、coalescing buffer、HTTP Range、压缩解码、活动读取限流、请求统计和生命周期释放。
- Worker 与主线程的协议、错误序列化、typed array/ArrayBuffer 转移。

### 不负责

- 坐标重投影；Core 保留 Reader 的主几何 CRS，OpenLayers/Cesium 适配器决定支持的显示 CRS。
- 视口事件、瓦片生命周期、图层样式、Cesium Entity/Primitive、OpenLayers Feature。
- 把 `maxRows` 解释为完整查询或空间均匀抽样。
- 让引擎适配包直接读取 Parquet 私有结构；这些细节只能由 Core 内部实现和测试覆盖。

## 3. 对参考 Reader 的模块承接

| Reader 能力 | Core 使用方式 | 是否复制 |
|---|---|---|
| 参考模块 | Core 承接方式 | 处理原则 |
|---|---|---|
| `reader.ts`、`meta.ts`、`bbox.ts` | 迁移到 Core `reader/` | 保持公开行为，修正包内 import |
| `geometry.ts`、`geoarrow.ts`、`mvt.ts` | 迁移到 Core `encoding/` | 保持列式布局、坐标变换和编码结果 |
| `http-buffer.ts`、`abort.ts`、`coalescing-buffer.ts` | 迁移到 Core `transport/` | 在不改变 Reader 语义的基础上增加策略和统计钩子 |
| `range-cache.ts`、`page-index-cache.ts`、`shared-lru.ts` | 迁移到 Core `cache/` | 保持预算、并发共享、取消和 caller-owned copy 契约 |
| `column-projection.ts`、`overview.ts`、`arrow-ipc.ts` | 迁移到 Core `reader/encoding/` | 保留 nested path、overview schema、Arrow IPC 行为 |
| `vendor/hyparquet` | 原样纳入 Core `vendor/hyparquet` | 保留 fork commit、声明文件、来源和 MIT 许可 |
| `index.ts` | Core 根入口兼容导出 | 公开 API 与参考 Reader 对齐，再增加 Core 类型 |

迁移后的 Core 不得从 `@cogp/reader` 导入任何运行时或类型。参考 Reader 只作为源码和测试基线，Core 必须在独立 checkout、独立 `npm pack` 和无参考包安装的环境中构建。

## 4. 包结构和依赖

```text
ysgis-cogp-core/
  package.json
  tsconfig.json
  README.md
  LICENSE
  THIRD_PARTY_NOTICES.md
  SOURCE_SYNC.md         # 参考 Reader/vendor commit 与迁移差异
  src/
    index.ts              # Reader 兼容导出 + Core 直接 API
    types.ts              # Core 请求/响应/统计/配置
    dataset.ts            # DatasetHandle、同步状态和引用计数
    reader/               # reader.ts、meta、bbox、projection、overview
    encoding/             # geometry、mvt、geojson、geoarrow、arrow-ipc
    transport/            # http、abort、coalescing buffer
    cache/                # range、page-index、shared-lru
    errors.ts             # 可辨识的 CoreError/AbortError
    inspect.ts            # metadata/data bbox 汇总
    query.ts              # readBatch/readRow 参数归一
    tiles.ts              # tileBounds/tileResolution/readTile
    transfer.ts           # GeometryColumn/Batch 的 transfer 编解码
    stats.ts              # Range 与耗时统计
    worker-client.ts      # 主线程 Worker client
    worker-runtime.ts     # Worker 内 Reader pool 和 request dispatcher
    worker-entry.ts       # DedicatedWorkerGlobalScope 入口
  vendor/hyparquet/       # 参考 fork + .d.ts + license
  test/
    core-contract.test.mjs
    tile-query.test.mjs
    transfer.test.mjs
    worker-client.test.mjs
    fixtures/              # 通过仓库测试数据或可控 HTTP server 引用
  bench/
```

建议 package：

```json
{
  "name": "ysgis-cogp-core",
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./runtime": { "types": "./dist/worker-client.d.ts", "import": "./dist/worker-client.js" }
  },
  "files": ["dist", "vendor", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "npm run build && node --test test/*.test.mjs"
  },
  "dependencies": {
    "hyparquet-compressors": "^1.1.1",
    "lineclip": "^2.0.0",
    "@hpcc-js/wasm-zstd": "1.15.0"
  },
  "engines": { "node": ">=18" }
}
```

版本号仅为基于本地参考源码的起始假设，P0 必须用实际 registry/workspace 解析并锁定。Core 不声明 `@cogp/reader` dependency；它必须在没有该包安装时独立构建和运行。Core 的依赖闭包由 `hyparquet-compressors`、`lineclip`、ZSTD 和自带 vendor 组成。

`@hpcc-js/wasm-zstd` 只在需要 ZSTD 的读取路径中初始化；直接 Core 主入口不能在 import 时加载 WASM，也不能因 Node 导入类型而创建 `Worker`。Worker runtime 可以缓存一个 decoder promise，直接读取 API 则允许调用者注入 compressor 或使用惰性 decoder 工厂。

## 5. 直接读取 API

直接 API 用于 Node、Worker 内部、测试和不需要 Core Worker 的小规模场景。

### Reader 兼容层

Core 根入口必须提供参考 Reader 的兼容导出，至少包括：

- `CogpReader` 及 `BboxInput`、`CogpBatch`、`OpenOptions`、`ReadOptions`。
- `GeoMeta`、`GeoColumn`、LoD/overview 类型和 `Bbox`。
- `GeometryColumn`、`GeometryType`、`FeatureSource`、`geometryColumnFromWkb`、`toGeoJSON`。
- `MVT_BUFFER`、`MVT_EXTENT`、`MvtTileOptions`、`toMvt`。
- `toGeoArrow`、`GeoArrowOptions`、`PageIndexCacheOptions`、`RangeCacheOptions`。

兼容目标是“同一输入产生等价结果和错误语义”，不是保证所有未公开内部模块路径都可导入。Core 可增加类型字段，但不能修改已有字段含义。参考 Reader 的测试用例作为迁移门槛；新增 Worker/运行时测试不能替代 Reader 契约测试。

### Core 增强层

Core 专属能力通过主入口中的命名 API 或 `ysgis-cogp-core/runtime` 子路径提供：

```ts
export function openCogp(options: CogpOpenOptions): Promise<CogpDataset>;
export function createCogpClient(options?: CogpClientOptions): CogpClient;
export function tileBounds(z: number, x: number, y: number, options?: TileOptions): Bbox;
export function tileResolution(z: number, y: number, tileSize?: number): number;
```

`CogpDataset` 是直接读取 handle；`CogpClient` 是 Worker runtime 的主线程代理。两者共享 `CogpReadBatchOptions` 和 `CogpReadTileOptions`，返回结果字段命名保持一致。直接读取和 Worker 读取必须通过相同的 core contract tests，避免两个实现逐渐出现不同过滤或 LoD 语义。

```ts
import {
  openCogp,
  inspectCogp,
  readCogpBatch,
  readCogpTile,
  type CogpOpenOptions,
} from 'ysgis-cogp-core';

const dataset = await openCogp({
  url,
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
  rangePolicy: 'allow-full',
});

const info = await dataset.inspect();
const batch = await dataset.readBatch({
  bbox: [139.4, 35.4, 139.6, 35.6],
  resolution: 0.001,
  columns: ['name', 'details.height'],
  useOverview: true,
  maxRows: 10_000,
  signal,
});
const tile = await dataset.readTile({
  layer: { name: 'buildings', properties: { height: 'details.height' } },
  z: 12, x: 3635, y: 1615,
  signal,
});
await dataset.close();
```

### 配置约束

- `url` 必须是绝对 HTTP(S) URL；Core 不接受 `file:` 或隐式相对 URL。
- `requestInit` 只能包含可结构化克隆的值；函数型 fetch、ReadableStream 和 signal 不进入 Worker 消息。直接 API 可允许显式 `fetch` 注入，Worker API 不允许。
- `rangePolicy`：直接 API 默认 `'allow-full'` 以保持 Reader 现有行为；Worker client 默认 `'require'`，适配器可以覆盖。
- `rangeCoalescing`、`pageIndexCache`、`rangeCache`、`byteLength` 原样透传给 Reader，并在 Core 类型中使用 Reader 公开类型或结构兼容类型。
- `columns: undefined` 保持 Reader 默认属性投影；`columns: []` 表示只读几何（若请求了 geometry）；嵌套 struct/map/list 路径保持 Reader 语义。
- `resolution` 传入主几何 CRS 单位/像素；`zoom` 只属于 OpenLayers/瓦片适配器，Core 不把 zoom 当作通用 resolution。
- `maxRows` 是源顺序前缀限制；响应增加 `truncated` 只表示触及 cap，不表示空间查询完整性。

### 返回类型

```ts
export interface CogpDatasetInfo {
  url: string;
  geo: CogpReader['geo'];
  columnNames: string[];
  numRowGroups: number;
  byteLength: number;
  dataBbox: [[number, number], [number, number]] | null;
  hasOverviews: boolean;
}

export interface CogpBatchResult {
  batch: CogpBatch;
  level: number;
  resolution: number;
  truncated: boolean;
  elapsedMs: number;
  network: CogpNetworkStats;
}

export interface CogpTileResult {
  data: ArrayBuffer;
  z: number;
  x: number;
  y: number;
  layerName: string;
  level: number;
  truncated: boolean;
  elapsedMs: number;
  network: CogpNetworkStats;
}

export interface CogpNetworkStats {
  requests: number;
  bytes: number | null;
}
```

`CogpBatch`、`GeometryColumn`、`GeoMeta` 等兼容类型从 Core 主入口导出，便于两个适配包只依赖 Core。它们的定义来自 Core 自有实现；不能通过类型重导出继续暴露 `@cogp/reader` 或 vendor 类型。

## 6. Worker 设计

### 消息

```ts
type WorkerRequest =
  | { id: number; type: 'open'; options: WorkerOpenOptions }
  | { id: number; type: 'inspect'; datasetId: string }
  | { id: number; type: 'readBatch'; datasetId: string; options: ReadBatchOptions }
  | { id: number; type: 'readTile'; datasetId: string; options: ReadTileOptions }
  | { id: number; type: 'readRow'; datasetId: string; rowIndex: number; columns?: string[] }
  | { id: number; type: 'stats'; datasetId?: string }
  | { id: number; type: 'release'; datasetId: string }
  | { id: number; type: 'cancel'; requestId: number };
```

实际消息中 `id` 不需要同时出现在 cancel 的外层与 `requestId` 语义中；实现时选一种固定协议并为每种消息写 discriminated union。示意重点是：取消针对单次请求，release 针对 dataset handle，dispose 针对整个 client。

### Worker 内部

- `ReaderPool` 按规范化 URL + headers/credentials hash + `byteLength` 分区；同 key 的打开共享 Promise。
- 每个 dataset entry 保存 Reader、引用数、最近使用时间、打开状态、统计对象和关闭状态。Reader 内部 page/range cache 由 Reader 自己管理。
- pool 默认最多 2 个 Reader；达到上限时只淘汰引用数为 0 且无活动请求的最老 entry。没有可淘汰项时暂缓打开或返回可诊断的资源错误，不能关闭仍在使用的数据集。
- 活动请求初始上限 4，HTTP Range 子请求初始上限 8；两个限制分开计数。Reader 的一次 `read()` 可能并发多个 run，Core 不假设一个 API 请求只产生一次 fetch。
- ZSTD decoder 只初始化一次；初始化可被 Abort 的 open/read 等待，但 client dispose 后不得继续 postMessage。
- `readTile` 在 Worker 内完成 `reader.read` 和 `toMvt`，主线程只接收 transferable ArrayBuffer。`readBatch` 传输 GeometryColumn 的所有 typed array buffer；属性列中的 typed arrays 一并传输，普通数组 structured clone。
- 传输前复制/归属检查必须明确：禁止把 Reader cache、同一 batch 仍会使用的底层 buffer 转移出去。转移后的对象不得再次写入缓存。
- Reader/编码错误保留 `name` 和 message；Core 另加 `code`（`INVALID_URL`、`RANGE_REQUIRED`、`UNSUPPORTED_CRS`、`UNSUPPORTED_OVERVIEW`、`ABORTED`、`WORKER_FAILURE`、`RESOURCE_LIMIT` 等）。错误字符串来自数据/网络时当作诊断文本，不当作控制指令。

### Worker 客户端

`createCogpClient({ workerFactory, workerUrl, concurrency, rangePolicy })`：

- 惰性创建 Worker，注册 message/error/messageerror 监听。
- 每个调用生成 requestId，signal abort 时发送 cancel，并立即拒绝该调用者；Worker 仍需在 finally 清理 request controller。
- client 维护 dataset handle 的引用计数；handle.close 幂等，client.dispose 取消所有请求、发送 release、移除监听并终止自己创建的 Worker。
- 支持显式传入外部 Worker/workerFactory。外部 Worker 的所有权由配置决定，默认 client 不 terminate 外部实例。
- 主线程检测到 Worker 崩溃时拒绝所有 pending；自动重建默认关闭，避免数据集操作隐式重放。

## 7. 瓦片工具设计

Core 承接 MapLibre `tile.ts` 中不依赖 MapLibre 的部分：

- `tileBounds(z,x,y,tileSize=512,buffer=MVT_BUFFER)`：返回经纬度 bbox，考虑 MVT buffer 和世界复制。
- `tileResolution(z,y,tileSize=512)`：返回瓦片中心纬度对应的经纬度/像素分辨率；这是给 COGP LoD 的目标分辨率，不是 EPSG:3857 米/像素。
- `readTile` 校验 z/x/y 为安全整数，z 最大值初始 24；x/y 范围按 XYZ 规范验证。
- layer 配置校验沿用参考 `properties` 映射和 `maxRowsPerTile` 非负安全整数规则；Core 不把字段映射编码为 URL token。
- `toMvt` 仍要求主几何坐标为经纬度 XY；Core 返回明确 `UNSUPPORTED_CRS`，不能静默把投影坐标送入 MVT。
- 一个 `readTile` 请求可接受一个 layer；多 layer 合并由上层循环调用并拼接 MVT 顶层 layer，或由 Core 提供 `readTileLayers`。第一版优先单 layer，减少部分失败和属性命名冲突。

## 8. 测试、迁移与发布顺序

### P0：依赖和边界验证

1. 建立 pnpm workspace，固定参考 Reader commit、vendor hyparquet commit、依赖版本和 Core 包版本。
2. 建立源码承接清单：逐个迁移 Reader 的 `src/`、vendor JS/d.ts、许可证和测试；明确每个文件的 Core 目标路径。
3. 验证 Core 在没有 `@cogp/reader` 安装时能单独构建；验证 `@hpcc-js/wasm-zstd` 在模块 Worker、Vite 生产 build、CSP 注入和无 WASM 的主入口导入下的行为。
4. 固定 package lock、测试数据来源和第三方 notices；不把 `D:\学习资料` 路径写进源码或 npm 包。

### P1：Reader 兼容内核

1. 迁移并整理 Reader 的读取、transport、cache、geometry、metadata、overview、projection 和编码模块；只修正包内 import，不先做行为重构。
2. 迁移 Reader 全部公开导出和回归测试，确保 `CogpReader`、`toMvt`、`toGeoJSON`、`toGeoArrow` 在 Core 根入口保持兼容。
3. 用上游 `test-data` 和 `reader/test/fixtures` 验证 bbox、LoD、overview、属性投影、空/null 几何、跨层几何变化、`maxRows`、cache、cancel、HTTP Range 和压缩。
4. 通过结构化测试验证 Core 不依赖 `@cogp/reader`，Node import 不创建 Worker、不加载 WASM。

### P2：瓦片编码

1. 从参考 `tile.ts` 移植纯数学和配置校验测试，`renderLayer` 改为 Core 自有 Reader 调用。
2. 校验 PBF 结果的 layer name、MVT extent、属性字符串、裁剪和 source row ID。
3. 测试 200/206、CORS、Range 错误、短读取和统计字节；上游已有重试由 Reader 负责，Core 不重复退避。

### P3：Worker client

1. 固定消息 schema 和 transfer list。
2. 用 mock Worker 测试 requestId、取消、共享打开、共享读取、handle close、client dispose、Worker failure。
3. 用真实浏览器 Worker + 可控 Range server 测试 Core 自有 ZSTD、多个并发 read、读取消费者隔离和 Reader 淘汰。

### P4：适配器接入与发布

依赖顺序是 `ysgis-cogp-core` → `ysgis-cogp-openlayers` / `ysgis-cogp-cesium`。两个适配器不应在 Core 完成前各自复制 Worker 或 Reader 调用。

## 9. 风险与决策

| 风险/决策 | 默认方案 |
|---|---|
| 参考 Reader 未来变化 | Core 维护明确的 source-sync 基线；升级先跑 Core 全部兼容测试和上游 fixtures，再人工审查差异 |
| vendored hyparquet 变化 | Core 固定 fork commit；升级必须同时更新 JS、d.ts、许可证和 page planning/overview 回归测试 |
| Worker 传输 GeometryColumn | 明确所有权和 transfer list；没有必要时不转移普通对象属性 |
| 多引擎共享 Reader | 显式注入同一个 Core client；默认各包各自创建，避免隐式所有权冲突 |
| Range 严格策略 | 低层直接读取默认兼容 Reader；Worker/地图适配器默认严格，可显式覆盖 |
| 依赖重复打包 | Core 的 reader 实现、vendor 和 ZSTD 作为自身运行时；适配器只依赖 Core 和引擎 peer，构建产物检查没有第二份 reader |
| 许可 | Core 保留自身 MIT（如采用）；`THIRD_PARTY_NOTICES.md` 列出参考 Reader、hyparquet fork、ZSTD、lineclip、压缩包和参考算法来源 |

Core 的完成标准是：不安装 `@cogp/reader` 也能独立构建和运行；参考 Reader 的公开 API 与 fixtures 契约通过；直接 API 和 Worker API 语义一致；读取、编码和 runtime 只有一份实现；两个适配器不再有重复读取/Worker 代码；第三方许可证和 source-sync 基线完整。

## 10. 生命周期状态机

### DatasetHandle

```text
new -> opening -> open -> closing -> closed
             \\-> failed
```

- `opening` 允许多个调用共享同一个打开 Promise；首个失败会让所有等待者收到同一诊断错误，失败 entry 不进入缓存。
- `open` 可以并发 inspect/read；每个请求独立拥有 requestId 和 AbortController 引用。
- `closing` 拒绝新请求，等待或取消本 handle 的请求后释放 Reader 引用；`close()` 幂等。
- `closed` 的所有 API 都返回 `CLOSED`，不重新打开、不偷偷创建新 Worker。
- `failed` 只表示本次打开失败；调用者显式重新 open 才能重试，避免错误响应循环。

### CogpClient

`new -> ready -> disposing -> disposed`。`dispose()` 先阻止新请求，再取消 pending、释放 dataset handles、清理监听器/队列，最后按所有权规则终止 Worker。外部注入的 Worker 默认不由 Core 终止。所有状态变更都必须有测试覆盖，不能只依赖 `try/finally` 的约定。
