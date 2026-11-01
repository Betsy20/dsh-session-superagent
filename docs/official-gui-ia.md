# 官方插件 dsh-superagent 的浏览器端 GUI 信息架构（考古报告）

> 目标：把官方插件 `dsh-superagent@0.1.0`（`dsh-superagent-prototype`（本地 checkout））的**面板 IA、控件、交互、文案、依赖**完整扒出来，作为「主理鱼」（`dsh-session-superagent`）重写 GUI 的施工蓝图。
>
> **证据约定**
> - 行号一律指 `lib/client.js`（6883 行，tsdown 产物，保留 `//#region src/...` 模块边界）。
> - 同构的原始 TS 在 `src/client/*.tsx`（类型、注释、JSX 都在），编译后类型被擦除，所以**类型形状**我额外标注 `src/...` 行号；**行为与文案**以 `lib/client.js` 为准。
> - 全部 CSS 是**一行**：`lib/client.js:664` 的巨型字符串（源 `src/client/client.css`，一行一个规则）。本文所有 "css:N" 指该文件的行号；`lib/client.js:664` 一律写作 "css"。
> - 文案键 → 原文：`lib/client.js:3421-4150`（`const TEXT`，**724 条** `[zh, en]` 条目，含 `userError.*` 44 条与 `setup.*` 16 条；任务书说的 709 是另一口径）。

---

## 0. 一页速览

| 维度 | 官方做法 |
|---|---|
| 挂载点 | 3 个槽位：`main`（整块主区面板）+ `sidebar.panellist`（侧栏图标）+ `plugins.row.config`（插件市场配置页）—— `lib/client.js:6852-6875` |
| 布局 | **单列居中**（`max-width:960px`），顶部标题+工具条 → 6 个 tab → 主区；**没有左右分栏、没有详情抽屉** |
| 导航 | 6 个 tab（overview/source/trigger/eval/execution/settings）+ 2 个整页详情（thread / ticket），自己实现路由对象 + sessionStorage 历史栈（最多 20 步）—— `lib/client.js:1468-1566`、`6751-6789` |
| 状态 | 首页轮询 `GET state`，5s 一次；页面隐藏时 ×6 退避；重启时 1s 一次等它回来 —— `lib/client.js:595-637`、`829-898` |
| 配置 | 每个配置块独立「草稿」：sessionStorage 持久化 + 三方合并（`merge3`）+ 409 重基 + 冲突提示 —— `lib/client.js:899-1232` |
| 风格 | 自写 13 个原语（Icon/Button/Tag/Pill/SegmentedTabs/SegmentedControl/Input/Switch/StateDot/Dot/DisclosureRow/Modal/InfoTip）+ 18 个复合件，全部用 `--dsw-alias-*` token —— `lib/client.js:34-425`、`1567-1876`、`664` |
| 依赖 | 客户端包 inject 6 个；组件侧 `inject = ['slots','locale','sessions','uiWorkspace']` —— `lib/client.js:6839-6844`、`package.json` |

---

## 1. 外层结构

### 1.1 挂在哪个槽位

入口是 `src/client/index.tsx`，编译后在 `lib/client.js:6790-6883`。

常量与命名空间（`6792-6794`）：

```js
const NS = "dshSuperagent";      // locale 命名空间
const PANEL_ID = "dsh-superagent"; // 面板 id / 侧栏 id
const ENTRY = "dsh-superagent";    // DSH 配置条目名（configForms 的 key）
```

`apply(ctx)`（`6846-6876`）做四件事：

1. **注册词典**：`ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-superagent: dictionaries')`（`6848-6850`），然后 `const t = ctx.locale.bind(NS)`（`6851`）。全部 UI 文案都走 `t(key, values)`，`t('lang')` 返回当前语言 `'zh'|'en'`（`text.ts:9-13`，编译在 `701-704`）。
2. **主区面板** → 槽位 `main`（`6852-6860`）：
   ```js
   ctx.slots.inject("main", () => ctx.slots.register({
     name: "main", key: PANEL_ID, locale: NS, inject: () => ({})
   }, (props) => <Mounted ctx={ctx} t={props.t} />));
   ```
   即：官方 GUI 是 **ui-layout 主区的一个命名面板**（`MainPanelId`），不是侧栏、不是会话内嵌块。
3. **侧栏图标** → 槽位 `sidebar.panellist`（`6861-6867`）：
   ```js
   { name:"sidebar.panellist", id: PANEL_ID, order: 10, label: () => t("panel"), locale: NS }
   ```
   图标是内联 SVG `HammerIcon`（`6796-6813`，三笔路径，`strokeWidth:1.8`，`currentColor`，**无 fill**）。
4. **插件市场配置页** → 槽位 `plugins.row.config`（`6868-6875`）：
   ```js
   { name:"plugins.row.config", key: `${ENTRY}#${ENTRY}`, locale: NS }
   ```
   渲染 `PluginConfig`（`4564-4571`）：`view === 'page'` 时套一层 `PanelProvider(interval=10000)` 渲染 `DeploymentPage`（带 `accounts` 派生信息），`view === 'summary'` 返回 `null`（摘要交给 DSH 显示包描述）。

组件层依赖声明（`6839-6844`）：

```js
const inject = ["slots", "locale", "sessions", "uiWorkspace"];
```

- `sessions` + `uiWorkspace` 只为一个功能：**「打开主 Session」/「打开某个执行器 Session」**（见 `Mounted` `6814-6838`：`openKnownSession(ctx.sessions, id, t => ctx.uiWorkspace.openSession(t), signal)`，失败映射 `sessionListNotReady` / `sessionNotListed`，并且用 AbortController 取消上一次跳转）。
- `configForms` 是**可选**的（`6836`：`ctx.get('configForms')?.get(ENTRY)`）；没有它时部署页退化成只读。

> 施工提示：这三个槽位我们全都没有（我们只有 `conversation.view` 与 `conversation.composer.dock`）。**官方 IA 的"外层"对我们不可复用，可复用的是"里面那一整套"。**

### 1.2 整体布局

DOM 骨架（`6673-6750` 的 `Pages`）：

```
.dt-page                              ← 整页滚动容器；padding: 28px clamp(24px,4vw,48px) 0；container-type: inline-size
└ .dt-column                          ← max-width: 960px; margin: 0 auto; gap: 24px
  ├ Header .dt-head                  ← h1 标题 + .dt-toolbar（搜索框 / 术语表按钮 / 打开主 Session）
  ├ (可选) p.dt-error[role=status]   ← state 已有但最新一轮轮询失败时的顶部错误条
  ├ SegmentedTabs .dt-tabs           ← 6 个 tab，窄屏横向滚动
  └ main#dt-page.dt-main[role=tabpanel]
      └ 当前 tab 的页面（每个页面自己用 .dt-form / .dt-list 排版）
```

- `.dt-page`：`overflow:auto; scrollbar-gutter:stable; scroll-padding:48px 0 72px; container-type:inline-size`（css:2）。
- `.dt-column`：`max-width:960px`（css:7）——**官方面板是窄栏阅读型布局，不是仪表盘**。
- `.dt-main`：`display:flex; flex-direction:column; gap:24px`（css:108）。
- 顶部**不是 sticky**（`.dt-head` 只有 `position:relative; z-index:3`，css:8），滚动时 tab 条会一起滚走；只有窄屏（`container max-width:640px`）才用 `mask-image` 给 tab 条做渐隐提示左右还有内容（css `@container` 段）。
- 响应式用 **container query**（`container-type:inline-size` + `@container (max-width: 640px)`），不是 media query——因为面板宽度由 DSH 主区决定。

`Header`（`6565-6672`）三块：

| 元素 | 行为 | 文案键 |
|---|---|---|
| `h1.dt-title` | 静态标题 | `title` = 「Superagent」 |
| 搜索表单 `.dt-search` | 提交 `GET search?q=<text>`；结果面板浮在下方 6px；点击外部/Escape/清空即关；请求带自增序号丢弃过期响应（`latest` ref，`6570-6601`） | `searchPlaceholder`「搜索工单、线程、触发或链接」/`searchLabel` |
| 术语表按钮 `icon=question` | 打开 `Glossary` Modal | `glossary`「术语表」 |
| 打开主 Session 按钮 | `openSession(masterId)`，`masterId` 为空时 disabled | `openMaster`「打开主 Session」 |

`SegmentedTabs` 渲染（`6722-6738`）：`items = TABS.map(v => ({value:v, label:t('tab.'+v), id:'dt-tab-'+v, panelId:'dt-page'}))`，`aria-label = pagesLabel`「dsh-superagent 页面」。

### 1.3 路由模型

**tab 列表与设置分组**（`1470-1484`）：

```js
const TABS = ["overview","source","trigger","eval","execution","settings"];   // 1470-1477
const SETTINGS_GROUPS = ["source","eval","execution","prompts","deployment"]; // 1478-1484
```

**路由类型**（编译后擦除，形状见 `src/client/route.ts:11-17`）：

```ts
type Route =
  | { page:'overview' | 'source' }                                  // 无参数
  | { page:'trigger';  id?:undefined; query?:{ filter?: ThreadFilter } }   // 列表页：subscribed|evaluating|recent|all
  | { page:'trigger';  id:string;     query?:{ trigger?:string } }          // 详情页：线程 key + 高亮某条触发
  | { page:'eval';     id?:undefined; query?:{ filter?:DecisionFilter; window?:'24h' } }
  | { page:'execution';id?:undefined; query?:{ filter?: TicketFilter } }     // open|person|working|idle|ended
  | { page:'execution';id:string }                                          // 详情页：工单 id
  | { page:'settings'; id?:undefined; query:{ group:SettingsGroup; source?:string; version?:string } }
