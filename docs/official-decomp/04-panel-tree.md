# 官方 Superagent 面板完整解构：导航树、数据依赖、组件素材与吸收映射

> 源码基线：`/tmp/sa-off`，commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`。
> 本文中的 `src/...:行号` 均指该源码树；CSS 栏的 `client.css` 指 `src/client/client.css`，组件栏省略目录的 `controls.tsx / widgets.tsx / rows.tsx / settings-kit.tsx` 等指 `src/client/` 下同名文件，`resources.ts` 指 `src/app/resources.ts`。
> 主理鱼文件则明确写 `dsh-session-superagent/...`，第四节省略目录的 `client.js` 也指该文件。
> 层级口径：一级是 6 个主 Tab；二级是 Tab 内 Section、整页详情或设置分组；三级是分组内子页、折叠区、浮层与 Modal。官方**没有详情抽屉**，Thread/Ticket 都是同一路由壳里的整页详情。

## 一、完整页面树

### 1. 挂载面、公共壳与路由

官方有三个注册面，不只有一个主面板（`src/client/index.tsx:48-57`）：

```text
DSH
├─ sidebar.panellist
│  └─ HammerIcon → 打开 main / dsh-superagent
├─ main / dsh-superagent
│  └─ Mounted → App → PanelProvider → Pages
│     ├─ Header
│     │  ├─ 全局搜索浮层
│     │  ├─ 术语表 Modal
│     │  └─ 打开主 Session
│     ├─ SegmentedTabs（6 个一级 Tab）
│     └─ main#dt-page[role=tabpanel]
│        ├─ overview
│        ├─ source
│        ├─ trigger → trigger/:key（Thread 整页详情）
│        ├─ eval
│        ├─ execution → execution/:id（Ticket 整页详情）
│        └─ settings
│           ├─ source
│           ├─ eval
│           ├─ execution
│           ├─ prompts → edit / full / history
│           └─ deployment
└─ plugins.row.config / dsh-superagent#dsh-superagent
   └─ PluginConfig → PluginPage → DeploymentPage（含仓库与账号；summary 模式为空）
