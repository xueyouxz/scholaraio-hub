# ScholarAIO Hub Reference

`reference/` 是从当前 `scholaraio-hub` 前端中抽离出来的纯展示素材目录，目标是为后续重构提供可复用的 TSX 设计稿组件。

## 使用边界

- 这里只保留 UI 样式、结构层级、状态外观和静态 mock。
- 不保留路由、服务请求、localStorage、Markdown 渲染、PDF 渲染、流式消息、动画运行时等业务或行为逻辑。
- 组件允许通过 props 控制展示状态，但不包含内部 `useState` 逻辑。
- 静态文案统一采用中文，便于作为中文设计稿素材直接参考。

## 目录结构

- `components/`
  基础可复用组件，偏向卡片、徽标、导航项、消息块、设置项等细粒度素材。
- `sections/`
  介于页面骨架和基础组件之间的区块级组件，用于表达原页面中的独立区域。
- `pages/`
  页面主内容骨架，只负责组合各个 section，不包含业务壳逻辑。
- `mock/`
  页面场景 mock 和共享实体样本。
- `styles/`
  `reference-theme.css`，提供最小必要的 Tailwind 主题令牌、字体和 utility。
- `types/`
  展示专用类型，避免直接耦合主项目业务类型。
- `package.json`
  仅保留 UI 相关依赖清单。

## TSX 组件索引

### `components/`

- `ChatHistoryItem.tsx`
  侧边栏最近会话条目。
  结构：标题行 + 可选会话操作菜单预览。
  主要 props：`item`、`showActions`。
  对应原页面：`Sidebar`。

- `ChatMessageBubble.tsx`
  聊天消息块。
  结构：附件预览、消息正文、工具结果卡、底部操作条。
  主要 props：`message`。
  对应原页面：`ChatView`、`MessageStream`。

- `FilterCheckboxRow.tsx`
  过滤面板中的复选项行。
  结构：静态勾选框 + 文案。
  主要 props：`label`、`checked`。
  对应原页面：`SearchView`、`LibraryView`。

- `InsightPaperCard.tsx`
  阅读器右侧关联洞察卡。
  结构：标题、作者元信息、摘要摘录、底部引用区。
  主要 props：`item`。
  对应原页面：`ReaderView`。

- `NavItem.tsx`
  侧边栏导航项。
  结构：图标 + 标签，支持折叠态。
  主要 props：`item`、`collapsed`。
  对应原页面：`Sidebar`。

- `PaperGridCard.tsx`
  文库网格卡片。
  结构：标题、作者、来源信息、状态标签。
  主要 props：`paper`。
  对应原页面：`LibraryView`。

- `PaperListRow.tsx`
  文库列表行卡。
  结构：状态点、标题、元信息、右侧操作占位。
  主要 props：`paper`。
  对应原页面：`LibraryView`。

- `ReaderLayerTab.tsx`
  阅读器层级切换标签。
  结构：单个层级切换 pill。
  主要 props：`label`、`active`。
  对应原页面：`ReaderView`。

- `SearchInput.tsx`
  检索输入框展示稿。
  结构：搜索图标、输入值区域、清空图标。
  主要 props：`value`。
  对应原页面：`SearchView`。

- `SearchResultCard.tsx`
  检索结果卡片。
  结构：状态标签、标题、作者与年份、摘要、底部 CTA。
  主要 props：`paper`。
  对应原页面：`SearchView`。

- `SectionLabel.tsx`
  通用分区标签。
  结构：mono 风格小标题。
  主要 props：`label`、`accent`。
  对应原页面：全局。

- `SettingsFieldCard.tsx`
  设置字段显示单元。
  结构：字段标签、可选 env 标记、字段值、编辑图标占位。
  主要 props：`field`。
  对应原页面：`SettingsView`。

- `SettingsPathRow.tsx`
  路径配置行。
  结构：图标、路径文本、来源标签、校验状态。
  主要 props：`item`。
  对应原页面：`SettingsView`。

- `SidebarBrand.tsx`
  侧边栏品牌头部。
  结构：品牌名、tagline、折叠图标。
  主要 props：`collapsed`。
  对应原页面：`Sidebar`。

- `StatCard.tsx`
  文库统计卡。
  结构：图标、角标、指标值、标签。
  主要 props：`stat`。
  对应原页面：`LibraryView`。