```

> **关键结论：官方没有"抽屉"，两个详情页是整页路由**（`trigger + id` → `ThreadPage`，`execution + id` → `TicketPage`）。列表行点击 = `navigate({page,id})`。见 `Pages` 的分支（`6695-6721`）。

**parseRoute**（`1501-1542`）：白名单式解析 + 归一化。

- 未知 `page` → `undefined`（所以旧版的 `policy` tab 会被静默丢弃）；
- 每个 query 字段单独 `pick` 白名单：`THREAD_FILTERS` / `DECISION_FILTERS` / `TICKET_FILTERS` / `SETTINGS_GROUPS`；`window` 只接受 `'24h'`；
- `compact()`（`1496-1500`）丢掉 `undefined` 的键；`id` 必须是**非空字符串**才算详情页；
- `settings` 的 `group` 缺省回落到 `'source'`。

**历史与持久化**（`1543-1566` + `6751-6789`）：

```js
const ROUTE_KEY = "dsh-superagent/route";        // sessionStorage 键（1543）
interface Location { route: Route; stack: Route[]; group?: SettingsGroup }
```

- 初始化：`initialLocation()`（`1545-1560`）读 sessionStorage → `parseRoute` 清洗 route 与 **stack 里每一项**（坏的直接丢），失败一律回 `HOME = {page:'overview'}`（`1485`）。
- 每次 location 变化：`useEffect(() => remember(location))` 写回（`6754-6756`）。
- 写栈语义（`6757-6779`）：
  - `navigate(route, replace=false)` → `stack = [...stack, currentRoute].slice(-20)`（**最多 20 层**）；
  - `navigate(route, replace=true)` → 只换当前项、不动栈——**筛选项、分页、设置分组切换都用 replace**，避免"点 5 次筛选要按 5 次返回"；
  - `back()` → 弹栈，栈空回 `HOME`；
  - `openTab(tab)` → **清空整个栈**；点 `settings` 时恢复上次的分组（`lastSettingsGroup`，`1544`：`route.page==='settings' ? route.query.group : group ?? 'source'`）。
- `backLabel` = 上一个栈顶 route 的 label（`routeLabel` `1494`：有 `id` 的返回 `term.thread`/`term.ticket`，否则 `tab.<page>`），传给 `PanelProvider` 再进 `PageHead`。

**为什么不用 URL**：面板在 SPA 主区里，没有独立的地址栏维度；`sessionStorage` + 内存栈已经覆盖"刷新后回到原位"。代价是**不能分享链接**——它用「全局搜索」补这个缺口（搜到就能点进去，见 §2.0）。

### 1.4 状态从哪来

`PanelProvider`（`829-898`）是唯一的全局数据源：

| 字段 | 来源 | 用途 |
|---|---|---|
| `state` | `usePoll(() => call('GET state'), [], 5000)`（`889`） | 全局心跳：`setup`/`load.running`/`load.queued`/`maxWorkers`/`masterId`/`paused`/`health` |
| `error` | 同上 | 顶部错误条 |
| `reload` | 同上 | 手动重取（暂停/恢复后） |
| `setup` | `state.setup` | 部署问题、账号派生信息 |
| `running` | `state.load.running ?? 0` | "重新检查会不会打断派工"的判断 |
| `restarts` | 重启探测计数器 | 让依赖视图在插件重启后重新拉数据 |

页面级数据各自 `usePoll`：`GET overview`（`4332`）、`GET sources`（`5531`）、`GET threads`（`6357`）、`GET decisions`（`2648`）、`GET tickets`（`3133`）、`GET settings`（`2166`）、`GET tickets/:id`（`6140`）、`GET threads/:key`（`5722`）。

API 根路径：`/orchestrator/api/<path>`，且每个请求带 `x-orchestrator-request: 1` 头（`546-585`，用于 host 侧区分"来自面板"）。

---

## 2. 六个 tab 逐个拆

> 通用骨架：每个 tab 页面自己渲染内容，**没有统一的页面头**；`StatusHead`（`1806-1821`）是状态类页面的统一头（`状态` 标题 + InfoTip 说明 + 「设置」跳转按钮），`PageHead`（`1822-1841`）是详情页头（返回按钮 + 标题 + 操作区）。

### 2.0 全局搜索（跨 tab 的导航补丁）

`SearchResults`（`6486-6564`）+ `GET search{q}`：

- 结果分三类渲染，**顺序固定**：tickets → threads → items（触发）。
- 计数行：`searchFound{tickets,threads,items}`「找到 {tickets} 个工单、{threads} 个线程、{items} 条触发」；items 达到 20 条上限时改用 `searchFoundCapped`「…前 {items} 条触发（请缩小搜索范围）」。
- 空态：有飞书账号时 `searchNone`（提示可输入触发文字/GitHub 链接/#编号/飞书消息链接/`om_` id），否则 `searchNoneGithub`（去掉飞书那半句）。
- 每行：ticket → 跳 `execution/:id`，第二行给 `term.ticket` + 结束/阶段标签；thread → 跳 `trigger/:key`；trigger → 跳 `trigger/:key?trigger=<id>`，右侧给 `source`/actor/时间/`inThread`；**被来源过滤的触发不可点**，改显示 `searchFiltered{reason}`「被来源过滤：{reason}」（`6520-6523`）。
- 查询命中用 `<mark class="dt-mark">` 高亮（`6454-6465`）。

**术语表 Modal**（`6392-6453`）：三列表格（当前语言 / 另一种语言 / 含义）+ 状态颜色图例 + 枚举值速查（决策/强度/工单阶段/派工/报告）。数据来自 `GLOSSARY`（`4151-4186`）与 `GLOSSARY_VALUES`（`4187-4193`）：6 个分组（roles/source/trigger/eval/execution）。**这是个低成本高质感的组件，建议照抄。**

---

### 2.1 `overview` 概览

数据：`GET overview`（`4332`）。渲染 `OverviewPage`（`4329-4420`）。

区块（`Section`，`1589-1619`，标题支持 `count`/`hint`(InfoTip)/`badge`/`icon`/右侧 action）：

| # | Section 标题（键/中文） | 内容 | 空态 |
|---|---|---|---|
| 1 | `pendingTickets`「待处理工单」+ count=`person.length` | `TicketLine` 列表（`question` 模式，带内联操作按钮，`onChanged=reload`） | `Hint` = `needsYouNone`「没有待处理的工单。」 |
| 2 | `problems`「系统问题」+ count（**仅 `length>0` 时渲染**） | `ProblemLine` 列表，见下表 | — |
| 3 | `lastDay`「过去 24 小时」+ 右侧 action「详情 ›」→ `trigger?filter=recent` | 5 个 `.dt-stat` 数字 | — |
| 4 | `term.executor`「执行器」+ 右侧 action「详情 ›」→ `execution` | 3 个 `.dt-stat`；若 `setup.problem` 存在则只显示 Hint = `executorWaitingSetup`「执行器等待部署检查」 | — |

**`problems` 的 9 种 kind**（`4223-4328`，每种一个渲染分支）：

| kind | 触发条件 | 标题文案 | 正文 | 提供的操作 |
|---|---|---|---|---|
| `setup` | 部署检查失败 | `problemSetup`「部署检查未通过，dsh-superagent 暂不接单」；`place==='feishu'` 时用 `problemSetupFeishu`「飞书机器人检查未通过，飞书来源暂停」 | `SetupMessage`（`setup.<code>` 文案 + 可选 `values.output` 原始输出，`.dt-mono.dt-clamp`） | 跳 `setupPage(place)`；hint=`problemSetupFix.<place>`；`CheckSetupButton`（`POST setup/check`，若 `running>0` 先弹确认 `setupCheckInterrupts`） |
| `no-source` | 没有任何运行中的来源 | `problemNoSource`「没有运行中的来源，不会收到任何触发」 | — | 按钮 `actionOpenSources`「去打开来源」→ `settings?group=source` |
| `no-allowed` | 各来源名单全空 | `problemNoAllowed`「没有人能发起工作：…」 | — | 按钮 `actionAddAllowed`「去添加」→ `settings?group=eval` |
| `executor-paused` | 处理已暂停 | `problemPaused`「处理已暂停：不开始新的评估，不派工，不发送回复」 | — | `ConfirmButton` `resumeProcessing` / 确认文案 `resumeProcessingConfirm` → `POST executor/pause {paused:false}` + reload |
| `runtime-error` | `state.health[name].state==='error'`（排除来源专属与 `sync:`/`evals`） | `problemRuntime`「运行异常：{name}」 | 原始 `detail`（`.dt-error.dt-clamp.dt-mono`） | 无 |
| `source-error` | 某来源某个 health 项 error | `sourceError`「{source} 来源异常」 | `healthText`（`healthCode.<code>`）或原始 detail | 跳 `source` tab，hint=`sourceErrorHint` |
| `eval-overdue` | 评估超时未决定 | `problemEvalOverdue`「评估超时未决定：{thread}」 | — | 跳 `trigger/:key` |
| `eval-unavailable` | 24h 内有未完成且未 dismiss 的评估 | `problemEvalUnavailable`「评估未完成：{thread}」 | `reasonLabel(reason)` | 两个按钮：`requeue`「重新评估」→ `POST triggers/:id/requeue`；`dismiss`「不再提示」→ `POST decisions/:id/dismiss` |
| `outgoing` | 有重试失败的回复 | `problemReply`「{source} 回复发送失败（已重试 {attempts} 次）」 | 原始 error | 无 |

行样式 `.dt-row.dt-att.dt-att-error`（error 用红，其余用琥珀），左侧 2px 竖条 + 标题色（css `dt-att` 段），**这是唯一带"警示条"的列表**。

「过去 24 小时」5 个数字（`4349-4368`）：

| 标签键 | 中文 | 是否可点 |
|---|---|---|
| `flowReceivedLabel` | 到达 | 否（触发数 ≠ 线程数/决策数，刻意不给链接） |
| `flowFilteredLabel` | 被过滤 | `flow.filtered` 非 0 时 → `source` |
| `flowJudgedLabel` | 已评估 | 否 |
| `flowAcceptedLabel` | 接单或续做 | → `eval?window=24h` |
| `flowDroppedLabel` | 放弃发送 | 仅 `dropped>0` 时渲染，→ `source` |

执行器区 3 个数字：`executingLabel`「执行中」= `running / maxWorkers`、`queuedLabel`「排队」、`idleLabel`「等待新触发」。

**加载/错误**：无数据时 `LoadState`（`1784-1792`）→ 有 error 显示 `p.error[role=alert]`，否则 `Hint` = `loading`「正在读取…」。已有数据时刷新失败，在页面顶部再叠一条 `LoadState`（`4359`）。

**关键响应字段**（`src/app/views/overview.ts:71-79`）：`problems[]`、`person[]`(ticketRow)、`executor{running,queued,idle,maxWorkers}`、`flow{received,filtered,triggers,judged,accepted,evaluating,dropped}`、`policyVersion`。

---

### 2.2 `source` 来源

数据：`GET sources`（`5531`）。渲染 `SourceStatus`（`5528-5566`）。

结构（自上而下）：

1. `StatusHead`（`1806-1821`）：标题固定为 `statusTitle`「状态」+ InfoTip = `sourceStatusIntro`「每个来源是否在运行、过去 24 小时到达和被过滤的触发，以及被过滤的原因。」+ 右侧 `tab.settings`「设置」按钮 → `settings?group=source`。
2. **全局部署问题条**（仅 `setup.problem.place==='deployment'`）：`SetupMessage` + 链接 `setupFixLink`「去修正」。
3. 列表：`SourceRow`（`5420-5527`）逐来源。

`SourceRow` 一行 = 6 层信息：

| 层 | 内容 | 文案 |
|---|---|---|
| 圆点 | `Dot state={dot} label={state}`，`sourceMark` 映射 7 态（`1342-1344` + `1312-1320`） | `missing→idle/sourceNotInstalled`、`off→idle/sourceOff`、`error→error/sourceState.error`、`setup→idle/sourceState.setup`、`starting→ongoing/sourceState.ongoing`、`paused→warning/sourceState.warning`、`ready→done/sourceState.done` |
| 标题行 | 名称 + 状态文字 `.dt-status-text[data-state]`（warning/error 才上色，css:272-275） | 同上的 `sourceState.*` |
| meta 行 | 3 个 `LabelValue`：`sourceReceivedLabel`「24 小时到达」、`sourceFilteredLabel`「被过滤」、`sourceLatestLabel`「最近」 | 值为 0/空则**不渲染** |
| 问题行 | `SetupMessage` + 文字链接 `sourceOpenSettings`「去设置」→ `settings?group=source&source=<id>`（会自动滚到该卡片） | — |
| health 备注 | 只渲染 `state==='error'\|'paused'` 且 `enabled`、且**没有** `problem`、且**全局** `setup.problem` 不存在时（`5479-5486`，避免重复解释） | `valueLabel('health', name)` + `labelSeparator`「：」+ `healthText`（raw detail 用 `.dt-mono`） |
| 折叠组 | ① `sourceFilteredTitle`「24 小时内最近被过滤的触发」（最多 5 条，来自 host）；② `DroppedReplies`（`5356-5419`）= `sourceDroppedTitle`「24 小时内放弃发送的消息」+ Hint `sourceDroppedHint` | 每条过滤：`actorName：preview` + `Tag tone=neutral` reason + `<When>`；每条放弃：preview + Tag reason + 时间 + 指向 ticket/thread 的链接 |

空态：**没有专门空态**——没有来源时列表为空，只剩 StatusHead（对比 overview 有 `needsYouNone`，这里官方选择不提示）。

加载/错误：`LoadState`（`5541`）：`!data` 时显示 loading 或错误。

**关键响应字段**（`src/app/views/sources.ts:50-56`）：`id/title/installed/enabled/state/health[{name,state,code,detail,values,at}]/problem?/stats{received,filtered,lastAt}/filtered[{id,at,actor,preview,reason}]/dropped[{id,kind,channel,preview,dropped{reason,at},ticket?,thread?}]`。

**设置里的来源卡片**（`SourceSettings` `5346-5355` + `SourceCard` `5247-5345`）——这是 settings tab 的 `source` 分组，见 §2.6。

---

### 2.3 `trigger` 触发

**列表页 `TriggerStatus`**（`6354-6389`）：数据 `GET threads?filter&limit`。

| 元素 | 说明 |
|---|---|
| `StatusHead`（无 settings 按钮） | InfoTip = `triggerIntro`「触发按线程归组；线程决定它们扇出给哪些工单、由哪次评估处理。」 |
| 4 个 `Pill` | `threadFilter.subscribed`「已被订阅」/`evaluating`「评估中」/`recent`「24 小时内有新触发」/`all`「全部线程」；点击 = `navigate(..., replace=true)` 并把 limit 重置为 20 |
| 列表 | `ThreadLine`（`1975-2031`）：阶段标记（`StageMark`）+ 标题按钮 → `trigger/:key` + 引用行（`最新 actor：preview`）+ meta（`ThreadChip`、`fanoutTo` 或 `pollError`、`<When>`） |
| 分页 | `limit` 初值 20，`data.next_offset != null` 时显示 `LoadMore`「加载更多」（+20） |
| 空态 | `Hint` = `threadsNone`「没有符合条件的线程。」 |

**详情页 `ThreadPage`**（`5811-5946`）：数据 `GET threads/:key?limit=50&before&around`。

自上而下：

1. `PageHead`：返回按钮（`backLabel`）+ 标题 `readableMarkers(title)` + 右侧 `ActionLink` `openOriginal`「打开原文」（有 `url` 时）。
2. 状态行 `.dt-row-meta.dt-status-line`：`valueLabel('source')`、`threadLatest{time}`「最近 {time}」、`threadCreated{time}`「创建 {time}」。
3. 评估中横幅（`data.evaluating`）：`evaluatingBanner{count,strength,deadline}`「评估进行中：{count} 条触发，{strength}，{deadline} 到期。」
4. 轮询错误：`pollFailed{error}`「轮询失败：{error}」。
5. `Section subscribedTickets`「订阅此线程的工单」+ count：`TicketLine` 列表（`context` 标记只作上下文的工单）。
6. 折叠 `threadDecisions{count}`「这个线程的决定 · {count}」：`DecisionLine` 列表。
7. `Section term.correlation`「关联」：相关线程按钮 → 另一个 ThreadPage。
8. `Section timeline`「触发时间线」+ count=`newestFirst`「最新在前」：
   - `automatedRuns()`（`2121-2132`）把**同一来源同一发送者**的连续自动触发折叠成一条，其余进 `Earlier`（`2133-2151`，可展开「同一发送者之前还有 {count} 条自动消息」）；
   - 每条 `TriggerItem`（`5647-5705`）：actor + 时间 / `ClampText` 正文（>480 字或 >8 行时折叠，`1688-1698`）/ 交回提示 `handedBack{ticket,reason}` / 一排 `Tag`（去向）+ 「查看工单」+「重新评估」（hover 才显现，`.dt-reveal`）；
   - 深链目标会 `scrollIntoView({block:'center'})` 并加 `.dt-highlight`；
   - 空态 `Hint` = `noTriggers`「没有保留的触发。」；
   - 更早：`loadEarlier`「加载更早的触发」按钮（`data.earlier` 非空）。
9. **危险区** `.dt-danger-zone`：`unsubscribeHint`「取消订阅后，…」 + `ConfirmButton` `unsubscribe`「取消订阅」/ 标题 `unsubscribeTitle` / 确认文案 `unsubscribeConfirm{title}` → `POST threads/:key/unsubscribe`，返回 `context_delivery==='pending'` 时额外 toast `unsubscribePending`「已取消订阅，结果等待注入主 Session。」

**分页的坑（必须照抄）**：`useThreadTimeline`（`5719-5805`）里，轮询只取最新 50 条，翻页取更早的 50 条，两者之间可能出现"断档"。它用 `overlaps`/`byTime`/`gapBetween`（`5703-5705`）检测，检测到断档就**自动循环 `before=earlier` 向前补齐**直到重叠（`5762-5781`），再用 `mergeTimeline` 按时间去重合并。深链目标不在当前页时用 `around=<triggerId>` 单独拉一页（`5745-5755`）。

**去向标签语义**（`triggerTags` `5614-5646`）：

| 标签 | 条件 | 文案 |
|---|---|---|
| 排队 | `disposition.queued` | `dispositionQueued`「已排队，等待评估」 |
| 评估中 | `disposition.evaluating` | `dispositionEvaluating`「评估进行中」 |
| 被过滤 | `disposition.filtered` | `tagFiltered{reason}`「已过滤：{reason}」 |
| 决策 | `decision.outcome !== 'ignore'` | `decisionMark().label`（接单/续做/停止/未完成） |
| 已送达 | `disposition.delivered` | `dispositionDelivered`「已送达工单」（title=`dispositionDeliveredHint`） |
| 扇出 | `fanout.length`（且不全在已订阅工单里） | `dispositionFanout{count}`「扇出到 {count} 个工单」 |

**关键响应字段**（`src/app/views/records.ts:171-177`）：`key/source/title/stage/latest{actor,human,at,preview}/lastAt/createdAt/subscriptions/tickets[{id,title,state}]/evaluating{id,strength,triggers,startedAt,deadline}/pending/pollError/url/facts`；详情追加 `url/context[]/correlated[{key,title}]/tickets[]/decisions[]/timeline[]/earlier`。

---

### 2.4 `eval` 评估

**列表页 `EvalStatus`**（`2645-2707`）：数据 `GET decisions?limit&kind&window`。

| 元素 | 说明 |
|---|---|
| `StatusHead`（带设置按钮） | InfoTip = `evalStatusIntro`「评估按策略对触发做出的决定，每条写明理由。」 |
| 暂停横幅（`paused`） | `dt-banner`：`evalRecordsPaused`「处理已暂停：新的触发会被记录，但不会被评估。」+ 链接 `resumeWhere`「在执行状态中恢复」→ `execution` |
| 5 个 `Pill` | `decisionFilter.work`「接单与续做」/`stop`/`ignore`/`unavailable`/`all`；`kind` 参数由 `DECISION_KINDS`（`645-651`）映射：`work→'accept,reopen'`、`stop→'stop'`、`ignore→'ignore'`、`unavailable→'unavailable'`、`all→''` |
| 24h 过滤 | `window==='24h'` 时追加一个**已选中**的 Pill：`lastDayOnly`「仅过去 24 小时到达的触发 ✕」，点击即取消 |
| 列表 | `DecisionLine`（`2032-2089`）：阶段标记 + 标题（`ticketTitle` → `threadTitle` → `preview` → `empty`）+ 引用行 preview + meta（`reason`、`ruleLabel`「规则」= 命中规则名、`<When>`） |
| 分页 | limit 初值 30，`LoadMore` +30 |
| 空态 | `Hint` = `none`「暂无。」 |

**设置分组 `eval` = `EvalSettings`**（`3113-3124`）：`PolicyBlock` + `EvalBlock` + `ConfigHistory(['policy','eval'], versions)`。

`PolicyBlock`（`2919-3038`）：

- 标题 `term.policy`「策略」+ InfoTip `policyIntro`；
- 策略版本行：`policyVersion`「策略版本」+ `policyVersion.slice(0,8)`（`.dt-mono`）+ InfoTip `policyVersionHint`；
- `Section rules`「接单规则」+ InfoTip `rulesHint` + 右侧按钮 `addRule`「添加规则」：
  - `RuleRow`（`2708-2783`）= `DisclosureRow`（图标是一个 8px 圆点，`data-enabled` 变品牌色，css:101-102）+ 名称 + 折叠时右侧 `rule-preview`（截断的 instruction）+ 展开后：`ruleName` Input（`maxLength=LIMITS.ruleName=100`）、`ruleInstruction` textarea（4 行，`maxLength=2000`，placeholder `ruleInstructionPlaceholder`）、`duplicate`「复制」（名字追加 `copySuffix`「 副本」并截断）、`remove`「删除」；行尾 `Switch`（aria-label `ruleEnable{name}`）；
  - 空态 `Hint` = `rulesEmpty`「暂无规则，不会主动接单。」；
  - 原生表单校验失败时自动展开所有规则行（`onInvalidCapture`，`2973-2975`）；
- `Section policyPerSource`「在各来源上」+ InfoTip `policyPerSourceHint`：
  - 来源 >1 时显示 `.dt-subtabs` 二级 tab；
  - `SourcePart`（`2784-2851`）：`policy.fields` 用 `SourceField` 渲染（第一个字段通常是 `allowed` 名单）+ `sync` 按钮（`localized(sync.label)`，`!sync.ready` 时 disabled；dirty 时点它先 toast `syncNeedsSave`「请先保存或放弃修改，再同步。」）+ `sync.health` 展示（ready→`syncDone`+时间，error→红字 detail）+ `AdmissionTable`（若该来源有 `rows`，否则只显示一句 `explicitRequest`「明确的请求」+ 说明）。

`AdmissionTable`（`2852-2918`）——**准入矩阵**，3 列 × N 行：

```
                名单内                名单外
                          未 @      点名智能体      未 @