```

- `Mounted` 从 `configForms` 取可选宿主表单，并封装 Session 跳转；连续跳转会用 `AbortController` 取消前一次（`src/client/index.tsx:30-45`）。`openKnownSession` 会先刷新 Session 目录，再区分 `not-ready` / `not-listed`（`src/navigation.ts:9-22`）。
- 一级 Tab 固定为 `overview / source / trigger / eval / execution / settings`；设置分组固定为 `source / eval / execution / prompts / deployment`（`src/client/route.ts:7-17`）。
- 路由对象支持 Trigger 列表筛选、Thread 深链 `trigger`、Eval 的 `window=24h`、Ticket 筛选、设置的 `source` / `version` 定位参数；解析时逐字段白名单清洗（`src/client/route.ts:31-46`）。
- 路由和最多 20 条返回栈存 `sessionStorage['dsh-superagent/route']`；筛选、分页和设置分组用 replace，详情跳转才 push，重新点一级 Tab 会清空返回栈并回到该 Tab 根（`src/client/route.ts:49-66`，`src/client/app.tsx:172-187`）。
- 壳 DOM 是 `.dt-page > .dt-column > Header + SegmentedTabs + main.dt-main`，单列最大宽 960px；不是左右仪表盘（`src/client/app.tsx:141-169`，`src/client/client.css:2-15,108`）。

### 2. 公共 Header、搜索与跨页出口

| 层级 | 内容与行为 | 文件 / 组件 | 数据与动作 | 官方控件 / CSS |
|---|---|---|---|---|
| Header | 标题、搜索、术语表、打开主 Session | `Header`，`src/client/app.tsx:101-138` | `GET state` 提供 `masterId`；`openSession(masterId)` | `.dt-head`、`.dt-title`、`.dt-toolbar`，`client.css:8,13-14` |
| 搜索输入 | 提交 trim 后文本；清空、Escape、点外部关闭；序号丢弃过期响应 | `src/client/app.tsx:103-130` | `GET search?q=...` | `Input(type=search)`、`.dt-search`，`client.css:9` |
| 搜索浮层（三级） | 依次列 Tickets、Threads、Triggers；显示三组计数；Trigger 最多 20 条时提示缩小范围 | `SearchResults`，`src/client/app.tsx:68-99` | Ticket→`execution/:id`；Thread→`trigger/:key`；Trigger→`trigger/:key?trigger=id` | `.dt-search-results`、`.dt-search-head`、`.dt-list`、`.dt-mark`，`client.css:10-11,145` |
| 被过滤搜索结果 | 没有 Thread 的 filtered Trigger 不可点击，只显示过滤原因 | `src/client/app.tsx:89-96` | 使用结果里的 `filtered` / `threadTitle` / `disposition` | `.dt-row`、`.dt-row-meta` |
| 术语表 Modal（三级） | 当前语言 / 另一语言 / 含义三列；按 roles/source/trigger/eval/execution 分组；另含状态颜色与枚举速查 | `Glossary`，`src/client/app.tsx:27-55`；词典分组 `src/client/locales.ts:754-766` | 纯本地 `GLOSSARY` / `GLOSSARY_VALUES` | `Modal`、`.dt-glossary-modal`、`.dt-glossary`、`.dt-legend`、`.dt-values`，`client.css:109,147-150,154-161` |
| Session 出口 | 主 Session、Ticket Session、Assignment Session 共用目录检查后跳转 | `src/client/index.tsx:30-45`；`SessionButton`，`src/client/widgets.tsx:91-96` | 非 HTTP：`sessions` + `uiWorkspace.openSession` | `Button(icon=session)` |
| 全局 Toast | 单条、顶部居中、自动消退；动作错误统一进入 Toast | `PanelProvider` / `Toast`，`src/client/provider.tsx:41-70,82-107` | `notify(text)` | portal 到 body，`.dt-toast`，`client.css:261-263` |

### 3. Tab 1：`overview` 概览

数据入口是 `OverviewPage` 的 `GET overview`，另从全局 `GET state` 取部署状态；无数据时显示 `LoadState`（`src/client/overview.tsx:61-74`）。

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 待处理工单 | `person[]` 的 TicketLine；空态「没有待处理的工单」 | `src/client/overview.tsx:75-79` | `overview.person`；动作后 reload overview | `Section(count)`、`.dt-list.dt-cards` |
| └ Ticket 行 | 阶段、标题、关联 Thread chips、待送达数、问题摘要 / 更新时间 | `TicketLine`，`src/client/rows.tsx:10-43` | 点击→Ticket 详情 | `.dt-ticket`、`.dt-ticket-stage`、`.dt-ticket-body`，`client.css:323-333` |
| └ 行内动作（三级） | 去原渠道回答、重试、打开 Session、停止；重试 / 停止有确认 Modal | `src/client/rows.tsx:30-41` | `POST tickets/:id/retry`、`POST tickets/:id/stop` | `ActionLink`、`ConfirmButton`、`SessionButton`、`.dt-ticket-actions` |
| 系统问题 | 仅 `problems.length>0` 时出现；每条是带修复方向或动作的警示行 | `ProblemLine`，`src/client/overview.tsx:11-59,80-83` | `overview.problems` | `.dt-att`、`.dt-att-error`、`.dt-att-what`，`client.css:290-296` |
| 过去 24 小时 | 到达、被过滤、已评估、接单或续做、放弃发送；部分数字可跳对应视图 | `src/client/overview.tsx:84-93` | `overview.flow`；accepted→`eval?window=24h`，filtered/dropped→`source` | `.dt-stats`、`.dt-stat`、`.dt-stat-value`，`client.css:297-300` |
| 执行器 | 执行中 `running/maxWorkers`、排队、等待新触发；部署未通过时只给等待部署提示 | `src/client/overview.tsx:94-101` | `overview.executor` + `state.setup.problem` | 同上；详情→`execution` |

`problems` 的 9 个分支必须完整保留为“问题类型→去处”，不是一条通用红字（渲染见 `src/client/overview.tsx:26-58`，服务端聚合见 `src/app/views/overview.ts:38-78`）：

| kind | 三级内容 / 动作 |
|---|---|
| `setup` | 显示 `SetupMessage` 与原始 output；跳来源或部署设置；`CheckSetupButton` 调 `POST setup/check`，有运行中派工时先确认 |
| `no-source` | 跳 `settings?group=source`，提供「去打开来源」 |
| `no-allowed` | 跳 `settings?group=eval`，提供「去添加」 |
| `executor-paused` | 确认后 `POST executor/pause {paused:false}` |
| `runtime-error` | 核心 health 名称与 mono 错误详情，无详情页 |
| `source-error` | 来源健康错误；跳 `source` Tab，并可继续进来源设置 |
| `eval-overdue` | 跳对应 Thread 详情 |
| `eval-unavailable` | 跳 Thread 中高亮 Trigger；可 `POST triggers/:id/requeue` 或 `POST decisions/:id/dismiss` |
| `outgoing` | 来源、重试次数和发送错误；没有另造回复详情页 |

### 4. Tab 2：`source` 来源状态

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 状态头 | 「状态」说明 + 设置按钮，直达 `settings?group=source` | `SourceStatus`，`src/client/source.tsx:141-155`；`StatusHead`，`src/client/widgets.tsx:118-125` | 全局 setup + `GET sources` | `.dt-status-head`、`.dt-status-title`，`client.css:270-275` |
| 全局部署错误 | 部署级 setup 错误置项，链接到部署设置 | `src/client/source.tsx:145-152` | `state.setup.problem.place==='deployment'` | `.dt-error`、`.dt-textlink` |
| Source 状态行 | 每个来源显示 ready/off/error/setup/starting/paused/missing 对应状态、24h 收到 / 过滤数、最近触发 | `SourceRow`，`src/client/source.tsx:95-124` | `sourcesStatus[]` | `Dot`、`LabelValue`、`.dt-row-name`、`.dt-status-text` |
| 来源 setup / health 明细 | 来源专属 setup 链接到对应设置卡；只展示 error/paused health，健康部件不占空间 | `src/client/source.tsx:102-124` | `source.problem`、`source.health[]` | `SetupMessage`、`.dt-clamp`、`.dt-mono` |
| 被过滤 Trigger 折叠（三级） | 每个来源最近最多 5 条，显示 actor、preview、原因、时间 | `src/client/source.tsx:125-135`；服务端 `src/app/views/sources.ts:41-56` | 同一 `GET sources` | `DisclosureRow(icon=filter)`、`.dt-disclosure-body`、`Tag(neutral)` |
| 放弃回复折叠（三级） | 24h 未发送回复，显示原因；优先跳 Ticket，缺 ticketId 时回退 Thread | `DroppedReplies`，`src/client/source.tsx:70-94`；`src/app/views/sources.ts:59-69` | 同一 `GET sources` | `DisclosureRow(icon=dismiss)`、`.dt-plain-list` / `.dt-list` |

来源的**配置**不在此 Tab 另开表单，而在 `settings → source`；状态与配置分离是官方 IA 的关键。

### 5. Tab 3：`trigger` 触发 / Thread 列表

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 状态头与筛选 | 默认 `subscribed`，另有 `evaluating / recent / all` 共四个 Pill；切换筛选 replace 路由并把 limit 重置 20 | `TriggerStatus`，`src/client/trigger.tsx:10-21`；筛选常量 `src/app/api.ts:12-15` | `GET threads?filter&limit` | `StatusHead`、`.dt-filters`、`Pill` |
| Thread 行 | 生命周期阶段、标题、最近一条 actor/preview、ThreadChip、扇出 Ticket 或 poll error、时间 | `ThreadLine`，`src/client/rows.tsx:50-76` | `threads.items[]`；点击→`trigger/:key` | `.dt-ticket`、`StageMark`、`.dt-row-quote`、`.dt-chip`，`client.css:280-288,323-333` |
| 空态 / 加载更多 | 空列表统一 Hint；有 `next_offset` 时每次多取 20 | `src/client/trigger.tsx:22-25` | 同上 | `Hint`、`LoadMore` |

#### 5.1 三级整页：`trigger/:key` → `ThreadPage`

| 区块 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 页头 | 返回上一路由；Thread 标题；有 URL 时「打开原帖」 | `src/client/thread.tsx:108-130` | `GET threads/:key?limit=50` | `PageHead`、`ActionLink`、`.dt-page-head`，`client.css:130-133` |
| 状态行 | 来源、最近触发、创建时间 | `src/client/thread.tsx:131-134` | `threadSummary` | `.dt-row-meta.dt-status-line` |
| 评估中横幅 | 触发数、强度、deadline | `src/client/thread.tsx:135-138` | `data.evaluating` | `.dt-banner` |
| poll error | 线程轮询失败原文 | `src/client/thread.tsx:139` | `data.pollError` | `.dt-error.dt-clamp` |
| 已订阅 Tickets | TicketLine 列表；context-only Ticket 有标签 | `src/client/thread.tsx:140-143` | `data.tickets`、`data.context` | `Section(count)`、`ContextTag` |
| Decisions 折叠 | 该 Thread 全部 DecisionLine，默认折叠 | `src/client/thread.tsx:144-149` | `data.decisions` | `DisclosureRow(icon=decision)` |
| 关联 Threads | 只作上下文关联；点击切到另一个 Thread 详情 | `src/client/thread.tsx:150-155` | `data.correlated` | `.dt-plain-list`、`.dt-textlink` |
| Trigger 时间线 | actor、时间、正文、去向 tags、handback、打开 Ticket、重新评估 | `TriggerItem`，`src/client/thread.tsx:28-56,156-168` | `data.timeline` | `.dt-timeline`、`.dt-event`、`.dt-event-foot`、`.dt-highlight`，`client.css:57-72` |
| 长正文 / 自动消息折叠 | 超 480 字或 8 行显示展开；同发送者连续自动消息只展示最新， Earlier 可展开 | `ClampText`，`src/client/widgets.tsx:61-72`；`Earlier`，`src/client/rows.tsx:118-139` | 本地折叠，无额外请求 | `.dt-clamp-8`、`.dt-more`、`.dt-plain-list` |
| Trigger 深链 | `?trigger=id` 高亮并滚动到目标；不在最新页时用 `around` 取锚点页 | `src/client/thread.tsx:34-39,72-101` | `GET threads/:key?around=id&limit=50` | `.dt-event.dt-highlight`、`.dt-reveal` |
| 无缺口向前分页 | 最新轮询页与较旧页有 gap 时循环 `before` 补页、按 id 去重排序，再显示「加载更早」 | `src/client/thread.tsx:57-106,162-167` | `GET threads/:key?before=at|id&limit=50` | `Button(icon=chevron-down)` |
| 退订危险区 | 仅仍有 Tickets 时出现；确认后 `POST threads/:key/unsubscribe`，pending delivery 给 Toast | `src/client/thread.tsx:123-127,169-174` | 同左 | `.dt-danger-zone`、`ConfirmButton`，`client.css:137-138` |

Thread 没有独立“Decision 详情页”；DecisionLine 总是跳 Ticket（若有 `ticketId`）或回到 Thread 的 Trigger 锚点（`src/client/rows.tsx:78-101`）。

### 6. Tab 4：`eval` 评估记录

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 状态头 | 状态说明 + 直达 `settings?group=eval` | `EvalStatus`，`src/client/eval.tsx:15-24` | 全局 `state.paused` | `StatusHead` |
| 暂停横幅 | 暂停时解释记录不再推进，链接到 Execution 恢复 | `src/client/eval.tsx:24-27` | 无额外请求 | `.dt-banner`、`.dt-textlink` |
| 决策筛选 | 默认 `work`，另有 `stop / ignore / unavailable / all`；work 对应 `accept,reopen`，all 的空 kind 不发送；可叠加「仅 24 小时」 | `src/client/eval.tsx:18-33`；`src/client/api.ts:100-103` | `GET decisions?kind&window&limit` | `.dt-filters`、`Pill`、`.dt-filter-gap` |
| Decision 行 | 结果 StageMark、Ticket/Thread 标题、Trigger 摘要、原因、命中规则、时间 | `DecisionLine`，`src/client/rows.tsx:78-101` | `decisions.items[]` | `.dt-ticket`、`.dt-line`、`.dt-line-text` |
| 加载更多 | 初始 30，每次 +30；空态统一 Hint | `src/client/eval.tsx:34-37` | `next_offset` | `LoadMore` |

评估的**设置**不是此页中的弹层，而是 `settings → eval` 的 Policy + Eval 两个独立草稿块，见 §10。

### 7. Tab 5：`execution` 执行 / Ticket 列表

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 状态头 | 状态说明 + 直达 `settings?group=execution` | `ExecutionStatus`，`src/client/execution.tsx:14-29` | 全局 `GET state` + `GET tickets` | `StatusHead` |
| 执行器状态行 | 等待部署 / 已暂停 / 运行中；显示 running/maxWorkers、queued；暂停 / 恢复确认 | `src/client/execution.tsx:20-38` | `POST executor/pause {paused}`，随后 reload state | `.dt-status-line`、`LabelValue`、`ConfirmButton` |
| Ticket 筛选 | 默认 `open`，另有 `person / working / idle / ended`；idle 附解释；切换重置 limit=20 | `src/client/execution.tsx:39-49` | `GET tickets?state&limit` | `Pill`、`.dt-filters` |
| Ticket 行 | 与概览同一 TicketLine；person 行显示回答 / 重试 / 停止等动作 | `src/client/execution.tsx:45-49`；`src/client/rows.tsx:10-43` | 行内 retry/stop 后 reload tickets | `.dt-list`、`.dt-ticket` |
| 加载更多 | `next_offset` 存在时每次 +20 | `src/client/execution.tsx:49` | 同上 | `LoadMore` |

#### 7.1 三级整页：`execution/:id` → `TicketPage`

| 区块 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 页头 | 返回、标题、打开来源 Thread、可重试时 Retry、打开 worker Session | `src/client/ticket.tsx:108-135` | `GET tickets/:id`；`POST tickets/:id/retry` | `PageHead`、`ActionLink`、`ConfirmButton`、`SessionButton` |
| 状态行 / 结束信息 | 阶段、授权强度、来源与 actor、更新时间；已结束另显示 outcome/reason/time | `src/client/ticket.tsx:115-143` | `ticketMark`、`data.ended` | `StageMark`、`LabelValue`、`.dt-status-line` |
| 待人工决定横幅 | attention question 用安全 Markdown；提供去来源回答链接 | `src/client/ticket.tsx:144-148` | `data.attention`、`data.channels` | `.dt-banner`、`.dt-banner-actions`、`MarkdownLite` |
| blocked / failed / delivery 横幅 | 只有阻断工作的报告或发送失败才在此显示；普通进度留在 Session / Channel | `src/client/ticket.tsx:149-155` | `data.summary`、`data.deliveryError` | `.dt-banner.dt-danger`、`.dt-mono` |
| 授权详情 Mandate | Trigger、Decision、每条规则 matched/reason、direction、scope、basis facts、Policy version | `MandateDetails`，`src/client/ticket.tsx:68-106` | 同一 Ticket 详情；版本号跳 `settings?group=eval&version=...` | `Section(icon=shield)`、`KeyValues`、`.dt-trigger-link` |
| 未送达 Inputs | 说明等待 / 暂停 / 发送失败原因；列出未送达输入 | `src/client/ticket.tsx:157-160` | `data.inputs.filter(!delivered)`、`data.paused` | `Section(count)`、`InputList` |
| 已订阅 Threads | ThreadLine 列表；context-only 有标签 | `src/client/ticket.tsx:161-164` | `data.threads` | `Section(count)` |
| Assignments 折叠 | 多于 1 次才显示且默认展开；编号、状态、报告、起止时间、结束原因、Session 出口 | `Assignments`，`src/client/ticket.tsx:46-67,165-168` | `data.assignments` | `Details(open)`、`Dot`、`Tag` |
| 环境折叠 | 实际环境变量 key/value 表 | `src/client/ticket.tsx:169-175` | `data.environment` | `Details(icon=settings)`、`.dt-table` |
| Channels 折叠 | 每个可回复渠道的外链 | `src/client/ticket.tsx:176-180` | `data.channels` | `Details(icon=message)`、`ExternalLink` |
| 已送达 Inputs 折叠 | 已送达输入数量与相同 InputList | `src/client/ticket.tsx:181-184` | `data.inputs.filter(delivered)` | `Details(icon=inbox)` |
| 标识折叠 | Ticket id、执行目录、legacy assignment | `src/client/ticket.tsx:185-190` | `data.id`、`data.directory`、`legacy` | `Details(icon=hash)`、`.dt-kv` |
| 停止危险区 | 仅 `actions.stop` 时出现；确认后停止并 reload | `src/client/ticket.tsx:192-196` | `POST tickets/:id/stop` | `.dt-danger-zone`、`ConfirmButton` |

Input 三级行还包括： delivered/undelivered 状态点、回跳 Thread Trigger 锚点、text/note 的 Markdown、handback 原因和自动消息 Earlier 折叠（`src/client/ticket.tsx:13-44`）。

### 8. Tab 6：`settings` 设置总壳

设置不是单个长表单，而是 `.dt-settings` 的左侧分组导航 + 右侧内容；五个分组切换用 replace，不制造五步返回历史（`src/client/settings.tsx:12-37`）。`source/eval/execution` 由 `SettingsProvider` 共用 `GET settings`；`prompts` 自己取数据；`deployment` 用全局 state 加宿主 ConfigForm（`src/client/settings.tsx:17-24`，`src/client/settings-kit.tsx:23-41`）。

```text
settings
├─ source      → N 张 SourceCard + Source 配置历史
├─ eval        → PolicyBlock + EvalBlock + Policy/Eval 配置历史
├─ execution   → Executor/Environment 联合草稿 + Executor/Pause 配置历史
├─ prompts     → edit / full / history + Prompt 草稿 SaveBar
└─ deployment  → setup 检查 + 本机设置 + 三项资源上限
```

### 9. 设置 1：`settings → source`

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| SourceCard × N | 标题、说明、未安装标签、启用 Switch；普通字段与 facts；setup 错误及重新检查；关联字段有未保存修改时暂时隐藏派生 fact，避免把旧事实贴到新值上 | `SourceCard`，`src/client/source.tsx:14-58` | `GET settings` 的 `sources[]` | `.dt-card`、`.dt-card-head`、`.dt-card-title`，`client.css:122-126` |
| 高级字段折叠 | `advanced` 字段集中进 Disclosure | `src/client/source.tsx:33,50-54` | 同一 Source draft | `DisclosureRow(icon=settings)` |
| 动态字段 | switch/select/number/text/fact/rows 六类；text 可只读或从 labels 选择；fact 可跳相关设置 | `SourceField`，`src/client/settings-kit.tsx:240-277` | `source.fields`、`source.labels`、`source.facts` | `Field`、`SegmentedControl`、`Input`、`.dt-select` |
| rows 编辑器 | 增删行、选择或输入各列、去重选项、超过 6 行先显示摘要；可刷新外部名称 | `RowsField`，`src/client/settings-kit.tsx:163-238` | `POST sources/:id/labels` | `.dt-rows`、`.dt-rows-item`、`.dt-subhead`，`client.css:127-129` |
| 草稿保存 | 每个 `source:<id>` 独立 revision；setup-sensitive 字段变更且有运行时给重启警告 | `src/client/source.tsx:21-32,56-57` | `PUT settings/source:<id> {value,revision}` | `SaveBar`、`.dt-savebar`，`client.css:151-153` |
| 配置历史折叠 | 只列 `source:*` 变更 | `SourceSettings`，`src/client/source.tsx:61-67` | `GET policy/history` | `ConfigHistory`、`.dt-timeline` |

带 `?source=<id>` 进入时会滚动到 `#dt-source-<id>`（`src/client/source.tsx:61-64`）。

