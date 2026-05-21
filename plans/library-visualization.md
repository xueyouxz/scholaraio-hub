# Plan: Library 可视化页面

> 来源：对话讨论（可视化设计审查 + grill-me 会话）

## 架构决策

贯穿所有阶段的持久决策，不随实现变动：

- **路由**：`/library` 保持为可视化分析页；`/search` 扩展为包含全量论文浏览列表；`/library/:paperId` 论文阅读器不变。
- **预计算存储**：所有重计算产物写入磁盘，路径由 `Config` 属性派生：
  - `topics overview` → `data/state/topics/overview.json`
  - `UMAP 投影` → `data/state/projection/projection.json`
- **新鲜度检测**：投影文件头部存储 `vectorCount`，与 `COUNT(paper_vectors)` 对比判断是否过时，无需时间戳。
- **触发方式**：重计算通过现有 `POST /api/v1/jobs` 提交（新增 `project` job kind），前端轮询 job events 等待完成，不新增私有端点。
- **前端图表技术栈**：D3（scatter/histogram 的数学 + 交互工具）+ Canvas 2D（scatter 渲染）+ SVG-in-React（histogram）+ 纯 React+Tailwind（sidebar bar chart、stat mini-chart）。
- **联动状态**：`yearRange`、`activeTopicId`、`selectedPaperId` 三个状态提升至 `LibraryPage` 顶层；`activeIds: Set<string> | null` 由 `useMemo` 派生，`null` 表示全量激活。
- **保留组件**：`PaperVirtualList`、`PaperListRow`、`PaperGridCard`、`PaperDetailPanel`、`StatCard` 原始代码全部保留，仅做必要扩展。
- **两个仓库**：后端变更位于 `~/scholaraio/`，前端变更位于 `~/Projects/JavaScript/scholaraio-hub/`。

---

## Phase 1：主题端点打通

**覆盖用户场景**：用户打开 Library 页面，左侧主题柱状图能展示当前文献库的 BERTopic 主题分布；主题模型未构建时显示空态引导。

### 需要构建的内容

在 `scholaraio` 后端的 `build_topics()` 完成后，额外写出一份轻量 `overview.json`，包含每个主题的 id、关键词、论文数；`serve.py` 新增 `GET /api/v1/analytics/topics` 端点，只读该文件（不加载 BERTopic pickle），未构建时返回 `{built: false, topics: []}`。

前端同步新增 `scholar.getTopics()` API 方法、对应 query key、以及 `TopicSidebar` 组件骨架（包含完整空态 UI）。此阶段 `TopicSidebar` 仅展示数据，尚未与散点图联动。

### 验收标准

- [ ] `POST /api/v1/jobs {kind: "topics"}` 完成后，`data/state/topics/overview.json` 存在且包含 `topicCount`、`topics[]`、`computedAt` 字段
- [ ] `GET /api/v1/analytics/topics` 在 overview.json 存在时返回 `{built: true, topics: [...]}`，不存在时返回 `{built: false, topics: []}`，响应时间 < 20ms
- [ ] 前端 `TopicSidebar` 在 topics 存在时渲染横向柱状图（topic label + 比例条 + 论文数）
- [ ] `TopicSidebar` 在 `built: false` 时渲染空态卡片，包含"构建主题模型"的操作引导文案
- [ ] **后端测试**（`scholaraio/tests/test_serve_analytics.py`）：`test_topics_endpoint_returns_empty_when_no_overview`、`test_topics_endpoint_reads_overview_json`
- [ ] **前端测试**（`paperUtils.test.ts` 旁新建文件）：`TopicSidebar` 在 built=false / built=true 两种 props 下的渲染快照测试

---

## Phase 2：UMAP 投影预计算管道

**覆盖用户场景**：用户可通过 Jobs 触发 UMAP 投影计算；计算完成后散点图端点返回坐标数据；重新入库论文后投影能检测到过时状态。

### 需要构建的内容

在 `scholaraio` 中新建 `services/projection.py`，实现 `build_projection(index_db, output_path, rebuild=False)`：读取 `paper_vectors` 表，运行 UMAP（n_components=2），将坐标写入 `projection.json`（含 `vectorCount` 指纹）。

`jobs.py` 的 `default_handlers()` 追加 `project` handler，调用 `build_projection()`，与现有 `index`/`embed` handler 模式完全一致。

`Config` 新增 `projection_path` 属性（路径：`data/state/projection/projection.json`）。

`serve.py` 新增 `GET /api/v1/analytics/projection`：读 JSON 文件，对比当前 `COUNT(paper_vectors)` 与文件头 `vectorCount`，返回 `{built, stale, vectorCount, points}`。未构建时返回 `{built: false, stale: false, points: []}`。

前端新增 `scholar.getProjection()` 方法与 query key。

### 验收标准