<接收范围>    [select]    [select]    [select]
```

- 行来自来源配置（`policy.rows(config)`），列固定 `['listedUnaddressed','unlistedAddressed','unlistedUnaddressed']`；
- 每格是可选项：`ADMISSION_OPTIONS`（`426-435`）与默认值 `ADMISSION_DEFAULTS`（`437-442`）；
- `unlistedAddressed === 'explicit'` 时该格右侧出现 **warn 色 InfoTip**（`admissionAnyoneWarning`「这个范围里任何人点名智能体都能直接发起工作」），并用固定 16px 占位槽避免列宽跳动（`2867-2871`）；
- 不可用的格显示 `—`（`admissionNotReceived`）；
- 说明：`admissionHint`（Section hint）、`explicit` 说明、`admissionFootnote`（脚注，讲"改弱会收回已接工单的授权"）。

`EvalBlock`（`3039-3112`）：

| 控件 | 字段 | 约束/文案 |
|---|---|---|
| `Section acceptMode`「接单模式」 | `SegmentedControl` 三选一 `off/observe/auto` | 选项 label `valueLabel('mode')`=（关闭/仅观察/自动接单），title=`modeOption.<mode>` 长说明 |
| `Field evalTimeout` | `Input[type=number]` | 30–600 秒；hint `evalTimeoutHint` |
| `Section assessorModel`「研判模型」 | `ModelField` | hint `assessorModelHint`「保存后用于新建的主 Session…」 |

保存：`SaveBar` → `PUT settings/policy|eval {value, revision}`（`2189-2191`），`restarting` 时 toast `savedRestarting`。

---

### 2.5 `execution` 执行

**列表页 `ExecutionStatus`**（`3130-3213`）：数据同时来自 `GET state`（父级）与 `GET tickets?state&limit`。

1. `StatusHead`（带设置按钮）：InfoTip = `executionStatusIntro`「执行器的状态，以及按在等谁分组的工单。」
2. 状态行 `.dt-row-meta.dt-status-line`：
   - `.dt-status-text[data-state]` 三态：`setup.problem` → warning + `executorWaitingSetup`；`paused` → warning + `processingPaused`「处理已暂停」；否则 ongoing + `executorRunning`「执行器运行中」；
   - `executingLabel` = `running / maxWorkers`、`queuedLabel`（`setup.problem` 时不显示）；
   - `ConfirmButton`：`pauseProcessing`「暂停处理」/`resumeProcessing`「恢复处理」，确认文案 `pauseProcessingConfirm` / `resumeProcessingConfirm` → `POST executor/pause {paused:!paused}` + reload。
3. 5 个 `Pill`：`ticketFilter.open`「进行中」/`person`「待处理」/`working`「执行中」/`idle`「等待新触发」/`ended`「已结束」（replace 导航，重置 limit 20）。
4. `current==='idle'` 时 Hint `idleHint`「执行器结束了当前回合，没有提出问题；…」。
5. 列表：`TicketLine`（`1879-1965`）；`stage==='person'` 的行带内联操作（question 模式）。
6. 空态 `none`；`LoadMore` +20。

`TicketLine` 是**整个面板最复杂的行**（`1879-1965`）：

```
[阶段标记 StageMark]  |  标题按钮（→ execution/:id）
                      |  引用/备注行：ThreadChip* + ContextTag? + ticketUndeliveredLabel + note(或 <When>)
                      |  操作行：answerIn / retry / SessionButton / stop（容器恒定渲染以保证三行等高）
```

- 阶段语义由 `ticketMark`（`1234-1269`）给：`ended→(outcome label, neutral, idle, stop)`；`person` 按 action 分 `review→review/ask/inbox`（failed→danger/error，其余 warning/warning）；`working` 且 `queued`→idle/queue，否则 info/ongoing；其余 idle/clock。
- `answer` 行（`person`+`action==='answer'` 且有 reply）显示 `ActionLink` `answerIn{source}`「去{source}回答」直达渠道 URL。
- 重试/停止都是 `ConfirmButton`：`retry`/`retryTitle`/`retryConfirm{title}`、`stop`/`stopConfirmTitle`/`stopConfirm{title}`。

**设置分组 `execution` = `ExecutionSettings`**（`3259-3385`）：

| 块 | 字段 | 控件 | 约束/文案 |
|---|---|---|---|
| 执行器 | `executorModel`「执行器模型」 | `ModelField` | hint `executorModelHint`（留空继承 DSH 默认） |
| 执行器 | `maxWorkers`「并行工单数」 | `Input[number]` | 1–16；hint `maxWorkersHint` |
| 执行环境 | `executionDirectory`「执行目录的根目录」 | `Input.dt-mono` | `pattern="/.*"`；空时 note `executionDirectoryDefault{root}`；placeholder `executionDirectoryEmpty`；hint `executionDirectoryHint`（明说"这不是安全边界"） |
| 执行环境 | `prepareCommand`「准备命令」 | `textarea` 3 行 `.dt-mono` | `maxLength=LIMITS.prepareCommand=4000`；placeholder `prepareCommandEmpty`；hint `prepareCommandHint`（讲 `$DSH_SUPERAGENT_DIR` 与 git worktree） |
| 执行环境 | **可用的环境变量**（折叠） | `EnvironmentVariables`（`3214-3258`）：3 列表格 key/说明/注册者 | count 徽标；点 key 把 `"$KEY"` **插入到 prepare 光标处**（`3290-3296`，含 `setSelectionRange` 恢复光标）；owner 显示 `term.executor` 或来源名，`!enabled` 追加 `· sourceOff` |
| 执行环境 | `blockedCommands`「禁止调用的命令」 | `Input.dt-mono` | 空格/逗号分隔，草稿里保留原始字符串、保存时才 split；placeholder `blockedCommandsNone`；hint `blockedCommandsHint` |
| 底部 | `ConfigHistory(['executor','pause'])` | 折叠历史 | — |

---

### 2.6 `settings` 设置

`SettingsPage`（`5574-5610`）：**二级两栏**布局 `.dt-settings`（`grid-template-columns:140px minmax(0,1fr)`，css:301）。

```
.dt-settings
├ nav.dt-settings-nav   ← 5 个按钮，[data-stage] 的三个（source/eval/execution）与后两个之间 10px 分隔
└ .dt-settings-body
  ├ h2.dt-settings-title  = settingsGroup.<group>
  └ 内容