### 10. 设置 2：`settings → eval`

#### 10.1 PolicyBlock

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| Policy 头 | 说明与 Policy version 短哈希 | `src/client/eval.tsx:136-163` | `settings.policyVersion`、`blocks.policy` | `.dt-form.dt-block`、`.dt-block-title`、`.dt-flow` |
| 接单规则列表 | 空态 / N 条 RuleRow；新增、复制、删除、启用开关 | `src/client/eval.tsx:147-174` | `policy.rules` 草稿 | `Section(action)`、`.dt-rules`、`.dt-rule` |
| RuleRow 折叠 | 名称、指令、复制 / 删除；折叠时显示指令预览；原生校验失败会展开全部规则 | `RuleRow`，`src/client/eval.tsx:42-67,151-153` | 本地编辑，保存整块 Policy | `DisclosureRow`、`Input`、`.dt-textarea`、`.dt-rule-preview` |
| 按来源子 Tab | 多来源时出现下划线子 Tab；当前来源编辑独立 part | `src/client/eval.tsx:175-186` | `policy.sources[id]` | `.dt-subtabs`、`.dt-subtab`，`client.css:309-311` |
| SourcePart | 来源专属 policy 字段；同步按钮及 health；脏草稿时禁止同步并提示先保存 / 放弃 | `SourcePart`，`src/client/eval.tsx:70-96` | `POST policy-sync/:id`，随后 reload settings | `SourceField`、`.dt-part`、`.dt-row-buttons` |
| 准入矩阵 | 每个 scope × listedUnaddressed / unlistedAddressed / unlistedUnaddressed；不可收消息格显示 —；危险 explicit 有警告 InfoTip | `AdmissionTable`，`src/client/eval.tsx:98-134` | `policy.rows` + `part.admission` | `.dt-table.dt-admission`、`.dt-admission-cell`，`client.css:372-381` |
| 无矩阵来源 | 只显示 explicitRequest 说明 | `src/client/eval.tsx:90-94` | `policy.explicit` | `.dt-field` |
| Policy SaveBar | 整个 Policy 独立保存 / 放弃 / 冲突合并 | `src/client/eval.tsx:188` | `PUT settings/policy` | `SaveBar` |