- `StatusBadge.tsx`
  论文状态徽标。
  结构：统一 badge 外观，按状态切换颜色和文案。
  主要 props：`status`。
  对应原页面：`LibraryView`、`SearchView`、工具结果卡。

- `ToolCallIndicator.tsx`
  工具调用状态条或状态胶囊。
  结构：待处理中条形占位，完成/异常中小胶囊。
  主要 props：`toolName`、`status`。
  对应原页面：`ChatView`。

- `ToolResultCard.tsx`
  聊天中的工具结果卡。
  结构：论文结果、主题结果、工作区结果三种分支。
  主要 props：`result`。
  对应原页面：`ChatView`、`tool-results/*`。

- `UserProfileCard.tsx`
  侧边栏底部用户资料块。
  结构：头像、用户名、角色、展开箭头。
  主要 props：`collapsed`、`menuOpen`。
  对应原页面：`Sidebar`。

- `WorkspaceCard.tsx`
  工作区卡片。
  结构：头部摘要 + 可选展开的论文列表。
  主要 props：`workspace`、`expanded`。
  对应原页面：`WorkspacesView`。

### `sections/`

- `ChatComposerSection.tsx`
  聊天输入区整体设计稿。
  结构：附件条、输入框、底部工具按钮、发送按钮。
  组合组件：无，内部使用静态附件样本。
  对应原页面：`ChatView`。

- `ChatConversationSection.tsx`
  聊天主消息区域。
  结构：空态欢迎卡或消息流列表。
  组合组件：`ChatMessageBubble`。
  对应原页面：`ChatView`。

- `ChatExplorerSection.tsx`
  聊天右侧 Explorer 面板。
  结构：引用列表、选中参考卡、关键词块。
  组合组件：`SectionLabel`。
  对应原页面：`ChatView`。

- `LibraryCollectionSection.tsx`
  文库内容区。
  结构：按年份分组，支持列表态和网格态。
  组合组件：`PaperListRow`、`PaperGridCard`。
  对应原页面：`LibraryView`。

- `LibraryFilterSheetSection.tsx`
  文库底部过滤面板。
  结构：状态过滤、年份过滤、来源标签、底部操作区。
  组合组件：`FilterCheckboxRow`、`SectionLabel`。
  对应原页面：`LibraryView`。

- `LibraryStatsSection.tsx`
  文库顶部统计区。
  组合组件：`StatCard`。
  对应原页面：`LibraryView`。

- `LibraryToolbarSection.tsx`
  文库工具条。
  结构：过滤按钮、排序按钮、视图切换、排序菜单预览。
  对应原页面：`LibraryView`。

- `ReaderDocumentSection.tsx`
  阅读器左侧主文档区域。
  结构：顶部层级条、文档摘要区、底部 reader 状态浮条。
  组合组件：`ReaderLayerTab`。
  对应原页面：`ReaderView`。

- `ReaderInsightsSection.tsx`
  阅读器右侧关联洞察区。
  结构：头部说明、选中统计条、关联论文卡、底部综合 CTA。
  组合组件：`InsightPaperCard`。
  对应原页面：`ReaderView`。

- `ReaderWorkspaceModalSection.tsx`
  阅读器工作区选择弹层。
  结构：弹层标题、描述、工作区列表。
  对应原页面：`ReaderView`。

- `SearchFiltersSection.tsx`
  检索页左侧过滤栏。
  结构：年份轨道、发表类型、入库状态。
  组合组件：`SectionLabel`、`FilterCheckboxRow`。
  对应原页面：`SearchView`。

- `SearchHeroSection.tsx`
  检索页头部区域。
  结构：标题、描述、搜索框、检索模式 pills。
  组合组件：`SearchInput`。
  对应原页面：`SearchView`。

- `SearchResultsSection.tsx`
  检索结果区。
  结构：结果数、排序控件、视图按钮、结果卡列表。
  组合组件：`SearchResultCard`。
  对应原页面：`SearchView`。

- `SettingsFooterSection.tsx`
  设置页底部导出区和系统状态区。
  结构：导出说明、环境状态卡、底部状态栏、帮助按钮。
  对应原页面：`SettingsView`。