```

- 导航点击 = `navigate(settingsRoute(value), replace=true)`，并用 `aria-current="page"` 标当前。
- 5 个分组：`source`「来源」/`eval`「评估」/`execution`「执行」/`prompts`「提示词」/`deployment`「部署」。
- `source`/`eval`/`execution` 三组外面套 `SettingsProvider`（`2163-2181`，`GET settings`，依赖 `[call, restarts]`，插件重启后自动重取）。
- 窄屏（container ≤640px）：导航变成横向换行的 tag 行（css `@container` 段）。

#### 2.6.a `source` 分组 → `SourceSettings`（`5346-5355`）

- 每个来源一张 `.dt-card`（css:122：`padding:16px; border:0.5px solid border-l3; border-radius:16px`）；
- `focus` 参数（`query.source`）会 `scrollIntoView` 到该卡片（`5349`）；
- 末尾 `ConfigHistory(['source:'])`（前缀匹配，显示所有 `source:<id>` 的保存记录）。

`SourceCard`（`5247-5345`）结构：

1. 头部行：卡片标题（`localized(title)`）+ InfoTip（description）+ `!installed` 时 `Tag tone=warning` `sourceNotInstalled`「插件未安装」+ 右侧 `Switch`（`sourceEnable{name}`「运行来源：{name}」）。
2. `problem` 时：`SetupMessage`（lead 模式，前缀 `setupProblem{detail}`）+ `CheckSetupButton`。
3. `!installed` 时：`Hint` = `sourceNotInstalledHint`「提供这个来源的插件没有加载，配置按保存时的样子保留。」
4. 普通字段：`source.fields.filter(!advanced)` 逐个 `SourceField`。
5. 高级字段：`advanced.length>0` 时套 `DisclosureRow`，标题 `advanced`「高级」。
6. `SaveBar`：`status` 可能是 `restartInterrupts{count}`「保存会重启 dsh-superagent：{count} 个进行中的派工会中断，并带恢复说明重新开始。」——**这是"脏字段会触发重启"的提示**，由 `draft.dirty && source.restarts.some(changed)` 判定（`5270`）。

`SourceField`（`2547-2641`）把 `FieldSpec` 映射成控件（`src/sources/kind.ts:16-22`）：

| FieldSpec.type | 渲染 | 说明 |
|---|---|---|
| `switch` | `SwitchRow`（label+hint+右对齐 Switch） | — |
| `select` | `SegmentedControl`（`.dt-segmented.dt-field-segmented`，max-width 240px） | 选项 label 走 `localized` |
| `number` | `Input[type=number] min/max required` | 空串回传 `''`（不是 0） |
| `text` | 有 `choose` 且 `labels` 非空 → `select`（选项来自 labels，可刷新）；否则 `Input`（可 `readOnly`/`pattern`） | — |
| `fact` | 只读 `.dt-mono` 值（`localized(fact) || empty`），可带 `openSettingsOf.<group>` 跳转链接 | 派生事实，不可编辑 |
| `rows` | `RowsField`（`2416-2546`）：表格化多行编辑 | 见下 |

`RowsField` 细节（**很适合移植到我们的"标签过滤/规则列表"**）：
- 行数 > 6 时先折叠成一行摘要（点开才显示全部）；
- 首列若 `choose` + labels：`select` 从 labels 里选（已选的不会重复出现，`choices()` 过滤），已保存的显示为纯文本（可点性交给外部）；
- 其它列：`select` 用 `column.options`，`text` 用 `Input`（`optional` 的不用 mono、不加 required）；
- 每行末尾删除按钮（aria-label `removeRow{name}`）；
- 头部右侧：可选「刷新标签」按钮（`refreshLabels` → `POST sources/:id/labels`，toast `labelsAdded{names}` / `labelsCurrent` / `labelsFailed{error}`）+ `addRow`「添加」；
- 列宽用 CSS 变量 `--dt-columns` 控制（css:128）。

#### 2.6.b `prompts` 分组 → `PromptsPage`（`4673-5244`）

三个视图 `.dt-subtabs`：`promptViewEdit`「编辑」/`promptViewFull`「完整提示词」/`promptViewHistory`「历史」。

- **编辑**：左侧 200px 导航（三组：`promptTeamGroup`「团队约定」/`promptBuiltInGroup`「内置段落」/`promptSkillsGroup`「技能」），右侧 `.dt-editor`（`min-height:360px`）textarea；技能可新建（名字校验 `promptSkillNameInvalid`：唯一、小写字母数字连字符、字母开头）；内置段落有"恢复此段默认内容"按钮；模板段落显示"必须保留的占位符"`promptTemplateHint`；若升级改了默认文本则出现 `.dt-default-updated` 区块（warn 左边框）给出 diff + `promptKeepMine`「保留我的文本」/`promptTakeDefault`「改用新的默认内容」。
- **完整提示词**：`select` 选预览目标（主 Session / 执行器 Session / 各技能）+ 一行统计 `promptFullState{count,chars,state}` + `SegmentedControl` 比较方式（`promptCompareSaved`/`promptCompareDefault`）+ `promptCopyAll`「复制全文」（写剪贴板后 toast `copied`）；正文按段渲染，有差异的地方用 `Diff`（`5152-5161`：`<ins>`/`<del>` + `promptSameLines{count}` 折叠未变行）。
- **历史**：版本列表（`promptHistoryItem{revision,time,source}` + 变更段落）+ `promptRestore`「将这个版本载入草稿」+ 分页 `promptOlder` + `promptDefaults`「将整套默认内容载入草稿」+ 底部"Session 最近使用的版本"（`promptSessions`）。
- 保存：`PUT prompts {config, baseRevision}`；`context_delivery==='pending'` 时 toast `promptSavedPending`「已保存；通知等待注入主 Session。」；冲突文案自定义：`promptConflict{revision}`（merged）/ `promptConflictParts{revision,parts}`（conflict）。

#### 2.6.c `deployment` 分组 → `DeploymentPage`（`4442-4563`）

- 数据不是来自 `/orchestrator/api`，而是 **DSH 的 `ConfigForm`**（`ctx.get('configForms')?.get('dsh-superagent')`，`6814-6838` → `usePageForm` `4433-4441`），`form.mutate(ops, revision)` 走 DSH 设置系统的 `set`/`unset` 操作。
- 三个数字限额：`deploymentPromptMaxChars` / `deploymentContextPages` / `deploymentContextTimeout`，来自 `LIMITS`（`443-469`）：`promptMaxChars 1000–1e6`、`admissionContextMaxPages 1–100`、`admissionContextTimeoutMs 1–90000`。
- 只读原因（`4489-4491`）按优先级给一句 Hint：无表单 → `deploymentNoForms`；`mode==='memory'`（远端浏览器）→ `deploymentReadOnly`；`status==='loading'` → `loading`；`unavailable` → `deploymentUnavailable`；否则 `deploymentReadOnly`。
- 本机状态目录 `stateDir` 只读 `.dt-mono`（`deploymentStateDir` + InfoTip `deploymentStateDirHint`）。
- 插件市场页额外显示「仓库与账号」派生块（`deploymentDerived`）：repository / @agent / feishu bot，并注明「账号在 dsh-superagent 面板的来源设置里修改」（`deploymentAccountsWhere`）。
- 保存后**立即生效、不重启**（`deploymentIntro`）。

---

### 2.7 两个整页详情（不是 tab，但必须实现）

#### `TicketPage`（`6138-6351`）— `execution/:id`

| 区 | 内容 |
|---|---|
| `PageHead` | 返回 + 标题 + 操作：`openThread{source}`（ActionLink 到首个带 url 的线程）、`retry`（ConfirmButton `retryConfirm{title}`）、`SessionButton`（打开工作 Session） |
| 状态行 | `StageMark` + `ticketMandateLabel`(strength) + `ticketActorLabel`(source·actor) + `ticketUpdatedLabel`(时间) |
| 结束提示 | `ended` 时 Hint：`endedAt{time,outcome,reason}` 或 `endedAtShort{time,outcome}` |
| 待人工横幅 | `attentionPrefix`「待人工决定：」+ `MarkdownLite(question)` + `answerIn{source}` 链接 |
| 失败/受阻横幅 | `data.actions.retry && data.summary` 时：`failedPrefix`「失败：」或 `blockedPrefix`「受阻：」+ summary（正文像 Error 时加 `.dt-mono`；`failed` 时加 `.dt-danger`） |
| 送达失败横幅 | `deliveryFailedPrefix`「送达失败：」+ `deliveryError`（红底 mono） |
| `Section mandateDetails`「授权详情」 | `KeyValues`：`term.trigger`（可点回触发页，含 preview/source·actor/时间）、`term.decision`（outcome + reason + 每条规则 `ruleMatched`/`ruleUnmatched{rule,reason}` + `directionLine` 方向三连）、`term.scope`、basis facts（`basis.*`）、`policyVersion`（短哈希可点 → `settings?group=eval&version=`） |
| `Section undeliveredInputs` | Hint 三选一：`inputRetryHint`（有 deliveryError）/`inputPausedHint`（paused）/`inputWaitingHint`；`InputList` |
| `Section subscribedThreads` | `ThreadLine`（排除本工单、`context` 标记） |
| `.dt-details` 折叠 | `term.assignment`（仅 >1 时，`open` 默认展开）、`term.environment`（表格 key/value）、`term.channel`（`ExternalLink`，github 用 `pull` 图标）、`deliveredInputs{count}`、`identifiers`（ticketId/执行目录/legacyAssignment） |
| 危险区 | `stopHint` + `ConfirmButton` `stop`/`stopConfirmTitle`/`stopConfirm{title}` → `POST tickets/:id/stop` |

`Assignments`（`6022-6068`）：倒序，每条 `assignmentNumber{number}`「第 {number} 次派工」+ Tag（状态或报告）+ `assignmentSpan{from,to}` + `endedReason` + 可能的 SessionButton。

`MandateDetails` 的 `basisFacts` 由 host 侧 `src/app/views/tickets.ts:18-34` 生成，`ticket.tsx:71-77` 把 `legacyAuthority/mode/addressed/admission/rules/sender` 翻译成人话。

#### `ThreadPage` — `trigger/:key`（见 §2.3）

---

## 3. 通用 UI 原语清单（照着重写）

`controls.tsx`（`lib/client.js:34-425`）是**无上下文依赖**的纯原语；`widgets.tsx`（`1567-1876`）依赖 `usePanel()`。整体策略见文件头注释：**模仿 DSH ui-primitives 的标记与键盘行为，但不耦合它的内部包**（`src/client/controls.tsx:1-4`）。这是我们要照抄的核心思路——我们也不该 import DSH 的 UI 包。

### 3.1 `controls.tsx` 的 13 个原语

| 原语 | 行号 | Props | 视觉要点（token） |
|---|---|---|---|
| `Icon` | `77-90` | `{name: IconName, size=16}` | 内联 `<svg>`，`viewBox 0 0 24 24`，`fill:none; stroke:currentColor; strokeWidth` 由调用方给，`aria-hidden`。**35 个图标路径**在 `ICON_PATHS`（`40-76`）：chevron ×4、search、question、plus、trash、refresh、clock、history、shield、decision、message、inbox、hash、filter、user、close、settings、external、session、stop、pause、play、unsubscribe、dismiss、pull、copy、review、ask、alert、running、blocked、queue |
| `Button` | `91-101` | `{variant:'primary'\|'ghost'\|'outline'=ghost, size:'md'\|'sm'=md, icon?, className?, ...buttonAttrs}` | `.dt-btn` 圆角 **18px**；md `height:36px`、sm `height:28px / 12px`；primary=`--dsw-alias-button-primary-fill` + `label-primary-foreground`，hover=`button-primary-hover`；ghost/outline hover=`interactive-bg-hover`；outline 有 `0.5px solid border-l3`；disabled `opacity:.4`；focus-visible `2px solid brand-primary` + offset 2px（css:187-197） |
| `Tag` | `102-109` | `{tone: TagTone=outline, title?, children}` | `.dt-tag` 胶囊、`11px/17px`、`padding:1px 8px`、`radius:999px`；7 tone：outline(border-l4+label-tertiary)/neutral(bg-module-platform+label-secondary)/quiet(纯文字 label-tertiary)/success/warning/danger/info（10–12% 透明态底色 + 对应 state 色）（css:198-205） |
| `Pill` | `110-118` | `{active, onClick, children}` | `.dt-pill` `height:24px; radius:12px; font 12px`；底色 `bg-layer-2`；active 用 `button-ghost-active-fill` + inset 1px 描边（css:206-208）。**筛选器专用** |
| `SegmentedTabs` | `135-175` | `{items:{value,label,id,panelId}[], value, onChange, label, className?}` | `.dt-tabs` grid + `gridTemplateColumns: repeat(n, minmax(0,1fr))`（4px 内边距、radius 12px、底色 module-platform 的"药丸盒子"）；但**页面级 tab 会被 `.dt-page .dt-tabs` 覆盖成下划线式**（`border-bottom` + `box-shadow: inset 0 -1.5px 0`，css:268-269）；方向键/Home/End 循环（`walk` `119-133`），ResizeObserver 测左右溢出 → `data-more=start\|end\|both` 让窄屏出渐隐遮罩 |
| `SegmentedControl` | `176-199` | `{options:{value,label,title?}[], value, onChange, label, disabled?, className?}` | `.dt-segmented` 内嵌 grid（`background: interactive-bg-hover`、radius 9px、padding 3px）；选中 `.dt-segment` 白底 `bg-layer-1` + `--dsw-elevation-soft` 阴影；同样支持方向键（css:16、214-218） |
| `Input` | `200-208` | `{icon?, className?} & inputAttrs` | 外层 `.dt-input` 是 `span`（`height:32px; radius:8px; border 0.5px border-l4; bg-layer-1`），内层真 `<input>` 无边框；`:focus-within` 边框变 brand-primary；带 icon 时左侧有 `.dt-input-icon`（css:219-225） |
| `Switch` | `209-219` | `{checked, onChange, label, className?}` | `<button role="switch" aria-checked aria-label>`；36×20 轨道 + 16px 拇指；选中品牌色 + `translateX(16px)`（css:226-230） |
| `StateDot` | `220-256` | `{state: 'done'\|'warning'\|'ongoing'\|'error'\|'idle', className?}` | 非 ongoing 时是 `span.dt-state-dot`（10×10，`::after` 内缩 20% 实心圆，颜色由 `data-state` 决定：idle 默认色、done=success、warning=warn、error=error，css:231-235）；**ongoing 时换成 SVG 圆环 spinner**（两个 circle：底圈 25% 透明 + `stroke-dasharray:18 150` 绕圈，css:236-241） |
| `Dot` | `244-256` | `{state: DotState, label?: string}` | `StateDot` + `className="dt-dot"` 的包装；给 `label` 时套 `span.dt-dot-wrap[role=img][aria-label][title]`，否则直接返回圆点。**列表行左侧状态位的标准写法** |
| `DisclosureRow` | `257-293` | `{icon, title, open, onToggle, collapsedContent?, children?}` | `.dt-disclosure-row`：左侧 24×24 图标槽，**hover/展开时图标隐去、换成 chevron**（css:245-249）；`role=button tabIndex=0 aria-expanded`，Enter/Space 切换；折叠时右侧可挂 `collapsedContent`（典型用法：一行截断预览） |
| `Modal` | `305-368` | `{open, onClose, title, closeLabel, description?, footer?, className?, children?}` | `createPortal(document.body)`；`.dt-modal-root` 固定居中 + `padding: max(24px, var(--dsh-frame-top-clearance,24px)) 24px`；遮罩 `bg-mask-1` + `backdrop-filter: var(--dsw-mask-blur)`；面板 radius 24px、`bg-layer-2`、`--dsw-elevation-prominent`；**焦点陷阱 `trapTab`**（`294-304`，手写查 `FOCUSABLE` 选择器）+ Escape 关闭 + 关闭后**焦点还给 opener**；`onClose` 存在 ref 里避免父级重渲染重置焦点（`315-317`） |
| `InfoTip` | `369-424` | `{text, icon='question', warn?}` | 16×16 无边框小按钮（`cursor:help`，caption 色）；气泡 portal 到 body，`position:fixed` 手工定位（优先在上方 12px 边距内，否则下方；水平居中并夹在视口内）；`role=tooltip`；hover / `:focus-visible` / 触摸点按三种触发；scroll/resize/Escape 关闭（css:91-95） |

### 3.2 `widgets.tsx` 的 18 个复合件

| 组件 | 行号 | 用途 / props | 关键点 |
|---|---|---|---|
| `When` | `1573-1580` | `{at}` → `<time dateTime title=fullTime>` | 24h 内用 `Intl.RelativeTimeFormat`（秒/分/时），更早用 `toLocaleString`（同年省略年份）；中文 `zh-CN`、英文 `en`（`text.ts:44-59`，编译 `737-756`） |
| `SetupMessage` | `1581-1588` | `{problem:{code,values}, lead?}` | `setupText` 文案；`lead` 时套 `setupProblem{detail}`；有 `values.output` 追加 `.dt-detail.dt-mono.dt-clamp` 原始输出 |
| `Section` | `1589-1619` | `{title, count?, hint?, badge?, icon?, action?, children}` | `<section.dt-section><h2.dt-section-title>`：icon + 名称 + `count` 徽标 + `InfoTip(hint)` + badge + `action`（`margin-left:auto`） |
| `Hint` | `1620-1625` | `{children}` | `<p.dt-hint>`（label-tertiary） |
| `LabelValue` | `1626-1641` | `{label, value}` | `<span.dt-lv>` 两段：label 用 caption 色、value 用 secondary 色 + tabular-nums |
| `KeyValues` | `1642-1650` | `{rows:[string, ReactNode][]}` | `<dl.dt-kv>` 两列 grid（`max-content 1fr`） |
| `MarkdownLite` | `1664-1677` | `{text}` | 只认标题/列表/段落/粗体/行内码/链接，**不解释原始 HTML**；解析器在 `markdown.ts`（`1386-1452`） |
| `ClampText` | `1688-1698` | `{text}` | >480 字或 >8 行才折叠 + 「展开全文/收起」 |
| `ConfirmButton` | `1699-1733` | `{label, title, message, onConfirm:()=>Promise, variant='ghost', icon?}` | `Button` 打开 `Modal`，footer 两键（`cancel`/`confirm`），确认键 `disabled={busy}`，成功才关；内部用 `useAction` |
| `SessionButton` | `1734-1748` | `{sessionId, label?, variant}` | 调 `openSession`，失败 `notify` |
| `ExternalLink` / `ActionLink` | `1749-1773` | `{href, children, icon}` | 前者是内联链接，后者是「长得像按钮的 `<a>`」（`a.dt-btn`） |
| `StageMark` | `1774-1783` | `{state: DotState, icon: IconName, label}` | `<span.dt-stage data-state>`：ongoing 用 spinner，其余用图标 + 文字，颜色随 state（css `dt-stage`） |
| `LoadState` | `1784-1792` | `{error?, loading}` | 有 error → `p.dt-error[role=alert]`；否则 loading 时 `Hint(loading)` |
| `LoadMore` | `1793-1805` | `{onMore}` | outline 小按钮 + chevron-down + `loadMore`「加载更多」 |
| `StatusHead` | `1806-1821` | `{hint, settings?}` | 标题 `statusTitle`「状态」+ InfoTip + 可选「设置」按钮 |
| `PageHead` | `1822-1841` | `{title, children?}` | 返回按钮（`backLabel`）+ `h2`（最多 2 行截断）+ 右侧操作区 |
| `CheckSetupButton` | `1842-1876` | — | `POST setup/check` + toast `setupChecking` + `restart()`；`running>0` 时改走 `ConfirmButton`（`setupCheckInterrupts{count}`） |

### 3.3 设计令牌清单（要用的都在这）

CSS 里出现的 `--dsw-alias-*`（含出现次数，css:664 全文统计）：

| 用途 | token | 次数 |
|---|---|---|
| 主文字 | `--dsw-alias-label-primary` | 22 |
| 次文字 | `--dsw-alias-label-secondary` | 28 |
| 三级文字/提示 | `--dsw-alias-label-tertiary` | 15 |
| 说明/微文字 | `--dsw-alias-label-caption` | 16 |
| 占位符 | `--dsw-alias-label-dimmed` | 1 |
| 主色填充上的文字 | `--dsw-alias-label-primary-foreground` | 2 |
| 边框 | `--dsw-alias-border-l2` / `l3` / `l4` | 8 / 18 / 3 |
| 背景 | `--dsw-alias-bg-base` / `bg-layer-1` / `bg-layer-2` / `bg-layer-3` / `bg-module-platform` / `bg-mask-1` | 1 / 5 / 3 / 1 / 6 / 1 |
| 交互态 | `--dsw-alias-interactive-bg-hover` / `-active` | 9 / 1 |
| 按钮 | `--dsw-alias-button-primary-fill` / `-primary-hover` / `-ghost-active-fill` / `-ghost-active-border` | 1 / 1 / 1 / 1 |
| 品牌 | `--dsw-alias-brand-primary` | 17 |
| 状态 | `--dsw-alias-state-success-primary` / `-warn-primary` / `-error-primary` / `-business-primary` / `-idle-primary` | 4 / 14 / 15 / 3 / 1 |
| 链接 | `--dsw-alias-link` | 2 |
| 浮层 | `--dsw-alias-tooltip-bg` / `--dsw-alias-toast-bg` | 1 / 1 |
| 阴影/模糊 | `--dsw-elevation-prominent` / `--dsw-elevation-soft` / `--dsw-shadow-lv3` / `--dsw-mask-blur` | — |
| 固定色 | `--dsw-static-neutral-bluish-00`（浮层文字） | 1 |
| 字体 | `--ds-font-family-code`（等宽） | — |
| 宿主变量 | `--dsh-frame-top-clearance`（macOS 顶栏避让） | — |

> 我们插件目前只用了 `--dsw-alias-border-l2` / `bg-base` / `label-primary`（`client.js:211,363-364`）。**其它全部可以直接借用，无需引入 DSH 任何 UI 包。**

局部变量只有两个：`--dt-columns`（rows 表列数，css:128）和 `--dt-toast-hold`（toast 停留时长，`provider.tsx:69`，编译 `813-828`）。

### 3.4 列表行的"三线结构"（所有列表统一）

```
.dt-row(.dt-link)              ← 10px/8px padding；hover 变 interactive-bg-hover；radius 12px
├ [可选] .dt-dot / .dt-ticket-stage   ← 左侧状态位
└ .dt-row-main
  ├ .dt-row-title              ← 14px/500 的主标题，内部常是 button.dt-open（整行可点，::after 铺满）
  ├ .dt-row-quote              ← 13px 引用（单行截断）
  └ .dt-row-meta               ← 12px 元信息行（chip/tag/时间），flex-wrap