#### 10.2 EvalBlock 与历史

| 视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 接单模式 | `off / observe / auto` 三段互斥 | `src/client/eval.tsx:192-206` | `blocks.eval.value.mode` | `SegmentedControl` |
| 评估超时 | 数字输入，保存时转 number；空值不交 0 | `src/client/eval.tsx:195-210`；`numberOf`，`src/client/settings-kit.tsx:14-15` | `timeoutSeconds` | `Field(hint)`、`Input(type=number)` |
| 评估模型 | provider / model / reasoningEffort 三列，附默认值与 datalist；只有 provider 与 model 同时非空才提交对象，否则提交 `null` 表示继承默认模型 | `src/client/eval.tsx:211-213`；`ModelField`，`src/client/settings-kit.tsx:71-103` | `GET models` | `.dt-model`、`.dt-grid3`、`<datalist>` |
| Eval SaveBar | 与 Policy 分开 revision、分开保存 | `src/client/eval.tsx:214-216` | `PUT settings/eval` | `SaveBar` |
| 配置历史 | 默认列 policy/eval；`versions` 模式还列所有改变 Policy 版本的保存；`?version=` 自动展开、定位并高亮最老的产生版本记录 | `EvalSettings`，`src/client/eval.tsx:219-224`；`ConfigHistory`，`src/client/settings-kit.tsx:123-160` | `GET policy/history` | `DisclosureRow(icon=history)`、`.dt-event.dt-highlight`、`.dt-changes` |

### 11. 设置 3：`settings → execution`

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| Executor 块 | worker model + maxWorkers | `src/client/execution.tsx:75-103` | `blocks.executor` + `GET models` | `.dt-form.dt-block`、`ModelField`、数字 `Input` |
| Environment 块 | executionDirectory、prepareCommand、blockedCommands | `src/client/execution.tsx:104-121` | 同一 Executor 草稿；保存时拆 commands | `.dt-textarea.dt-mono`、`.dt-mono` |
| 环境变量折叠 | 按 Executor / Source owner 分组，列 key、首句说明、启用状态；点 key 在 prepare 光标处插入 `"$KEY"` | `EnvironmentVariables`，`src/client/execution.tsx:53-73,85-91,116` | `settings.environment.variables`、`sources` | `DisclosureRow(icon=hash)`、`.dt-table` |
| 联合 SaveBar | Executor + Environment 是同一 `executor` block 草稿；暂停是另一 block，不会让此草稿失效 | `src/client/execution.tsx:78-84,123-125`；服务端注释 `src/app/settings.ts:197-213` | `PUT settings/executor`；历史含 executor/pause | `SaveBar`、`ConfigHistory` |

### 12. 设置 4：`settings → prompts`

此分组有三张**内部子页签**，不是新增一级 Tab（`src/client/prompts.tsx:20-67`）。

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 内部页签 | `edit / full / history`；共用当前 Prompt 草稿与底部 SaveBar | `PromptsEditor`，`src/client/prompts.tsx:29-67` | 初始 `GET prompts`；`PUT prompts {config,baseRevision}` | `.dt-subtabs`、`.dt-subtab` |
| Edit · Team sections | 左侧 Team 固定为 communication / scope / delivery，显示 changed 标签和未保存圆点；右侧 textarea，可恢复该段默认 | `PromptSections` / `TeamEditor`，`src/client/prompts.tsx:70-94,119-138` | `view.sections`、`view.defaults` | `.dt-prompt`、`.dt-prompt-nav`、`.dt-nav-item`、`.dt-editor`，`client.css:116-120,165-167,359-363` |
| Edit · Built-in parts | 左侧内置 part，可覆盖；右侧 reset、读取角色、模板占位符提示；当前版本已移除的内置 part 在页签上方统一提示 | `BuiltInEditor`，`src/client/prompts.tsx:56-60,140-175` | `view.parts`、`config.overrides`、`view.defaultChanged` | `.dt-prompt-main`、`.dt-changed-tag` |
| Edit · 默认已更新 | override 的 base 落后于内置 base 时显示 diff；可保留我方文本或采用新默认 | `src/client/prompts.tsx:114-118,150-170` | `view.defaultChanged` | `.dt-default-updated`、`.dt-updated-tag`、`.dt-pre ins/del` |
| Edit · Skills | 团队 skill 列表、合法且不重名的新增表单、删除后回 communication | `src/client/prompts.tsx:75-108,127-137`；命名校验 `src/client/prompt-config.ts:47-50` | `config.skills`、`view.skillName/builtin` | `.dt-add-skill`、`.dt-changed-dot` |
| Full · 预览工具条 | 选择 orchestrator / worker / 任一 skill；显示段数、字符数、draft/saved revision；复制全部 | `FullPrompt`，`src/client/prompts.tsx:177-220` | 每次 config 改变后 250ms 防抖调用 `POST prompts/preview` | `.dt-inline-select`、`.dt-compare`、`.dt-subhead` |
| Full · 对比 | 脏草稿可与 saved 比，否则与 default 比；按 team/fixed/generated 分段，可跳回编辑来源 | `src/client/prompts.tsx:221-246` | preview 与生成它的 config 成对保存，避免 diff 错位 | `SegmentedControl`、`.dt-preview-part`、`.dt-preview-head` |
| Full · Diff | 行级 LCS diff；超过 4 行未变内容折叠成边界行 + 数量 | `Diff`，`src/client/prompts.tsx:249-255`；`lineDiff`，`src/client/prompt-config.ts:55-77` | 纯本地计算 | `.dt-pre`、`.dt-diff-fold`、`ins/del` |
| History · 版本行 | revision、保存时间、来源、变化段落；「载入」只进入草稿，不直接覆盖线上 | `PromptHistory`，`src/client/prompts.tsx:257-282` | `GET prompts?revision=n` | `.dt-list`、`.dt-row-actions` |
| History · 更早 / 默认 | 分页取更早版本；可载入内置 defaults 作为草稿 | `src/client/prompts.tsx:261-269,283-288` | `GET prompts?offset=n` | `Button(icon=history/refresh)` |
| History · Session 版本 | 每个 Session 当前 / 曾经使用的 prompt revision | `src/client/prompts.tsx:289-293` | `view.sessions` | `.dt-changes.dt-mono` |
| Prompt SaveBar | 显示 revision、改动段数、草稿来源；409 后按段落说明 merged/conflict | `src/client/prompts.tsx:45-66` | `PUT prompts`；pending delivery 单独提示 | `SaveBar`、`.dt-savebar` |

