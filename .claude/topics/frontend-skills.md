# 前端 skills 适用规则

适用于 `packages/client/**`。先遵守 [client 规则](../rules/client.md)、
[shared 导入边界](../rules/shared.md)和 [UI 设计规范](../../.design/DESIGN.md)，
再采用下列上游建议；冲突时以项目适用规则为准。只读取当前任务涉及的详细规则。

## 使用时机

| Skill | 使用时机 |
| --- | --- |
| [vercel-react-best-practices](../../.agents/skills/vercel-react-best-practices/SKILL.md) | 编写、修改或审阅 React 代码，以及分析请求、渲染和包体积性能时。 |
| [vercel-composition-patterns](../../.agents/skills/vercel-composition-patterns/SKILL.md) | 设计复杂组件 API、组合组件或重构模式参数过多的组件时。 |
| [web-design-guidelines](../../.agents/skills/web-design-guidelines/SKILL.md) | 编写 UI 时参考可访问性和交互要求；审阅 UI 时检查本次涉及的文件。 |

## 技术栈映射与例外

- **加载与框架**：使用 React.lazy、Suspense、动态 import 和 Vite 分包；不引入
  next/dynamic。RSC、Server Actions、SSR hydration 和 next/server 专属规则不适用。
  Hono 后端仅按其自身规则借鉴通用并发、缓存原则。
- **请求与状态**：请求去重、缓存沿用 TanStack Query；状态管理沿用现有 Zustand
  和局部状态。不要因上游示例引入 SWR、better-all 或替换状态库。
- **导入边界**：按需导入不得绕过 @scholaraio-hub/shared 公开入口，禁止跨包引用源码。
- **渲染与资源**：保留资源释放、订阅引用计数、公共祖先计算派生数据及 D3 命令式边界。
  memo、缓存和 JS 微优化需有明确成本依据；新增缓存必须定义容量、失效与清理方式。
  隐藏组件不等于卸载，不能据此假定订阅和资源已经释放。
- **组件组合**：减少控制组件模式的布尔参数，不禁止 disabled、loading 等正常状态。
  仅针对本次需求调整组件，不批量替换 useContext、forwardRef 或把状态全部迁入 Context。
  React API 必须由当前项目依赖支持，不为使用 skill 升级到 Canary。
- **界面与动效**：采用语义化控件、标签、键盘可达性、可见焦点、空状态、长文本和
  prefers-reduced-motion 要求。现有侧栏 width、内容 margin、顶栏 left 动画是
  “仅 transform/opacity 动画”建议的项目例外；变更须先调整设计规范，不自动重写。
- **列表与导航**：沿用 TanStack Virtual 和 React Router；虚拟化根据列表成本判断，
  URL 只同步需要分享或恢复的界面状态，不机械同步全部 useState，不因示例引入 virtua、nuqs。
- **文案与格式**：大小写、引号和标点按文案语言处理；代码继续遵守 Biome，视觉继续遵守
  DESIGN.md。通用指南不得覆盖项目设计 token、字体或布局。

## 来源与维护

- 上游：[vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)，
  固定提交 `063bee94c3f4df8453406c830b0a7df0f2860278`。
- 对应源目录：`skills/react-best-practices`、`skills/composition-patterns`、
  `skills/web-design-guidelines`。保留完整 skill 内容及其许可声明，不在上游文件中混入本地规则。
- 公共副本存放于 `.agents/skills/`；`.claude/skills/` 使用相对符号链接。
  项目规则明确引用公共副本，不依赖个人全局安装的版本。
- 更新须显式进行，并审阅上游差异和本页例外，不自动跟随 main。
- web-design-guidelines 按原版流程在每次 UI 审阅时获取最新外部指南；该指南未固定版本。
  审阅时记录实际使用的来源和版本或获取日期。无法获取时明确说明，不声称完成最新指南检查。
- Skills 是编码与审阅指导，不替代项目现有 lint、类型检查和测试，也不授权部署或全量重构。