```

- `.dt-open` 用 `::after { inset:0 }` 把整行变成点击区（css:32 区块），操作按钮容器再 `pointer-events:none` + 子元素 `auto`（css `dt-ticket-actions` 段），避免按钮点击穿透到行链接——**这个技巧务必照抄**。
- ticket/thread 列表用**两列 grid**（`.dt-list > .dt-ticket`：`112px + 1fr`，左列放阶段，css:323），窄屏退化成单列。

---

## 4. 交互模式

### 4.1 Toast / PanelProvider 怎么工作

- `PanelProvider`（`829-898`）用两个 Context：`Panel`（动作与文案）与 `PanelState`（数据）。**职责分离**：前者稳定（`useMemo` 依赖 t/call/navigate/…），后者随轮询变。
- Context 形状（`src/client/provider.tsx:9-28`）：

| PanelContext | 说明 |
|---|---|
| `t` | 翻译函数 |
| `call` | 类型化 API 调用器（`Call`，`src/client/api.ts:105-117`，编译 `653-661`） |
| `navigate(route, replace?)` / `back()` / `backLabel` | 路由 |
| `openSession(id)` | 跳会话 |
| `notify(text)` | 弹 toast |
| `restart()` | 进入"等重启"模式 |

| PanelData | 说明 |
|---|---|
| `state` / `error` / `reload` | `GET state` 快照 |
| `setup` | `state.setup` |
| `running` | 进行中的派工数（决定要不要弹"会中断"确认） |
| `restarts` | 重启恢复计数（依赖它的视图会重新拉数据） |

- **Toast**（`813-828`）：`createPortal` 到 body，`.dt-toast` 固定顶部居中（`top:40px`），`pointer-events:none`；停留由 CSS 动画 `--dt-toast-hold`（默认 3000ms）驱动，JS 侧 `setTimeout(holdMs + 1000)` 再卸载；**同时只有一条**（`notify` 直接覆盖 `{text,id}`，`key={id}` 强制重挂载重放动画）。视觉：`--dsw-alias-toast-bg` / `--dsw-static-neutral-bluish-00` / `--dsw-shadow-lv3` / radius 14px。
- `useAction`（`777-801`）：`running` ref 做**重入保护**（连点只跑一次），`busy` 状态给按钮，成功后可选 `reload`，失败统一 `errorText` → `notify`，返回 `boolean` 供调用方决定是否关闭弹窗。

### 4.2 SaveBar：保存 / 冲突 / 合并

这是整份代码里**最值得学的一套机制**（`draft.tsx`，`899-1232`）。

**状态机**（`draftReducer` `972-1054`）：

```
clean ──edit──▶ editing ──submit──▶ saving ──saved──▶ awaitingRevision ──revisionArrived(>=sent)──▶ clean
                   ▲                    │
                   └──── refused ◀──────┘   (409 → reload → rebasing；校验错 → invalid；其它 → failed)
