# Cloud Optimized GeoParquet Core/OpenLayers/Cesium 扩展规划

## Goal

参考 `D:\学习资料\cloud-optimized-geoparquet\js\packages\reader` 与 `maplibre`，实现 `ysgis-cogp-core`、`ysgis-cogp-openlayers` 与 `ysgis-cogp-cesium`，完成读取、运行时、适配器、测试、示例和打包验证。

## Phases

### Phase 1 — 现状与参考实现调查

**Status:** complete

- [x] 盘点当前仓库、包管理器、构建与测试约定
- [x] 读取 maplibre 参考包的目录、公共核心、数据读取与渲染边界
- [x] 确认 COGP 数据格式、浏览器运行时与依赖约束

### Phase 2 — Core 与双引擎架构设计

**Status:** complete

- [x] 提取共享核心层与 OpenLayers/Cesium 适配层
- [x] 设计包目录、公开 API、类型、生命周期和缓存策略
- [x] 设计坐标系、空间过滤、分块加载、样式与错误语义

### Phase 3 — 实施路线与验收标准

**Status:** complete

- [x] 制定 MVP 到增强版的开发顺序
- [x] 制定测试、示例、性能和兼容性验收项
- [x] 输出待确认决策与下一步实现任务

## Next Step

三包 MVP 已实现。使用根目录 README 启动示例；后续仅按业务数据实测结果推进 Primitive、自定义投影、地形高度和 Mars3D 等增强阶段。

### Phase 4 — 新增独立 Core 包设计（用户补充范围）

**Status:** complete

- [x] 核对 Reader 的模块职责、公共导出、vendor 与测试依赖
- [x] 确定 Core 的源码承接方式、主入口与 Worker 子入口、生命周期和兼容策略
- [x] 新增 Core 目录设计文档，更新总体设计、分阶段验收及记录

### Phase 5 — Core 替代 Reader 的整体收敛（用户补充范围）

**Status:** complete

- [x] 将 Core 从 Reader 薄封装调整为完整格式读取内核和跨引擎运行时
- [x] 明确迁移 Reader 源码、vendored hyparquet、公开 API 兼容和 source-sync 基线
- [x] 更新三包依赖、构建顺序、测试矩阵、许可证和生命周期状态机

## Deliverables

### Phase 6 — 实现和验证

**Status:** complete

- [x] 建立三包 workspace，迁移 Reader 源码、vendor 和 fixtures
- [x] 恢复全部 Reader 回归测试和依赖、完善 Core 数据契约
- [x] 完成 Worker Reader 池、调度、传输和取消隔离
- [x] 完成 OpenLayers 瓦片生命周期及 Cesium 视口/几何/资源管理
- [x] 完成浏览器示例、真实 Worker 与引擎集成验证
- [x] 完成三包独立打包安装和文档

- `DESIGN.md`：最终设计、拟定接口、实施阶段、测试矩阵和验收标准。
- `findings.md`：源码调查证据、选型依据和待验证项。
- `progress.md`：本轮操作与验证范围。
- `ysgis-cogp-core/DESIGN.md`：Core 专项架构、API、Worker、测试和发布计划。

## Errors Encountered

| Error | Attempt | Resolution |
|---|---:|---|
| `rg --files` 未返回文件 | 1 | 改用 PowerShell 目录枚举并继续调查 |
| `git -c core.excludesFile=NUL status` 被 Git 拒绝 | 1 | 改用普通只读 `git status --short`；不修改用户 Git 配置 |
| 依赖安装访问用户缓存/全局 store lock 被拒绝 | 多次 | 经工具审批安装，使用项目内 store 并锁定实际 pnpm 版本，常规 build/typecheck/test 已可直接运行 |
| 参考测试依赖外部 Rust fixture 及测试解码器 | 1 | 迁移所有 fixtures 和测试依赖，恢复默认完整测试，未跳过读取回归 |
| Reader 导出名称完全相等断言不允许 Core 新 API | 1 | 保留所有原导出并允许新增 API；记录唯一断言调整 |
| Cesium 生产页面数据提交早于异步绘制完成 | 1 | 浏览器测试轮询真实图像像素而非把 onLoad 当渲染完成，生产测试通过 |
