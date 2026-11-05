# Superagent 可复用 UI 资产：组件、CSS、TraceTimeline 与复用边界

> 源码基线：`/tmp/sa-off`，commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`（已用 `git rev-parse HEAD` 核对）。本文重新读取源码，不把页面清单当作组件证据。
>
> 路径缩写：`SA/` = `/tmp/sa-off/`；`ZL/` = `D:/主工作区/projects/dsh-session-superagent/`；`DSH_UI/` = `D:/DeepSeek Harness/home/dsh-ui-official/`。除 `ZL/client.js`、`ZL/lib/**` 外，行号均按上述基线或主库当前文件。
>
> 参考过 `ZL/docs/official-decomp/04-panel-tree.md`，但以下结论均回到源码复核。DSH 补充素材只认 `DSH_UI/` 主库；其来源优先级见 `DSH_UI/SOURCES.md:3-17,25-30`，完整性与安装态哈希见 `DSH_UI/LIBRARY-MANIFEST.json:2-5`。

**三种复用判定**：

- **纯 CSS 可直接复用**：选择器和声明可以原样拷贝，但必须同时复制对应 DOM、`data-*` / ARIA 状态和 DSH token；只贴 class 不会自动得到行为。
- **依赖 React / 数据模型需改写**：保留 DOM、交互与状态映射，JSX 改成主理鱼现有的 `React.createElement`，数据改接 watcher、trace、credentials 等真实模型。
- **依赖官方 Runtime 不应照搬**：包括 `/orchestrator/api`、Ticket/Assignment、setup/restart、ConfigForm、Session 跳转和带 revision 的服务端协议。只借鉴信息结构，不复制其运行假设。

## 一、组件清单

### 1. `controls.tsx`：无业务上下文原语

文件头明确说明它镜像 DSH ui-primitives 的 DOM 与键盘行为，并使用 `--dsw-alias-*` token，而不耦合内部包 API（`SA/src/client/controls.tsx:1-8`）。这些组件是主理鱼最直接的行为素材；仍须做 JSX → `h()` 改写。

| 组件 | 可直接提取的 DOM / 行为 | 文件与行号 | 主理鱼边界 |
|---|---|---|---|
| `Icon` | 集中维护 path；统一 24 viewBox、`currentColor`、圆角 stroke、`aria-hidden`；尺寸由 props 控制 | `SA/src/client/controls.tsx:11-52` | DOM 可移植；主库已有同义官方 JSX 时优先用主库图元，不另手画 |
| `Button` | `button.dt-btn.dt-btn-{variant}.dt-btn-{size}`；icon 独立 `.dt-btn-icon`；默认 `type=button`；primary/ghost/outline × md/sm | `SA/src/client/controls.tsx:54-60` | DOM 与属性转发可移植 |
| `Tag` | `span.dt-tag[data-tone]`；outline/neutral/quiet/success/info/warning/danger | `SA/src/client/controls.tsx:62-65` | tone 应由统一状态映射产生 |
| `Pill` | 筛选按钮，`aria-pressed` 与 `.dt-pill-active` 同步 | `SA/src/client/controls.tsx:67-70` | 可直接用于 watcher / reason 筛选 |
| `walk` + `SegmentedTabs` | ←/→/Home/End 循环、焦点跟随、正确 tab/tablist/tabpanel 关系；ResizeObserver 测量溢出并写 `data-more=start/end/both` | `SA/src/client/controls.tsx:72-112` | 键盘与窄屏行为一起移植，不能只取下划线外观 |
| `SegmentedControl` | 表单内互斥选择；复用 `walk`；当前项不重复触发 `onChange`；支持 disabled | `SA/src/client/controls.tsx:113-125` | 官方语义是 tablist/tab；主理鱼当前 radiogroup 版本不是权威基线 |
| `Input` | `span.dt-input > [span.dt-input-icon] + input`；native input 属性全部转发 | `SA/src/client/controls.tsx:127-130` | 可直接用于搜索、仓库名和数值字段 |
| `Switch` | `button[role=switch][aria-checked]` + `.dt-switch-thumb`；有可读 label | `SA/src/client/controls.tsx:132-138` | 适合 enabled/observe，不替代危险确认 |
| `StateDot` / `Dot` | done/warning/ongoing/error/idle；ongoing 是 SVG spinner，其余是 `data-state` 圆点；`Dot` 可补 `role=img` 与 label | `SA/src/client/controls.tsx:140-152` | 状态色可移植，业务状态需重新映射 |
| `DisclosureRow` | `.dt-disclosure[data-open]`；行支持点击、Enter、Space 和 `aria-expanded`；折叠时保留 `collapsedContent`；展开才挂载 children | `SA/src/client/controls.tsx:154-169` | children 应由调用方包 `.dt-disclosure-body`，见 ticket/thread/source 用法 |
| `trapTab` + `Modal` | body portal；遮罩/Escape 关闭；Tab 焦点陷阱；关闭后焦点归还 opener；`onClose` 用 ref 防止轮询重置焦点 | `SA/src/client/controls.tsx:171-215` | 行为完整移植；不要退化成两次点击确认 |
| `InfoTip` | body portal tooltip；hover、focus-visible、触摸；视口边缘定位；Escape/scroll/resize 关闭 | `SA/src/client/controls.tsx:217-249` | 主理鱼当前 absolute 气泡需按此行为改写 |

对应 CSS 集中在 `SA/src/client/client.css:186-269`；InfoTip 另见 `:91-95`，Disclosure body 见 `:168`。

### 2. `widgets.tsx`：页面级复合件

| 组件 | 可复用实现 | 文件与行号 | 边界 |
|---|---|---|---|
| `When` | 真正的 `<time dateTime title>`，相对时间与完整时间并存 | `SA/src/client/widgets.tsx:12-15` | 结构改写；时间格式化接主理鱼 locale |
| `SetupMessage` | 可读错误 + 可选原始 output，output 使用 `.dt-detail.dt-mono.dt-clamp` | `SA/src/client/widgets.tsx:16-23` | 错误呈现可复用，setup code 不搬 |
| `Section` | `section.dt-section > h2.dt-section-title`；icon/name/count/InfoTip/badge/右 action 固定顺序 | `SA/src/client/widgets.tsx:24-35` | 高优先级结构改写 |
| `Hint` / `LabelValue` / `KeyValues` | 统一弱提示、label/value 和 `<dl>` 两列事实表 | `SA/src/client/widgets.tsx:36-43` | 可直接映射 watcher 事实与唤醒依据 |
| `MarkdownLite` | 标题、列表、段落、粗体、行内 code、http(s) 链接；不解释 raw HTML | `SA/src/client/widgets.tsx:45-60`；解析器 `SA/src/client/markdown.ts:14-42` | 适合短 verdict/说明；完整 issue body 见第四节 DSH 空白 |
| `MoreToggle` + `ClampText` | >480 字或 >8 行才折叠；`.dt-event-text.dt-clamp-8` + `aria-expanded` 展开按钮 | `SA/src/client/widgets.tsx:61-72` | TraceTimeline body 的直接素材 |
| `ConfirmButton` | Button 打开 Modal；description 说明后果；footer 取消/确认；`useAction` 防重入，成功才关闭 | `SA/src/client/widgets.tsx:75-90` | Modal 与 busy 结构可移植，action 改接主理鱼 API |
| `SessionButton` | 打开 Session 并统一捕获错误到 Toast | `SA/src/client/widgets.tsx:91-96` | **Runtime 不应照搬**；主理鱼已处在当前 Session |
| `ExternalLink` / `ActionLink` | 安全外链属性；后者用 `<a>` 复用按钮外观 | `SA/src/client/widgets.tsx:97-103` | 可用于 issue/PR 原始链接，但 trace 当前未提供 URL |
| `StageMark` | `.dt-stage[data-state]`，ongoing spinner，其余 icon + label | `SA/src/client/widgets.tsx:104-107` | 与统一 mark mapper 一起复用 |
| `LoadState` / `LoadMore` | error 用 `p.dt-error[role=alert]`；loading 用 Hint；分页按钮复用 outline Button | `SA/src/client/widgets.tsx:108-116` | 空态/错误态基线 |
| `StatusHead` / `PageHead` | 列表状态头 + 设置入口；详情返回 + 标题 + actions | `SA/src/client/widgets.tsx:118-132` | 路由改接主理鱼 tab/筛选状态 |
| `CheckSetupButton` | setup 检查、重启等待、运行中 Assignment 的中断确认 | `SA/src/client/widgets.tsx:133-147` | **Runtime 不应照搬** |

### 3. `rows.tsx`：三种列表行共用一套骨架

| 组件 | 可复用实现 | 文件与行号 | 主理鱼映射 |
|---|---|---|---|
| `TicketLine` | `li.dt-row.dt-link.dt-ticket > .dt-ticket-stage + .dt-ticket-body`；body 固定 title/meta/actions；actions 容器始终渲染以稳定三行高 | `SA/src/client/rows.tsx:10-44` | watcher 行：状态、仓库/标题、chips/原因/时间、行内动作 |
| `ThreadLine` | 同一 Ticket 骨架，增加单行 quote、poll error、fanout 与时间 | `SA/src/client/rows.tsx:50-76` | 判定条目或仓库最近事件 |
| `DecisionLine` | outcome StageMark、标题、preview、原因、命中 rules、时间；按 ticketId 决定跳转目标 | `SA/src/client/rows.tsx:78-102` | 判定日志最接近的官方行 |
| `ThreadChip` | source + facts 分段 chip；problem 用错误色；可外链且不会触发行跳转 | `SA/src/client/rows.tsx:104-116` | repo/provider/编号/labels 等真实 facts |
| `automatedRuns` / `Earlier` | 仅折叠“同 sender 的连续自动项”，不是任意截断；Earlier 展开后保留时间和 preview | `SA/src/client/rows.tsx:118-140` | 可借给重复轮询/冷却事件；深链目标不能折叠 |

行点击的关键不是只加 `.dt-open`，而是 `.dt-open::after` 覆盖整行、动作容器穿透空白区域、子控件恢复 pointer events；CSS 证据为 `SA/src/client/client.css:27-39,46-47,323-358`。

### 4. `settings-kit.tsx`：设置字段、动态 rows 与历史

| 组件 | 可复用实现 | 文件与行号 | 边界 |
|---|---|---|---|
| `SettingsProvider` / `useSettings` | Context 提供 settings 与 reload；首次无数据显示 LoadState，后续错误保留旧内容并补充错误 | `SA/src/client/settings-kit.tsx:16-32` | 数据层改写，不能直接请求 `GET settings` |
| `useBlockDraft` | 每个 block 独立 key、revision、保存与 Toast | `SA/src/client/settings-kit.tsx:33-42` | 只有主理鱼服务端提供 block revision 时才完整移植 |
| `Fields` / `Field` / `SwitchRow` | fieldset 保存期禁用；保存后恢复原输入焦点；label + InfoTip + note；switch 左右行 | `SA/src/client/settings-kit.tsx:44-70` | 高优先级结构改写 |
| `ModelField` | provider/model/effort 三列、默认提示、错误与 datalist；全空时提交 null | `SA/src/client/settings-kit.tsx:71-104` | 主理鱼无角色模型设置时不增加此区块 |
| `ConfigHistory` | Disclosure + timeline + 结构化 changes + notified；支持指定版本定位、滚动和 `.dt-highlight` | `SA/src/client/settings-kit.tsx:106-161` | DOM 可复用；`GET policy/history` 与 revision 数据 **不应伪造** |
| `RowsField` | 动态增删行、选项去重、外部 label 刷新、超过 6 行摘要折叠、列数 CSS 变量 | `SA/src/client/settings-kit.tsx:163-239` | 可改写为 labels/authors 等列表编辑器 |
| `SourceField` / `numberOf` | switch/select/number/text/fact/rows 六类字段统一分派；空数字保持 null 而非 coerce 0 | `SA/src/client/settings-kit.tsx:14-15,240-278` | schema 改为主理鱼真实字段，不复制 Source Policy |

### 5. `draft.tsx` 与 `deployment.tsx`：可学状态机，不可假接协议

| 组件 | 可复用实现 | 文件与行号 | 复用判定 |
|---|---|---|---|
| `merge3` / `mergeList` | base/mine/theirs 三向合并；对象递归；唯一 `id` / `chatId` 数组按元素合并；删除遇修改保留 mine 并记录冲突路径 | `SA/src/client/draft.tsx:10-50` | 纯算法可单独移植并配测试；不代表服务端已有并发协议 |
| `draftReducer` | `clean → editing → saving → awaitingRevision → clean`；保存中不 rebase；revision 到达后再清理 sent | `SA/src/client/draft.tsx:62-108` | **依赖 Runtime**；无 revision 时只做 clean/editing/saving |
| `saveBarText` | restored/rebasing/merged/conflict/invalid/failed/unstored 的完整反馈 | `SA/src/client/draft.tsx:109-126` | 文案状态可借鉴，不能假报 merged/conflict |
| `useDraft` | sessionStorage 恢复、409 reload/rebase、保存后 reload/restart、dirty/busy/discard | `SA/src/client/draft.tsx:128-173` | sessionStorage 可移植；409/revision/restart 不应照搬 |
| `SaveBar` | 仅 dirty/busy/error 出现；sticky；错误 `role=alert`、状态 `aria-live`；隐藏时修复焦点 | `SA/src/client/draft.tsx:175-203` | 展示层高优先级复用，接本地真实 dirty/saving/error |
| `usePageForm` | `useSyncExternalStore` 订阅宿主 ConfigForm snapshot | `SA/src/client/deployment.tsx:26-30` | **依赖 DSH Runtime** |
| `DeploymentPage` | ready+writable 才可编辑；只提交变化的 set/unset ops；只读原因、stateDir、setup 问题与 SaveBar | `SA/src/client/deployment.tsx:32-84` | 只读/可写状态结构可学；三项 limit 与 ConfigForm 不搬 |
| `PluginPage` / `PluginConfig` | 主面板与 Plugin Manager 共用 Deployment；嵌入时 `.dt-embedded`；summary 不渲染 | `SA/src/client/deployment.tsx:86-98` | **Runtime 不应照搬**到主理鱼会话视图 |

### 6. 页面组件：提取结构，不搬领域对象

| 文件 / 组件 | 可复用实现与行号 | 主理鱼用法与边界 |
|---|---|---|
| `app.tsx` · `Glossary` | Modal 内表格、状态 legend、枚举 values（`SA/src/client/app.tsx:27-55`） | 术语表可保留；数据改为主理鱼真实词汇 |
| `app.tsx` · `Highlight` / `Result` / `SearchResults` | 查询高亮、三类结果、计数、空态、filtered 不可点项（`SA/src/client/app.tsx:57-99`） | 改为 watcher/repo/trace 结果；不是独立 Search 页 |
| `app.tsx` · `Header` | search form、Escape/外点关闭、请求序号丢弃过期响应、工具栏（`SA/src/client/app.tsx:101-139`） | 过期响应保护可直接借；API 改接 `/state` 与 `/trace` |
| `app.tsx` · `Pages` / `App` | `.dt-page > .dt-column > Header + Tabs + main.dt-main`；返回栈最多 20，筛选 replace、详情 push（`SA/src/client/app.tsx:141-188`） | 页面壳高优先级；主理鱼仍保持 4 tabs |
| `provider.tsx` · `useAction` | running ref 防连点、busy、成功后 reload、错误 Toast、boolean 结果（`SA/src/client/provider.tsx:41-56`） | 行为可移植到本地 call |
| `provider.tsx` · `Toast` | body portal、单条、`role=status`、CSS hold + JS 延迟卸载（`SA/src/client/provider.tsx:65-70,82-84,103-107`） | 高优先级；不要做多条堆叠或重要错误只 Toast |
| `provider.tsx` · `PanelProvider` | state 轮询、restart down/up 检测、Context 分离、CSS 注入（`SA/src/client/provider.tsx:74-107`） | **Runtime 不应照搬**；主理鱼已有 routeBase/ETag/请求序号 |
| `source.tsx` · `SourceCard` | card head + enable Switch + 普通字段 + 高级 Disclosure + 独立 SaveBar；脏字段隐藏旧 derived facts（`SA/src/client/source.tsx:14-59`） | 新增/编辑 watcher 表单的最贴近素材 |
| `source.tsx` · `DroppedReplies` | 带计数 Disclosure、原因 Tag、Ticket/Thread 回退链接（`SA/src/client/source.tsx:70-94`） | 结构可借给失败/跳过记录；无 dropped 概念不造区 |
| `source.tsx` · `SourceRow` / `SourceStatus` | 健康状态、统计、最近时间、setup/health 错误、filtered Disclosure（`SA/src/client/source.tsx:95-156`） | 映射 watcher/repo 健康；设置与状态分离 |
| `overview.tsx` · `ProblemLine` | 每类问题都有标题、详情、修复去向或真实动作；原始错误 clamp+mono（`SA/src/client/overview.tsx:11-59`） | “需要关注”直接参考，问题类型换成真实凭证/限流/未回音等 |
| `overview.tsx` · `OverviewPage` | Section、待处理行、问题列表、统计、执行器状态；空态统一 Hint（`SA/src/client/overview.tsx:61-103`） | 只借结构，不伪造 Executor/Ticket 数 |
| `trigger.tsx` · `TriggerStatus` | StatusHead + Pill filters + LoadState + list/Hint + LoadMore（`SA/src/client/trigger.tsx:10-27`） | 判定/触发筛选骨架 |
| `eval.tsx` · `EvalStatus` | Decision filters、暂停 banner、24h 附加筛选、分页（`SA/src/client/eval.tsx:15-39`） | 判定日志结构改写 |
| `eval.tsx` · `RuleRow` | Disclosure 折叠摘要、名称/指令字段、复制/删除、独立启用 Switch；校验失败时由父级展开（`SA/src/client/eval.tsx:42-68,151-157`） | 可用于未来多条过滤规则；不搬 Admission 语义 |
| `eval.tsx` · `SourcePart` / `AdmissionTable` | 来源字段、sync 前 dirty 拦截、固定 warning slot 防止列宽跳动（`SA/src/client/eval.tsx:70-134`） | 固定 icon slot 可复用；准入矩阵不搬 |
| `eval.tsx` · `PolicyBlock` / `EvalBlock` / `EvalSettings` | 独立 form/block/draft/SaveBar；来源子 tabs；配置历史（`SA/src/client/eval.tsx:136-225`） | 块级草稿结构可复用，Policy/Eval API 不搬 |
| `execution.tsx` · `ExecutionStatus` | 状态行、并发事实、暂停确认、Ticket filters 与列表（`SA/src/client/execution.tsx:14-51`） | 只映射真实 watcher 状态；不虚构 worker pool |
| `execution.tsx` · `EnvironmentVariables` | Disclosure 内表格；点击 key 插入 prepare 光标位置（`SA/src/client/execution.tsx:53-74,85-91`） | 交互可借给变量/路径辅助；环境变量数据不搬 |
| `execution.tsx` · `ExecutionSettings` | Executor/Environment 两块共享一个草稿；文本原样编辑、保存时才解析；统一 SaveBar（`SA/src/client/execution.tsx:75-127`） | 草稿策略可学；blockedCommands/Executor 不搬 |
| `settings.tsx` · `SettingsPage` | `.dt-settings > nav.dt-settings-nav + .dt-settings-body`；`aria-current=page`；分组 replace 路由（`SA/src/client/settings.tsx:12-38`） | 主理鱼现有五分区可直接对齐 DOM |
| `thread.tsx` · `triggerTags` / `TriggerItem` | 每个 Trigger 是 `li.dt-event`；head 用 `.dt-event-foot` 放 actor/time；body 是 ClampText/Earlier；第二个 foot 放 tags 与动作；target 加 `.dt-highlight` 并滚动（`SA/src/client/thread.tsx:11-56`） | **TraceTimeline 最贴近模板**，详见第三节 |
| `thread.tsx` · `useThreadTimeline` | around 定位、before 补页、gap 检测、按 id 去重排序；深链目标不参与自动折叠（`SA/src/client/thread.tsx:57-107,120-122`） | 数据量大且有游标后再移植；当前 `/trace` 不假装支持 |
| `thread.tsx` · `ThreadPage` | 页头、状态、banner、关联列表、Decisions Disclosure、Trigger timeline、危险区（`SA/src/client/thread.tsx:108-176`） | 追溯详情的信息顺序参考 |
| `ticket.tsx` · `InputLine` / `InputList` | Dot + row-main + 标题/meta/Markdown/handback/Earlier；自动输入折叠（`SA/src/client/ticket.tsx:13-38`） | 可借给唤醒输入记录，无 Inputs 实体不新建区 |
| `ticket.tsx` · `Details` / `Assignments` | Details 统一给 Disclosure 加 `.dt-disclosure-body`；Assignment 行含状态、报告、起止与 Session 动作（`SA/src/client/ticket.tsx:40-67`） | Details 可直接复用；Assignment 不搬 |
| `ticket.tsx` · `MandateDetails` | `Section(icon=shield)` + KeyValues；Trigger 回链、Decision/rules/direction、scope/facts/version（`SA/src/client/ticket.tsx:68-106`） | “本次唤醒依据”的最佳结构；只展示真实 watcher/filter/quota/ack |
| `ticket.tsx` · `TicketPage` | 页头动作、状态行、attention/danger banners、Mandate、关联列表、Details、危险区（`SA/src/client/ticket.tsx:108-198`） | 详情页渐进披露参考；Ticket API 不搬 |
| `prompts.tsx` · 编辑/预览/历史 | 双栏导航与 dirty 标记（`SA/src/client/prompts.tsx:70-175`）；预览与配置成对保存、Diff（`:177-255`）；历史只载入草稿（`:257-295`） | 只借 dirty/diff/history 交互；主理鱼 goal 不扩成 Prompt 编辑器 |
| `api.ts` · `usePoll` | 串行 queue、隐藏降频、响应相等不 setState、依赖变化丢弃旧响应、错误保留最后数据（`SA/src/client/api.ts:60-98`） | 技术参考；主理鱼 ETag/routeBase 不能被官方简化轮询覆盖 |
| `api.ts` · `caller` / `ApiError` | 类型化 route、路径/query 编码、结构化 validation/unreachable/404（`SA/src/client/api.ts:8-58,105-117`） | **Runtime 不应照搬** `/orchestrator/api` 与错误契约 |
| `marks.ts` | Ticket/Thread/Source/Decision 集中映射 label/tone/dot/icon（`SA/src/client/marks.ts:7-57`） | 映射方法可直接复用，枚举改为主理鱼真实状态 |
| `route.ts` | 路由逐字段白名单清洗、sessionStorage 恢复失败回 HOME（`SA/src/client/route.ts:26-67`） | 可借筛选/深链持久化；不复制官方 6 tabs |

## 二、CSS / 素材清单

### 1. 主理鱼最该复用的 CSS 结构

下表的“纯 CSS 可直接复用”只指样式层；同一行同时列出必须一起改写的 React/数据部分。token 名称不能替换成写死 hex，否则明暗主题会漂移。

| 结构 | 必须复制的 DOM / CSS | 依赖的 DSH token | 复用边界 |
|---|---|---|---|
| **页面壳** | `.dt-page` 自己滚动并建立 inline-size container；`.dt-page > .dt-column` 最大 960、居中、gap24；`header.dt-head`、`.dt-toolbar`、`.dt-tabs`、`main.dt-main`（`SA/src/client/client.css:2,7-16,108,268-269`）；DOM 见 `SA/src/client/app.tsx:161-169` | `label-primary/secondary`、`border-l3`、`bg-module-platform`、`bg-layer-3`、`interactive-bg-hover`；macOS 另有 `--dsh-frame-top-clearance` | **CSS 直用**；Tabs 键盘/ResizeObserver 与路由 **需改写** |
| **Section** | `section.dt-section > h2.dt-section-title`；name 不换行，count、hint、badge、右 action；icon 用 `.dt-section-icon`（`SA/src/client/client.css:19-23,348`；DOM `SA/src/client/widgets.tsx:24-35`） | `label-secondary/tertiary/caption` | **CSS 直用**；action/hint 组合 **需 React 改写** |
| **Ticket / watcher 行** | `.dt-list > .dt-ticket` 为 112px + 1fr；左 stage 有分隔线，右 body 为 title/meta/actions；`data-state` 左侧警示条；窄屏单列（`SA/src/client/client.css:323-345,355-358`） | `border-l3`、`state-warn/error/business-primary`、`label-primary/secondary/caption`、`interactive-bg-hover` | **CSS 直用**；TicketLine 的导航和 retry/stop **需数据改写** |
| **整行点击与动作层** | `.dt-open::after` 铺满 row；focus ring 也画在 after；`.dt-ticket-actions/.dt-row-buttons/.dt-row-actions` 空白处穿透，子控件恢复交互（`SA/src/client/client.css:33-37,46-47,333-336`） | `brand-primary` | **CSS 直用且必须整套复制**，否则行链接会吃按钮点击 |
| **时间线** | `ol/ul.dt-timeline > li.dt-event`；事件 padding、分隔线、gap；`.dt-event.dt-highlight`；`.dt-event-text`、`.dt-event-actor`、`.dt-event-quiet`、`.dt-event-foot`；hover 才显示 `.dt-reveal`（`SA/src/client/client.css:57-72`） | `border-l2`、`interactive-bg-hover`、`label-secondary/tertiary` | **CSS 直用**；TriggerItem、ClampText、深链目标 **需 React/数据改写** |
| **Clamp / 长文** | 短错误 `.dt-clamp` 3 行；长正文 `.dt-clamp-8` 8 行；`.dt-more` 左对齐；banner clamp 时用透明 border 保留间距（`SA/src/client/client.css:40-45,61,65-68`） | `label-tertiary`、`link` | **CSS 直用**；是否出现展开按钮必须由真实长度/行数决定 |
| **设置左右栏** | `.dt-settings` 140px + minmax；nav sticky；`aria-current=page`；body gap16；≤640cqw 时 nav 变横向换行（`SA/src/client/client.css:301-322`；DOM `SA/src/client/settings.tsx:26-37`） | `label-primary/secondary`、`bg-module-platform`、`border-l3` | **CSS 直用**；分组路由与块级草稿 **需改写** |
| **设置字段 / SaveBar** | `.dt-form/.dt-fieldset/.dt-field/.dt-field-head/.dt-input/.dt-select/.dt-textarea`（`SA/src/client/client.css:75-105,219-230`）；`.dt-savebar` sticky，card/block 内负 margin 贴合底边（`:151-153`） | `label-*`、`border-l2/l3/l4`、`bg-base/layer-1`、`brand-primary`、`button-primary-fill`、`label-primary-foreground`、`--ds-font-family-code` | **CSS 直用**；Fields 焦点恢复、SaveBar 状态 **需 React 改写**；revision/409 **不搬** |
| **搜索浮层** | `form.dt-search` 为定位锚点；`.dt-search-results[role=region]` 绝对定位、实心 layer-2、滚动、z-index；`.dt-search-head`、`.dt-mark`；窄屏左对齐全宽（`SA/src/client/client.css:9-11,145-146,169-185`）；行为 `SA/src/client/app.tsx:68-99,101-130` | `border-l3`、`bg-layer-2`、`--dsw-elevation-prominent`、`state-warn-primary`、`label-tertiary` | **CSS 直用**；请求序号、外点/Escape、结果数据 **需改写**。官方不是 combobox，也没有结果方向键导航，勿虚称完整命令面板 |
| **Disclosure** | `.dt-disclosure[data-open]`、`.dt-disclosure-row`、lead/icon/chevron/title；hover/open 换 chevron；children 包 `.dt-disclosure-body`（`SA/src/client/client.css:168,242-250`；DOM `SA/src/client/controls.tsx:154-169`） | `label-primary/secondary`、`brand-primary` | **CSS 直用**；键盘、open state、collapsedContent **需 React 改写** |
| **ConfirmButton / Modal** | portal `.dt-modal-root > .dt-modal-mask + .dt-modal[role=dialog]`；header/body/description/footer；按钮样式（`SA/src/client/client.css:187-197,251-260`）；ConfirmButton `SA/src/client/widgets.tsx:75-90` | `bg-mask-1`、`--dsw-mask-blur`、`bg-layer-2`、`--dsw-elevation-prominent`、`label-primary/secondary`、`interactive-bg-hover`、`brand-primary` | **CSS 直用**；焦点、Escape、busy、action **需改写**；不能拿主理鱼当前两次点击 ConfirmBtn 冒充官方结构 |
| **Toast** | body portal 单条 `.dt-toast[role=status]`；fixed 顶部居中、pointer-events none、`--dt-toast-hold`、进入/淡出动画与 reduced-motion（`SA/src/client/client.css:261-267`；`SA/src/client/provider.tsx:65-70,103-107`） | `toast-bg`、`--dsw-static-neutral-bluish-00`、`--dsw-shadow-lv3` | **CSS 直用**；单条替换与卸载计时 **需 React 改写**；持久错误仍留在 Section |
| **空态 / 错误态** | 普通空态 `Hint.dt-hint`；加载错误 `.dt-error[role=alert]`；警告/危险 banner；问题行 `.dt-att*` 有左侧状态条与修复动作（`SA/src/client/client.css:23-26,290-296`；`SA/src/client/widgets.tsx:108-112`；`SA/src/client/overview.tsx:11-59`） | `label-tertiary`、`state-warn/error-primary`、`border-l3`、`link` | **CSS 直用**；空态下一步动作、错误分类与重试 **需真实数据**。官方没有通用 `.dt-empty` / `.dt-step*` 样式，主理鱼这些类只能算本地扩展 |

补充局部变量：`--dt-columns` 是 RowsField 列数（`SA/src/client/client.css:127-128`），`--dt-toast-hold` 是 Toast 停留时长（`SA/src/client/provider.tsx:65-70`），它们不是 DSH 全局 token。

### 2. 窄屏与动效不能漏拷

- 主布局使用 **container query**，不是按整个浏览器宽度猜断点：搜索、Tabs、模型三列、Prompt 双栏在 `SA/src/client/client.css:169-185`；设置与 Ticket 行另见 `:317-322,355-358`。
- Tabs 的 `data-more` 渐隐依赖 ResizeObserver，CSS 与 JS 缺一不可（`SA/src/client/client.css:176-180`；`SA/src/client/controls.tsx:88-110`）。
- reduced-motion 同时处理 Tab、Segment、Switch、spinner、busy icon、tooltip 和 Toast（`SA/src/client/client.css:264-267`）；不能用删除动画的方式让 Toast 永不消失。

## 三、TraceTimeline 映射

### 1. 当前结构与官方最近邻

当前 `TraceTimeline` 在 `ZL/client.js:972-989`：

- loading/error/empty 都是简单段落；
- 每个 trace 是一个 `li.dt-event`；
- `trace.verdict` 被塞在一个 `.dt-event-head`；
- seen/reported/filtered/absorbed/wakes 全部压成多个 `.dt-event-foot`，文本为 `label · at`；
- 没有 body、长文展开、分组 Disclosure、事件高亮/定位，也没有使用 filtered/absorbed 已有的 title。

服务端真实 payload 由 `itemTrace` 给出：`seen`、`reported`、`filtered[{at,reason,title}]`、`absorbed[{at,title}]`、`wakes[{at,ok,reason}]`、`verdict`（`ZL/lib/watch.js:1042-1067`）。因此 **title/reason 进入 body 不需要新增 API**；URL、ack 评论结果、worktree、执行 transcript 不在此 payload 中，不能画成已有事实。

官方最贴近的不是 Ticket row，而是 `ThreadPage → TriggerItem`：actor+time 的 head、ClampText body、tags/actions foot，以及 target highlight/scroll（`SA/src/client/thread.tsx:28-56`）。分组折叠则借 SourceRow/Thread Decisions 的 Disclosure（`SA/src/client/source.tsx:125-135`；`SA/src/client/thread.tsx:144-149`）。

另一个直接可复用规则在旧文本投影：正常且无 filtered/absorbed、所有 wake 成功时只显示最近一次成功；异常才展开明细（`ZL/lib/index.js:68-85`）。这正好适合 Disclosure 的默认开/关，而不是让所有成功记录也铺开全部事件。

### 2. 推荐目标 DOM

下面是**结构示意**，不是要求新增一套 `sa-` 设计。外层一个 trace 是“条目分组”，内层每个时间戳才是官方意义上的 `.dt-event`：

```html
<ul class="dt-list">
  <li class="dt-row">
    <div class="dt-row-main">
      <div class="dt-disclosure" data-open>
        <div class="dt-disclosure-row" role="button" tabindex="0" aria-expanded="true">
          <span class="dt-disclosure-lead">…icon + chevron…</span>
          <span class="dt-disclosure-title">#42 @ owner/repo</span>
          <!-- 仅闭合时显示 verdict；展开后由下方 body 显示 -->
        </div>
        <div class="dt-disclosure-body">
          <p class="dt-event-text">verdict</p>
          <ol class="dt-timeline">
            <li id="trace-owner-repo-42-filtered-…" class="dt-event dt-highlight">
              <div class="dt-event-foot dt-event-head">
                <strong class="dt-event-actor">被过滤</strong>
                <time datetime="…" title="…">…</time>
              </div>
              <div class="dt-event-text dt-event-body dt-clamp-8">reason · item.title</div>
              <button type="button" class="dt-textlink dt-more" aria-expanded="false">展开</button>
              <div class="dt-event-foot">
                <span class="dt-tag" data-tone="neutral">filtered</span>
                <span>#42</span>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </div>
  </li>
</ul>
```

`dt-event-head` / `dt-event-body` 在这里只是**主理鱼可选的语义钩子**：官方 `client.css` 没有这两个选择器。真正的官方布局类是 `dt-event-foot` 与 `dt-event-text`。若不准备补本地 head/body 规则，就删除这两个额外类，不要指望它们自动产生布局。

### 3. 字段与类名逐项映射

| 当前数据 / 结构 | 官方最近邻 | 应改成的结构 |
|---|---|---|
| `payload.loading` | `LoadState` | `p.dt-hint`；保留已有结果时不清空旧时间线（`SA/src/client/widgets.tsx:108-112`） |
| `payload.error` | `LoadState(error)` | `p.dt-error[role=alert]`；有旧结果时错误与旧数据并存，不只 Toast |
| 空 `traces` | Thread 空时间线 | `Hint`，沿用服务端 `payload.text`；官方例子 `SA/src/client/thread.tsx:156-167` |
| 每个 `trace` | Source filtered / Thread Decisions 分组 | 外层 `.dt-row > .dt-row-main > DisclosureRow`；title 为 `#number @ repo`，闭合摘要为 verdict |
| `trace.verdict` | Trigger 正文 / collapsedContent | 闭合时放 `collapsedContent`；展开时放 `.dt-disclosure-body > .dt-event-text`，不要只留在无样式 head |
| `seen` / `reported` | Trigger head + 可选 body | 各转成一个事件：head 为“首次看到/上次上报” + `<time>`；无额外正文就不造空 body |
| `filtered[]` | `triggerTags(filtered)` + ClampText | head“被过滤”；body 放 `reason + title`；foot 用 `Tag(neutral)`；官方 filtered tag 见 `SA/src/client/thread.tsx:15-18` |
| `absorbed[]` | Earlier / quiet 自动事件 | head“冷却期吸收”；body 放 `title`；foot 可用 `Tag(warning)`；默认与异常组一起展开 |
| `wakes[].ok=true` | delivered/decision tag | head“唤醒成功”；foot `Tag(success 或 info)`；正常组默认闭合，只摘要最近一次成功 |
| `wakes[].ok=false` | blocked/failed banner 的事件级等价物 | head“唤醒失败”；body 必须保留 `reason`；foot `Tag(danger)`，不得用 quiet/reveal 隐藏 |
| 多个事件 | `ol.dt-timeline > li.dt-event` | 每个时间戳独立 head/body/foot，不再是一串同级 `.dt-event-foot`。官方 Thread 是最新优先；若主理鱼保留升序，Section 应明示“最早优先”，不要无声换序 |
| 当前 `.dt-event-head` | 官方 head 实际也是 `.dt-event-foot` | 使用 `.dt-event-foot` 提供 flex/wrap/字号；内部 actor 用 `.dt-event-actor`，时间用 `<time>` |
| 新增 body | `.dt-event-text` | reason/title/verdict 才进入 body；无正文不渲染空容器 |
| 事件 foot | 官方第二个 `.dt-event-foot` | 放 Tag、编号和真实动作；时间已经位于 head，不重复拼字符串 |

### 4. 还必须补的结构与行为

1. **highlight + 定位**：目标事件必须同时是 `li.dt-event.dt-highlight`，并有稳定 `id`；选中/深链时 `scrollIntoView({block:'center'})`，且只滚一次。官方实现是 `SA/src/client/thread.tsx:34-41`，样式是 `SA/src/client/client.css:60`。它不是红色错误态，也不能给所有事件都加。
2. **clamp + MoreToggle**：长 title/reason 用 `.dt-clamp-8`，并配 `aria-expanded` 按钮；阈值可沿用 >480 字或 >8 行（`SA/src/client/widgets.tsx:61-72`）。短错误才用 3 行 `.dt-clamp`。只加 clamp 而没有展开入口会丢信息。
3. **Disclosure 分组**：正常组默认闭合、异常组默认展开；闭合摘要保留 verdict 和最近一次成功。展开 children 必须包 `.dt-disclosure-body`，不能走当前 `CollapsibleList` 那种直接放 `<ul>` 的 incomplete 结构（当前 `ZL/client.js:354-365`；官方包装 `SA/src/client/ticket.tsx:40-45`）。
4. **quiet 与 reveal 的边界**：`.dt-event-quiet` 只弱化例行 seen/reported 或自动事件正文，不能隐藏失败原因；`.dt-reveal` 只适合“复制/重新评估”等次级动作，且有触屏 fallback（`SA/src/client/client.css:63,67-71`）。
5. **时间语义**：把 `event.at` 从字符串拼接改为 `<time dateTime title>`，显示层可复用 `When` 的相对/完整时间结构（`SA/src/client/widgets.tsx:12-15`）。
6. **不要虚构深链分页**：`around` / `before` / gap-free merge 需要服务端游标支持（`SA/src/client/thread.tsx:57-107`）。当前 `/trace` 没有这些参数，先保留完整现有结果，不复制一个看似能分页的空按钮。
7. **不要虚构执行事实**：ack 评论、执行 worktree、Session transcript、原 issue URL 当前不在 trace payload；将来有真实字段后可分别放 foot action 或 MandateDetails 式 Section，不能先从现有 `ok` 推导出来。

## 四、复用边界与 DSH 空白

### 1. 主理鱼现有移植层需要纠正的地方

这些是从官方源码回看当前实现的差异，不是另起 UI 设计：

- **页面壳未闭合**：官方是 `.dt-page > .dt-column > Header + Tabs + main.dt-main`（`SA/src/client/app.tsx:161-169`）；主理鱼当前直接从 `.dt-page` 放 page-head、Tabs 与内容（`ZL/client.js:2216-2278`）。因此官方的 960px 居中、column gap、container 语义没有完整生效。
- **ConfirmBtn 不是 ConfirmButton**：当前是第一次 armed、第二次执行（`ZL/client.js:481-497`）；官方是 Button + Modal description/footer + busy + 成功关闭（`SA/src/client/widgets.tsx:75-90`）。普通暂停可简确认，删除/清凭证等后果明确动作应使用 Modal。
- **Disclosure children 缺包装**：当前 `CollapsibleList` 直接渲染 `<ul>`（`ZL/client.js:354-365`）；官方调用方包 `.dt-disclosure-body`，否则缩进和 gap 不生效。
- **InfoTip 不能只换定位**：当前是父级 absolute 气泡（`ZL/client.js:404-414`）；官方还包含 body portal、视口夹取、focus-visible/touch、Escape/scroll/resize 关闭（`SA/src/client/controls.tsx:217-249`）。
- **Toast 保持单条 portal**：当前 `toastView` 直接放在页面树（`ZL/client.js:2265`），官方 Toast portal 到 body 并由 Provider 用 key 强制重挂载（`SA/src/client/provider.tsx:65-70,82-84,103-107`）。结构应对齐，不必改成多条堆叠。
- **当前 `dt-event-head/time/nums` 不是官方 CSS 类**：官方全文只提供 `.dt-event`、`.dt-event-text`、`.dt-event-actor`、`.dt-event-foot` 等（`SA/src/client/client.css:57-72`）。这些本地类可保留为 derived，但必须记录并补本地规则，不能声称已经“官方原样”。

### 2. 不应照搬的官方 Runtime 清单

| 官方能力 | 为什么不能直接复制 | 可保留的部分 |
|---|---|---|
| `/orchestrator/api` + `ApiError` | 主理鱼使用 `/session-superagent`、routeBase 发现、ETag 和自有错误文本；官方空 404/unreachable 语义不同（`SA/src/client/api.ts:32-58`；当前 `ZL/client.js:26-91`） | 请求序号、旧响应丢弃、错误保留旧数据 |
| 官方 `usePoll` / `PanelProvider` | 官方不知道主理鱼 ETag、routeBase 与宿主重载；restart down/up 也不是主理鱼状态机（`SA/src/client/provider.tsx:74-107`） | 隐藏降频、串行、busy、防重入 |
| 完整 `useDraft` / `merge3` | 当前 watcher 保存只提交 touched 字段，服务端未给每个 UI block 的 revision/409 契约；直接接上会假报 merged（`SA/src/client/draft.tsx:52-108,128-173`；当前 `ZL/client.js:1020-1030`） | sessionStorage、dirty/discard/busy、SaveBar、纯 merge 算法留待协议就绪 |
| `ConfigHistory` | 需要持久 revision、结构化 changes 与 `GET policy/history`（`SA/src/client/settings-kit.tsx:123-160`） | Disclosure + timeline + highlight DOM；没有历史 API 就不显示假历史 |
| `DeploymentPage` | ConfigForm 与三项官方 limits 不属于主理鱼 watcher（`SA/src/client/deployment.tsx:32-84`） | ready/writable/read-only/unavailable 状态分支 |
| `SessionButton` / `CheckSetupButton` | 依赖宿主 openSession、setup/check、restart 和 Assignment running 数（`SA/src/client/widgets.tsx:91-96,133-147`） | 按钮外观、busy、确认结构 |
| Ticket / Assignment / Inputs / Channels | 主理鱼的核心是 watcher → filter/decision → wake → ack，不是官方执行器实体 | Mandate 式“本次唤醒依据”、状态行、详情渐进披露 |
| Prompts 全套编辑器 | 主理鱼 goal 不是官方团队 Prompt/内置 parts/skill 组合系统（`SA/src/client/prompts.tsx:20-67`） | dirty 标记、历史只载入草稿、diff 结构；无 revision 不做历史 |

### 3. Superagent 未覆盖，应转向 DSH 官方主库的空白

以下只使用 `DSH_UI/` 主库。主库明确提醒：其当前批次没有完整 primitives 内部实现，Modal/Menu/Tooltip/Toast/SettingsForm 等未出现的数值必须标“待验”，不能拿别的拆包或截图倒填（`DSH_UI/structure/official-settings-tree.md:307-313`）。

| 空白 | DSH 官方素材 / 结构 | 主理鱼应怎么用 |
|---|---|---|
| **行内更多菜单与渐进动作** | DSH Workspace 行把次要动作放 hover/menu，而不是全量常驻（`DSH_UI/structure/official-shell-tree.md:101-105`）；官方 ellipsis 图元已登记于 `DSH_UI/structure/official-assets-reuse.md:44-55`，真实 JSX 为 `DSH_UI/assets/icons/sidebar/ellipsis.jsx:1-3` | watcher 的编辑/暂停/删除可按频率收纳；superagent 没有通用 Menu 组件。菜单键盘/portal 内部数值主库未覆盖，标待验，不自称官方完成 |
| **本地即时搜索 + Host 搜索的层级** | DSH Workspace 非空查询替换整棵树；标题/Workspace 即时子串 + 250ms Host 内容搜索，失败仍保留元数据结果（`DSH_UI/structure/official-shell-tree.md:102-105`）；搜索图元 `DSH_UI/assets/icons/workspace/search.jsx:1-2` | 主理鱼可让 repo/watcher 本地过滤立即反馈，编号 `/trace` 明确提交；不要把本地过滤称为全文搜索。superagent SearchResults 只有提交式管理搜索 |
| **工具执行明细、Inspect 与未知 JSON** | DSH ToolCallTree 按 callId 递归真实 subCalls；ToolRow 只有有内容才 disclosure、有回调才 inspect，未知 JSON 原样显示（`DSH_UI/structure/official-shell-tree.md:123-125`） | 将来展示真实 wake 执行记录时转向此结构，不要把工具树硬塞成 TraceTimeline 的字符串 foot；没有 parentCallId/subCalls 不画假树 |
| **完整 Markdown / 执行 IO** | DSH 助手 Markdown 保持 text/reasoning/tool 的真实顺序；ToolRow bodyScroll/ioCard 有独立几何与状态（`DSH_UI/structure/official-shell-tree.md:121-125`）；官方 code/api/browse 等图元登记于 `DSH_UI/structure/official-assets-reuse.md:105-118` | superagent MarkdownLite 只够 verdict/短说明；完整 issue/PR body、命令输出、错误日志应复用 DSH 对应结构，不继续扩 MarkdownLite 假装支持全部 GFM |
| **凭证/provider 编辑与 secret 边界** | DSH Models 树包含 retryableError/notices/savedNotice、provider row/card/editor、delete ConfirmDialog；editor 只提交可见字段 path ops，secret 不回显，未知 namespace 只读（`DSH_UI/structure/official-settings-tree.md:140-175`） | 主理鱼“设置 → 凭证”应采用这类 secret/editor 状态，而不是把 superagent 普通 Input + SaveBar 当作完整凭证方案；具体写操作仍接真实 credentials API |
| **高风险动作的专用确认** | DSH Models 删除有独立 deleteTarget → Modal → ConfirmDialog → error（`DSH_UI/structure/official-settings-tree.md:142-162,170-173`）；权限 danger/auto 也只有真实风险确认（`DSH_UI/structure/official-shell-tree.md:129`） | 普通停止沿 superagent ConfirmButton；删除 watcher、清凭证或未来真实 danger-full-access 应参考 DSH 风险确认与错误驻留。没有对应能力就不新增权限控制 |
| **可重试加载、分组卡片与空目录** | DSH 内置插件页明确 loading skeleton / error+retry / search / session+global groups / card facts（`DSH_UI/structure/official-settings-tree.md:181-204`） | superagent LoadState 只有 Hint/error；主理鱼来源与仓库目录较大时，可借“错误可重试 + 分组 + 卡片事实”，但无真实 fiberPhase/condition 等字段不照搬这些名词 |
| **连接状态的官方位置与真值** | DSH footer 的设置/连接由真实 settings 连接状态驱动，不另造固定 statusbar（`DSH_UI/structure/official-shell-tree.md:106`） | superagent StateDot 只解决状态点；主理鱼连接/重连提示应放在既有来源或设置区域，且只在有 disconnected/connecting/recovered 真值和重连动作时出现 |
| **workdir / 目录选择** | DSH Hero workspace pill 只有 picker 动作存在才可点（`DSH_UI/structure/official-shell-tree.md:118-119`）；folder/project 图元已登记 `DSH_UI/structure/official-assets-reuse.md:56-65`，真实文件如 `DSH_UI/assets/icons/workspace/folder-close.jsx:1-2` | superagent 只有文本 Input，没有目录选择器。可先复用官方 folder 图元；完整 browse/native picker 在主库仍是缺口，不能把文件多选或自造目录弹层冒充官方（`DSH_UI/structure/official-parity-current.md:245-250,277-283`） |
| **大时间线的搜索与虚拟化** | DSH Trajectory 有独立 toolbar/search/count、可见窗口搜索边界、>100 records 虚拟化与向前历史（`DSH_UI/structure/official-shell-tree.md:143-145`） | 当前少量 trace 用 superagent timeline 足够；若以后变成完整常驻执行 ledger，应转 DSH Trajectory 结构，不用无限 li 或把可见窗口搜索说成完整历史 |
| **丰富空态 / Hero 与品牌素材边界** | DSH Hero 是双轴居中、真实 headline/fish/workspace action，而不是通用 `dt-empty`（`DSH_UI/structure/official-shell-tree.md:112,118-120`）；官方品牌素材与哈希见 `DSH_UI/structure/official-assets-reuse.md:35-42` | superagent 只有 Hint，主理鱼 Onboarding 的 `.dt-empty/.dt-step*` 只能标 derived。可借“标题 + 真实下一步 + 无 workspace 不编目录”的结构；不要把 DSH wordmark/鲸鱼当主理鱼自有品牌或官方背书 |
| **superagent 图标表没有的语义图元** | DSH 主库已有 ellipsis、folder/project、question、goal、checklist 等真实 JSX，并记录来源/hash/viewBox（`DSH_UI/structure/official-assets-reuse.md:44-65,105-118`） | 新增“更多 / workdir / goal / 诊断”图标时优先复制这些 JSX 图元，不手画近似。许可证与 JSX fragment 边界见 `:16-28,131-138` |

### 4. 建议实施顺序（仍不增加一级 Tab）

1. **先做无 API 变化的结构对齐**：补齐 `.dt-column/main.dt-main`，统一 Section、watcher/Decision row、设置左右栏、Disclosure body、Modal Confirm、单条 portal Toast。
2. **随后改 TraceTimeline**：直接使用现有 `title/reason/at/ok/verdict`，完成分组 Disclosure、事件 head/body/foot、time、clamp、异常展开与目标 highlight；不需要先改服务端。
3. **再接本地真实状态**：Fields/SaveBar 只接当前 dirty/saving/error/touched 字段；没有 revision 就不做 awaitingRevision/merged/config history。
4. **最后补大数据与执行面**：只有真实游标、callId/subCalls、ack URL、完整 Markdown、directory picker 契约出现后，才引入对应 DSH 结构。缺数据时隐藏或只读，绝不用官方外观包装虚构能力。

---

本文仅写此文档；未修改生产代码、未 commit。所有“可直接复用”结论都是静态源码/CSS 对照，未宣称已经完成 GUI 像素或交互验收。