editing 期间 revisionArrived(更新) ──▶ merge3(base, mine, theirs) ──▶ merged / conflict / clean
```

- `phase`: `clean | editing | saving | awaitingRevision`；
- `notice`: `restored`（从 sessionStorage 恢复草稿）、`rebasing`（读最新版本）、`merged{revision}`、`conflict{revision,paths}`、`invalid{fields}`、`failed{error}`、`unstored{error}`；
- `saveBarText`（`1055-1078`）把状态映射成一句话：

| 状态 | 文案键 | 中文 |
|---|---|---|
| conflict | `saveConflict`（或自定义 `words.conflict`） | 设置已在别处修改，其中有你也改过的项；保存会以你的修改为准。 |
| merged | `saveMerged` | 设置已在别处修改，你的修改已合并到最新版本；请检查后保存。 |
| rebasing | `saveRebasing` | 已在别处修改，正在读取最新版本… |
| invalid | `invalidSettings{fields}` | 这些字段无效：{fields} |
| unstored | `draftFailed{error}` | 无法保留草稿，请保存后再离开：{error} |
| awaitingRevision | `savedRestarting` / `saved` | 已保存，dsh-superagent 正在重启 / 已保存 |
| clean | `saved` | 已保存 |
| editing | `draftRestored` / `draftKept`（或自定义 `words.editing`） | 未保存 · 已恢复草稿 / 未保存 · 草稿已保留 |

- **三方合并 `merge3`**（`912-934` + `mergeList` `935-952`）：对象按 key、**带主键的数组（`id` 或 `chatId`）按元素**合并；一方删除、另一方没改 → 删；删除 vs 修改 → **保留自己并记入 `conflicts`**。这是"设置页可以后台被人改"场景的正解。
- **持久化**：草稿写 `sessionStorage['dsh-superagent/draft/<masterId>/<block>']`（`2182-2203` 的 `useBlockDraft` 生成 key）；`read()`（`953-971`）会丢弃**没有 `base`** 的旧格式草稿（无法三方合并）。写失败 → `unstored` 提示。
- **提交**（`1080-1174`）：`save(value, revision, base)` → 成功 dispatch `saved`；`restarting` 为真时不 reload 而是 `restart()`；`ApiError.status===409` → 先 `reload()` 再标 `rebasing` 让人重看；校验错误取 `ApiError.issues[].path` 列表。
- **SaveBar 视觉/交互**（`1175-1231`）：只在 `dirty || busy || error` 时出现；`position:sticky; bottom:0`（但卡片内的 `margin:-16px` 贴边、圆角只保留下半，css:151-153）；左边一句状态（`aria-live=polite`）或错误（`role=alert`），右边「放弃修改」+「保存」；**消失时如果焦点还在条上，会把焦点还给父块**（`tabIndex=-1` + focus），避免键盘用户丢失位置。

### 4.3 轮询 / 刷新策略

`usePoll`（`595-637`）：

```
立即跑一次 → 完成后再排下一次（setTimeout，非 setInterval）
- 间隔 = intervalMs（默认 5000）；document.hidden 时 ×6（HIDDEN_FACTOR=6）→ 30s
- visibilitychange 回前台 → 立即补跑
- 请求串行：queue = queue.then(once)，保证手动 reload 排在当前轮询之后
- 响应与上次"深度相等"（JSON 比较）时不 setState，避免无意义重渲染
- 出错时保留上一次 data，只更新 error（页面可以继续显示旧数据 + 顶部错误条）
- deps/interval 变化 → 旧订阅置 inactive，丢弃迟到响应
```

重启探测（`829-861`）：`restart()` 置 `restarting={down:false}`，间隔改 1s；第一次拿到 error（服务端没应答）→ `down:true`；error 消失 → 结束并 `restarts+1`；30s 超时自动放弃（防止"重启快到我一次都没看到"）。

### 4.4 错误码 → 文案的完整链路

1. **传输层**（`546-585`）：`fetch` 抛错 → `ApiError(offline, 0, {unreachable:true})`。
2. **HTTP 非 2xx**（`561-584`）按优先级取文案：

| 响应体里有 | 文案来源 |
|---|---|
| `setup` 对象 | `messages.setup` → `setupText` + 可选原始 output |
| `code` + `values`（结构化用户错误） | `messages.user` → `t('userError.'+code, values)`（若 `values.part` 存在，先经 `valueLabel('promptPart', part)` 转成人话） |
| `error` 字符串 | 直接用 |
| 空 body + 404 | `hostNotRunning`「dsh-superagent 没有响应：它可能正在重启；…」 |
| `status>=500` | `serverError{status}`「dsh-superagent 服务内部错误（{status}），请查看运行日志后重试。」 |
| 其它 | `requestFailed{status}`「请求失败（{status}）。」 |

3. `ApiError`（`528-545`）保留 `status` / `details{issues,setup,user,unreachable}`，并提供 `issues`（字段级校验错误）与 `missing`（`404 && !unreachable`——**"确认不存在"与"连不上"必须区分**，`ticket.tsx`/`thread.tsx` 据此显示 `ticketNotFound`/`threadNotFound` 而不是错误条）。
4. **码表**：
   - `USER_ERRORS`（`471-517`，44 条，`[missing|refused, English]`）：`unknownTicket/unknownProblem/unknownTrigger/unknownAssignment/unknownBlock/unknownPromptRevision/unknownPromptPart/ticketEnded/assignmentEnded/evalFinished/notAdmissible/notExplicit/ticketStopped/mandateRevoked/notRetryable/sourceThread/followedThread/notFollowing/questionWithResult/askerWithoutQuestion/notAsker/notAnswerable/ackEnded/notReached/handedBack/handedBackHere/workerDecides/ackNoChannel/ackNotPerson/notReady/notAttention/notQuestion/noAnswer/noChannel/panelOnlyEnvironment/panelOnlyAccounts/setupComplete/modelUnavailable/promptTooLong/promptPlaceholders/promptPartEmpty/sourceNotInstalled/noLabels/nothingToSync`。
   - `REASONS`（`669-694`，25 条模板）：`said/timeout/policyChanged/noAdmissible/startedTicket/acceptedBefore/routed/explicitRouted/humanStop/legacyImport/forwarded/senderNotMember/retried/hostRestarted/stopUnknown/stopNotExplicit/directionUnsettled/noRuleMatched/ignoredFromCard/observed`。**来源侧还会发自己的 reason 码**（如 `not_human`/`no_mention`/`issue_closed`… 见 `reason.*` 48 条文案）。
   - `SETUP_PROBLEMS`（`3387-3405`，16 条，带 `place: deployment|github|feishu`）。
   - `HEALTH_TEXT`（`3407-3415`，5 条）：`setupPending/sourceOff/feishuCliUnset/feishuBotMissing/pollFailures`。
5. **`reasonLabel`（`712-732`）的三级回退**：先查 `t('reason.'+code)`；没命中用 host 的英文 `reasonText`；若结果长得像 `XxxError` 则**截断到第一行 140 字**（防止把一坨堆栈塞进 UI）。这条规则很实用，建议照抄。

### 4.5 健康项（health.*）怎么渲染

- 数据形状：`state.health: Record<string, Health>`，`Health = {state:'ready'|'error'|'starting'|'paused', code?, detail, values?, at?}`（host 侧 `src/sources/host.ts`）。
- **来源的健康是数组**：一个来源可以有多个 health 部件（`source.health[]`），每项 `{name,state,code?,detail}`；`sourceHealth`（host 侧 `src/app/views/sources.ts:13-21`）会把"来源已启用但 health 还是 `sourceOff`"的项改判为 `starting`（避免刚打开时的假红）。
- **来源总体状态**是 7 态优先级推导（`src/app/views/sources.ts:33-40`）：`missing > off > error > setup > starting > paused > ready`，客户端映射成 5 种圆点（`1312-1344`）。
- **渲染规则**：只显示 `error`/`paused` 的部件（健康的部件是噪音），且当已经有 `problem`（设置问题）或全局 `setup.problem` 时**一律不显示**（`5479-5486`）——"一个原因只说一次"。
- 文案：`healthText`（`731-732`）优先用 `healthCode.<code>` 本地化模板，没有 code 就用英文 `detail`。
- `overview` 里把 `state.health` 中 `state==='error'` 且不属于来源的项汇总成 `runtime-error`（`src/app/views/overview.ts:56-58`，排除 `sourceParts` 与 `sync:` 前缀与 `evals`），保证"系统问题"和"来源问题"不重复计。

### 4.6 危险操作与确认

- 统一用 `ConfirmButton`（Modal + 二次确认），**没有一处用 `window.confirm`**（对比：我们的 `client.js:303-307`、`445-449` 还在用 `window.confirm`，这是要改的）。
- 需要"做之前先解释后果"的操作都带长文案：`retryConfirm`/`stopConfirm`/`unsubscribeConfirm`/`setupCheckInterrupts`/`restartInterrupts`/`resumeProcessingConfirm`/`pauseProcessingConfirm`。
- 页面级危险区 `.dt-danger-zone`：顶部 0.5px 分隔线 + 右侧红字按钮（css:137-138）。

### 4.7 可访问性 / 键盘 / 焦点（官方做得很足，值得抄）

| 机制 | 位置 |
|---|---|
| Modal：焦点陷阱、Escape、背板点击、关闭后焦点还原 | `305-368`（`trapTab` `294-304`） |
| SaveBar 消失时把焦点还给父块 | `1182-1193` |
| `Fields`（fieldset）在保存后把焦点还给原来那个输入 | `2205-2222` |
| tab / segmented 的方向键 + Home/End + 循环，`tabIndex` 只让选中项可 tab | `119-133`、`135-199` |
| DisclosureRow：`role=button` + Enter/Space | `257-293` |
| InfoTip：hover / `:focus-visible` / 触摸三种触发，Escape 关闭 | `369-424` |
| `aria-live=polite`（保存状态）、`role=alert`（错误）、`role=status`（toast） | `1197`、`196`、`813-828` |
| 减弱动效：`prefers-reduced-motion` 关掉 tab/segment/switch/spinner/toast 动画 | css `@media (prefers-reduced-motion)` 段 |

### 4.8 空态 / 加载态 / 错误态文案总表（可直接抄进我们插件）

| 场景 | 键 | 中文 | English |
|---|---|---|---|
| 读数据中 | `loading` | 正在读取… | Loading… |
| 通用空 | `none` | 暂无。 | None. |
| 空值占位 | `empty` | — | — |
| 概览：没有待处理工单 | `needsYouNone` | 没有待处理的工单。 | No pending Tickets. |
| 触发：无线程 | `threadsNone` | 没有符合条件的线程。 | No matching Threads. |
| 线程详情：无触发 | `noTriggers` | 没有保留的触发。 | No retained Triggers. |
| 线程不存在 | `threadNotFound` | 找不到这个线程。 | Thread not found. |
| 工单不存在 | `ticketNotFound` | 找不到这个工单。 | Ticket not found. |
| 规则为空 | `rulesEmpty` | 暂无规则，不会主动接单。 | No rules; nothing is accepted proactively. |
| 历史为空 | `historyEmpty` | 还没有记录的版本；下次保存后开始记录。 | No revisions recorded yet; history starts with the next save. |
| 搜索无结果（有飞书） | `searchNone` | 没有找到。可以输入触发文字、GitHub PR 或 Issue 链接、#编号、飞书消息链接或 om_ 开头的消息 id。 | … |
| 搜索无结果（无飞书） | `searchNoneGithub` | 没有找到。可以输入触发文字、GitHub PR 或 Issue 链接或 #编号。 | … |
| 连不上服务 | `offline` | 无法连接到 dsh-superagent 服务。请确认它正在运行（dsh-superagent status），然后重试。 | … |
| 服务在重启 | `hostNotRunning` | dsh-superagent 没有响应：它可能正在重启；… | … |
| 500 | `serverError` | dsh-superagent 服务内部错误（{status}），请查看运行日志后重试。 | … |
| 其它失败 | `requestFailed` | 请求失败（{status}）。 | … |
| 部署检查未通过 | `setupProblem` | 部署检查未通过：{detail} | Deployment check failed: {detail} |
| 执行器等部署 | `executorWaitingSetup` | 执行器等待部署检查 | Executor waiting for the deployment check |
| 处理暂停 | `processingPaused` | 处理已暂停 | Processing paused |
| 草稿冲突 | `saveConflict` | 设置已在别处修改，其中有你也改过的项；保存会以你的修改为准。 | … |
| 草稿已合并 | `saveMerged` | 设置已在别处修改，你的修改已合并到最新版本；请检查后保存。 | … |
| 字段无效 | `invalidSettings` | 这些字段无效：{fields} | Invalid fields: {fields} |

> 这些 key 的**双语原文**都在 `lib/client.js:3421-4150`；`zh`/`en` 两个字典由 `language(index)`（`4147-4150`）从 `TEXT` 投影出来。

---

## 5. 依赖：它 inject 了什么，我们缺什么

### 5.1 客户端包清单（`package.json` 的 `dsh.client.inject`）

```json
["@deepseek-ai/dsh-client-locale",
 "@deepseek-ai/dsh-client-ui-settings",
 "@deepseek-ai/dsh-client-ui-renderer",
 "@deepseek-ai/dsh-client-ui-layout",
 "@deepseek-ai/dsh-client-ui-sidebar",
 "@deepseek-ai/dsh-client-ui-workspace"]