### 13. 设置 5：`settings → deployment`

| 二级 / 三级视图 | 内容与交互 | 文件 / 组件 | 数据 / API | 控件 / CSS |
|---|---|---|---|---|
| 部署说明 / setup 问题 | setup 错误 + `CheckSetupButton` | `DeploymentPage`，`src/client/deployment.tsx:32-63` | 全局 `state.setup`；`POST setup/check` | `.dt-row-buttons`、`SetupMessage` |
| 本机设置 | `stateDir` 只读；根据 ConfigForm 状态显示 loading/unavailable/memory/read-only 原因 | `src/client/deployment.tsx:47-75` | `setup.machine.stateDir` + ConfigForm snapshot | `.dt-field`、`.dt-mono`、`InfoTip` |
| 三项上限 | `promptMaxChars`、`admissionContextMaxPages`、`admissionContextTimeoutMs` | `src/client/deployment.tsx:20-24,52-55,76-80` | 可写时不是 HTTP PUT，而是 `ConfigForm.mutate(ops,revision)`，空值生成 unset | `Field`、`Input(type=number)` |
| Deployment SaveBar | 仅 ready 且 writable 时出现；只提交实际变化的 op | `src/client/deployment.tsx:35-46,82` | 本地 revision +1，不重启 | `SaveBar`；`.dt-embedded` 中取消 sticky，`client.css:3-6` |
| 插件管理器附加区 | 仅 `plugins.row.config` 的 page 视图显示仓库、Agent 账号、飞书 Bot 派生信息 | `PluginPage`，`src/client/deployment.tsx:86-97`；字段 `64-68` | `PanelProvider(interval=10000)` + `state.setup.accounts` | `.dt-embedded`、`Section`、`KeyValues` |

### 14. 弹层、折叠、草稿与状态机总表

| 类型 | 全部用途 / 行为 | 证据 |
|---|---|---|
| 术语表 Modal | Header 打开；三列术语词典、状态色和枚举；Escape / 背板 / 关闭按钮 | `src/client/app.tsx:27-55` |
| 确认 Modal | `ConfirmButton` 统一取消 / 确认 footer；用于暂停 / 恢复、Ticket retry/stop、Thread unsubscribe、有运行派工时的 setup check | `src/client/widgets.tsx:75-89`；调用点见 `execution.tsx:35-37`、`ticket.tsx:131-133,192-196`、`thread.tsx:169-173` |
| 搜索浮层 | 非 Modal、非路由页；支持点外部 / Escape 关闭 | `src/client/app.tsx:68-99,110-130` |
| Tooltip | `InfoTip` portal，支持 hover、键盘 focus、触摸；滚动 / resize 关闭 | `src/client/controls.tsx:217-249` |
| Disclosure | 来源 filtered/dropped、Thread decisions、Ticket 详情、规则、环境变量、配置历史、来源高级字段 | `src/client/controls.tsx:154-169`；`.dt-disclosure-*`，`client.css:242-250` |
| SaveBar | 仅在 dirty/busy/error 时出现；sticky 底部；消失时避免键盘焦点掉回 body | `src/client/draft.tsx:175-203` |
| 普通设置草稿 | key 为 `dsh-superagent/draft/<masterId>/<block>`；base/value/revision 存 sessionStorage | `useBlockDraft`，`src/client/settings-kit.tsx:33-41`；`src/client/draft.tsx:52-60,135-148` |
| Prompt 草稿 | key 为 `dsh-superagent/prompts/<masterId>`，额外 meta 记录 selection 与 defaults/history/reset 来源 | `src/client/prompts.tsx:29-53` |
| Deployment 草稿 | 仍复用 useDraft 的 dirty/save/rebase 状态机，但未传 `key`，所以**不写 sessionStorage**，刷新后不恢复 | `src/client/deployment.tsx:38-46`；key 可省的实现 `src/client/draft.tsx:128-148` |
| 草稿状态机 | `clean → editing → saving → awaitingRevision → clean`；保存中 / 等 revision 时禁止继续编辑和放弃 | `src/client/draft.tsx:66-107` |
| 三向合并 | base/mine/theirs 按键递归；`id` 或 `chatId` 唯一数组按元素合并；普通数组双方同改则整体冲突；删除遇修改保留 mine 并记录路径冲突 | `merge3/mergeList`，`src/client/draft.tsx:10-50` |
| 409 / revision 到达 | 409 先 reload，再以新远端为重基；saving 中不抢合，sent 等轮询 revision 追上；冲突、合并、校验失败、存储失败分别反馈 | `src/client/draft.tsx:95-105,149-172` |
| 动作重入保护 | `useAction` 统一 busy、防连点、错误 Toast、可选 reload | `src/client/provider.tsx:41-56` |

## 二、数据依赖

### 1. 请求、轮询与重启约定

- 所有管理 HTTP 走同源 `/orchestrator/api/<path>`，带 `x-orchestrator-request: 1`；route key 同时声明方法和路径，路径参数 encode，query 的 `undefined` / 空串被省略，body 为 JSON（`src/client/api.ts:32-58,105-117`）。完整路由契约集中在 `src/app/api.ts:20-46`。
- `ApiError` 保留 status、Zod issues、setup、结构化 user error 与 unreachable；只有“非 unreachable 的 404”才被 Thread/Ticket 详情当成记录确实不存在，空 404 可表示宿主重启中（`src/client/api.ts:8-24,44-56`）。
- `usePoll` 默认 5 秒，页面隐藏时间隔 ×6；请求串行，依赖变化会丢弃旧响应，数据不变时不触发 setState，错误时保留最后成功数据（`src/client/api.ts:60-98`）。
- `PanelProvider` 全局只轮询 `GET state`；重启探测改 1 秒，看到 down 再 up 后增加 `restarts`，让 SettingsProvider 重新拉取；30 秒兜底退出重启态（`src/client/provider.tsx:74-107`）。
- `SettingsProvider` 的 `GET settings` 依赖 `restarts`；插件管理器内嵌 Deployment 则用 10 秒 state 轮询（`src/client/settings-kit.tsx:23-31`，`src/client/deployment.tsx:95-97`）。

### 2. 页面 → API → 服务端投影完整矩阵

