# ysgis-cogp-cesium

<p><a href="https://www.npmjs.com/package/ysgis-cogp-cesium"><img src="https://img.shields.io/npm/v/ysgis-cogp-cesium?color=orange&logo=npm" /></a></p>

> Cesium 1.147 的视口驱动 COGP 图层，使用 Core Worker 和原生 CustomDataSource/Entity。

## 版本记录

- v0.0.1 首个公开版本。

## 安装

```sh
pnpm add ysgis-cogp-cesium cesium
```

Cesium 1.147 的视口驱动 COGP 图层，使用 Core Worker 和原生 `CustomDataSource/Entity`。

```ts
import { Color } from 'cesium';
import { CogpCesiumLayer } from 'ysgis-cogp-cesium';

const layer = new CogpCesiumLayer({
  url: 'https://example.com/data.cogp.parquet',
  properties: { height: 'details.height' },
  maxRows: 10_000,
  heightMode: 'clamp',
  style: { lineColor: Color.CYAN, fillColor: Color.DODGERBLUE.withAlpha(0.5) },
  onError: console.error,
  onLoad: ({ rows, entities, level, requestedLevel, truncated }) => console.log(rows, entities, level, requestedLevel, truncated),
});
await layer.attach(viewer);
await layer.refresh();
const info = await layer.inspect();
layer.detach(); // 保留 handle，允许随后重新 attach。
await layer.destroy(); // 取消请求、移除监听/实体、释放 handle。
```

支持六类基本/multi 几何和多边形孔洞。`style` 也可传 `(properties, rowIndex) => style` 回调。拾取使用 `viewer.scene.pick`，Entity properties 的 `_cogp` 保存 `{datasetId,rowIndex,partIndex}`；`layer.readRow()` 可获取完整源属性和主几何。

attach 后立即读视口，相机 moveEnd 防抖和 resize 后刷新；新请求取消旧请求，晚到响应不覆盖新画面。旧实体保留到新批次成功后按 ID 更新。跨日期变更线拆 bbox 并按源 rowIndex 去重，合并后应用总行预算。requestRenderMode 会在提交后主动 requestRender。

默认 `heightMode: 'clamp'`，忽略源 Z；`absolute` 使用以米表示的椭球高度，并默认读取主几何以保留 Z，未提供/非有限 Z 按 0 处理。源 CRS 必须是经纬度 XY；自动重投影、相对地形高度、建筑拉伸和 Primitive 后端未列入首版。

默认 maxRows=10,000、maxCoordinates=1,000,000、maxEntities=20,000；超过坐标/实体预算时保留上一幅画面并调用 onError。当前聚焦 3D 模式，2D/Columbus View 暂停读取。`client` 可注入共享，destroy 不终止外部 client。认证、Range 策略与缓存选项同 Core。Cesium 本身的静态 Assets/Workers 需由宿主配置，仓库示例已提供本地资源服务。

行预算默认采用 `rowLimitPolicy: 'coarsen'`：视口超限时尝试较粗的完整 LoD，最粗一级仍超限才截断。设为 `'truncate'` 可保留请求级别并直接限行。`onLoad` 的 `level` 和 `requestedLevel` 均从 0 开始；`truncated` 描述最终结果。




## 示例

![Openlayers调用](https://zorrowm.github.io/npm/cogp2.png)

![Cesium调用](https://zorrowm.github.io/npm/cogp1.png)
