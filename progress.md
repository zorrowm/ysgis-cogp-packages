# 进度记录

## 2026-11-18

- 初始化规划文件。
- 已读取 `using-superpowers`、`xgis-ol-skill`、`planning-with-files`。
- 已盘点仓库：三个目标目录为空，没有工程基线。
- 已读取 MapLibre 参考包、`@cogp/reader` README/核心类型及 COGP LoD 规范。
- 已形成共享 Worker 核心、OpenLayers MVT 瓦片适配、Cesium Entity 批次适配的初稿。
- 已完成 MVP 到增强版的实施路线、测试/性能/兼容性验收项和待确认决策清单。
- 已输出初版 DESIGN.md，随后按用户补充更新为三个公开包和独立 Core；此前两个包 + 非发布 shared 的草案已废弃。
- 用户新增 `ysgis-cogp-core` 后，已将总体方案改为三个公开包；此前 Core 包装 `@cogp/reader` 的中间方案已被替换。
- 已补充 `ysgis-cogp-core/DESIGN.md`，涵盖 Reader 模块映射、直接 API、Worker 协议、Reader pool、transfer、测试迁移、许可和发布顺序。
- 用户进一步明确 Core 必须替换 `@cogp/reader`；已改为 Core 自带完整 reader、vendor、编码和 runtime，不再依赖或包装 `@cogp/reader`。
- 已补充 Reader 源码迁移、公开 API 兼容、source-sync 基线、第三方许可和无参考包独立构建要求。
- 已进一步收敛四层职责、不变量、Core 生命周期状态机和 Core/Worker 双 API 边界。
- 已核实上游 HTTP 200 回退、缓存预算、MIT 许可、CRS 默认/未知的区别及 MVT 属性字符串限制。
- 已核实 Reader vendor hyparquet 的 fork commit、公开 index 导出、fixtures 测试覆盖和 Core 自有实现不依赖参考包私有路径的边界。
- 设计阶段未创建实现代码；用户随后授权开发，以下记录为实际实现结果。

## 开发实现与验证

- 三包 0.1.0 workspace 已建立，锁定 pnpm 12.18.0、TypeScript 5.9.3、OpenLayers 10.11.0、Cesium 1.147.0。无 @cogp/reader 运行时或类型依赖。
- Core 原始 Reader 与 vendor 保留平铺布局和原算法，新增 dataset/Worker runtime、引用计数、Reader 池、双层并发、transfer、取消、严格 Range、CRS 校验、累计实际字节统计。SOURCE_SYNC.json 记录文件 SHA-256，原始源文件仅 index.ts 改为增加 Core 导出。
- 所有 Reader 测试已恢复并纳入默认测试；fixture 均在本仓库，Mapbox/PBF/Arrow 解码器用于交叉验证。新增真实 HTTP、runtime 共享/关闭、缓存转移、限流、Range 回退、零副作用导入和 CRS 契约测试。
- OpenLayers 原生 tile 加载、投影解码、ID/字符串属性和 dispose 通过测试。Cesium 孔洞/multipart、实体身份保持、重复 attach 和 detach/destroy 清理通过测试。
- pnpm build、pnpm typecheck、pnpm test 全部通过。
- Vite 示例生产构建通过；Playwright 验证真实 Worker、HTTP Range、共享 handle、取消隔离及两引擎可见图像像素，桌面/手机截图位于 artifacts/。
- 三包 tarball 安装到独立目录后，Reader/runtime/适配导出与 TypeScript 声明通过 smoke 验证；未发布 npm。
- 实现边界：Cesium 使用 3D Entity 后端，经纬度源数据；Primitive、自动投影、地形采样、建筑拉伸和 Mars3D 后续按需求推进。未宣称大数据性能/FPS 上限。
- 最终补充：两个适配器使用共享 client 时，销毁期间的待打开请求也会取消；新增对应回归测试通过。最终 tarball 已重新生成并在全新目录安装验证。
- 本地示例服务已启动于 http://127.0.0.1:5173/，HTTP 200 已确认；可切换 OpenLayers/Cesium。未提交 Git commit、未发布 npm。