| 页面 / 动作 | API 与参数 | 主要返回 / 服务端依据 |
|---|---|---|
| 全局壳 | `GET state` | setup、load、masterId、paused、health；`src/app/api.ts:21` |
| 全局搜索 | `GET search {q}` | tickets 最多 10、Triggers 最多 20及关联 Threads；`src/app/views/threads.ts:55-88` |
| 概览 | `GET overview` | problems/person/executor/flow/policyVersion；`src/app/views/overview.ts:38-78` |
| 来源状态 | `GET sources` | 每来源 health/state/24h stats/最多 5 filtered/dropped；`src/app/views/sources.ts:41-69` |
| Trigger 列表 | `GET threads {filter,limit,offset?}` | page(items,total,next_offset)；筛选和排序 `src/app/views/threads.ts:9-23` |
| Thread 详情 | `GET threads/:key {limit,before?,around?}` | summary + context/correlated/tickets/decisions/timeline/earlier；`src/app/views/threads.ts:25-53` |
| Eval 列表 | `GET decisions {kind,window?,limit,offset?}` | DecisionView 列表；`src/app/views/threads.ts:90-94` |
| Execution 列表 | `GET tickets {state,limit,offset?}` | TicketRow 列表；`src/app/views/tickets.ts:35-49` |
| Ticket 详情 | `GET tickets/:id` | mandate/basis/channels/assignments/inputs/threads；`src/app/views/tickets.ts:56-86` |
| 设置三分区 | `GET settings` | blocks{policy,eval,executor}{value,revision}、sources[]、environment；`src/app/views/settings.ts:23-40` |
| 模型字段 | `GET models` | DSH ModelCatalog；provider 默认、groups/models/efforts；客户端 `src/client/settings-kit.tsx:71-103` |
| 配置历史 | `GET policy/history` | 最近 30 个版本、结构化 changes、notified、Policy version；`src/app/settings-history.ts:81-90` |
| Prompt 编辑 / 历史 | `GET prompts {revision?,offset?}` | current/defaults/parts/revisions/sessions/defaultChanged；`src/client/prompts.tsx:20-26,257-293` |
| Prompt 预览 | `POST prompts/preview {config}` | 按 orchestrator/worker/skills 组合后的 parts；只预览、不产生持久版本；`src/client/prompts.tsx:177-201` |
| 设置保存 | `PUT settings/:block {value,revision}` | 新 revision、restarting；block 为 policy/eval/executor/source:`<id>`；`src/client/settings-kit.tsx:33-41` |
| Prompt 保存 | `PUT prompts {config,baseRevision}` | 新 revision、context_delivery；`src/client/prompts.tsx:31-38` |
| 来源 labels 刷新 | `POST sources/:id/labels` | added[]；`src/app/settings.ts:253-266` |
| Policy 同步 | `POST policy-sync/:id` | 同步后的 policy part；冲突 / 退避见 `src/app/settings.ts:225-251` |
| 暂停 / 恢复 | `POST executor/pause {paused}` | paused；独立 pause block，不能拿 Executor 表单去 PUT pause；`src/app/settings.ts:197-213` |
| Trigger 重新评估 | `POST triggers/:id/requeue` | queued；`src/app/api.ts:30` |
| Decision 不再提示 | `POST decisions/:id/dismiss` | dismissed；`src/app/api.ts:32` |
| Thread 退订 | `POST threads/:key/unsubscribe` | removed/thread/context_delivery；`src/app/api.ts:29` |
| Ticket 重试 | `POST tickets/:id/retry` | retried；`src/app/api.ts:35` |
| Ticket 停止 | `POST tickets/:id/stop` | stopped；`src/app/api.ts:36` |
| 部署重检 | `POST setup/check` | restarting；随后前端进入重启轮询；`src/client/widgets.tsx:133-147` |
| Deployment 保存 | **非管理 HTTP**：`ConfigForm.mutate(ops,revision)` | 对三项 limit 生成 set/unset；`src/client/deployment.tsx:35-46` |
| Session 跳转 | **非管理 HTTP**：`sessions.list/refresh` + `uiWorkspace.openSession` | `src/navigation.ts:13-22` |

### 3. `records / threads / tickets / sources / settings` 的服务端投影关系

这些文件不是额外页面，而是上述 API 的读模型；不要把文件名误翻成新 Tab。

| 文件 | 为面板提供的真实数据职责 |
|---|---|
| `src/app/views/records.ts` | 共享 `page` 分页、`snapshot` 每请求缓存、actor/rule/订阅解析；`triggerView` 计算 queued/evaluating/delivered/filtered/fanout/handbacks/requeue；`ticketSummary` 计算阶段、注意问题、未送达、Session；`threadSummary` 计算 error/evaluating/queued/subscribed/dormant/unsubscribed；`decisionView` 合并 audit、rules、direction（`src/app/views/records.ts:14-67,70-107,109-177,184-210`）。 |
| `src/app/views/threads.ts` | Thread 列表、Thread 详情、跨实体 search、Decision 列表；`before` 是 `at|id` 稳定游标，`around` 用于深链（`threads.ts:9-53,55-94`）。 |
| `src/app/views/tickets.ts` | Ticket 列表 / 详情、执行器负载、Mandate basis facts；输入反转成最新优先，并补 Trigger/handback/Markdown、worker Session ref（`tickets.ts:35-55,56-86`）。 |
| `src/app/views/sources.ts` | health 优先级、setup 归属、24h filtered/dropped；dropped 会补 Ticket 和 Thread 跳转目标（`sources.ts:11-40,41-69`）。 |
| `src/app/views/settings.ts` | 每块 value+revision、来源 schema fields/facts/restart-sensitive fields/labels/policy metadata、执行环境变量（`settings.ts:10-40`）。 |
| `src/app/views/overview.ts` | 跨 Store、Source health、setup、Policy 和 ExecutorLoad 汇总，不另存“概览页面数据”（`overview.ts:38-78`）。 |
| `src/app/views/text.ts` | 在服务端先剥离 HTML、压缩 preview、把 JSON notice 变成可读行；客户端 Markdown 也不解释 raw HTML（`src/app/views/text.ts:1-36`，`src/client/markdown.ts:18-42`）。 |

### 4. 设置写入、历史、版本与资源上限

- `Settings.save` 在异步模型 / 账号检查前后各检查一次 revision；随后重新读取 settings，避免无关块的并发保存被覆盖。no-op 不产生新版本；Policy 变化计算 effects 并通知受影响 Ticket；setup 字段变化会重启，其他保存触发立即 pass（`src/app/settings.ts:148-195`）。
- 执行环境只能由 `origin==='panel'` 改，来源账号字段同理；这不是 UI 禁用就能替代的服务端约束（`src/app/settings.ts:32-52,139-167`）。
- `settings-history.ts` 把版本差分翻译为规则增删改、来源字段 / rows / admission、mode/timeout/model/maxWorkers/pause/environment 等结构化 change code；历史缺相邻 baseline 时返回 `changes:null`，UI 显示「无基线」（`src/app/settings-history.ts:47-89`，`src/client/settings-kit.tsx:145-157`）。ConfigHistory 是只读 Disclosure，不是 Modal，也没有“恢复此设置版本”按钮；只有 Prompt History 能把版本载入草稿（`src/client/settings-kit.tsx:123-160`，`src/client/prompts.tsx:257-288`）。
- `Versions` 用 current pointer + 每 revision 全量快照，save 原子推进；`keep` 可保存初始默认基线而不推进 current；`list` 按 revision 倒序。Settings 与 Prompts 共用这套存储，不是另造“版本页面”（`src/app/versions.ts:5-33`）。
- `resources.ts` 是主 Session / worker 的 `orchestrator_read` 资源面，**不是浏览器面板 URL，也不是新导航树**。列表分页默认 20、最大 50，text 默认每页 4000 字符；worker 只能读自己 Ticket 授权范围内的资源；旧 `event/ / task/ / observation/` 前缀会归一化为 `trigger/ / ticket/ / decision/`（`src/app/resources.ts:76-109,295-307`）。资源包括：
  - 列表：`tickets`、`triggers`、`threads`、`decisions`、`models`（`resources.ts:118-132,150,191-200`）。
  - 单实体：`thread/<key>`、`decision/<id>`、`trigger/<id>`、`ticket/<id>`（`resources.ts:133-155,210-253`）。
  - Ticket 三级资源：`assignment`、`assignments`、`inputs`、`input/<id>`、`result`、`report/<id>`、`transcript`、`message/<n>`（`resources.ts:254-291`）。
  - 设置与提示词：`settings`、`settings/<block>`、`prompts`、`prompts/<revision|current|defaults>`、`prompt-preview/<id>`（`resources.ts:156-190`）。
  - 模型与来源原文：`models/<provider>`、`feishu/<trigger-id>/…`、`github/…`；来源正文 offset 0 拉取并缓存，后续 offset 读缓存（`resources.ts:103-109,191-209`）。