- `SettingsModelSection.tsx`
  设置页模型与依赖配置区。
  结构：LLM 配置卡、Embedding 卡、MinerU 卡。
  组合组件：`SettingsFieldCard`。
  对应原页面：`SettingsView`。

- `SettingsPathSection.tsx`
  设置页路径配置区。
  结构：路径标题 + 多条路径行。
  组合组件：`SettingsPathRow`。
  对应原页面：`SettingsView`。

- `SidebarReference.tsx`
  整个侧边栏参考稿。
  结构：品牌头、新建按钮、导航、历史会话、用户菜单。
  组合组件：`SidebarBrand`、`NavItem`、`ChatHistoryItem`、`UserProfileCard`。
  对应原页面：`Sidebar`。

- `TopNavReference.tsx`
  顶部导航条参考稿。
  结构：页面标题、右侧设置按钮、快捷设置抽屉。
  对应原页面：`TopNav`。

- `WorkspacesHeaderSection.tsx`
  工作区页头部和创建条。
  结构：标题说明、新建按钮、创建输入稿。
  对应原页面：`WorkspacesView`。

- `WorkspacesListSection.tsx`
  工作区列表区。
  组合组件：`WorkspaceCard`。
  对应原页面：`WorkspacesView`。

### `pages/`

- `AppShellReference.tsx`
  全局壳层。
  结构：固定 `SidebarReference` + `TopNavReference` + 页面内容插槽。
  主要 props：`title`、`children`、`sidebarCollapsed`、`settingsDrawerOpen`。
  对应原页面：`App.tsx`。

- `ChatPageReference.tsx`
  聊天页主内容骨架。
  组合 section：`ChatConversationSection`、`ChatComposerSection`、`ChatExplorerSection`。
  对应原页面：`ChatView`。

- `LibraryPageReference.tsx`
  文库页主内容骨架。
  组合 section：`LibraryStatsSection`、`LibraryToolbarSection`、`LibraryCollectionSection`、`LibraryFilterSheetSection`。
  对应原页面：`LibraryView`。

- `ReaderPageReference.tsx`
  阅读器页主内容骨架。
  组合 section：`ReaderDocumentSection`、`ReaderInsightsSection`、`ReaderWorkspaceModalSection`。
  对应原页面：`ReaderView`。

- `SearchPageReference.tsx`
  检索页主内容骨架。
  组合 section：`SearchHeroSection`、`SearchFiltersSection`、`SearchResultsSection`。
  对应原页面：`SearchView`。

- `SettingsPageReference.tsx`
  设置页主内容骨架。
  组合 section：`SettingsModelSection`、`SettingsPathSection`、`SettingsFooterSection`。
  对应原页面：`SettingsView`。

- `WorkspacesPageReference.tsx`
  工作区页主内容骨架。
  组合 section：`WorkspacesHeaderSection`、`WorkspacesListSection`。
  对应原页面：`WorkspacesView`。

## mock 与类型

- `mock/entities.ts`
  公共实体样本，包括导航、会话、论文、主题、工作区、统计卡。
- `mock/chat.ts`
  聊天页面样本，包括消息、工具结果和 Explorer 关键词。
- `mock/search.ts`
  检索页模式、过滤项和结果样本。
- `mock/library.ts`
  文库年份分组、统计卡和来源标签样本。
- `mock/reader.ts`
  阅读器层级、主论文、关联洞察和工作区样本。
- `mock/settings.ts`
  设置页字段样本和路径配置样本。
- `mock/workspaces.ts`
  工作区页场景数据。
- `types/ui.ts`
  展示专用类型定义，只保留 UI 所需字段。

## 样式与依赖

- `styles/reference-theme.css`
  复制并裁剪了当前项目需要的字体、颜色 token 和 `signature-gradient` 等 utility。
- `package.json`
  仅保留 UI 相关依赖：`react`、`react-dom`、`lucide-react`、`tailwindcss`、`typescript`、`@types/react`、`@types/react-dom`。

## 说明

- 当前仓库的 `tsconfig.json` 没有单独给 `reference/` 配置入口，这个目录默认作为设计稿素材沉淀，不会自动接入现有业务页面。
- 如果后续要把某个设计稿重新接入业务层，建议从 `pages/*Reference.tsx` 对应 section 开始逐层回迁，而不是直接复制整个页面。
