# ysgis-cogp-core

<p><a href="https://www.npmjs.com/package/ysgis-cogp-core"><img src="https://img.shields.io/npm/v/ysgis-cogp-core?color=orange&logo=npm" /></a></p>

> 独立维护的 Cloud Optimized GeoParquet（COGP）读取内核，为各适配器提供统一 Reader、LoD、缓存及 Worker 运行时。

## 版本记录

- v0.0.1 首个公开版本。

## 安装

```sh
pnpm add ysgis-cogp-core
```

独立维护的 COGP 读取内核，替代 `@cogp/reader`，保留 `CogpReader`、`toGeoJSON`、`toMvt`、`toGeoArrow` 等兼容 API，并提供跨引擎 Worker 会话。

```ts
import { CogpReader, toGeoJSON, openCogp } from 'ysgis-cogp-core';

const reader = await CogpReader.open('https://example.com/data.cogp.parquet');
const batch = await reader.read({ bbox: [100, 20, 110, 30], useOverview: true });
const features = toGeoJSON(batch);

const dataset = await openCogp({ url: 'https://example.com/data.cogp.parquet' });
const result = await dataset.readBatch({ resolution: 0.001, columns: ['name'], maxRows: 1000 });
await dataset.close();
```

低层 `CogpReader.read({ columns })` 保持参考语义：若列清单不包含主几何，批次可以没有 geometry。高层 `readBatch({ columns })` 将列清单视为显示属性，自动加入主几何；`columns: []` 或 `properties: {}` 为仅几何。`properties` 可映射输出名到嵌套字段路径；不能和 columns 同时传入。

```ts
import { createCogpClient } from 'ysgis-cogp-core/runtime';

const client = createCogpClient({ maxReaders: 2, maxConcurrentReads: 4, maxConcurrentRequests: 8 });
const dataset = await client.openDataset({ url: 'https://example.com/data.cogp.parquet' });
const info = await dataset.inspect();
const tile = await dataset.readTile({ layer: { name: 'buildings', properties: {} }, z: 0, x: 0, y: 0 });
const stats = await dataset.getStats();
await dataset.close();
client.dispose();
```

`openDataset(options, signal?)`、`readBatch({signal})`、`readTile({signal})` 和 `readRow(rowIndex, columns?, signal?)` 支持取消。多个 handle 可共享同配置 Reader；关闭一个 handle 只取消它自己的请求。Reader 池满且全部有活跃引用时返回 `RESOURCE_LIMIT`，调用者须释放 handle 或提高 maxReaders。

主入口 import 不创建 Worker、不初始化 WASM、不访问网络；`openCogp` 在打开时惰性加载一次 ZSTD，低层 Reader 使用兼容压缩器，也可注入 `compressors`。Worker 通过 `new Worker(new URL(..., import.meta.url))` 构建，要求 bundler 支持模块 Worker，默认 Vite 生产构建已验证。CSP/特殊宿主可传 `workerFactory` 或 `workerUrl`；工厂创建的 Worker 默认由 client 终止，借用已有 Worker 时配置 `ownsWorker: false`。同一个外部 Worker 只对应一个 client。

Core 直接读取默认 `rangePolicy: 'allow-full'`，Worker 默认 `'require'`。请求参数、缓存预算、数据版本和认证 headers 都参与 Reader 分区；headers/token 不写入公开 dataset ID。自定义 fetch/compressors 仅直接 API 支持，不能通过 Worker 消息传函数。

网络统计是每个 Reader 累计 Range 尝试数及实际经过 fetch 的响应体字节，不是每次读取独占统计；并发调用会共享累计计数。`truncated` 只说明行预算截断，不说明 bbox/LoD 结果是否包含全部业务要素。

普通 GeoParquet、GeometryCollection、自动 CRS 重投影和 SQL 不在当前兼容范围内。`readTile` 要求经纬度 XY；必要时可通过 `dataProjection: 'OGC:CRS84'` 明确覆盖已验证的数据 CRS。