- 因而 `provider` 有两层含义：React 的 `PanelProvider` 提供 call/navigate/state/toast/restart（`src/client/provider.tsx:9-39,74-107`）；模型 provider 只作为 Eval/Executor 的 ModelField 与 Session resource，不存在独立 Provider Tab（`src/client/settings-kit.tsx:71-103`，`src/app/resources.ts:191-200`）。

## 三、组件素材

### 1. 自包含官方原语

`controls.tsx` 明确选择“镜像 DSH ui-primitives 的 DOM 与键盘行为，但不耦合内部包 API”，全部样式使用 `--dsw-alias-*` token（`src/client/controls.tsx:1-8`）。

| 原语 | 行为 / DOM | 文件与 CSS |
|---|---|---|
| `Icon` | 统一 currentColor SVG；chevron/search/question/plus/trash/refresh/history/settings/session/pause/play/stop 等路径集中管理 | `controls.tsx:11-52` |
| `Button` | primary/ghost/outline × md/sm；icon 独立 span；默认 `type=button` | `controls.tsx:54-60`；`client.css:187-197` |
| `Tag` | outline/neutral/quiet/success/info/warning/danger 七 tone | `controls.tsx:62-65`；`client.css:198-205` |
| `Pill` | 筛选胶囊，`aria-pressed` | `controls.tsx:67-70`；`client.css:206-208` |
| `SegmentedTabs` | 真 tablist/tab；←/→/Home/End 循环并焦点跟随；ResizeObserver 给窄屏加 start/end/both 渐隐 | `controls.tsx:72-112`；`client.css:15,169-180,209-213,268-269` |
| `SegmentedControl` | 表单互斥选择，沿用相同键盘 walk，但不重复触发当前值 | `controls.tsx:113-125`；`client.css:16,214-218` |
| `Input` | `.dt-input` 包 native input，可带图标，focus-within | `controls.tsx:127-130`；`client.css:219-225` |
| `Switch` | `role=switch` + `aria-checked` | `controls.tsx:132-138`；`client.css:226-230` |
| `StateDot` / `Dot` | done/warning/ongoing/error/idle；ongoing 用 spinner，其他用状态点，Dot 可带可读 label | `controls.tsx:140-151`；`client.css:231-241` |
| `DisclosureRow` | Enter/Space 与点击均可展开；`aria-expanded`；折叠时可保留摘要 | `controls.tsx:154-169`；`client.css:242-250` |
| `Modal` | body portal、Escape、背板关闭、Tab 焦点陷阱、关闭后焦点归还；onClose 用 ref 防止轮询重置焦点 | `controls.tsx:171-215`；`client.css:251-260` |
| `InfoTip` | body portal tooltip；hover/focus/touch；视口边缘定位；Escape/scroll/resize 关闭 | `controls.tsx:217-249`；`client.css:91-95` |

### 2. 复合件与列表素材

| 复合件 | 可复用结构 | 证据 |
|---|---|---|
| `Section` | 标题、count、InfoTip、badge/icon、右 action 的统一 Section | `src/client/widgets.tsx:24-35`；`client.css:19-22` |
| `StatusHead` / `PageHead` | 列表状态头 + 设置入口；详情返回 + 标题 + 操作区 | `widgets.tsx:118-132`；`client.css:130-134,270-275` |
| `Hint` / `LabelValue` / `KeyValues` | 空态、弱标签强数值、两列事实表 | `widgets.tsx:36-43`；`client.css:23,54-56,277-279` |
| `ConfirmButton` | 所有危险动作共用确认 Modal 与 busy 防连点 | `widgets.tsx:75-89` |
| `ClampText` / `MarkdownLite` | 长文展开；标题/列表/段落/粗体/code/link 安全子集，不渲染 HTML | `widgets.tsx:45-72`；`src/client/markdown.ts:18-42` |
| `TicketLine` / `ThreadLine` / `DecisionLine` | 同一 `.dt-ticket` 两列行：左 StageMark，右标题/摘要/meta/actions；窄屏变一列 | `src/client/rows.tsx:10-101`；`client.css:323-358` |
| `ThreadChip` | source + facts 的可外链芯片，problem 用错误色 | `rows.tsx:104-116`；`client.css:280-288` |
| `automatedRuns` / `Earlier` | 同 sender 自动消息折叠，不是简单截断列表 | `rows.tsx:118-139` |
| `Field` / `Fields` | label+InfoTip+note；保存期间 fieldset disabled，完成后恢复原输入焦点 | `src/client/settings-kit.tsx:44-69`；`client.css:75-81` |
| `ModelField` | provider/model/effort 三列 + 默认提示 + datalist | `settings-kit.tsx:71-103`；`client.css:104-105` |
| `ConfigHistory` | Disclosure + timeline + changes + notified + 指定版本高亮 | `settings-kit.tsx:123-160` |
| `SaveBar` | sticky 保存 / 放弃 / 状态 / 错误；嵌入 Plugin Manager 时 static | `src/client/draft.tsx:175-203`；`client.css:3-6,151-153` |
| `LoadState` / `LoadMore` | 统一错误、加载、空态和分页按钮 | `src/client/widgets.tsx:108-116` |

### 3. 状态、文案与 CSS 组合规则

- `ticketMark / threadMark / sourceMark / decisionMark / reportDot` 把领域状态集中映射为 label、TagTone、DotState、IconName；不要在每个页面自行发明颜色（`src/client/marks.ts:7-57`）。
- `localized / actorName / valueLabel / reasonLabel / setupText / healthText / readableMarkers / when` 集中处理双语文案、错误原因、媒体占位和相对时间（`src/client/text.ts:9-63`）。
- 词典、术语表分组和状态枚举都在 `locales.ts`，不是散在各 TSX；`TEXT` 从通用 UI 到 userError/setup/health 全覆盖（`src/client/locales.ts:8-19,682-766`）。
- 主布局用 container query，不用假设浏览器宽度的 media query：窄屏时 Tab 横滚、设置左栏变横向换行、三列模型 / Prompt 双栏变一列、Ticket 左状态列并入主体（`src/client/client.css:169-185,317-322,355-358`）。
- 交互点击层有特殊规则：`.dt-open::after` 覆盖整行，动作容器 `pointer-events:none`、子控件恢复 auto，避免行跳转吃掉按钮（`client.css:33-37,46-47,333-336`）。
- 样式经 `import STYLES from './client.css?raw'` 在 PanelProvider 内注入；`css.d.ts` 只是 raw 文本模块声明（`src/client/provider.tsx:4-7,103-106`，`src/client/css.d.ts:1-5`）。

## 四、「主理鱼现有 4 页签 vs 官方树」的可吸收映射

### 1. 先对齐现状，不照搬实体

主理鱼当前确实只有 `overview=总览 / judge=判定 / trigger=触发 / settings=设置` 四个一级页签（`dsh-session-superagent/client.js:2224-2232`），现有内容为：

- **总览**：统计、最近被过滤、需要关注、主理鱼列表、按仓库汇总（`client.js:1579-1656,1807-1855`）。
- **判定**：判定日志、按编号追溯、暂停 / 跳过原因、运行时事件（`client.js:1658-1805`）。
- **触发**：新增主理鱼及仓库、限流、过滤、作者、时段、observe、隔离等字段；已有行的编辑仍是另一条动线（`client.js:1857-1876`）。
- **设置**：左侧已有 `来源 / 凭证 / 版本与更新 / 分诊信号 / 会话 goal` 五个分区（`client.js:1885-2019`）。

官方的核心是 **Source → Trigger/Thread → Eval/Decision → Ticket/Assignment**；主理鱼的核心是 **仓库 watcher → 过滤 / 判定 → 唤醒当前 Session → ack**。因此吸收单位应是“信息结构、证据链、控件和交互”，不是把 Ticket、Assignment、Provider 等名词全部新增为 Tab。

### 2. 推荐目标树：仍然只有 4 个一级页签