```

| 包 | 官方拿它做什么 | 证据 | 我们（只 inject `ui-conversation`）要不要 |
|---|---|---|---|
| `dsh-client-locale` | `ctx.locale.register(NS, {zh,en})` + `ctx.locale.bind(NS)`；`t('lang')` 决定格式化语言 | `6848-6851`；`text.ts:9-12` | 不要——我们直接写中文常量。但**注意宿主可能把界面语言切到 en**，官方为此准备了整套 en 文案；我们至少应保证中文在 en 环境下不出错 |
| `dsh-client-ui-layout` | `MainPanelId` 类型：把面板注册进主区 | `index.tsx:4`；`6852-6860` | 不要——主区不归我们 |
| `dsh-client-ui-sidebar` | `SidebarPanelIconOwnerProps`：侧栏图标只给 `{size}` | `index.tsx:5`；`6861-6867` | 不要——我们没有侧栏位，等价物是 composer dock 的卫星环（已有） |
| `dsh-client-ui-workspace` | `ctx.uiWorkspace.openSession(id)` 切会话 | `index.tsx:8`、`6839-6844`、`6830-6832` | **可选**：想从面板跳去"某个主理鱼对应会话"时有用；没有它就只能显示 id |
| `dsh-client-ui-settings` | `ConfigForm` 类型 + `ctx.get('configForms')`：读写宿主配置（部署限额） | `deployment.tsx:6`、`4433-4441`、`6836` | 不要——我们没有宿主配置面 |
| `dsh-client-ui-renderer` | **只有 `import type {}`**，无任何运行时调用 | `index.tsx:7` | 不要 |
| `dsh-client-ui-plugin-manager`（devDep，不在 inject 里） | `PluginConfigViewProps` / `ConfigPageForm` 类型，给 `plugins.row.config` 槽位 | `index.tsx:10`、`4564-4571` | 不要 |
| `dsh-api-session-controller` | `ISessions`：`sessions.list.getSnapshot()` / `refresh()`，配合 openSession 做"会话目录加载" | `navigation.ts:1-23`（编译 `10-33`） | **可选**（同上） |
| `dsh-client-ui-slots` | `Translate<K>` 类型（`text.ts:2`） | — | 间接：我们已通过 `ui-conversation` 拿到 `slots` |

### 5.2 我们的现状（作为对照）

`dsh-session-superagent/client.js`：

- 不是 TSX 编译产物，而是 `window.__ModuleLoader__.load({ id, factory(require) })` 的手写 UMD 风格模块（`client.js:9-13`）；
- `inject: ['slots']`（`client.js:666`），只注册两个槽位：
  - `conversation.view` → `DutyDesk`（主理鱼标签页，`client.js:675-690`）
  - `conversation.composer.dock` → `StatusOrbit`（机器级卫星环，`client.js:696-710`）
- 样式全写进内联 `style` 对象（`client.js:34-54` 的 `S` 常量），**没有 CSS 文件、没有 token 体系**（只随手引用 3 个 `--dsw-alias-*`）；
- 交互：`setInterval(load, 5000)` 裸轮询（`client.js:233`、`427`）、行内 `notice` 文本（`client.js:405`）、`window.confirm` 删除确认（`client.js:303-307`）、没有 Modal/Toast/草稿/SaveBar。

### 5.3 换成我们之后，需要替代实现的能力

| 官方能力 | 官方实现 | 我们的替代方案 |
|---|---|---|
| 主区整页 + 6 tab | `main` 槽位 + `SegmentedTabs` | **已有**：`conversation.view` 里做 tab 条（我们现在的单页可以拆成「总览 / 主理鱼 / 设置」三个 tab） |
| 侧栏图标入口 | `sidebar.panellist` | **已有**：composer dock 的卫星环（信息密度更高，建议保留） |
| i18n（724 键 ×2 语言） | `ctx.locale` | 中文常量 + 少量 `lang` 判断（可选）。**不必移植双语**，但把文案集中到一个 `TEXT` 对象（而不是散落在 JSX 里） |
| 会话跳转 | `ISessions` + `uiWorkspace.openSession` | 若宿主暴露 `ctx.sessions`/`ctx.uiWorkspace` 就照抄 `openKnownSession`（`lib/client.js:22-32` 只有 11 行）；否则省略 |
| 宿主配置表单（部署限额） | DSH `ConfigForm` | **不移植**（我们没有对应配置面；若将来要暴露 `stateDir`，用它自己的 `/state` 字段 + 只读展示即可） |
| 设计令牌 | `--dsw-alias-*` | 直接用，无需引入任何包；把 `client.css` 里 css:664 的规则**按需摘抄**成我们自己的样式表 |
| 样式注入 | `<style>{STYLES}</style>` 挂在 `PanelProvider` 里（`provider.tsx:104`，编译 `888`） | 注意：slot 可能被挂载多次（多个视图实例），**必须做去重**（例如按 id 只插一次 `<style>`，或改用 `adoptedStyleSheets`） |
| Modal / Toast / Tooltip 的 portal | `createPortal(..., document.body)` | 同在浏览器里，可直接照抄；注意 `--dsh-frame-top-clearance` 避让 |
| Markdown 渲染 | 自写 `markdown.ts`（`1386-1452`） | 我们暂时不需要（正文都是仓库名/标签），若做"最近动态摘要"可以摘抄 60 行 |

---

## 6. 官方模块 → 主理鱼对应物 映射表

图例：**✅ 直接移植** / **➕ 需新增** / **◐ 部分移植** / **✖ 不移植**（附理由）。

| 官方模块（行号） | 官方概念 | 主理鱼现有对应物 | 结论 |
|---|---|---|---|
| `overview` / `problems[]`（`4223-4328`） | 系统问题清单（9 种 kind，每种带修复动作） | 只有每行的 `w.lastError` 一行红字 + composer dock 的"异常"计数 | ➕ **需新增**：把 watcher 的 `lastError`/`backoff`/凭证未配置/GitHub 401 汇总成一个 problems 列表，每种给一个修复按钮 |
| `overview` / `pendingTickets`（`4335-4348`） | 待人工处理的工单 | 无（在主理鱼里，人类介入 = 会话里的提问） | ➕ **需新增**（换语义）：做成「攒着待唤醒」——`lastDeferred` + `maxWakesPerHour` 超限 + 时段外，等下一次唤醒的条目 |
| `overview` / `lastDay` 流量统计（`4349-4368`） | 到达/过滤/评估/接单/放弃 5 个数字 | `watch.js` 里有 `splitFresh` 的中间量，但**不留计分板** | ➕ **需新增**：24h 收到/过滤/已唤醒/跳过（`running` 未 idle）/超限 5 个计数 |
| `overview` / `executor` 负载（`4368-4400`） | 执行器并发 / 排队 / 空闲 | 无（我们没有独立执行器） | ✖ **不移植**：我们就在本会话里干活，"并发"就是宿主自己的调度，面板无权也无需展示 |
| `source` tab（`5528-5566`） | 多来源健康（GitHub/飞书，每个来源多 health 部件） | 单来源：GitHub（`gh` CLI）+ 凭证配置 | ◐ **部分移植**：把"来源行"替换成「仓库 × 凭证 × gh CLI 状态」三行；`state` 五态改造成 `idle/starting/ready/paused/error` |
| `source` / `filtered` 折叠（`5510-5525`） | 最近被过滤的触发 + 原因 | `filters`（labels / ignoreLabels / onlyAssigned）确实在过滤，但**不记录过滤了什么** | ➕ **需新增**：每次轮询把被 `filters` 刷掉的条目记 5 条 + 原因，这几乎是"主理鱼到底在不在干活"最有力的证据 |
| `source` / `dropped`（`5356-5419`） | 放弃发送的消息（渠道失效） | 无对应 | ✖ **不移植**：我们不发消息，只唤醒 |
| `trigger` tab 列表（`6354-6389`） | 线程列表 + 4 种过滤 + 分页 | 没有"线程"概念，只有 仓库→条目 | ➕ **需新增**（改造）：按「仓库」分组的条目列表，过滤条件换成 `全部/已唤醒/被过滤/已 ack` |
| `thread` 详情 + 无缺口分页（`5611-5946`、`5703-5805`） | 时间线 + 折叠同发送者 + 深链定位 + 向前补页 | 无 | ◐ **部分移植**：条目时间线（含"这条是否已唤醒/已 ack"）价值高；**无缺口分页的补页逻辑可在条目 >50 时照抄** |
| `eval` tab（`2645-2707`） | 决策日志（接单/续做/停止/忽略/未完成） | 没有模型评估，只有规则判定（filters/时段/限流/水位） | ◐ **部分移植**：把"评估"改叫「判定」，日志记录每条动态：唤醒 / 跳过（非 idle）/ 过滤（命中哪条 filter）/ 超限 / 时段外；`decisionMark` 的 6 种标记可直接复用 |
| `eval` 设置 / 接单模式 off·observe·auto（`3039-3062`） | 关 / 只看不接 / 自动接 | 无——目前只有"开/暂停" | ➕ **需新增**（高价值）：**observe 模式**（只记录"本会唤醒哪条"但不真唤醒）是灰度上线/调试的最优解 |
| `eval` 设置 / 接单规则 rules（`2708-2783`） | 可增删排序的规则 + 启用开关 + 折叠预览 | `filters`（三个字段，全或无） | ➕ **需新增**：把 filters 升级成规则列表（标签/指派/关键词/排除），每条可单独开关 |
| `eval` 设置 / 准入矩阵（`2852-2918`） | 谁（名单内/外）× 是否点名 → 明确/推断/忽略 | 无（单仓库单会话，天然只有 owner） | ✖ **不移植**：我们没有"名单"概念；若将来支持多人仓库，再回来抄这张表 |
| `execution` tab + `ticket` 详情（`3130-3213`、`6138-6351`） | 工单生命周期（阶段/派工/输入/授权/报告） | **不存在的实体**：主理鱼唤醒后由会话自己推进，没有 ticket | ✖ **不移植**；但 `MandateDetails` 的"授权详情"思路可借给「goal」卡片（见下） |
| `ticket` / `mandate` 授权详情（`6069-6137`） | 这次活是凭什么被授权的（准入/规则/模式/发起人/策略版本） | `sessionGoal`（objective/phase/revision） | ◐ **部分移植**：把"授权详情"改成「本次唤醒依据」——哪个 watcher、命中哪条 filter、第几次唤醒、用了哪个 goal |
| `settings` / `source` 卡片（`5247-5345`） | 每来源一张卡片，脏字段会重启的提示 | 「新增主理鱼」一张裸表单（`client.js:590-619`） | ➕ **需新增**（重点）：改成 **卡片 + 草稿 + SaveBar**；把「新增」和「每条 watcher 的编辑」统一成同一种卡片 |
| `settings` / executor 环境（`3259-3385`） | 执行目录 / 准备命令 / 环境变量 / 禁止命令 | `isolated` + `workdir`（+ `isolateKeepDays`） | ◐ **部分移植**：`executionDirectory` ↔ `workdir`、`prepareCommand` ↔ 隔离时的 worktree 创建（我们内部实现，暴露成只读展示 + 少量可调项） |
| `settings` / prompts（`4673-5244`） | 整套提示词编辑器 + diff + 历史 | 规则写在仓库 `AGENTS.md` | ✖ **不移植**：主理鱼的设计哲学就是"怎么处理由项目规则决定"（README:21），把提示词搬进面板会破坏这一点 |
| `settings` / deployment（`4442-4563`） | 宿主配置限额表单 | 无（配置在 `~/.dsh/state` 与 profile） | ✖ **不移植**：依赖 DSH `ConfigForm`，我们没有这一层 |
| 全局搜索（`6486-6564`） | 跨 ticket/thread/trigger 搜索 | 无 | ➕ **需新增**（低成本）：搜仓库名 / 条目号 / 标题，命中直接跳到条目详情 |
| 术语表 Modal（`6392-6453`） | 中英术语对照 + 状态色图例 + 枚举速查 | README 里散落的术语 | ➕ **需新增**（低成本高收益）：把 `watcher/唤醒/过滤/时段/隔离/ack/goal/凭证` 做成同一张表 |
| Toast / `useAction`（`813-828`、`777-801`） | 统一操作反馈 + 重入保护 | 行内 `notice` 文本（`client.js:543`） | ➕ **需新增**：`notify(text)` + `useAction` 两个小东西，全站受益 |
| `ConfirmButton` + 危险区（`1699-1733`、css:137） | 二次确认 Modal | `window.confirm`（`client.js:303-307`、`445-449`） | ➕ **需新增**：删除 watcher 的确认要讲清"已读水位一起丢"（我们现在的文案已经写了，但体验是原生弹窗） |
| `SaveBar` + 草稿 + `merge3`（`899-1232`） | 表单草稿、冲突合并 | 无（每次 POST 立即生效） | ◐ **部分移植**：先做 `clean/editing/busy` 三态 + 放弃修改；**三方合并先不要**（我们没有并发编辑场景） |
| `usePoll` 可见性退避（`595-637`） | 页面隐藏时降频 6 倍 | 裸 `setInterval(5000)`（`client.js:233`、`427`） | ✅ **直接移植**（30 行），省电、省 host 调用 |
| 状态点/标签/药丸（`1312-1380`、`1234-1269`） | 7 种来源态 + 6 种线程态 + 6 种决策态 → 圆点/标签 | 三种颜色圆点（`client.js:75-76`） | ✅ **直接移植**：`SAT_COLOR`/`STATE_TEXT` 升级成 `DotState` 9 态 + `Tag` 7 tone |
| goal 编辑（`client.js:522-532` 已有） | — | 官方无对应物（最接近的是 ticket 的 mandate） | ✅ **保留并加强**：官方没有 goal 编辑，我们这块是独有能力，别为了对齐官方而砍掉 |
| 唤醒（`Agent.followup`，仅 idle） | 官方无对应物：它派工给独立执行器会话 | **我们的核心** | ✅ **保留**：官方 IA 里没有"唤醒"这一层，说明这是我们的差异化能力 |
| 时段 `activeHours` | 官方 7×24 评估，无时段概念 | **我们的能力** | ✅ **保留**，并在 overview 的"攒着"区展示"现在是时段外，攒了 N 条" |
| 隔离 `isolated` + worktree | 官方用执行目录 + prepareCommand 每个 ticket 一个目录 | **我们的能力**（更轻） | ✅ **保留** |
| ack（GitHub 标签水位） | 官方用 decision/disposition 记录"处理到哪" | **我们的能力** | ✅ **保留**，并把它可视化（"已 ack N 条"徽标） |
| 凭证（token / ssh key） | 官方用 setup 检查 + ConfigForm | **我们的能力**（服务端持有、不回显） | ✅ **保留**：把 `凭证` 卡片搬进「设置」tab，加 `gh CLI 状态` 一行（对应官方 `sourceState`） |
| 飞书来源（feishu-watch、lark-cli、`feishu*` health/setup 码） | 第二个来源 | 无 | ✖ **不移植**：主理鱼只做 GitHub；引入第二个来源会让"单仓库单会话"的模型失效 |
| 执行器 / Assignment / worker preset（`cordis.patch.yml` 里的 `dsh-superagent-worker-preset`） | 独立执行器会话池 | 无 | ✖ **不移植**：我们直接在本会话干活，这正是我们比官方轻的地方 |

---

## 7. 施工建议：先做哪三块

1. **UI 原语层 + 一张 CSS 表**（`controls.tsx` 的 13 个 + `widgets.tsx` 里 5 个最常用的：`Section/Hint/LabelValue/KeyValues/StatusHead`）。
   - 理由：我们现在 716 行里有一半在拼内联 style（`client.js:34-54` 的 `S`），每加一个字段就多一堆魔法数；换成 token + class 之后，后面所有卡片都是拼装。
   - 产出：`styles.css`（从 css:664 摘抄需要的 ~40 条规则）+ `ui.js`（`h()` 版的原语，因为我们是纯 JS 无 JSX）。
2. **`usePoll` + Toast + ConfirmButton**（`lib/client.js:595-637`、`813-828`、`1699-1733`）。
   - 理由：现在的裸 `setInterval` + 行内 notice + `window.confirm` 是三处最伤体验的地方，而且都非常小（各 20–40 行）。
   - 附带收益：可见性退避能减少后台标签页的 host 调用；`useAction` 顺手解决"连点删除"。
3. **Watcher 卡片 + 草稿 SaveBar**（`SourceCard` 式布局 `5247-5345` + `useDraft` 的精简版）。
   - 理由：这是主理鱼面板的主战场——现在"新增"与"编辑"是两张皮（新增有表单，已有条目只能暂停/删除/立刻）。
   - 精简版只需 `clean/editing/busy` 三态 + `dirty/busy/submit/discard` 四个字段，**不要**上 `merge3`。

次优先：概览页的 problems 列表（把 `lastError` 变成"可修的问题"）、过滤记录、observe 模式。术语表 Modal 和全局搜索属于"半天就能做完但质感提升明显"的加餐。

---

## 附录 A：`lib/client.js` 区域索引（按模块边界）

| 源模块 | lib/client.js 行 | 说明 |
|---|---|---|
| `src/navigation.ts` | `10-33` | `SessionNavigationError` + `openKnownSession` |
| `src/client/controls.tsx` | `34-425` | 13 个原语 + 35 个图标路径 |
| `src/admission.ts` | `426-442` | 准入选项/默认值 |
| `src/limits.ts` | `443-470` | 校验边界（规则名 100、指令 2000、评估 30–600s、并发 1–16、prepare 4000、prompt 1e3–1e6、上下文 1–100 页 / 1–90s） |
| `src/core/errors.ts` | `471-519` | `USER_ERRORS` 44 码 + `UserError` |
| `src/client/api.ts` | `520-662` | `ApiError`(528) / `api()`(546) / `usePoll`(595) / 过滤器常量(638-651) / `caller`(653) |
| `src/client/client.css?raw` | `663-666` | 全部 CSS（**只有一行**：664） |
| `src/core/reasons.ts` | `666-700` | `REASONS` 25 码 + `reasonText` |
| `src/client/text.ts` | `701-761` | `localized/actorName/valueLabel/reasonLabel/setupText/healthText/readableMarkers/when/fullTime` |
| `src/client/provider.tsx` | `762-898` | Context 形状、`useAction`(777)、`messages`(802)、`Toast`(813)、`PanelProvider`(829) |
| `src/client/draft.tsx` | `899-1232` | `merge3`(912)/`mergeList`(935)/`read`(953)/`draftReducer`(972)/`saveBarText`(1055)/`useDraft`(1080)/`SaveBar`(1175) |
| `src/client/marks.ts` | `1233-1385` | 状态→图标/颜色映射（`reportDot`1271、`THREAD_MARKS`1272、`ticketMark`1234、`threadMark`1304、`SOURCE_MARKS`1312、`sourceMark`1342、`DECISION_MARKS`1346、`decisionMark`1379） |
| `src/client/markdown.ts` | `1386-1452` | 安全的 Markdown 子集解析 |
| `src/app/api.ts` | `1453-1467` | 过滤器常量（`TICKET_FILTERS`/`THREAD_FILTERS`） |
| `src/client/route.ts` | `1468-1566` | `TABS`(1470)/`SETTINGS_GROUPS`(1478)/`HOME`(1485)/`parseRoute`(1501)/`ROUTE_KEY`(1543)/`initialLocation`(1545)/`remember`(1561) |
| `src/client/widgets.tsx` | `1567-1876` | 17 个复合件 |
| `src/client/rows.tsx` | `1877-2152` | `TicketLine`(1879)/`ThreadLine`(1975)/`DecisionLine`(2032)/`ThreadChip`(2090)/`automatedRuns`(2121)/`Earlier`(2133) |
| `src/client/settings-kit.tsx` | `2153-2642` | `useSettings`(2158)/`SettingsProvider`(2163)/`useBlockDraft`(2182)/`Fields`(2205)/`Field`(2223)/`ModelField`(2253)/`ConfigHistory`(2345)/`RowsField`(2416)/`SourceField`(2547) |
| `src/client/eval.tsx` | `2643-3127` | `EvalStatus`(2645)/`RuleRow`(2708)/`SourcePart`(2784)/`AdmissionTable`(2852)/`PolicyBlock`(2919)/`EvalBlock`(3039)/`EvalSettings`(3113) |
| `src/client/execution.tsx` | `3128-3386` | `ExecutionStatus`(3130)/`EnvironmentVariables`(3214)/`ExecutionSettings`(3259) |
| `src/setup.ts` | `3387-3406` | `SETUP_PROBLEMS` 16 码（带 `place`） |
| `src/sources/host.ts` | `3407-3416` | `HEALTH_TEXT` 5 码 |
| `src/client/locales.ts` | `3417-4221` | `TEXT` 724 条(3421)、`language`(4147)、`GLOSSARY`(4151)、`GLOSSARY_VALUES`(4187) |
| `src/client/overview.tsx` | `4222-4420` | `ProblemLine`(4223)/`OverviewPage`(4329) |
| `src/client/deployment.tsx` | `4421-4571` | `usePageForm`(4433)/`DeploymentPage`(4442)/`PluginConfig`(4564) |
| `src/client/prompt-config.ts` | `4572-4672` | 提示词配置纯函数 |
| `src/client/prompts.tsx` | `4673-5244` | `PromptsPage`(4676)/`PromptsEditor`(4694)/`PromptSections`(4802)/`TeamEditor`(4916)/`BuiltInEditor`(4964)/`FullPrompt`(5031)/`Diff`(5152)/`PromptHistory`(5162) |
| `src/client/source.tsx` | `5245-5567` | `SourceCard`(5247)/`SourceSettings`(5346)/`DroppedReplies`(5356)/`SourceRow`(5420)/`SourceStatus`(5528) |
| `src/client/settings.tsx` | `5568-5610` | `SettingsPage`(5574) |
| `src/client/thread.tsx` | `5611-5946` | `triggerTags`(5614)/`TriggerItem`(5647)/`mergeTimeline`(5706)/`useThreadTimeline`(5719)/`ThreadPage`(5811) |
| `src/client/ticket.tsx` | `5947-6351` | `InputLine`(5949)/`InputList`(5994)/`Details`(6009)/`Assignments`(6022)/`MandateDetails`(6069)/`TicketPage`(6138) |
| `src/client/trigger.tsx` | `6352-6389` | `TriggerStatus`(6354) |
| `src/client/app.tsx` | `6390-6789` | `Glossary`(6392)/`Highlight`(6454)/`Result`(6466)/`SearchResults`(6486)/`Header`(6565)/`Pages`(6673)/`App`(6751) |
| `src/client/index.tsx` | `6790-6883` | 入口：`NS/PANEL_ID/ENTRY`(6792-6794)/`HammerIcon`(6796)/`Mounted`(6814)/`inject`(6839)/`apply`(6846)/三个 `slots.inject`(6852,6861,6868) |

## 附录 B：官方 API 契约速查（`src/app/api.ts:20-46`，类型只存在于编译期）

```
GET    state                                  → {setup, load{running,queued,maxWorkers}, masterId, paused, health}
GET    overview                               → {problems[], person[], executor{running,queued,idle,maxWorkers}, flow{...}, policyVersion}
GET    search?q=                              → {tickets[], threads[], items[]}
GET    sources                                → SourceStatusView[]
GET    settings                               → {policyVersion, blocks{policy,eval,executor}{value,revision}, sources[], environment{root,variables}}
POST   sources/:id/labels                     → {added[]}
GET    threads?filter&offset&limit            → {items[], total, next_offset}
GET    threads/:key?limit&before&around       → {…summary, url, context[], correlated[], tickets[], decisions[], timeline[], earlier}
POST   threads/:key/unsubscribe               → {removed, thread, context_delivery}
POST   triggers/:id/requeue                   → {queued}
GET    decisions?kind&window&offset&limit     → {items[], next_offset}
POST   decisions/:id/dismiss                  → {dismissed:true}
GET    tickets?state&offset&limit             → {items[], total, next_offset}
GET    tickets/:id                            → TicketPageView（含 mandate/basis/inputs/assignments/channels/environment）
POST   tickets/:id/retry | /stop              → {retried|stopped}
POST   executor/pause {paused}                → {paused}
PUT    settings/:block {value, revision}      → {revision, restarting}
GET    policy/history                         → {items[{revision, source, savedAt, block, changes[], notified[], policyChanged, policyVersion}]}
POST   policy-sync/:id                        → {policy}
POST   setup/check                            → {restarting:true}
GET    models                                 → ModelCatalog（provider/model/effort 建议）
GET    prompts?revision&offset                → PromptsView
PUT    prompts {config, baseRevision}         → {revision, context_delivery}
POST   prompts/preview                        → 组合后的完整提示词
```

调用约定（`src/client/api.ts:33-58`）：方法写在 route 键里（`'GET state'`），`caller` 拆成 `method` + `path`，`:param` 用 `encodeURIComponent` 替换，`query` 里的 `undefined`/`''` 自动丢弃；body 走 JSON 且带 `content-type`；每个请求都带 `x-orchestrator-request: 1`。

---

## 9. 移植映射与取舍（我们实际做了什么）

官方是 6 个 tab，我们是 4 个 —— 不是漏了，是**按"会话级、单数据源"的定位主动合并**：

| 官方 tab | 我们 | 状态 | 取舍理由 |
|---|---|---|---|
| `overview` 概览 | 总览 | ✅ 已实现 | 统计卡 +「需要关注」+「最近被过滤」 |
| `source` 来源 | 设置·来源卡片 | ⚠️ 合并 | 我们只有一种来源：GitHub 轮询。官方的 webhook / 常驻实例 / 多源切换对本插件不存在 |
| `trigger` 触发 | 触发 | ✅ 已实现 | 新增、行内编辑、暂停/恢复、立刻跑一次、删除 |
| `eval` 评估 | 判定 | ⚠️ 改名合并 | 官方的「策略 / 强度 / 决策」是它的工单模型；我们的判定就是「这轮唤醒了没、为什么没」，落成 `history` + `filteredLog` |
| `execution` 执行 | 总览/判定里的字段 | ⚠️ 合并 | 没有工单与派工概念：一次唤醒 = 一轮会话。隔离 worktree 的路径与分支写在唤醒消息里 |
| `settings` 设置 | 设置 | ✅ 部分 | 保留来源、凭证、goal、术语表；官方 `prompts`（提示词模板）与 `deployment`（部署流程）未移植——我们不需要给外部实例发提示词 |
| 术语表 Modal（§2.7 之后） | 设置·术语表 | ✅ 已实现 | 三列（术语 / 含义 / 用法）+ 状态色图例，直接照抄 |
| 全局搜索（§2.0） | — | ❌ 未做 | 我们最多几十条 watcher，加了反而是噪音 |
| `TicketPage` 工单详情页 | — | ❌ 未做 | 同上：没有工单实体 |

**通用组件保留**：分段页签（含键盘左右切换与焦点跟随）、Toast（单条语义）、Modal（固定遮罩 + 居中）、
状态点 / 标签的 tone 体系、`--dsw-alias-*` 设计 token。这些是"看着像官方"的部分，实测在真浏览器里都对得上
（见 HANDOFF 的 UI 走查表）。

> 二次开发的建议：要加 tab 就走 `conversation.view` 的多注册（`id` 不同即可），
> 但要先回答一个问题——这个信息是不是「每轮唤醒」能解释的？解释不了就别加页签，加到现有页里的 section 更合适。