- [ ] `POST /api/v1/jobs {kind: "project"}` 成功触发，job status 最终为 `completed`，`projection.json` 写入磁盘
- [ ] `GET /api/v1/analytics/projection` 在投影存在且向量数未变时返回 `{built: true, stale: false, points: [...]}`
- [ ] 向 `paper_vectors` 新增一条记录后，`GET /api/v1/analytics/projection` 返回 `{stale: true}`（points 返回空或旧数据）
- [ ] `points` 数组每条记录包含 `{id, x, y, topicId, year, title}` 字段
- [ ] 端点响应时间 < 50ms（纯文件读取，不触发 UMAP 计算）
- [ ] **后端测试**（`test_serve_analytics.py`）：`test_projection_endpoint_returns_empty_when_not_built`、`test_projection_endpoint_detects_staleness`、`test_project_job_produces_valid_output`
- [ ] **服务层测试**（`test_projection.py`）：`test_build_projection_writes_correct_shape`、`test_vector_count_fingerprint_matches`

---

## Phase 3：Stat Cards 重构 + D3 安装

**覆盖用户场景**：Library 页面顶部 4 张卡片，第 1 张突出显示总论文数，第 2/3 张内嵌迷你横向柱状图展示文献类型和来源分布，第 4 张展示健康指标。

### 需要构建的内容

安装 `d3` + `@types/d3` 依赖。在 `paperUtils.ts` 新增三个纯函数：`buildYearCounts`（年份聚合）、`buildTypeDist`（文献类型聚合）、`buildSourceDist`（来源聚合 + `abbreviateSource` 简写映射）。

重构 `StatCard` 组件：新增可选 `miniChart` prop，类型为横向柱状图数据，使用 `d3.scaleLinear` 计算比例，React 渲染 SVG bars。卡片 1 的 `font-mono text-3xl` 总数保持不变；卡片 4 展示 `missingPdf`、`notIndexed` 等健康指标数字。

### 验收标准

- [ ] `abbreviateSource("IEEE Transactions on Visualization and Computer Graphics")` → `"IEEE TVCG"`，覆盖实测 Top 6 期刊简写
- [ ] `buildTypeDist` 正确聚合 `paperType` 字段，未知类型归入 `"other"`
- [ ] StatCard 在传入 `miniChart` 数据时渲染可见的比例条；无数据时渲染骨架占位
- [ ] 4 张卡片总高度不超过当前高度（不增大页面顶部占用空间）
- [ ] **前端测试**：`abbreviateSource` 的全部简写映射、`buildTypeDist`、`buildSourceDist` 的边界情况（空库、单类型、字段为空字符串）
- [ ] `pnpm typecheck` 通过

---

## Phase 4：YearHistogram（SVG + D3 brush）

**覆盖用户场景**：Library 页面右侧上方显示年份分布柱状图，用户可拖拽刷选年份区间，散点图（尚未实现）预留接收过滤状态的接口。

### 需要构建的内容

新建 `components/charts/YearHistogram.tsx`：React 渲染 SVG `<rect>` 柱子，`d3-brush` imperatively 挂载到 SVG overlay group。接收 `yearCounts`、`yearRange`、`onBrush`、`width`、`height` 5 个 props。

新建 `hooks/useChartSize.ts`：`ResizeObserver` 监听容器 ref，返回 `{width, height}`，供所有图表组件使用。

刷选结束时（`brush.on("end")`）调用 `onBrush([y0, y1])`；`yearRange` 为 null 时柱子全部为 `fill-primary`，刷选时非区间内柱子变为 `fill-primary/20`。

### 验收标准

- [ ] 柱状图正确渲染当前文献库的年份分布（2021–2026 各年柱高与实际论文数成比例）
- [ ] 拖拽选定 2022–2023 区间后 `onBrush([2022, 2023])` 被调用，区间外柱子变暗
- [ ] 调用 `onBrush(null)`（清除过滤）后柱子全部恢复
- [ ] 容器宽度变化时图表自适应（`useChartSize` 驱动重渲染）
- [ ] **前端测试**（vitest）：`useChartSize` hook 正确响应 `ResizeObserver`；`YearHistogram` 在指定 yearRange 下渲染正确数量的高亮/暗淡柱子

---

## Phase 5：ScatterPlot（Canvas + D3 zoom/quadtree）

**覆盖用户场景**：Library 页面主视图展示 UMAP 散点图，点以主题颜色着色；向量未构建时回退展示年份分布柱状图作为主视图；用户可平移缩放，hover 显示论文标题 tooltip，点击打开 `PaperDetailPanel`。

### 需要构建的内容

新建 `utils/topicColors.ts`：`buildTopicColors(topicIds)` 基于自定义调色板（锚定设计系统绿色系）生成 `Map<number, string>`，topic -1（outlier）固定为 `#bfc9c0`。

新建 `components/charts/ScatterPlot.tsx`：单 Canvas 三遍绘制（非激活点低透明 → 激活点全透明 → 选中外圈）；`d3.zoom()` 管理平移缩放，transform 存 `useRef` 不触发 React re-render；`d3.quadtree()` 做 O(log n) hover 点检测；`devicePixelRatio` 适配 Retina。

投影 `built: false` 时，`ScatterPlot` 位置改由 `YearHistogram` 占据（作为主视图回退）。

### 验收标准