```text
总览
├─ 统计与有动作率（保留）
├─ 需要关注：每条问题带修复动作（吸收 official problems）
├─ 来源 / 仓库健康摘要（吸收 source 状态，不新增 Source Tab）
├─ 待唤醒 / 被限流 / 时段外（借 pendingTickets 的信息优先级，不伪造 Ticket）
├─ 最近被过滤（保留，改统一 Disclosure）
└─ 主理鱼列表 + 按仓库汇总（保留）

判定
├─ 判定日志（保留，对齐 DecisionLine）
├─ 编号追溯 → 条目时间线 / 本次唤醒依据（借 Thread 深链与 MandateDetails）
├─ 暂停 / 跳过 / 被过滤原因（保留）
└─ 运行时事件（保留，和“判定结果”保持两个 Section）

触发
├─ 新增主理鱼（保留）
├─ 新增 / 编辑共用草稿与 SaveBar（吸收 SourceCard + useDraft）
├─ 基础字段 / 高级字段 Disclosure（隔离、workdir、保留策略归高级）
└─ observe、过滤与规则（吸收 Eval 设置中真正适用的部分）

设置
├─ 来源（仓库 / gh / token 状态摘要；详细凭证仍在凭证区）
├─ 凭证（保留，加块级 dirty/busy/错误反馈）
├─ 版本与更新（保留；只展示有真实 API 的部署事实）
├─ 分诊信号（保留；配置变更历史若可取得则放此区 Disclosure）
└─ 会话 goal（保留；只给 AGENTS.md 入口 / 摘要，不移植 Prompt 编辑器）
```

### 3. 官方树 → 现有页面的逐项映射

| 官方能力 | 应吸收到哪里 | 明确取舍 |
|---|---|---|
| `overview.problems` 9 类问题 | **总览 → 需要关注** | 保留“问题类型 + 原因 + 修复按钮”，种类改成主理鱼真实的凭证失败、仓库失效、限流、未回音、版本漂移；不要增加 Problems Tab。 |
| `overview.pendingTickets` | **总览 → 待唤醒 / 需要处理** | 只在有 `lastDeferred`、quota、activeHours、wake failure 等真实数据时做；不要把 watcher 改名为 Ticket。 |
| `overview.flow` / Executor 数字 | **总览 → 统计条 / 按仓库** | 可增加到 / 过滤 / 已唤醒 / ack / 超限；执行中并发仅在宿主提供可靠数据时显示，不虚构 worker 池。 |
| `source` Tab | **总览的健康摘要 + 设置·来源 / 凭证** | 总览只显示异常与最近轮询，设置放 CLI、token、scope；不新增第七个概念等同的 Source 页签。官方状态与配置分离的思路保留。 |
| Source filtered / dropped | **总览·最近被过滤 + 判定·跳过原因** | filtered 已有数据，直接换官方 Disclosure 行结构；主理鱼没有“渠道回复发送失败”就不要造 dropped 区。 |
| Trigger 列表四筛选 | **总览 watcher 筛选或判定条目筛选** | 映射为全部 / 已唤醒 / 被过滤 / 已 ack 等真实状态；不要为主理鱼新增“线程”一级页签。 |
| `ThreadPage` 时间线、around 深链、Earlier | **判定 → 编号追溯的条目详情** | 这是最值得吸收的三级页：同一 issue/PR 的轮询、过滤、唤醒、ack 按时间排列；编号搜索直接定位，不另开 Thread Tab。数据量大时再移植 before 游标，而非预先做复杂补页。 |
| `eval` Decision 列表 | **判定 → 判定日志** | 已合并正确；补齐统一 StageMark、原因、命中 filter、时间与深链即可，不新增 Eval Tab。 |
| Eval `off/observe/auto` | **触发 → watcher 表单** | observe 已存在，保留为单 watcher 开关；不要复制全局“接单模式”区块。 |
| Policy rules / AdmissionTable | **触发 → 过滤与作者规则** | 可借 RuleRow 的折叠、启停、复制和未保存标记；主理鱼没有多来源名单 × 点名语义，不搬准入矩阵。 |
| `execution` Ticket 列表 | **总览 watcher 行 + 判定条目详情** | 只吸收“当前在做什么 / 卡在哪里 / 下一步去哪”的状态行；没有 Ticket 实体，不新增 Execution Tab。 |
| `TicketPage` MandateDetails | **判定 → 本次唤醒依据** | 展示 watcher、goal revision、命中过滤、活跃时段、quota、唤醒批次、ack 结果；这是详情 Section，不是新页签。 |
| Ticket Inputs / Assignments / Channels | **不新建对应区** | 主理鱼在当前 Session 工作，原会话与 GitHub/Gitee 链接就是出口；只有真实存在的唤醒记录、执行 worktree、原条目链接可分别并入条目详情。 |
| Execution 设置（目录 / 环境 / blockedCommands） | **触发·高级字段 + 设置·分诊信号** | isolated/workdir/keepDays/maxIsolated 放对应 watcher 高级区；只读实际隔离路径可进诊断。没有的能力不暴露空表单。 |
| SourceCard + 高级字段 + SaveBar | **触发新增与行内编辑、设置凭证 / goal** | 高优先级：统一新建和编辑为同一 Field 体系，按 watcher 或设置块独立 dirty/saving/error；高级项默认折叠。 |
| `merge3` / 409 revision | **触发与设置的草稿层，按需实现** | 先实现 sessionStorage 恢复、dirty/discard/busy 和“服务端已变化”提示；只有服务端也提供 block revision 时才做完整三向合并，不能前端假报 merged。 |
| ConfigHistory / Versions | **设置·分诊信号内的配置历史 Disclosure；判定里的唤醒历史** | 配置历史与运行历史分开；没有持久化 revision/changes API 时不做假历史，更不新增 Versions Tab。 |
| Prompts edit/full/history | **不移植编辑器；设置·会话 goal 保留** | 主理鱼处理规则属于仓库 AGENTS.md，goal 属于会话；可以提供文件入口、当前 goal 和变更时间，不把整套 prompt 模板复制进面板。 |
| Deployment | **设置·来源 / 版本与更新 / 诊断** | stateDir、运行 / 安装版本、诊断、升级命令放现有分区；三项官方 limit 与主理鱼无关则不显示，ConfigForm 不存在时不伪造可写部署页。 |
| Provider / ModelField | **默认不吸收为页面** | 主理鱼没有独立 assessor/worker 模型配置；将来真有角色模型设置时，也只作为设置里的一个 Field，不开 Provider Tab。 |
| 全局搜索 | **扩展现有顶部搜索** | 继续搜 watcher/repo，并复用判定的编号追溯；结果显示在现有搜索浮层或判定区，不做独立 Search Tab。 |
| 术语表 / ConfirmButton / Toast / InfoTip | **全局控件层** | 直接复用官方原语与键盘行为，和页面数量无关；重要错误留在对应 Section，轻保存反馈用 Toast。 |
| `resources.ts` | **数据依赖参考，不进入 IA** | 它是 Agent 工具资源面；可借分页和按权限裁剪思路，不应映射成任何新 Tab。 |

### 4. 实施顺序与“不要增加 Tab”的判据

1. **先合并现有动线**：触发的新增 / 编辑共用草稿，总览问题带修复动作，判定编号进入完整条目时间线。这三项不改变一级导航，却消除最多返工。
2. **再统一三级素材**：`DisclosureRow + SaveBar + ConfirmButton + ConfigHistory 式时间线`；所有新信息优先进现有 Section 或条目详情。
3. **最后补数据证据**：只有真实 API 已提供 revision、历史、执行目录、模型或部署事实时才显示相应编辑器；否则保留只读事实或不显示。
4. **新增一级 Tab 的门槛**：必须是一个新的用户任务对象、拥有独立列表与详情、且无法被“watcher / 条目判定 / 设置块”承载。官方 Ticket/Assignment 在主理鱼不满足；Source、Provider、Versions、Resources 也都不满足。
5. **反向约束**：不要为“与官方数量相同”把 4 页签扩成 6 或更多。官方适合吸收的是渐进披露、状态 → 详情 → 修复动作、草稿并发与历史定位，不是它的领域对象数量。