- [ ] 1044 个点全量渲染，帧时间 < 5ms（Chrome DevTools Performance 验证）
- [ ] 鼠标移动到半径 12px 内的点时，对应点高亮并显示标题 tooltip
- [ ] 点击后 `onPointClick(id)` 被调用，选中点有绿色外圈
- [ ] 双指/滚轮缩放后，坐标系正确更新，quadtree 随 scale 重建，hover 检测仍准确
- [ ] `built: false` 时整个区域显示 YearHistogram 而非空白
- [ ] **前端测试**：`buildTopicColors` 颜色映射正确性（outlier 颜色、topic 0 颜色）；`quadtree.find` 在已知坐标集上的点检测精度

---

## Phase 6：Library 页面集成 + 三向联动

**覆盖用户场景**：Library 页面完整运行——刷选年份直方图过滤散点图点；点击主题柱状图高亮对应聚类；点击散点图点打开 `PaperDetailPanel`；投影过时时显示提示条和一键触发重新计算按钮。

### 需要构建的内容

新建 `LibraryAnalyticsPanel.tsx`：接收所有查询数据，维护 `yearRange`、`activeTopicId`、`selectedPaperId` 三个状态，`useMemo` 派生 `activeIds`，将回调向下传递给 `TopicSidebar`、`YearHistogram`、`ScatterPlot`。

重组 `LibraryPage.tsx`：顶部 4 张 StatCard → 下方 `LibraryAnalyticsPanel`（左栏 `TopicSidebar` + 右栏 `ProjectionPanel`）→ `PaperDetailPanel`。

投影 `stale: true` 时在右侧上方显示一条提示 banner（设计系统 tertiary 色系），包含"有新论文未计入投影"文案和"重新计算"按钮（触发 `POST /api/v1/jobs {kind: "project"}`）；按钮点击后转为 loading 状态并轮询 job 完成。

### 验收标准

- [ ] 刷选年份 2022–2024 后，散点图中其余年份点变暗，主题柱状图各 bar 宽度随激活论文数变化
- [ ] 点击 TopicSidebar 某主题后，散点图仅高亮该主题的点，再次点击取消过滤
- [ ] 两个过滤条件同时生效时（特定年份 + 特定主题），`activeIds` 正确取交集
- [ ] 点击散点图点，`PaperDetailPanel` 从右侧滑出，展示正确论文信息
- [ ] 投影 `stale: true` 时显示 banner；点击"重新计算"后 banner 转 loading，job 完成后散点图刷新
- [ ] **前端测试**（vitest）：`activeIds` 派生逻辑的单元测试（全激活/年份过滤/主题过滤/双过滤四种情况）

---

## Phase 7：论文列表迁移至 Search 页面

**覆盖用户场景**：用户在 Search 页面除了搜索结果外，还可以在未输入搜索词时浏览全量论文列表（含排序、列表/网格切换），与原 Library 列表功能完全一致。

### 需要构建的内容

扩展 `SearchPage.tsx`：当搜索框为空时，显示"全量浏览"模式——复用 `PaperVirtualList`（列表模式）和 `PaperGridCard`（网格模式）组件，保留排序下拉菜单和视图切换按钮；有搜索词时切换为当前搜索结果视图。

`LibraryPage.tsx` 移除 `PaperVirtualList`、`PaperGridCard`、排序工具栏、视图切换按钮等论文浏览相关代码，但**不删除对应组件文件**（`PaperVirtualList.tsx`、`PaperListRow.tsx`、`PaperGridCard.tsx` 均保留）。

### 验收标准

- [ ] 进入 `/search` 页面（无搜索词）时，显示全量论文列表，排序/视图切换功能与原 Library 列表一致
- [ ] 在搜索框输入关键词后，切换为搜索结果视图（现有行为不变）
- [ ] 清空搜索词后，回到全量浏览模式
- [ ] `/library` 不再渲染任何论文列表 UI，仅保留可视化分析视图
- [ ] `PaperVirtualList.tsx`、`PaperListRow.tsx`、`PaperGridCard.tsx` 文件存在且内容不变
- [ ] `pnpm typecheck` 通过，`pnpm test` 全量通过
- [ ] **前端测试**：SearchPage 在 `query=""` 时渲染论文列表，`query="deep learning"` 时渲染搜索结果

---

## 实施顺序说明

```
Phase 1 (topics 端点)  ──┐
Phase 2 (投影管道)    ──┤── Phase 6 (页面集成) ── Phase 7 (列表迁移)
Phase 3 (stat cards)  ──┤
Phase 4 (histogram)   ──┤
Phase 5 (scatter)     ──┘
```

Phase 1–5 之间无硬性依赖，可并行推进；Phase 6 需要 1–5 全部完成；Phase 7 与 1–6 完全独立，可在任意阶段进行。

建议执行顺序：**Phase 3 → Phase 1 → Phase 2 → Phase 4 → Phase 5 → Phase 6 → Phase 7**。先做纯前端的 stat cards 重构（无需后端就绪），再打通两个后端端点，最后完成图表组件和集成。
