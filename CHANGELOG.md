# 更新记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.9.145] - 2026-11-03 —— 判定页时间线按天分组（今天 / 昨天 / 具体日期）

### 为什么
20 条事件平铺时，读者分不清哪条是刚才、哪条是两天前 —— 只有「10 分钟前 / 26 小时前」这种相对时间，
越往下越难换算。出图时三条事件的相对时间分别是「5 分钟前 / 10 分钟前 / 26 小时前」，
中间没有任何分隔，读起来像同一批。

### 改法
1. 跨守合并后**按时间倒序**（此前是逐守拼接，顺序其实不是全局的）；
2. 按本地日期插入分组标题：`今天` / `昨天` / `M 月 D 日`；
3. 分组标题 12px caption 色，不抢事件本身的注意力。

### 测试
新增 1 例：跨天数据必须渲染出「今天」与「昨天/日期」两个分组标题。合计 **257 例**。

### 出图
`--only=判定 --dark`：今天（5/10 分钟前）→ 昨天（26 小时前）两段分节，一眼看出新旧。

## [0.9.144] - 2026-11-03 —— 判定页事件行：三行压成两行，时间右对齐

### 为什么
判定页每条事件原来是**三行**：

```
MYCF711/dsh-session-superagent            10 分钟前
仅观察（未唤醒）
#11  README 收尾与发布 · s1
```

扫一眼看不出"发生了什么"，而这里恰恰是客户最常翻的页面（"为什么这轮没叫醒我"）。

### 改法
两行封顶：

```
MYCF711/dsh-session-superagent            10 分钟前
仅观察（未唤醒） · #11
```

- 第一行：仓库（强）+ 时间（`margin-left: auto` 右对齐、`tabular-nums`）；
- 第二行：结果 + `· #编号`；
- 会话名/后缀不再重复（上方列表里已有）。

### 顺带
「追溯一条」的说明原本说了两遍（Section 的 `hint` 一句 + 下面又来一句 Hint），删掉重复那句，
并把两句意思合并成一行。

### 测试
新增 1 例：事件行必须出现 `dt-event-head`（仓库+时间同行）、第二行带 `#12 #13`、行内含 `10 分钟前`。
合计 **256 例**。

### 出图
`--only=判定 --dark`，改前/改后各一张。

## [0.9.143] - 2026-11-03 —— 弹层在窄窗口不再溢出（JS 夹 + CSS 兜底）

### 为什么
弹层宽度是固定 368px，`left` 会夹在窗口内，但**宽度本身没夹** —— 窗口 < 400px 时右侧整块被切掉。
360px 出图确认：卡片右边缘直接跑到画面外。

### 改法（两道）
1. **JS**：`width = Math.min(368, max(240, innerWidth - 16))`；
2. **CSS 兜底**：`.sa-dock-panel { max-width: calc(100vw - 16px); box-sizing: border-box }`
   —— 即使 JS 算错，也不会溢出。

### 测试
新增 1 例：把视口设成 360，断言弹层宽 344（=360-16）、左边距 ≥8、右边不溢出。
为此给测试桩加了 `setViewport(width)`（不再让测试去碰沙箱内部）。

### 证据
```
node --test → 255/255
出图：360px 容器下的弹层，仓库名省略号截断，卡片完整可见
```

## [0.9.142] - 2026-11-03 —— 窄屏扫一遍：设置页单列布局太挤

### 为什么
窄屏（<640px）这条一直攒着没验。新增预览开关 `--mobile`（把预览框压到 600px），
把总览 / 触发 / 设置三个页各出一张图。

### 看到什么
| 页 | 600px 下的表现 | 结论 |
|---|---|---|
| 总览 | 页头、指标条、行内容都能折行，操作按钮自动换行 | 可以 |
| 触发 | 输入框随容器收缩；两个时间选择器仍在一行 | 可以 |
| **设置** | 导航变成横向 chip（好），**但 `dt-kv` 单列后 label 与 value 贴在一起**，五行连读像一段话 | 需要改 |

### 改法
在容器查询里给单列 `dt-kv` 的每个 label 加 `margin-top: 4px`（第一个除外），
`gap` 由 2px 调到 6px —— 每组「标签 / 值」读成一个块。

### 证据
```
出图：总览 / 触发 / 设置 各一张（600px，深色）
node --test → 254/254；preflight 全量 → 36/36；ui-audit → 11/11 = 100
```

### 过程教训（写给下次的我）
往那段巨型 CSS 字符串里插规则时，`
` 必须写成**转义**；我这次写成了真换行，
`node --check` 立刻报 `Invalid or unexpected token`。
**改完立刻 `node --check client.js`** —— 这类错误不该流到测试阶段。

## [0.9.141] - 2026-11-03 —— 给"截图骗人"装上自动门禁

### 为什么
0.9.140 的教训：诊断页看着空，查了半天样式，结果是**预览快照没写 `triageSignals`**。
这种问题肉眼才能发现，而且极易被误判成 UI 缺陷。

### 改法
1. 预览快照补齐 client.js 读的全部 16 个 `body.*` 字段（此前只有 6 个）：
   `serverVersion / runningVersion / installedVersion / routeBase / defaults / retryPolicy /
   sessionUsage / tokenScopes / isolation / error`；
2. 新增 `test/preview-contract.test.mjs` 两条断言：
   - 顶层字段：`client.js 里出现的每一个 body.X` 都必须在快照里有同名键；
   - 嵌套字段：`isolation.roots[].{count,bytes}`、`isolation.totalBytes`、`sessionUsage.{used,cap,capped}`、
     `defaults.*`、`retryPolicy.*` 必须出现。

### 顺手抓到自己的错
我第一版快照写的是 `isolation.roots[].sizeBytes`，而服务端与客户端用的是 **`bytes` / `totalBytes`**，
出图显示「2 个 · **0 B**」。字段名一错，界面就是一行错数据 —— 正是这条门禁要防的东西。
改正后出图：`2 个 · 256.0 KB（合计 256.0 KB）`。

### 证据
```
node --test → 254/254（新增 2 例）
out: 设置（来源）出图，隔离占用 256.0 KB 显示正确
```

## [0.9.140] - 2026-11-03 —— 诊断页出图核对：把客户能读到的「N」换成具体说法

### 现场（出图）
`--only=设置（诊断）` 出图后读到两处**没写完的文案**：

| 位置 | 原文 |
|---|---|
| 优先级字段说明 | `优先级（一次只处理 N 条时先挑谁）` |
| 诊断页提示 | `一次只处理 N 条时，这些信号的加权决定先后。` |

「N」在**唤醒消息模板**里是合法占位（`有 N 条新动态` 本来就是模板），
但在**固定说明文案**里就是没写完 —— 客户会以为漏了个设置。

### 改法
- `优先级（在「单次最多唤醒条数」内先挑谁）`；
- `一次只处理上限条数之内，这些信号的加权决定先后。`

### 顺带：让预览能真的看出问题
诊断页在预览里一直只显示一个标题 + 一行提示 —— 因为**快照里没有 `triageSignals`**。
补上 5 条信号（事实/判断、权重、默认开关）后，出图才看到完整页面：

```
被重新打开  [事实] [默认开]  +100 分
state_reason=reopened
```

### 证据
```
node --test → 252/252；preflight 全量 → 36/36；ui-audit → 11/11 = 100
出图：诊断页（含 5 条分诊信号）
```

### 教训（写进 KB）
**没有数据的截图会骗人。** 页面看着"空"，可能不是样式问题，而是预览快照缺字段 ——
出图前先确认这份数据里页面用到的字段都在。

## [0.9.139] - 2026-11-03 —— 读取失败给卡片+重试、表单不再满屏宽、弹层可键盘进

### 三处（都来自出图核对）
1. **读取失败**：原来是一行红字 `读取失败：Failed to fetch`。现在是卡片：
   「读不到面板数据」+ 人话解释 + **「重试」按钮**（官方错误态不是裸报错，要带动作）。
2. **触发器表单满屏宽**：`间隔(秒)`、`最多唤醒条数` 这种短数字被撑到 900px，
   看着空。`.dt-form > .dt-field > .dt-input { max-width: 480px }`。
3. **弹层键盘不可达**：只有 Escape 关闭，**打开后焦点没有进入弹层**，关闭也没归还。
   现在：打开时 `panel.focus()`（面板带 `tabIndex=-1`），关闭时焦点还给圆环按钮
   —— 与官方 Modal 的 Escape + 焦点陷阱 + 焦点归还保持一致。

### 证据
```
node --test → 252/252（新增：弹层 tabIndex=-1 + aria-label）
preflight 全量 → 36/36；ui-audit → 11/11 = 100
出图：读取失败卡片（深色）、触发页 480px 输入框
```

### 攒批（真机才能证明）
- 焦点归还的真实 Tab 走查（预览没有真实 focus 生命周期）；
- `input[type=time]` 的键盘调时（方向键）；
- 窄屏下两个时间选择器是否换行错位。

## [0.9.138] - 2026-11-03 —— 活跃时段改成两个时间选择器（起 / 止），不用再手打

### 为什么
你提的：「起始时间和终止时间让 user 自己选」。此前是**一个文本框**，placeholder 写着
`09:00-23:00，留空 = 全天` —— 客户得自己记住格式、冒号、连字符，打错就是"永远不唤醒"，
而且没有任何校验会告诉他打错了。

### 学到的（出处）
MDN 对 `<input type="time">` 的说明：

> The value is always a 24-hour `HH:mm` (or `HH:mm:ss`) formatted time, **with leading zeros**,
> regardless of the UI's input format.

<https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/time>

也就是说：**浏览器替我们保证格式**，我们只需要拼成 `HH:mm-HH:mm`。

### 改法
新增 `HoursField`（新增表单与编辑表单共用）：
- 两个原生 `<input type="time">`（`aria-label` 分别是「起始时间」「结束时间」）；
- 中止 <= 起始 时显示「跨夜窗口」（22:00-06:00 这种是合法的）；
- 有值时给「全天」按钮（一键清空 = 全天）；空值时显示「留空 = 全天」；
- 回写仍是 `HH:mm-HH:mm`，服务端解析器不用改。

### 测试
新增 1 例：触发页必须渲染出两个 `type=time` 的输入，且带「起始/结束」无障碍名。合计 **251 例**。

### 门禁又抓到一次
我把 `.dt-hours` 等样式写进了 `DOCK_CSS`，`client.js 用到的 dt-* 类名必须在移植来的 CSS 里存在`
当场报红（4 个类名缺失）—— 挪进 `PORTED_CSS` 才过。**移植的设计系统只有一份，别另开一套。**

## [0.9.137] - 2026-11-03 —— 量出来一个真 bug：带图标的分节标题比正常高 4 倍

### 怎么发现的
看图觉得「判定日志」上方空了一大截，但 DOM 是干净的。于是给预览工装加了 `--measure`：
在无头浏览器里量 `getBoundingClientRect`，把结果写进 DOM 再 `--dump-dom` 读回来。

```
dt-section-title@405h89 | dt-section@502h78 | dt-timeline@588h185      ← 修前：标题行 89px
dt-section-name@405h22 | dt-count@405h22 | dt-subhead-actions@405h16   ← 修后：标题行 22px
```

**89px 对一行 22px 的文字**，4 倍。根因：`.dt-section-title` 用 `align-items: baseline`，
而「ⓘ」按钮是**没有文字的内联 flex 盒** —— 它的基线落在盒子底部，把整行撑高了。
所有带 `action` 的 `Section`（判定日志、需要关注…）都被撑高。

### 改法
`.dt-section-title` 的 `align-items: baseline` → **`center`**（标题与计数、图标垂直居中）。

### 顺带（设置页 + 工装）
- 设置页正文改成**卡片**（`bg-layer-1` + 边框 + 圆角 16 + padding 16），左侧导航 14 → **13px**，
  正文小节标题 → **15px** —— 此前导航与正文标题同字号，读起来像「来源 来源」重复。
- 预览工装新增：`--measure`（量元素位置/尺寸）、`--outline`（给每块画虚线）；
  **并修好一个让截图不可信的 bug**：`aria-current` 不在属性白名单里，导致设置页导航
  「没有选中态」——那是预览的假象，不是产品缺陷（真机一直是对的）。

### 证据
```
node --test → 250/250；ui-audit → 11/11 = 100；audit-preview → PASS 20 块（含弹层）
出图：设置页 / 判定页 改动前后各一张；标题行高度 89px → 22px（量出来的）
```

## [0.9.136] - 2026-11-03 —— 总览页对齐官方：页头分栏、指标上提、块间节奏

### 为什么
用 `--only=总览 --dark` 出图后逐条核对，看到四个真问题（都在图里）：

| 图里看到 | 根因 |
|---|---|
| 搜索框和「术语/刷新/全部暂停/全部恢复」贴在标题下面左侧 | `.dt-page-head` 是 `column`，工具栏没地方右对齐 |
| 四个计数挤在「需要关注」后面，像一句尾巴 | 渲染顺序：filtered → problems → stats |
| 各块之间几乎没有间距，读起来是一整墙 | `.dt-page` 是 block，子块之间**没有 margin/gap** |
| 「最近被过滤 / 需要关注 / 主理鱼」标题和正文同色同重，层级不清 | `.dt-section-title` 用的是 secondary + 13px |

### 改法
1. `.dt-page-head` 改成 `row + space-between`，标题块仍竖排，工具栏 `margin-left: auto` 右对齐；
2. 指标条移到总览最前，并做成卡片（`bg-module-platform` + 边框 + 圆角 12 + padding 10/14）；
3. `.dt-page > * + * { margin-top: 16px }` —— 给页面子块统一节奏；
4. 分节标题 13px/secondary → **14px/label-primary**；
5. 「需要关注」每条加左侧 2px 竖线（`opacity .45`）与 8px 行距，读起来才像列表。

### 证据（同一台机器、同一渲染器）
- 出图：`--only=总览 --dark`，改前/改后各一张；
- `node --test` → 250/250；`ui-audit` → 11/11 = 100。

### 顺带修的预览工装
- `--only=<场景>` 只渲染单个场景（此前过滤没生效：`sectionsForTheme` 用的是未过滤数组）；
- `--dark` 对面板也生效；
- `--only` 时不再插入弹层，截图不用滚动。

### 下一轮（已记进 KB「还没做的」）
设置页：左侧导航与右栏「来源/凭证/…」标签重名、导航没有选中态、标签列过宽把值挤到中间。

## [0.9.135] - 2026-11-03 —— 弹层真的看一眼：无头浏览器截图核对（浅色/深色）

### 为什么
上一版把弹层重写了，但**没有任何人（包括我）真的看过它长什么样** —— 只有单测断言 DOM 结构。
"看着糙"这类问题，断言抓不到。

### 做法（新能力，可复用）
`render-preview.mjs` 新增 `--popover` / `--dark`：
```bash
node scripts/render-preview.mjs --popover --dark shot-dark.html
msedge --headless=new --screenshot=shot-dark.png --window-size=520,560 file:///…/shot-dark.html
```
用真实 `client.js` 渲染出的 DOM + 移植的官方 token，在无头 Edge 里出图，再由我肉眼核对。

### 看图后改的三处
| 发现 | 改法 |
|---|---|
| 仓库名被截成 `MYCF711/dsh-g…`（344px 太窄） | 弹层宽 **344 → 368**，仓库名完整显示 |
| 同一仓库两条守分不清（会话后缀在标题行挤掉仓库名） | 会话后缀挪到副行：`#c0a5847a · 每 120s · 83 秒前` |
| 比例条里为 0 的类别仍画 1px 细丝（像脏点） | 为 0 的类别不画段（用 `flexGrow: n` 且过滤 0） |

### 顺带
- `audit-preview.mjs` 增加断言：**预览里必须出现弹层**，否则"离线验收面"缺一块；
- 预览里把圆环 svg 固定 20px（此前渲染成一大块灰，容易误判）。

### 顺带修好的门禁缺陷
"双主题预览"这条检查的注入验证用的是 `original.replace('浅色主题', …)` —— **只替换第一处**。
弹层场景里也有"浅色主题"字样，结果替换到别处去了，注入没真正生效，`门禁自检` 报红。
改成全量替换（`split/join`）后 `PASS 21/21 项注入都被检测到`。

### 证据
```
无头 Edge 截图两张：浅色 / 深色，弹层 368px 宽，三行 + 比例条 + 页脚分隔线齐全
node --test → 250/250（新增 2 例：宽度、比例条段数）
audit-preview → PASS 20 块（含弹层）
```

## [0.9.134] - 2026-11-03 —— 卫星环弹层重做：从"一坨文字"到官方那种摘要卡

### 现场（用户截图）
点开状态栏卫星环后，弹层是这样一个东西：
- 每条守最多 **5 行**说明（goal / 会话 / 每 120s · 轮询 · 唤醒 / 时段 · 隔离 · workdir · 304 / 错误）；
- 按钮「立刻 暂停 删除」和正文抢同一行；
- **弹层没有实心底色**（`.dt-card` 只定义了边框），叠在聊天内容上直接透字 —— 截图里文字互相压着；
- `.dt-card` 自带 `gap: 12px` 也没有被覆盖，块间被撑得更散。

### 学到什么（出处）
NN/g《Progressive Disclosure》：

> Progressive disclosure defers advanced or rarely used features to a secondary screen,
> making applications easier to learn and less error-prone.

<https://www.nngroup.com/articles/progressive-disclosure/>

弹层是**摘要屏**，不是详情屏 —— 细节该去「主理鱼」标签页。

### 改法（对齐官方 Token 用量 / 上下文弹层的语言）
1. **实心卡片**：`background: var(--dsw-alias-bg-layer-2)` + `box-shadow: prominent` + 圆角 16，`gap: 0`；
2. **头部**：标题「主理鱼」+ 右对齐等宽指标 `1 / 2 主理中`；
3. **比例条**：4px 细条，按 运行中 / 其他 / 异常 比例分段（官方「上下文已用」同款表达）；
4. **每行只有两行字**：`● repo  c0a5847a  [主理中]` + 副行 `每 120s · 83 秒前 · 时段 09:00-23:00`；
   错误时多一行红色单行（省略号截断）；
5. **动作收进悬停**：`立刻 / 暂停 / 删除` 只在 hover 或 focus 时出现（触屏设备常显），不再抢占信息区；
6. **其余细节进 title**：goal、过滤、退避、隔离、上次唤醒等放进 `title`，悬停可读，行内不再堆。

### 测试
5 个弹层用例按新信息架构改写（信息没丢：goal / 过滤 / 退避 / 隔离 / 历史都断言在 `title` 里）。合计 **249 例**。

## [0.9.133] - 2026-11-03 —— 系统错误码各归其类；没见过的措辞自动留样本

### 学到什么（出处）
Node 的系统错误表把每个码的含义写得很具体（本轮用 `gh api` 直接取到 `doc/api/errors.md`）：

> `EACCES` (Permission denied): An attempt was made to access a file in a way forbidden by its file access permissions.
> `EPIPE` (Broken pipe): A write on a pipe, socket, or FIFO for which there is no process to read the data.

<https://nodejs.org/api/errors.html#common-system-errors>

### 现场
这四类原本全落 `other`（"没归类的错误：已按退避自动重试"）：

| 文本 | 改前 | 改后 |
|---|---|---|
| `spawn gh EACCES` | other | `permfile`（检查安装权限或重装） |
| `spawn gh EPERM` | other | `permfile` |
| `EPIPE: broken pipe` | other | `network`（连接被中断，不需要手动处理） |
| `ETIMEDOUT connect` | other | `network` |

### 还有一个更根本的问题
分类器只认**我们见过的措辞**。没见过的如果只显示"没归类的错误"，下次还是收集不到 —— 死循环。
所以新增 `recordOtherError()`：`other` 时把原始措辞（≤120 字）记进事件流，最多保留到事件上限。

### 测试
新增 2 例：系统错误码分类；`other` 留样本（空内容不记、事件流不无限增长）。合计 **249 例**。

## [0.9.132] - 2026-11-03 —— 代理塞回一个网页时，说清"是网页不是 JSON"

### 真机复验（重启后）
```
serverVersion: 0.9.131
- MYCF711/dsh-go | 启用 | fails 1 | lastError: （返回内容不是合法 JSON：可能是代理干扰）
- MYCF711/dsh-go | 已暂停 | fails 0 | lastError: 无        ← 0.9.130 的归一在真机上生效了
```

紧跟着手动跑一次 `gh api --include ...`：`HTTP/2.0 200 OK` + body `[]`（2 字节）—— 说明网络此刻是通的，
那条错误是代理 502 期间留下的。

### 学到什么 / 改了什么
1. **坏 body 也要分类**：新增 `diagnoseBadBody()` —— 有内容但不是 JSON 时，
   若像 HTML/网关页（`<!DOCTYPE`、`<body`、`Bad Gateway`…）→ 归 `gateway`，
   提示「**返回的是网页而不是 JSON：本地代理/网关拦了请求 —— 检查代理设置**」；
2. **限流要等够一分钟**：GitHub 对 secondary/abuse 限流要求至少等 1 分钟，
   服务端没给 `Retry-After` 时现在我们兜底 60 秒（此前会立刻重试）；
3. 顺带修一个**自己刚写出的 bug**：先算了 `wait` 才定义 `classified`，
   会在每次失败时抛 `ReferenceError` —— 已把分类提到最前（注释里记了这次顺序错误）；
4. `deferReason` 直接用分类名（此前 auth 也会被写成 `notfound`）。

### 测试
新增 1 例（HTML 坏 body → gateway；合法 JSON 不报；空内容仍先判凭证）。合计 **247 例**。

## [0.9.131] - 2026-11-03 —— 403 被我们一律当成"限流"，其实一半是权限问题

### 学到什么（出处）
GitHub 排障文档里 403 有两种截然不同的含义，其中一个专节叫 **"Resource not accessible"**：
- 限流 → 等着就行；
- **权限不足 / 集成无权访问** → 要改 token 作用域或仓库权限。

<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible>

### 现场
我们的分类器只有一条：

```js
if (/HTTP 403|rate limit|API rate limit exceeded/i.test(text)) return { kind: 'ratelimit', … }
```

于是 `HTTP 403: Resource not accessible by integration` 会显示「被 GitHub 限流：等几分钟」——
客户会一直等，而真正要做的是去加权限。**又是"等一等"与"动手修"的混淆。**

### 改法
1. 先判限流关键词（`rate limit` / `secondary rate limit` / `abuse detection`）；
2. 其余 403 归新分类 `permission`：`（权限不足：检查 token 作用域或这个仓库的访问权限）`；
3. 面板给 `permission` 配按钮「去填 token」（指向设置页）。

### 测试
新增 1 例：403 限流 / `Resource not accessible` / `Must have admin rights` 三种文本各归其类。
合计 **246 例**。

### 说明
`gh api` 本轮可用过一阵（成功取到文档大小与 base64 片段），随后再次不可达；
上面的判据来自本会话早前成功抓取的同一份文档。

## [0.9.130] - 2026-11-03 —— 重启后真机复验：新代码生效了，但"暂停的守还挂着旧错误"

### 真机复验（重启后）
```
GET /state → serverVersion 0.9.129
defaults: { sessionMaxWakes: 12, maxWakesPerHour: 6, isolateKeepDays: 3 }
retryPolicy: { budgetAttempts: 6, slowCapMinutes: 120 }
```
说明 0.9.12x 的新字段与短路逻辑都已上线。`gh auth status` 也已恢复正常（`✓ Logged in`），
`gh api repos/MYCF711/dsh-go` 返回正常。

启用的那条守在 07:02:50Z 完成了一轮成功轮询：`lastError` 已清空、`nextAt` 归 null。

**但另一条（已暂停，来自更早的会话）仍然挂着**：
`lastError: 返回内容不是合法 JSON（可能是代理干扰）` + `consecutiveFailures: 1`。

### 根因
0.9.111 只在**暂停动作发生时**清错误。这条守是在那之前就暂停的，所以旧错误一直冻在状态文件里 ——
面板上永远显示「异常」，而它其实只是"停着"。

### 改法
`normalizePaused()`：`readState()` 读出来时，对 `enabled === false` 的条目清掉
`lastError` / `lastErrorAt` / `consecutiveFailures` / `needsReauth`（幂等、无副作用，下次写盘自然带走）。

### 测试
新增 1 例：手写一份"老版本留下的（暂停 + 旧错误）"状态，读出来后错误为空。合计 **245 例**。

## [0.9.129] - 2026-11-03 —— Windows 上找不到 gh 会说"不是命令"，我们原来不认

### 学到什么（出处）
Node 的错误页把系统级错误码（`ENOENT`、`EACCES`…）列成一张表，指出**同一个失败在不同平台上措辞不同**：

> Common system errors … `ENOENT` (No such file or directory) …

<https://nodejs.org/api/errors.html#common-system-errors>

我们的 `classifyGhError` 只认 `ENOENT` / `gh: command not found`，**不认 Windows cmd 的措辞**：

```
spawn gh ENOENT                                        → nogh ✅
gh: command not found                                  → nogh ✅
'gh' is not recognized as an internal or external ...  → other ❌（提示"没归类的错误"）
```

也就是说：Windows 客户没装 gh 时，看到的是"没归类的错误"，而不是"找不到 gh：确认已安装且在 PATH"。

### 改法
1. `classifyGhError` 认全三种措辞（补 `not recognized as an internal or external command`）；
2. 顺手把 `watch_doctor` 里写死的「最多每 **2 小时**一次」改成从 `RETRY_SLOW_CAP_MINUTES` 算 ——
   上一轮立的规矩（数字要能指回来源）还没覆盖到 `lib/` 自己的中文提示。

### 测试
- 新增 1 例：三种措辞都归 `nogh` 且提示指向 PATH；
- 更新 1 例：doctor 的"X 小时"改为按常量断言（常量改了用例自动跟随）。
合计 **244 例**。

## [0.9.128] - 2026-11-03 —— 面板上写死的四个数字，各自绑到真实来源

### 学到什么（出处）
这一轮没有可用的新外部来源（`en.wikipedia.org`/`raw.githubusercontent.com` 仍超时或 502），
所以直接把上两轮提炼的判据**做成守卫**：*要么同源，要么同测*
（见 KB `policy-numbers-have-one-home.md`、`defaults-are-data-not-copy.md`）。

### 现场（扫描 `client.js` 里含数字的中文文案，共 14 条）
真正有"漂移风险"的是这 4 个，其余都是示例值（`如 42`、`09:00-23:00`）或 HTTP 码（401/404/5xx）：

| 面板文案 | 真实来源 |
|---|---|
| `最小 30 秒` | `Math.max(30, Math.min(3600, …))`（watch_start 的夹紧） |
| `判定日志（最近 5 次唤醒）` | `/state` 里 `filteredLog.slice(-5)` |
| `时间线（最近 20 条）` | `pushHistory(history, record, max = 20)` |
| `连续 2 次就会在「需要关注」里提示` | 面板判断 `silentWakes >= 2` |

### 改法
新增 `test/panel-numbers.test.mjs`：从 `client.js` 抽出这四处数字，和 `lib/` 里的真实阈值逐条比对。

### 验证它会红
把面板文案改成「最小 **15** 秒」→ `pass 3 / fail 1`；还原后 `4/4` 通过。

### 测试
新增 4 例，合计 **243 例**。

## [0.9.127] - 2026-11-03 —— 面板里的「默认值提示」改成从 `/state` 读

### 学到什么（出处）
JSON Schema 对 `default` 的定义正好是这个用法：

> The `default` keyword specifies a default value. … **Non-validation tools such as documentation generators
> or form generators may use this value to give hints to users about how to use a value.**

<https://json-schema.org/understanding-json-schema/reference/annotations>

也就是说：**默认值应当在数据里声明一次，由表单/文档去渲染，而不是两边各写一遍。**

### 现场（本轮扫描）
`client.js` 里写死的默认值有 3 处：
- 会话上限占位符 `12（1-60）`；
- 隔离保留天数占位符 `3（1-30）` 与提示"留空用默认 3 天"；
- 术语表里「单条守每小时最多 **6** 次、整条会话 **12** 次」。

而真实默认值在 `lib/index.js`（`DEFAULT_SESSION_WAKES = 12`、`?? 6`、`?? 3`）。
改任一个，面板就开始说谎 —— 这正是 0.9.123 修过的那类问题，只是换了个位置。

### 改法
1. `lib/index.js` 抽出 `DEFAULT_WAKES_PER_HOUR = 6` / `DEFAULT_ISOLATE_KEEP_DAYS = 3`，并让读状态处复用它们；
2. `/state` 顶层新增 `defaults: { sessionMaxWakes, maxWakesPerHour, isolateKeepDays }`；
3. 面板三处提示改成读 `body.defaults`，缺省时才回落到 12/6/3。

### 测试
- 新增 1 例（服务端）：`/state.defaults` 精确等于 `{ 12, 6, 3 }`；
- 新增 1 例（面板）：defaults 缺省时也不能渲染出 `undefined`。
合计 **238 例**。

## [0.9.126] - 2026-11-03 —— 断路器下沉到 `run()`：一处生效，所有调用点都覆盖

### 为什么
0.9.125 只给 `github` / `repo_here` 两个工具加了短路。但**真正会发请求的地方有七八处**
（轮询、`watch_ack` 打标签、仓库体检、评论查询…），漏掉任何一处，"明知凭证坏了还去调"就还在。

上一轮刚立下的规矩（`policy-numbers-have-one-home.md`）同样适用：**政策只该有一处**。

### 改法
把断路器移进 `run()` —— 所有 `gh` 调用的唯一出口：

```js
if (file === 'gh' && !argv.includes('--version') && argv[1] !== 'auth') {
  if (isAuthBroken(authStatusCache.text) && fresh) {
    resolve({ code: 1, stdout: '', stderr: '凭证已失效，本次没有发起请求：跑 gh auth login 重新登录后再试' })
  }
}
```

- `gh auth status` 与 `--version` **豁免**（否则无法自检、也永远解不开）；
- 顺序放在**离线模式之前**，让"凭证坏了"的语义在测试里也一致；
- 工具层那两处重复短路随之删除，死常量 `AUTH_BROKEN_REPLY` 一并清掉。

### 测试
新增 1 例：凭证失效时 `watch_ack`（要打标签的内部调用）也走短路。合计 **236 例**。

## [0.9.125] - 2026-11-03 —— 凭证坏了就别再发请求：断路器式短路

### 学到什么（出处）
Martin Fowler《CircuitBreaker》：

> Once the failures reach a certain threshold, the circuit breaker trips, and **all further calls to the
> circuit breaker return with an error, without the protected call being made at all.**

<https://martinfowler.com/bliki/CircuitBreaker.html>

我们上一版（0.9.124）已经把"凭证失效"识别出来了，但**只有轮询路径**用它：
`github` 工具和 `repo_here` 仍然会照常 spawn `gh`，拿到空内容再走一遍诊断 —— 这就是"明知会失败还去调"。

### 改法
1. 抽出 `isAuthBroken()`（`diagnoseEmptyBody` 复用它，避免两处正则各写一份）；
2. `gh auth status` 的结论缓存 60 秒，`github` / `repo_here` 在**已知凭证失效**时直接返回：
   `[error: 凭证已失效，本次没有发起请求] 跑 gh auth login 重新登录后再试`
3. 缓存为空/过期时照常调用。

### 真机背景（本轮实测）
```
- MYCF711/dsh-go | fails 4 | nextAt 2026-11-03T02:40:27.997Z
  lastError: gh: HTTP 502（GitHub 或本地代理短暂故障）
```
外部网络此刻也不健康（502），所以"不发起这次调用"对客户更友好：少一次必然失败的进程。

### 测试
新增 1 例：缓存里是失效结论 → 两个工具短路且提示修复动作；清空缓存 → 恢复调用。合计 **235 例**。

## [0.9.124] - 2026-11-03 —— 真机实测：令牌失效时我们却在怪代理

### 现场（09:00 时段开门后的真实轮询）
```
serverVersion: 0.9.116
- MYCF711/dsh-go | 启用 | 失败 5 | nextAt 2026-11-03T01:30:27.698Z
  lastError: 返回内容不是合法 JSON（可能是代理干扰）—— 已按退避自动重试
```

时段一到它确实开始轮询了（`nextAt` 排到 09:30），但**失败原因写错了**：
真实原因是 `gh` 令牌失效 → 输出为空 → `JSON.parse('')` 抛错，于是我们甩锅给"代理"。
客户会去查一个根本不存在的代理，而真正要做的是 `gh auth login`。

### 学到什么（出处）
GitHub 排障文档在"结果不对"时要求先确认凭证：

> If you are using pagination correctly and still do not see all of the results that you expect,
> you should **confirm that the authentication credentials** that you used have access…

<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#missing-results>

### 改法
1. 新增纯函数 `diagnoseEmptyBody({ bodyText, authStatusText })`：
   - 空内容 + 凭证失效 → `auth`（提示 `gh auth login`）；
   - 空内容 + 凭证正常 → `empty`（提示可能是代理/未登录，去看 `watch_doctor`）；
2. 解析失败时先跑一次 `gh auth status`（60 秒缓存，只在失败路径）；
3. 判为 `auth` 时置 `needsReauth = true` 并走 30 分钟退避。

### 测试
新增 1 例（空 + 凭证失效 → auth；空 + 凭证正常 → empty；有内容 → 不诊断）。合计 **234 例**。

## [0.9.123] - 2026-11-03 —— 「已放慢到 2 小时档」不该是写死的文案

### 学到什么（出处）
Kubernetes Job 的做法：重试策略写在 `spec`（`backoffLimit`、退避上限），**状态由控制器按它算出来再写进 `status`**：

> The `.spec.backoffLimit` is set by default to 6 … The number of retries is calculated in two ways …

<https://kubernetes.io/docs/concepts/workloads/controllers/job/>

政策只有一处定义，派生的数字另算 —— 而不是在 UI 里再抄一份。

### 现场
0.9.122 的面板写着「已放慢到 **2 小时**档」，而这个 2 小时是 `nextDelayMs` 里的字面量。
一旦有人把上限改成 90 分钟（或把预算从 6 改掉），**这句话立刻变成谎话，而且没有任何门禁会红**。

### 改法
1. `lib/watch.js` 导出 `RETRY_SLOW_CAP_MINUTES = 120`，`nextDelayMs` 用它算上限；
2. `/state` 顶层新增 `retryPolicy: { budgetAttempts, slowCapMinutes }`（一次请求，逐守可用）；
3. 面板的档位文案由这三个数字算出来（≥60 分钟显示小时，否则显示分钟）。

### 测试
新增 1 例：默认 → 「2 小时档」；改成 90 分钟 → 「1.5 小时档」；预算调到 20 → 8 次失败**不该**说"已放慢"。
合计 **233 例**。

## [0.9.122] - 2026-11-03 —— 面板上写出「第几次失败 + 下次什么时候重试」

### 学到什么（出处）
Kubernetes Job 的重试策略把这些数字**暴露在 status 里**给人和工具看：

> The `.spec.backoffLimit` is set by default to **6**. Failed Pods … are recreated by the Job controller with
> an **exponential back-off delay (10s, 20s, 40s …) capped at ten minutes**.

<https://kubernetes.io/docs/concepts/workloads/controllers/job/>

两个要点：① 默认重试上限就是 **6**（和 0.9.121 的 `RETRY_BUDGET_ATTEMPTS` 一致，属于巧合但方向对）；
② **重试进度是可读的状态**，不是藏在日志里的行为。

### 改法
面板每条守在有失败时多一行：
```
已连续失败 7 次 · 下次重试约 90 分钟后（已放慢到 2 小时档）
```
数据全部来自 `/state` 已有的 `consecutiveFailures` / `nextAt`，没有新增字段、没有额外请求。

### 为什么要写
0.9.121 让失败后的间隔放慢到 2 小时，**如果面板不写出来，客户只会看到"它不动了"** ——
把"我们主动放慢"误读成"它坏了"。

### 测试
新增 1 例：失败 7 次 + 90 分钟后重试 → 面板出现次数、时间、以及「2 小时档」。合计 **232 例**。

## [0.9.121] - 2026-11-03 —— 重试要花预算：连续失败 6 次后放慢到 2 小时一次

### 学到什么（出处）
Google SRE《Handling Overload》：

> We implement a **per-request retry budget of up to three attempts**. If a request has already failed
> three times, we let the failure bubble up to the caller. … Secondly, we implement a **per-client retry budget**.

<https://sre.google/sre-book/handling-overload/>

核心是：**重试要花预算，花完就该慢下来**，而不是无限次地按固定节奏重来。

### 我们原来的问题
`nextDelayMs` 是指数退避，但**封顶 30 分钟之后就一直是 30 分钟** —— 一条凭证失效的守会以
每 30 分钟一次的频率重试**几天**（真机就在这个状态：失败 4 次）。

### 改法
引入 `RETRY_BUDGET_ATTEMPTS = 6`：
| 连续失败 | 等待 |
|---|---|
| 1 | 2 分钟 |
| 3 | 8 分钟 |
| 5 | 30 分钟（预算内上限） |
| **6 起** | **最多 2 小时一次**（预算外上限） |

`watch_doctor` 同时补一行解释：`已连续失败 8 次，重试间隔已放慢到最多每 2 小时一次` ——
否则客户看到"很久没动"会以为定时器坏了（这正好和 0.9.96 的"重启 vs 定时器丢了"是同一类误会）。

### 测试
新增 1 例（doctor 解释）；更新 1 例（退避取值，含 30s/60s 两种基准下的上限）。合计 **231 例**。

## [0.9.120] - 2026-11-03 —— 合并唤醒消息：同一份「接下来」只印一次

### 学到什么（出处）
Google SRE 书《Monitoring Distributed Systems》讲告警的核心原则：

> **Every page should be actionable.** … Every time the pager goes off, I should be able to react
> with a sense of urgency.

<https://sre.google/sre-book/monitoring-distributed-systems/>

但 **actionable ≠ 把同一份指令印 N 遍** —— 合并唤醒（多条一起叫）原来每条都带一份
「接下来：1/2/3」，三条就是同一段指令重复三次，读者只会更快跳过它。

### 改法
`mergeWakeTexts()` 把每条消息里 `接下来：` 之后的收尾剥掉，最后**统一附一份**，
每条自己的【完成标准】仍各自保留（内容不同，不能合并）。

### 证据（3 条合并，实测）
| | 长度 |
|---|---|
| 改前 | 309 字符（「接下来」出现 **3** 次） |
| 改后 | 259 字符（出现 **1** 次，净省 50） |

省下的不是大头（分隔行会补回来一点），关键是**读起来的噪音**：一份指令只出现一次。

### 测试
新增 1 例：3 条合并后「接下来」恰好 1 次、每条完成标准都在、净省长度 > 30。合计 **229 例**。

### 说明
`raw.githubusercontent.com` 与 `api.github.com` 本轮仍 502，所以学习源换成了 `sre.google`（可访问）。

## [0.9.119] - 2026-11-03 —— 凭证失效要单独报，并说清"不会自己恢复"

### 真机现场
```
$ gh auth status
X Failed to log in to github.com account MYCF711 (keyring)
  - The token in keyring is invalid.
```
插件这边只会显示一条普通的失败（`gh 登录失效：跑 gh auth login`），混在网络抖动里，
客户很容易以为"等会儿就好"。而 **401 永远不会自己好**。

### 改法
1. `permanentBackoffMs` 把 `auth` 也纳入 30 分钟退避 —— 每 60 秒重试一次无意义，反复 401 还可能被风控；
2. 失败时置 `needsReauth = true`，任何一次成功（含 304/204）都清掉；
3. `/state` 暴露 `needsReauth`；
4. `watch_doctor` 单列一行：
   `FAIL 凭证失效（N 条守）：跑 gh auth login 重新登录，在此之前这些守只会一直失败 —— 它不会自己恢复`
5. 面板顶部给红色横幅（不只是那行小字错误）。

### 测试
新增 3 例：`auth` 的 30 分钟退避、doctor 的"不会自己恢复"提示、面板横幅。合计 **228 例**。

### 说明
GitHub 文档本轮不可达（`raw.githubusercontent.com` 与 `api.github.com` 均 502），
所以这条只依据本机 `gh auth status` 的实测输出，未复核文档原文。

## [0.9.118] - 2026-11-03 —— 单测从 101 秒降到 1.6 秒：它们一直在等一个不可能的 gh 响应

### 现场
真机重启后跑 `node --test`，**101 秒**才结束（之前 9 秒）。逐文件计时立刻定位：

```
103571 ms  test/routes.test.mjs
 42290 ms  test/contract-stability.test.mjs
```

根因不是用例写错，而是**环境**：`gh auth status` 显示

```
X Failed to log in to github.com account MYCF711 (keyring)
  - The token in keyring is invalid.
```

于是每个调用 `gh api` 的用例都要等到超时（`watch_start` 的仓库体检、`watch_ack` 打标签）。

### 改法
加一个**离线模式** `DSH_SUPERAGENT_OFFLINE=1`：`run()` 遇到 `gh` 直接返回固定内容，不 spawn。
`preflight` 在跑子进程时开启它（生产不会设这个变量）。

### 证据
```
改前：node --test → 101.4 秒
改后：DSH_SUPERAGENT_OFFLINE=1 node --test → 1.65 秒（225/225 通过）
```

### 顺带
README「已知限制」补一条：凭证失效时的表现与"不会自己恢复、需要重新登录"。

## [0.9.117] - 2026-11-03 —— 真机重启后发现：时段外那条「异常」永远不会自己好

### 现场（重启后实测）
```
插件版本: 0.9.116
值守: 1 条 | 启用 | 间隔 120s | 失败 4 | 错误: gh: HTTP 304（没归类的错误…）
上次轮询: 2026-11-02T14:30:50.655Z（5.4 小时前）
lastDeferred: 不在活跃时段（09:00-23:00），597 分钟后开始
nextAt: 2026-11-03T01:00:00.114Z（= 本地 09:00）
```

问题很清楚：这条守的活跃时段是 **09:00–23:00**，此刻 03:53 —— **不在时段内，不会轮询**，
所以那条旧错误（`gh: HTTP 304`）就永远挂着，面板上的红点和「异常」计数也一直在。
而它其实**不是"现在"的事实**：这 5 小时里根本没有请求发生过。

### 改法
抽出 `enterActiveHoursDefer()`，时段外进入等待时顺手清掉瞬时状态：
`lastError` / `lastErrorAt` / `consecutiveFailures` 归零（`nextAt` / `lastDeferred` 照常写）。

### 为什么不是"面板上忽略它"
因为 `watch_doctor`、`watch_status`、`/state` 三个出口都会读 `lastError`。
**在数据源头清掉，比在每个出口各写一遍"如果是时段外就别显示"可靠得多。**

### 测试
新增 1 例：进入时段外等待后，错误与失败计数都归零、`nextAt` 指向未来、`lastDeferred` 写明多久后开始。
合计 **224 例**。

## [0.9.116] - 2026-11-03 —— 404 不等于"不存在"；顺便修掉一个"凌晨才红"的用例

### 学到什么（出处）
GitHub《Troubleshooting the REST API》：
> If you make a request to access a private resource and your request isn't properly authenticated,
> you will receive a `404 Not Found` response. GitHub uses `404` instead of `403` **to avoid confirming
> the existence of private repositories.**

出处：<https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#404-not-found-for-an-existing-resource>

也就是说：**404 既可能是"不存在"，也可能是"没权限"**，而且这两种情况的修复动作完全不同。

### 改了什么
1. `notfound` 的提示改写为：`（不存在或没权限 —— 私有仓库无权限也回 404：查 owner/name 与 token）`（47 字符，未超门禁 60）；
2. `repo_here` 工具失败时也走 `formatGhCall()`（与 `github` 工具一致，0.9.115 漏了它）。

### 顺带抓到一个"凌晨才红"的用例
`顶部四个计数必须加得上总数` 里把时段写死成 `03:00-04:00`：
- 白天跑 → 该守在窗口外，计数里出现「时段外」，用例绿；
- **凌晨 3 点跑 → 该守就在窗口内**，`时段外` 这一项消失，`value('时段外')` 得到 `NaN`，用例红。

改成 `outsideWindow()`：从当前小时 +6 开始、长度 1 小时，任何时刻都在窗口外。

### 证据
```
node --test → 223/223（此前凌晨跑会 221/223）
```

## [0.9.115] - 2026-11-03 —— `github` 工具失败时也带「下一步」和机器可读的 kind

### 为什么
上一版只修了**轮询**路径（x-poll-interval / 永久错误长退避）。而 `github` 工具（任意 REST 调用）
失败时仍然只贴原始 stderr 加一行 `[exit code: 1]`：

```
gh: HTTP 404 Not Found
[exit code: 1]
```

调用它的 agent 得自己猜"是仓库名错了、还是没权限、还是登录失效"。GitHub 官方最佳实践明确要求
「do not ignore repeated 4xx/5xx」—— 失败必须带着可执行动作回到调用方。

### 改法
抽出 `formatGhCall()`（`lib/gh-format.js`），`github` 工具与轮询共用同一套分类：

| 情况 | 现在返回 |
|---|---|
| 404 | `…（仓库不存在或没权限：检查 owner/name）` + `[kind: notfound]` |
| 401 | `…（gh 登录失效：跑 gh auth login…）` + `[kind: auth]` |
| 304 | `…（没有变化 —— 条件请求命中 304，这不是错误）` + `[kind: notmodified]` |
| 成功 | 只加 `[exit code: 0]`（不带 kind，保持轻量） |

### 测试
新增 1 例：四种情况的返回形状（含「成功时不带 kind」）。合计 **223 例**。

## [0.9.114] - 2026-11-03 —— 按 GitHub 官方最佳实践补两条：x-poll-interval、永久错误等更久

### 学到什么（出处）
GitHub《Best practices for using the REST API》明确两条我们没做：

1. **`x-poll-interval`**：「If a response includes an `x-poll-interval` header, wait at least that many seconds
   before you poll the same endpoint again.」
2. **重复 404**：「Once you have confirmed that your credentials are correct, **wait much longer** before you check
   again… Repeatedly requesting a missing resource wastes your rate limit and can trigger a secondary rate limit.」

出处：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

### 改了什么
1. `parseGhInclude` 解析 `x-poll-interval`（修了一个坑：`Number(null) === 0` 会让"没有这个头"被当成 0）；
2. 轮询取 `max(配置间隔, x-poll-interval)` 作为下限 —— **成功路径也生效**
   （此前 `nextAt` 只在失败退避时设置，成功后清空，间隔下限等于没用）；
3. 永久性错误（`notfound` / `moved`）新增 **30 分钟**最低等待（`permanentBackoffMs`），
   不再按普通指数退避反复撞不存在的仓库。

### 测试
新增 2 例：`x-poll-interval` 解析（有/无头）+ 间隔下限逻辑；`permanentBackoffMs` 四种 kind 的取值。
合计 **222 例**。

## [0.9.113] - 2026-11-03 —— 把「不是错误的状态码」理一遍：204 也补上了

### 梳理结果
| 状态码 | 语义 | 我们的处理 |
|---|---|---|
| 200 | 正常 | 解析 body |
| **204** | 没有内容（DELETE / 空列表） | **本轮补上**：按「未变化」处理（此前会掉进"不是合法 JSON"） |
| **304** | 没有变化（条件请求命中） | 0.9.110 修好：按「未变化」处理，不计入速率限制 |
| 301 | 改名/转移 | 归 `moved`，提示换新地址 |
| 401 / 403 / 404 | 要人动手 | 归 `auth` / `ratelimit` / `notfound` |
| 5xx | 服务端/网关 | 归 `gateway`，暗示可重试 |

### 改法
`pollOnce` 在 304 之外再认 204：清 `lastError`、重置退避、记 `unchanged` 事件。

### 测试
新增 1 例：`parseGhInclude` 能认 200/204/304 三种状态码与 ETag；304 的分类提示必须直说「不是错误」。
合计 **220 例**。

## [0.9.112] - 2026-11-03 —— 错误旁边写上「多久之前」，超过一小时标「旧记录」

### 为什么
上一轮清掉了「暂停后旧错误永久挂着」，但**没暂停**的守也会有旧错误：
轮询失败后不再失败，`lastError` 还在，面板上看起来像"刚刚又失败了"。

### 改法
1. 所有设置 `lastError` 的地方统一走 `setEntryError()`，顺带记 `lastErrorAt`；
2. `/state` 暴露 `lastErrorAt`；
3. 面板：`（3 分钟前） 失败原因…`；超过 1 小时显示 `旧记录（2 小时前）：失败原因…`。

### 测试
新增 1 例：3 分钟前 → 带「N 分钟前」且不标旧记录；150 分钟前 → 标「旧记录」。合计 **219 例**。

## [0.9.111] - 2026-11-03 —— 暂停后旧错误永远挂着；再给"退出码"加一道全库扫描

### 从截图那条误报想到的
304 误报修好之后，还有个遗留问题：**暂停的守不再轮询，旧的 `lastError` 就永远挂在面板上**
—— 客户看到的红点与「异常」计数，其实是几小时前的旧记录。

### 改法
1. 暂停 / 恢复时清掉瞬时状态：`lastError` / `deferReason` / `lastDeferred` / `consecutiveFailures` / `nextAt`；
2. 新增全库扫描 `scripts/audit-exit-codes.mjs`：**打印了 FAIL 却没返回非 0** 的脚本一律报出来
   （这是本轮之前的同类"第三类装死"，现在有门禁守着）；
3. 接进 `preflight`（第 36 项「退出码一致」）。

### 验证
- 暂停用例：造一个 `lastError` → 面板点暂停 → 状态里 `lastError` 与 `deferReason` 都为 null；
- 退出码扫描：把 `audit-promises.mjs` 里两处 `process.exitCode = 1` 都换成 `void 0` →
  `FAIL 这些脚本打印了 FAIL 却不返回失败：scripts/audit-promises.mjs`（exit=1）；还原后 PASS。

### 测试
合计 **218 例**。

## [0.9.110] - 2026-11-02 —— 截图里的「gh: HTTP 304（没归类的错误）」是误报

### 客户看到的
```
gh: HTTP 304
（没归类的错误：已按退避自动重试；持续出现就跑 watch_doctor 看检查清单，或把这行贴给对方）
```
这是面板上一条「异常」的守 —— **而 304 根本不是错误**。

### 根因
我们自己给 GitHub 加了条件请求（`If-None-Match`）：
- GitHub 没变化时回 **304**，且**不计入速率限制**；
- `gh` CLI 把非 2xx 一律当失败（exit 1），于是 `res.code !== 0` 分支先走进去了；
- 代码里本来有一个 `parsed.status === 304` 的「未变化」分支，但它在**成功分支**里，
  永远轮不到；
- 结果 304 落到 `classifyGhError` 的 `other` 分类，显示成「没归类的错误」。

### 改法
1. 轮询的失败分支先认 304：按「未变化」处理（清 lastError、重置退避、记事件 `unchanged`）；
2. `classifyGhError` 新增 `notmodified` 分类：`（没有变化 —— 条件请求命中 304，这不是错误）`；
3. 面板：历史数据里残留的 304 记录也不再算「异常」。

### 测试
新增 2 例：分类表（`gh: HTTP 304` / `HTTP 304 Not Modified` 都判 `notmodified` 且提示"不是错误"）、
面板计数不把 304 算进异常。合计 **217 例**。

## [0.9.109] - 2026-11-02 —— 五项"最容易退化"的反向用例，顺手抓到一处假通过

### 做了什么
`scripts/regression-list.mjs`（单一事实来源）列出最容易退化的五件事，`scripts/regression-cases.mjs`
逐条**改坏 → 确认检查变红 → 还原 → 确认变绿**：

| # | 会退化成什么 | 结果 |
|---|---|---|
| 1 | README 数字漂移 | ✅ 改坏会红 |
| 2 | 整句文案重复 | ✅ 改坏会红（见下） |
| 3 | 打包缺必需文件 | ✅ 改坏会红 |
| 4 | 模式差异文档漂移 | ✅ 改坏会红 |
| 5 | 计数加不上总数 | ✅ 改坏会红 |

### 顺带抓到一个假通过
第 2 项一开始怎么都不红。查下去发现 `audit-duplicate-copy.mjs` **发现重复也只 exit 0**
（当时写成 INFO）。`preflight` 是靠"输出里有没有『重复 0 处』"文字匹配才红起来的。

改成硬失败（exit 1），`preflight` 也改用退出码判断。**"检查发现了问题却不返回失败"是第二类装死。**

### 文档与门禁
- 生成 `docs/回归清单.md`（清单单一来源，`--check` 守着）；
- `preflight` 新增两项：「反向用例」（5/5）与「回归清单文档」，合计 **36 项检查**。

### 过程中的三次自伤（都是转义）
拼接注入代码时 `
` 被写成真实换行：先是 `SyntaxError: Invalid or unexpected token`，
后是拼出 `const ZZ_DUP = 没有引号的文本`（注入本身不合法）。最后改用
`String.fromCharCode(10)` + 拼引号，才稳定。

## [0.9.108] - 2026-11-02 —— `--fast` 到底少跑了什么：现在有一份生成出来的对照表

### 问题
`--fast` 快，但"快在哪"没人说得清。跳过 `门禁自检` 意味着**不再验证其它检查还活着** ——
这是可以接受的取舍，但必须写在纸上，否则"fast 全绿"会被当成"可以提交"。

### 做法
- `scripts/preflight-modes.mjs`：**单一事实来源**（跳过哪两项、为什么、风险是什么）；
- `scripts/render-preflight-modes.mjs`：从清单生成 `docs/preflight-modes.md`，带 `--write/--check`；
- `preflight` 新增第 34 项「模式差异文档」：文档与清单不一致就红（0.1 秒成本）。

### 文档长这样
| 模式 | 用途 | 约耗时 |
|---|---|---|
| 全量 | 提交前 / 发布前 | 约 30 秒 |
| `--fast` | 边改边跑 | 约 12 秒 |

| 跳过的检查 | 为什么跳过 | 跳过后的风险 |
|---|---|---|
| 门禁自检 | 要 21 次注入，约 4 秒 | 不会发现"某条检查已经装死" |
| 冒烟 smoke:observe | 需要真机宿主 | 不会发现真机上的观察模式失效 |

并写明：**`--fast` 全绿不代表可以提交。**

## [0.9.107] - 2026-11-02 —— 全量 preflight 从 84 秒压到 28 秒

### 先量（给每项加耗时）
`preflight` 现在每行后面带耗时，末尾打「最慢三项」：

```
PASS 门禁自检   21/21 项注入都被检测到（26/33 项有注入）  (56.6s)   ← 元凶
PASS 单测 node --test                       215/215  (9.3s)
PASS 长跑体积                 20 条守跑 30 天 = 165.2 KB  (6.0s)
```

### 三处改法
1. **门禁自检里有两个注入在跑整套 `preflight --fast`**（22.1s + 13.8s）——
   它们只想验证「README 单测数」「语法」两条检查。分别抽成
   `scripts/audit-readme-tests.mjs`（把真实用例数传进去，零成本）和 `scripts/audit-syntax.mjs`（0.5s）；
2. **路由注入跑整个 `test/routes.test.mjs`**（11.4s）→ 改用 `--test-name-pattern=路由面收敛`，
   只跑真正钉住路由表的那一例（0.18s）；
3. 顺手发现第一次改的 pattern（`注册了预期的工具与路由`）**抓不到**路径被改的情况 ——
   那一例只检查"三条路由存在"，不检查路径对不对。换成钉住 9 条路径的那一例才对。

### 结果
| 阶段 | 耗时 |
|---|---|
| 改前 | **83.7s** |
| 改后 | **28.3s**（-66%） |

门禁自检本身：56.6s → **4.4s**。

## [0.9.106] - 2026-11-02 —— 两个会话同守一个仓库：ack 标签是共享的，现在说清了

### 语义（先说清再说改）
ack 标签打在 **issue/PR** 上，是**仓库级**的。所以：
- A 会话 ack 后，B 会话的下一轮会把它当"已处理"跳过（判定日志里记「已 ack」）；
- 这通常是**对的**（避免两边重复修同一个 bug），但客户必须知道。

### 改了什么
1. 面板在"还有 N 个会话也在守"后面补一句：
   `（各自独立唤醒；但 ack 标签是仓库级的 —— 任一方 ack 后两边都会跳过，想让两边各处理各的就给对方设不同标签）`
2. `watch_start` 新增 `ackLabel` 参数（以前只有面板能设）—— 想让两个会话各用各的标签，现在工具也能配；
3. 顺手修了一个默认值缺失：`watch_start` 创建守时**没写** `ackLabel` 字段（面板路径有），
   靠读取时兜底才没出事；现在创建时就落盘 `主理鱼:已处理`。

### 测试
新增 1 例（自定义标签写入状态 / 不传时用默认），更新 1 例（面板文案）。合计 **215 例**。

## [0.9.105] - 2026-11-02 —— ack 标签被人删掉会怎样？四种情形都验了一遍

### 查了什么
`watch_ack` 的幂等痕迹有**两层**：GitHub 上的标签 + 本地水位 `seen`。
如果标签被别人手动删了，只靠一半的痕迹会怎样？

### 结果（新增用例，离线可复现）
| 情形 | 行为 | 是否合理 |
|---|---|---|
| 标签还在 | 跳过，并在判定日志里记「已 ack」 | ✅ 可追溯 |
| 标签被删、水位还在 | **不重复叫醒**（updated_at 未变新） | ✅ 正是要的效果 |
| 标签被删、水位也没了（换机/重建） | **会再叫醒一次** | ✅ 宁可多叫一次，不漏 |
| 标签被删、但条目被编辑过 | 会重新叫醒 | ✅ 内容变了就该重看 |

原来这条链路没有任何断言 —— 全靠"读代码看起来对"。

### 改法
- 新增 1 例把四种情形锁死（含"内容变了要重新处理"这个边界）；
- README「已知限制」补一条，把"标签被删"的结果直说，客户不用猜。

### 测试
合计 **214 例**。

## [0.9.104] - 2026-11-02 —— 顶部四个数字加不上总数：一条守被数了两次，「时段外」一次没数

### 查出来的
面板顶部是 `条主理鱼 / 主理中 / 已暂停 / 异常`。原来的算法各数各的：
```js
running = 状态==active 的条数
broken  = 状态==error  的条数
paused  = enabled===false 的条数      // ← 与上面两个不互斥
```
于是：
- 一条**已暂停又有错误**的守 → 「已暂停」「异常」各数一次；
- 「**时段外**」（设了 activeHours 且此刻在窗口外）根本不进任何一项。

5 条守（正常/暂停/出错/时段外/暂停且出错）时，四项加出来是 5，但其中一条被数两次、一条没数 ——
**看起来也对得上，实际是巧合**。

### 改法
四项都由同一个 `orbitStateOf()` 产出，天然互斥：
```js
const byState = { active: 0, paused: 0, error: 0, dormant: 0 }
for (const w of watchers) byState[orbitStateOf(w)] += 1
```
「时段外」只在 > 0 时显示（不占版面）。

### 测试
新增 1 例：五种状态的守 → 分项之和必须等于总数。
验证：把 `dormant` 写死为 0 → 用例立刻红；还原后绿。合计 **213 例**。

## [0.9.103] - 2026-11-02 —— 232 条 CHANGELOG 里「重复」出现 22 次，那就让工具找它

### 统计（把 232 条按关键词聚一遍）
| 主题 | 出现次数 |
|---|---|
| 门禁 / 检查 | 129 |
| 面板 UI | 116 |
| 错误提示 / 分类 | 88 |
| 文案 / 用词 | 60 |
| 消息内容 | 47 |

再看"具体毛病"的词频：`重复` **22 次**（最高）、`漏` 17、`兜底` 11、`漂移` 7。

### 结论：第 23 次打补丁不如加个检查
`scripts/audit-duplicate-copy.mjs`：扫 `client.js` / `lib/*.js`，找出**同一句中文（≥16 字）出现两次**的地方。
首跑抓到 2 处：
1. `隔离执行（每次唤醒开一个临时副本；在副本里改，用完自动回收）` —— **两个表单各写一份**（触发页 + 设置页）；
2. `… 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。` —— 两条代码路径各写一份（工具 / HTTP）。

### 改法
两处都抽成常量（`ISOLATED_HINT` / `noTraceText()`），现在 **0 处重复**，并接进 `preflight`（第 32 项）。

### 过程中撞到的一次 TDZ
把常量搬到模块顶层时，替换脚本把常量自身的字面量也替换了 →
`const ISOLATED_HINT = ISOLATED_HINT`（自引用），用例立刻 `ReferenceError: Cannot access before initialization`。

## [0.9.102] - 2026-11-02 —— npm 包里少了文件会"装上但不工作"，现在会红

### 查了什么
`npm pack` 一共 14 个文件，其中 **7 个是运行必需的**（插件不挂载、或面板空白都可能是漏了某个文件）：

```
lib/index.js  lib/watch.js  lib/gh-format.js  lib/redact.js  lib/body.js
client.js  cordis.patch.yml
```

历史上真踩过一次：`lib/body.js` 没进 profile 的链路，插件整体不挂载。

### 改法
`scripts/audit-pack.mjs` 除了查"不该进包的东西"，现在也查"**该进包的**"：
```
REQUIRED = ['lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'lib/body.js',
            'client.js', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE']
```
缺任何一个就 `FAIL …（缺：lib/body.js）`。

### 验证
把 `lib` 目录改成逐个列、故意漏掉 `lib/body.js`：
```
FAIL npm pack 内容  13 个文件（缺：lib/body.js）   exit=1
```
还原后 `PASS … 14 个文件  exit=0`。

（顺带发现：`LICENSE` / `README` / `package.json` 是 npm **强制包含**的，`files` 里删了也还在 ——
所以注入验证只能用 `lib/body.js` 这类文件。）

## [0.9.101] - 2026-11-02 —— README 的说法接进门禁（8 组对照）

### 为什么
README 是客户第一份契约，但**改常量时没人会想起它**。例如把冷却期从 3 分钟调成 5 分钟，
README 里还写着「冷却期 **3 分钟**」——客户按文档算时间就会算错。

### 做法
`scripts/verify-readme-claims.mjs` 直接从代码里读常量，和 README 里的说法逐组对照：

| 组 | 代码 | README |
|---|---|---|
| 轮询范围 | `30–3600` | 30–3600 秒 |
| 冷却期 | `DEFAULT_COOLDOWN_MS = 180_000` | 冷却期 3 分钟 |
| 会话上限 | `DEFAULT_SESSION_WAKES = 12` | 12 次/小时 |
| 单守上限 | `maxWakesPerHour ?? 6` | 6 次/小时 |
| 隔离默认 | `maxIsolated ?? 5` / `isolateKeepDays ?? 3` | 最多 5 个、超 3 天 |
| 状态路径 | `watchers.json` | `~/.dsh/state/session-superagent/watchers.json` |
| README 里的脚本 | 4 个 | 都真实存在 |
| README 里的工具 | 8 个 | 都真的注册（离线 apply 验证） |

### 验证它会红
把 README 的「冷却期 **3 分钟**」改成 4 分钟 → `FAIL 冷却期 代码 3 分钟 / README 没写`；还原后 PASS。

已接进 `preflight`（第 31 项）。

## [0.9.100] - 2026-11-02 —— 304 实测：60 秒 12 次拉取，只有 2 次真的传正文

### 为什么要量
`/state` 早就有 ETag/304，但**从没验证过它是否命中**。面板每 5 秒拉一次，
如果 ETag 因为某个易变字段永远不命中，那这段代码等于不存在。

### 实测（新增用例，模拟真实节奏）
12 次拉取（第 6 次改了一条守的 cursor）：

```
statuses: 200,304,304,304,304,200,304,304,304,304,304,304
→ 只有 2 次 200，10 次 304
```

按 20 条守 37.8 KB 的正文算：
| 情况 | 每分钟下载 |
|---|---|
| 无 ETag | 12 × 37.8 ≈ **454 KB** |
| 有 ETag（本实测） | 2 × 37.8 ≈ **76 KB** |
| 省 | **约 83%** |

### 顺带
把 `/state` 的体积（20 条守 ≤ 50 KB）接进 `preflight`，作为第 30 项「面板请求体积」。

### 测试
新增 1 例：12 次里恰好 2 次 200、其余 304，且累计正文 < 8 KB。合计 **212 例**。

## [0.9.99] - 2026-11-02 —— trace 也做「例外优先」：正常两行说完

### 为什么
`watch_trace` 原来固定输出 5 类细节（seen / 上次上报 / 被过滤 / 被冷却吸收 / 唤醒尝试），
**正常条目也全打** —— 问"#55 怎么了"时，客户要在一堆行里找那句结论。

### 改法
- 一切正常（有成功唤醒、无过滤、无吸收）→ **两行**：结论 + `最近一次唤醒：<时间>（成功）`；
- 出现过滤 / 吸收 / 唤醒失败 → 才展开完整细节（保持原有信息量）。
- JSON 输出不变（机器契约不动）。

### 测试
新增 1 例：正常两行且不含 `水位 seen`；有失败唤醒时展开并带上 `agent busy`。合计 **211 例**。

## [0.9.98] - 2026-11-02 —— 错误旁边给一个「下一步」按钮

### 为什么
上一版把错误拆成「现象 + 建议」两句，但**建议仍是文字**：客户读完还得自己找地方点。
登录失效要点「去填 token」、仓库改名要点「改仓库地址」、网络抖动要点「立刻重试」——
这三件事的正确动作完全不同。

### 改法
- `/state` 每条守增加 `lastErrorKind`（服务端用 `classifyGhError` 算一次，面板不解析中文）；
- 面板按 kind 给按钮：
  | kind | 按钮 | 去哪 |
  |---|---|---|
  | auth | 去填 token | 设置页 |
  | moved / notfound | 改仓库地址 | 触发页 |
  | network / ratelimit / gateway | 立刻重试 | 直接重跑这一轮 |
  | 其它 | 不给按钮（不猜） |

### 测试
新增 1 例：四种 kind 各出现对应按钮，未归类的不给按钮。合计 **210 例**。

## [0.9.97] - 2026-11-02 —— 状态文件坏了会全丢：因为第一次写入没留备份

### 查出来的（三条路径都跑了一遍）
| 场景 | 修复前 | 修复后 |
|---|---|---|
| 正常写入 | 1 条守 | 1 条守 + `.bak` |
| 主文件被截断 | **0 条守（全丢！）** | 1 条守（从备份恢复） |
| 主 + 备份都坏 | 0 条守 + `.corrupt-*` 留证 | 同左（本就正确） |

根因很具体：`writeState` **只在"盘上已有好的主文件"时才写 `.bak`** ——
所以**第一次写入之后、第二次写入之前**这段时间里，一次损坏就是全部丢失。

### 改法
1. 写完主文件后，如果 `.bak` 不存在就补一份（引导备份）；
2. `watch_doctor` 增加状态来源说明：`状态文件坏过一次，已从备份恢复（原文件留在 .corrupt-*）`；
   都坏时明确说「已从空状态开始……请重新添加守」。

### 测试
- 新增 2 例：第一次写入就有备份、主文件截断后能恢复 1 条守；都坏时从空开始且留 `.corrupt-*`。合计 **209 例**。

## [0.9.96] - 2026-11-02 —— 刚重启 ≠ 定时器丢了

### 为什么
上一版加的停滞检查（`age > max(3×interval, 5min)`）有一个假警报：
**宿主重启后**，`lastPoll` 天然是几小时前的，doctor 立刻报「定时器可能丢了」——
而客户只是刚重启。**假故障比没检查更糟**，客户会开始不信这个自检。

### 改法
- 记录 `PROCESS_STARTED_AT`，写进 `state.server.startedAt`；
- 停滞判断加一个前提：**进程 uptime 也超过停滞周期**才报故障；
- 否则给一条如实说明：`上次轮询是 120 分钟前，但进程才启动 1 分钟 —— 刚重启，等下一轮即可`。

### 测试
- 更新 1 例（原「定时器丢了」用例补上"进程已跑 4 小时"的前提）；
- 新增 1 例：刚重启 → 出现「刚重启」、不出现「定时器可能丢了」；进程跑够 3 小时 → 才报故障。合计 **207 例**。

## [0.9.95] - 2026-11-02 —— 长跑体积实测：20 条守跑 30 天 204 KB → 165 KB

### 怎么量的
`scripts/measure-growth.mjs` 用真实的时间推进模拟 30 天（每 10 分钟一轮，20 条守），
把 `events / history / filteredLog / absorbedLog / seen / wakeTimes` 的条数一并打出来：

| 时点 | 改动前 | 改动后 |
|---|---|---|
| 第 1 天 | 27.2 KB | 27.2 KB |
| 第 7 天 | 108.4 KB | 88.8 KB |
| 第 30 天 | **204.4 KB** | **165.2 KB**（8.3 KB/守） |

### 谁是增长源
- `seen` 到 150 条（30 天窗口内的不同条目）；
- `absorbedLog` 50 条 —— 每条约 70 字节 × 20 条守。

### 改法
- `absorbedLog` 上限 **50 → 20**（只用于回答"最近为什么没叫醒我"，20 条够覆盖最近几轮）；
- `pruneSeen` 的 `maxEntries` **500 → 200**（列表查询一次最多 100 条/页，200 足够去重）。

### 门禁
新增 `preflight` 第 29 项「长跑体积」：20 条守跑 30 天必须 ≤ 200 KB（当前 165.2 KB），
超了就是有数组没封顶。

## [0.9.94] - 2026-11-02 —— 仓库改名/转移要单独识别（否则只是"一直没动静"）

### 为什么
仓库被改名或转移后，GitHub 回 **301 / "Repository has been moved"**。
原来的错误分类里它落进 `other`，客户看到的是一句笼统的失败，
印象却是"这条守一直没动静"——**不知道该去改 owner/name**。

### 改法
1. `classifyGhError` 新增 `moved` 分支（匹配 301 / moved permanently / has been moved），
   排在 `notfound` 之前，提示：`（仓库改名或转移了：用新地址重新添加，或把守改成新的 owner/name）`；
2. `moved` 不在"可自动恢复"名单里（网络/限流/网关才算）；
3. `watch_doctor` 的可访问性检查改用分类提示，不再直接贴 120 字原始 stderr。

### 测试
- 扩展 1 例：分类表加 `HTTP 301` 与 `Repository has been moved` 两行，都判为不可自动恢复。合计 **206 例**。

## [0.9.93] - 2026-11-02 —— 同一仓库被多个会话守着时，面板说说清"还有谁"

### 为什么
两个会话守同一个仓库时，面板上每条守看起来都像"独占"的 ——
客户不知道**还有人在看同一个仓库**，也不知道两者会不会互相抢唤醒。

### 改法
- `/state` 每条守增加 `otherSessions: string[]`（同仓库、不同会话的 id）；
- 面板行内显示：`还有 1 个会话也在守这个仓库：session-2（各自独立唤醒，互不影响）`；
- 独占时不显示这一行。

### 过程中三次修正
1. 先把字段加进了 `statusView` 的清单 → **稳定性用例立刻红**：那个契约是"工具输出"的，
   而这个字段只在 `/state` 里 —— 清单撤回，契约边界才是对的；
2. 面板先加在「判定」页，但用例发现那一页在没有事件时不渲染 ticket → 改到总览行；
3. 我插的「另有 N 个会话在守」和已有的完整句子**重复** → 删掉我插的那行，只留一处实现。

### 测试
- 新增 2 例：面板显示（含独占时不显示）、`/state` 双向可见（我方看到对方、对方看到我方）。合计 **206 例**。

## [0.9.92] - 2026-11-02 —— 一条会话最多 20 条守（批量请求整批校验）

### 为什么
之前没有上限：客户可以给一条会话挂 200 条守 —— 每条每 60 秒轮询，
`/state` 再压缩也挡不住真实的请求量与上下文压力。

### 改法
- `MAX_WATCHERS_PER_SESSION = 20`；
- 第 21 条被拒绝：`一条会话最多挂 20 条守（现在 20 条）—— 先 watch_stop 停掉不用的，或把多个仓库合成一条规则`；
- **批量请求整批校验**：19 条时一次加 2 条 → 整批拒绝并说明"这次要新增 2 条"，不会只写进去第一条；
- 更新已有守不受上限影响。

### 过程中两次自我修正
1. 第一版只在"单条写入前"检查 → 批量时会出现**部分写入**；补了整批预校验；
2. 补丁把 `const applied = []` 和 `for` 挤到一行 → `SyntaxError`，`node --check` 当场拦下。

### 测试
- 新增 1 例：20 条为止、第 21 条被拦、19+2 整批拒绝且不写入、更新已有守不受影响。合计 **204 例**。

## [0.9.91] - 2026-11-02 —— 「最近 5 次唤醒」其实早就有，只是名字看不出来

### 先确认（结果和预期相反）
我准备给每条守加一个「最近 5 次唤醒」折叠区，写到一半发现**判定页的「判定日志」已经在显示这些**：
每轮的结果、跳过原因、条目编号全都在（`history` 取最近 5 条）。

所以：**这不是能力缺失，是命名问题** —— 标题写着"判定日志"，客户不知道那就是"最近几次唤醒"。

### 改法
- 撤掉我刚加的重复区块（不留两份实现）；
- 标题改成 **`判定日志（最近 5 次唤醒）`**；
- 用例改成锁"标题能看出这是最近几次"，并继续断言条目与失败原因可见。

### 测试
新增 1 例。合计 **203 例**。

## [0.9.90] - 2026-11-02 —— 之前叫醒过的条目，消息里标出来

### 为什么
`history` 里一直记着"哪次叫醒处理了哪几条"，但**消息里完全没用**。
结果同一个问题第二次被叫醒时，会话以为这是新问题，会从头分析一遍。

### 改法
- 发消息前把 `entry.history` 压成 `{条目号: 最近一次叫醒时间}`；
- 条目行尾追加 `⏰ 之前叫醒过（2026-10-30）`（只标日期，不占版面）。

### 测试
- 新增 1 例：叫醒过的标、没叫醒过的不标、没传 `seenBefore` 时行为不变。合计 **202 例**。
- 单行长度仍 ≤ 120（`audit-line-length` 通过）；演练快照 62 行未变（示例历史为空，符合预期）。

## [0.9.89] - 2026-11-02 —— watch_start 一次加多个仓库（客户三仓库不用点三次）

### 为什么
`watch_start` 一次只收一个 `repo`，三个仓库要点三次、三个工具调用 —— 而它们的
间隔/过滤/限流通常完全一样。

### 改法
`repo` 支持 `a/b, c/d e/f`（逗号、空格、换行都认）：
- 文本：每个仓库一行 `watching a/b → session s1 every 60s`；
- JSON：保留原字段（兼容），新增 `repos: [{repo,id,updated}]`；
- **有一个写错就整体拒绝**（`仓库要写成 owner/name，这些不对：…`），不会只加一半。

### 过程中踩到的坑
第一版把 `applyOne()` 包在原逻辑外面，但**原逻辑里还留着旧的 `format=json` 提前 return** ——
于是多仓库时只返回第一个仓库的 JSON。删掉那段之后才对。

### 测试
- 新增 1 例：三个仓库三行、守数=3；JSON 带 `repos`；一个写错时整体拒绝且不写入。
- `contract-stability.json` 登记 `repos: stable`（用例先红一次）。合计 **201 例**。

## [0.9.88] - 2026-11-02 —— 先量 /state 体积：100 条守 347 KB，加事件预算后 143 KB

### 先量（`scripts/measure-state.mjs`）
按 `/state` 的真实形状（比 `statusView` 多 `filteredLog`/`history`/`events`）建模：

| 守数量 | 修改前 | 修改后 |
|---|---|---|
| 1 | 3.7 KB | 2.1 KB |
| 5 | 17.5 KB | 9.6 KB |
| 20 | 69.6 KB | **37.8 KB** |
| 50 | 173.7 KB | 82.8 KB |
| 100 | **347.3 KB** | 143.0 KB |

**每守 3.5 KB → 1.4 KB**，`events`（每守 20 条）是主因。

### 改法
- `events` 每守上限 6 条，且**全局预算 240 条**：`perWatcher = max(1, min(6, 240/N))`；
  守越多，每守分到的越少（100 条守时每人 2 条）。

### 判据怎么定的
判据按**现实上限**：面板是会话级的，一个会话挂 20 条守已经很极端 → 上限 **50 KB @ 20 条守**。
100 条守不是目标，所以不为了它把字段砍到没法用。**这条判据写进脚本注释里，不是拍脑袋。**

### 测试
- 新增 1 例：40 条守 × 20 事件 → 返回每守 ≤ 6 条、总数 ≤ 240。合计 **200 例**。
- 踩到的坑：用例第一版用共享的 `call()`，打到了**别的实例**的路由表（返回 7 条守）→ 改用本实例路由。

## [0.9.87] - 2026-11-02 —— 「需要关注」按严重程度排序（会丢消息的排最前）

### 为什么
原来按**发现顺序**往数组里塞：`仓库已归档` 这种静态提示可能压在一堆真问题上面。
排在最前的应该是最急的：**正在丢消息的**。

### 改法
给每类问题一个权重，排序时按 `rank` 升序、同权重按文本：
| rank | 类型 |
|---|---|
| 0 | gh 不可用（所有轮询都会失败） |
| 1 | 轮询失败 |
| 2 | 叫醒后没回音 |
| 3 | 仓库结构（归档/关 Issues/fork） |
| 4 | 只有读权限 |
| 5 | 条目被重新打开 |
| 6 | 暂停唤醒 |
| 7 | 未配置 token（提示性） |

顺带修掉一个**重复推送**：`structure` 那条被 push 了两次（列表里会出现两条一模一样）。

### 测试
- 新增 1 例：四类提示都要出现，且「轮询失败」排在「已归档」「只有读权限」之前。
- 验证方式：把排序语句替换成 `void 0` → 用例立刻变红；恢复后全绿。合计 **199 例**。

## [0.9.86] - 2026-11-02 —— watch_status 文本：正常的守不堆字段，异常的才说原因

### 为什么
原来每条守一行，字段固定为 `repo → session | every 60s | flags | lastPoll=… | lastWake=… | err=-`。
**十条守就是十行长日志**，而其中 90% 的字段是 `-` 或 `null` —— agent 读完还得自己在脑子里筛。

### 改法
- 基础部分只写"这条守是什么"：`o/ok → s1 | 每 60s`（正常的守 < 60 字符）；
- **只有需要你注意时才追加**：`暂停：cap-session`、`叫醒 3 次没回音`、`已 35 分钟没轮询`、`还没轮询过`、`上次失败：…`；
- `lastPoll=` / `lastWake=` / `err=-` 这类固定字段不再出现（JSON 里仍有，机器不受影响）。

### 测试
- 更新 1 例（断言从 `defer=cap-session` 改成 `暂停：cap-session`，并新增"不许出现 lastPoll="）；
- 新增 1 例：正常的守行 < 60 字符且无暂停、异常的守带原因、每条守一行。合计 **198 例**。

## [0.9.85] - 2026-11-02 —— 知识库加一条「第一次读这三篇」的入口（并有门禁守着）

### 为什么
112 篇、9 个板块，按主题分组对熟悉的人好用，**对新人等于没有入口** —— 他不知道自己该从哪篇开始。

### 做法
`docs/kb/README.md` 顶部加 3 篇阅读路径（规则对齐 → 门禁可信度 → 错误分类 ），
`check-docs.mjs` 增加第 4 项检查：
- 路径必须存在且有 ≥ 3 篇；
- 路径里的文件必须真实存在。

### 写的时候踩到的两个真问题
1. 第一版检查用了不存在的变量 `ok` → 路径一坏就 **抛异常**（比不检查更糟）；
2. 检查块被插进了 `countMismatch` 的 `else` 分支里，只有"篇数一致"时才跑 ——
   重构到独立段落后，验证：删掉一篇链接 → `FAIL 知识库索引缺「第一次读」的阅读路径`，exit=1；还原后 exit=0。

## [0.9.84] - 2026-11-02 —— ack 失败分两类：会不会自己好，客户要知道

### 为什么
`watch_ack` 失败原来只回一句 `[error: #7 gh exited 1] <原始 stderr>` ——
**客户分不清"等一下就好"和"必须我去处理"**，两种情况的正确反应完全相反。

### 改法
用已有的 `classifyGhError` 分类，输出两类文案（长度 35–55 字符）：

| 类型 | 文案 |
|---|---|
| 可恢复（网络/限流/网关） | `[error: #7 暂时失败，稍后再 ack 一次即可（网络抖动）]` |
| 需处理（登录/权限/编号） | `[error: #7 需要你处理] （gh 登录失效：跑 gh auth login，或在面板填 token）` |

JSON 里同时给出 `kind` / `retryable` / `advice`。

### 文案去重（写的时候撞到两次）
1. 第一版：`会自动恢复：稍后再 ack 一次即可` + hint 里的"已按退避自动重试，不需要手动处理" —— **两句同义**；
2. 第二版：不可恢复分支既给 label 又给 hint，`gh 登录失效` **出现两次**。改成 hint 单独承担说明。

### 测试
- 新增 1 例：6 种错误文本的可恢复性判定，外加"没有守时"仍报错。合计 **197 例**。

## [0.9.83] - 2026-11-02 —— 空态引导不能引用不存在的控件

### 为什么
空态写着「③ 点「添加到当前会话」」，但那是**文案**；按钮一旦改名，引导就指向空气。
这类失效不会报错，只会让客户照着做却没反应。

### 做法
用例从引导文本里抽出所有「…」引用的名字，逐个要求它们**在「触发」页真实出现**。

### 过程中两次假通过（都是判据问题）
1. 第一版断言写成 `trigger.includes(name) || overview.includes(name)` ——
   引导文本自己就含这个词，`overview` 永远为真 → **注入改名后仍 PASS**；
2. 收紧成只查「触发」页后仍然 PASS，因为测试桩没传 `sessionId`，
   按钮渲染成「先打开一个会话」而引用的是「添加到当前会话」。
   给渲染桩加上 `props` 参数、测试传 `{ sessionId: 's1' }` 后，注入改名**立刻变红**。

### 测试
- 新增 1 例（现在是真会红的那种）。合计 **196 例**。

## [0.9.82] - 2026-11-02 —— 跳过必须可见：skip 要带原因，用例体内不许静默 return

### 为什么
`{ skip: process.platform !== 'win32' }` 在非 Windows 机器上只输出一个 `skip`，
**不说明为什么** —— 看日志的人无法判断"是环境不满足，还是有人偷懒"。
更隐蔽的是用例体内的 `if (…) return`：**显示通过，其实一行断言都没跑**。

### 做法
`scripts/audit-test-skips.mjs`：
1. `skip` 的值必须是三元里带字符串的写法 `? '原因' : false`；
2. 扫描用例体内的裸 `return`（当前 0 处）。

### 首跑就抓到自己一次
第一版判据写成"值里含引号就算有原因"，而 `process.platform !== 'win32'` 里也有引号 →
**假 PASS**。改成必须匹配 `? '…'` 才生效，立刻抓到 `secrets-acl.test.mjs:12`。

### 现状
```
PASS 跳过可见性  skip 都有原因，无用例体内 return
node --test → 195/195，skipped 0
```
已接进 `preflight`（第 28 项）。

## [0.9.81] - 2026-11-02 —— scripts/ 的临时文件也纳入收口（并且这次判据是真的生效）

### 做了什么
1. `clean-tmp.mjs` 的前缀补上 `preflight-`（之前只清 `superagent-` / `zhuli-`，preflight 自己的临时目录永远清不掉）；
2. `audit-tmp-dirs.mjs` 增加一条：**`scripts/*.mjs` 里用了 `tmpdir()` 就必须有 `rmSync`/`unlinkSync`**。

### 自己抓到的两个问题
1. 第一次写这条检查时，`leaky` 只出现在提示文字里、**没参与判定** → 注入后仍 `PASS`；
   把 `leaky.length === 0` 加进条件后才真的会红；
2. 注入验证（把 `rmSync` 改成 `noopSync`）当场证明：修前 exit=0（假通过）、修后 exit=1（真红）。

### 现状
```
PASS 临时目录收口  测试全走 tempDir()；脚本里 tmpdir 都配了清理
```

## [0.9.80] - 2026-11-02 —— 试过给"✅ 已落地"加内容校验，结论是**不能当门禁**

### 想做什么
现在 KB 的 ✅ 只校验"版本号在 CHANGELOG 里存在"，没校验"那条 CHANGELOG 真在讲这件事"。
于是试着加一层：KB 里的反引号标识符（`watch_doctor` 之类）至少要出现在对应 CHANGELOG 里。

### 结果：判据太松，全是噪音
109 条 KB 里 **8 条**报"对不上"，逐条看都是**正常表述差异**：
- `0.9.62` 的 CHANGELOG 写"兜底也要有下一步"，KB 里写 `preflight`；
- `0.8.91` 的 CHANGELOG 写"文档分四种"，KB 里写 `README.md` / `CHANGELOG.md`。

CHANGELOG 是给人读的散文，KB 写的是实现细节 —— **两者必然用不同词**。

### 决定
保留这项检查但**降级为 INFO**，不判失败；数字会打出来（8/109），漂移可见但不制造假警报。
这正是 KB KB `docs/kb/audit-false-positives.md` 那条的又一次实践。

## [0.9.79] - 2026-11-02 —— 工具描述里的承诺必须在对账表里有一行（双向）

### 为什么要做
工具描述是 **agent 读的契约**（`Idempotent per (repo, session)`、`Read-only`、`never returned`），
`docs/规则对照表.md` 是**人读的对账表** —— 两套文本最容易一边改了另一边没改。

### 做法
`scripts/audit-promises.mjs` 从描述里抽承诺，要求对账表里有对应关键词，**并且反向也查**：
表里承诺的，描述里必须还写着（否则说明行为被悄悄删了）。

### 首跑结果
对账表缺 4 条：`不再叫醒` / `不回显` / `幂等` / `默认间隔` → 补第 12–16 行。

### 验证双向
- 把 `Idempotent` 从描述里删掉 → `FAIL 表里承诺了但描述里找不到：幂等`（这正是单向检查抓不到的盲区）；
- 还原后 PASS。

已接进 `preflight` 第 27 项「工具承诺对照」。

## [0.9.78] - 2026-11-02 —— trace 能指名"被冷却期吸收"，不再三合一猜

### 为什么改
客户问「这条为什么没叫醒我」，`watch_trace` 原来给的是：
```
已记入水位但没唤醒（被吸收/仅观察/或上报前就已存在）
```
**三种可能糊在一起** —— 等于没说。根因是"被吸收"这件事从来没被记下来。

### 改法
1. `pushAbsorbed()`：吸收时写一条有界日志（`{at, number, title}`，最多 50 条）；
2. `itemTrace` 读它，结论改成 `被冷却期吸收了（<时间>）—— 那一批刚唤醒过，等下一轮`；
3. 文本列 `被冷却期吸收：<时间>`；JSON 的 `results[]` 多了 `absorbed` 字段；
4. `contract-stability.json` 登记 `absorbed: stable` —— **新增字段必须登记这条规矩当场生效**（用例先红了一次）。

### 测试
- 新增 1 例：造吸收记录 → 结论必须含「被冷却期吸收」、不得出现三合一说法、JSON 有明细。合计 **195 例**。

## [0.9.77] - 2026-11-02 —— doctor 补两项：定时器丢了、隔离目录不可写

### 为什么要补
`watch_doctor` 原来只检查：版本、挂载、gh 登录、仓库可访问、ack 标签、隔离目录**是否存在**。
两类真实故障它看不见：

1. **定时器丢了**：进程被挂起、`setInterval` 被清掉后，`lastPoll` 会一直是几小时前，
   但面板上一切显示"运行中、正常"；
2. **隔离目录存在但不可写**：权限/磁盘问题下，第一次唤醒建 worktree 就会失败。

### 改法
- 停滞：`age > max(3×interval, 5min)` 时报 `WARN … 已经 N 分钟没轮询过`；
- 可写：在 `workdir` 里写一个探针文件再删，失败报 `FAIL 隔离工作目录不可写（EPERM/EACCES/ENOSPC）`。

### 测试
- 新增 1 例：造一个 2 小时没轮询的守，`watch_doctor` 输出必须包含「没轮询过」。合计 **194 例**。

## [0.9.76] - 2026-11-02 —— 只有一条变化时，不再解释"为什么是这几条"

### 为什么改
只有一条变化时，消息里还挂着「本轮共 1 条变化；按最近更新取前 5 条」——
**本来就只有它，解释排序是纯噪音**，还占三行版面。

### 改法
`formatWatchText`：`list.length <= 1 && changedTotal <= 1` 时不输出排序解释；
**但跳过信息必须保留**（"本轮跳过 2 条"不是排序解释，而是"我还看过别的"）。

### 测试
- 新增 1 例：单条无解释、多条保留解释且带总数、单条+跳过时跳过信息仍在。合计 **193 例**。
- 离线演练脚本：62 行快照已刷新（示例里的两条消息仍带解释，符合预期）。

## [0.9.75] - 2026-11-02 —— 术语表与面板用词双向对照（并接进门禁）

### 做了什么
`scripts/audit-glossary.mjs` 做两件事：
1. 术语表里的词在面板文案里**有没有出现**（没出现 = 可能是死词）；
2. 面板里出现了哪些技术词但**术语表没解释**（客户会卡住）。

双向包含即算命中（`副本` 被 `临时副本` 覆盖，不算漏）。

### 首跑结果
- 术语表 13 条 / 面板文案 123 行；
- **面板在用但没解释**：`轮询`、`副本`（子串误报）、`盯办`。

### 改法
补 2 条术语（`盯办` / `轮询`），并把匹配改成双向包含 → 两侧都 PASS。
接进 `preflight` 第 26 项「术语表对照」，以后自动守住。

### 验证它会红
把 `轮询` 这条改名成注入词 → `面板在用但术语表没解释：轮询`，还原后 PASS。

## [0.9.74] - 2026-11-02 —— 首次使用时别让客户看到内部说法

### 做法
给面板文案快照加了**空态场景**（没配守、没凭证、没用量），把它当成"客户第一眼"来审。

### 发现
空态里有两处"内部说法"：
| 位置 | 原文 | 现在 |
|---|---|---|
| 添加按钮（无会话时） | `需要会话上下文` | `先打开一个会话` |
| 说明行 | 同上 | `（在会话里打开本面板，才能把仓库绑到会话上）` |

「会话上下文」是我们内部的叫法 —— 客户看到只会想"什么上下文？"

### 测试
- 新增 1 例：空态必须有三步引导，且**不得出现** `deferReason / silentWakes / cursor / filterCounts / watch_ack` 这些内部字段名，也不许出现「需要会话上下文」。合计 **192 例**。
- 面板文案快照 129 → **153 行**（多了空态一节）。

## [0.9.73] - 2026-11-02 —— 门禁注入覆盖 26/26，并修掉一个"失败却 exit 0"

### 做了什么
1. 路由面检查抽成 `scripts/audit-routes.mjs`（顺带修了 Windows ESM 路径：
   绝对路径要用 `pathToFileURL`，否则报 `protocol 'd:'`）；
2. 补最后两个注入 → **26/26 项检查都有注入验证**，21/21 全被检测到；
3. **修掉 `smoke-mount --json` 失败时仍 exit 0** 的问题：
   它打印 `{"ok": false}` 却返回成功码，任何只看退出码的调用方都会被骗（注入验证当场撞上）。

### 证据
```
注入覆盖：26/26
PASS 21/21 项注入都被检测到（门禁是活的）
smoke-mount 注入 apply 抛错：exit=1（修前 exit=0）
```

### 顺带
清理了验收清单里过期的解释键（`路由面` → `路由面（9 条）`），提示从 WARN 变 PASS。

## [0.9.72] - 2026-11-02 —— 注入覆盖 24/26：双主题预览与验收清单也验过了

### 做了什么
1. 新增两个注入：
   - **双主题预览**：把渲染器里的「浅色主题」标记改掉 → 检查必须红；
   - **验收清单**：给 preflight 塞一条没有解释的 `record(...)` → 清单检查必须红。
2. 预览检查抽成 `scripts/audit-preview.mjs`（preflight 与注入验证共用），
   注入验证耗时 31.6 秒 → **22 秒**。

### 结果
```
注入覆盖：24/26（剩下 2 项：路由面（9 条）、离线挂载冒烟）
PASS 19/19 项注入都被检测到（门禁是活的）
```

## [0.9.71] - 2026-11-02 —— 又一个装死的检查：打包泄漏检测的字符串写错了

### 发现（注入验证翻出来的）
`npm pack 内容` 的泄漏判断写的是固定字符串 `'npm notice test/'`，
而 `npm pack --dry-run` 的实际输出是：

```
npm notice 2.7kB test/agents-context.test.mjs
```

**中间夹着文件尺寸**，所以那几条 needle 永远匹配不到 —— 这条检查等于只检查了 `.tgz`。

### 改法
- 泄漏判断改成**模式匹配**（`/npm notice .*\stest\//` 等 6 条规则）；
- 抽成独立脚本 `scripts/audit-pack.mjs`（preflight 与注入验证共用）；
- 顺带把「临时目录收口」也抽成 `scripts/audit-tmp-dirs.mjs`。

### 效果
```
注入 test/ 进 files：修前 PASS（漏报）→ 修后 FAIL（含：test/）✅
verify-gates 运行时间：34 秒 → 22.6 秒（注入不再跑整套 preflight）
注入覆盖：20/26 → 22/26；17/17 注入都被检测到
```

## [0.9.70] - 2026-11-02 —— 覆盖率从 15 涨到 20/26，并把"不该注入"的项说清楚

### 做了什么
1. **消除重名**：`路由面` 的失败分支与成功分支各用了一个名字（清单里出现两项），统一成「路由面（9 条）」；
2. **豁免分类**：`gate-coverage.json` 新增 `exempt`，写明 6 项为什么不适合注入：
   - 单测 / 门禁自检：**元检查 / 自指**（注入没有区分度）；
   - 并发隔离 / 隔离链路：注入要模拟 git 并发失败，成本高于收益；
   - 文档标识符：**与「全库文档一致」重叠**（后者扫全部 docs/ 且有注入）；
   - 冒烟 smoke:observe：**需真机宿主**；
3. 新增 2 个注入（临时目录收口 / 文档标识符曾试过但发现不生效 → 改为豁免），
   清理不符合扫描范围的注入；
4. 验收清单新增 `⛔` 标记 + 说明。

### 结果
```
注入覆盖：20/26 项检查有注入验证
豁免注入：6 项（各自写清原因）
仍可注入未做：路由面（9 条）、npm pack 内容、离线挂载冒烟、验收清单、双主题预览可渲染
PASS 16/16 项注入都被检测到
```

## [0.9.69] - 2026-11-02 —— 查出"写死颜色"指标为什么装死：正则里混进了一个退格符

### 根因（两个叠加）
1. `scripts/ui-audit.mjs` 的 hex 正则末尾混进了一个 **0x08 退格符**（`{3,8}`），
   于是它永远匹配不到任何颜色 —— 指标恒为 0；
2. 剔除移植 CSS 用的是 `clientSource.replace(PORTED, '')`，而 `PORTED` 是**解码后**的文本，
   源码里是转义形式，替换根本不生效 —— 于是移植 CSS 里的 `#000` 会被算成"我们写的"。

### 修法
- 正则改回 `{3,8}`；
- 剔除改成**按源码区间切片**（`PORTED_CSS = "` 到 `";`）；
- 顺手把 4 处真的写死颜色换成 token：
  `badgeOn/badgeOff/err/ok` → `var(--dsw-alias-state-success|warn|error-primary)`。

### 结果
```
修前：写死颜色 0（假的）
修后：写死颜色 0（真的）—— 注入一处 hex 立刻变 1 并让 UI 体检变红
```
`verify-gates` 的 UI 注入**恢复并通过** → 覆盖 **15/27**，`suspect` 清空。

> 一个 0x08 让这条指标装了不知道多久的死；变异测试是唯一能发现它的办法。

## [0.9.68] - 2026-11-02 —— 变异测试抓到一条"疑似失明"的指标

### 发生了什么
给 `UI 体检` 加注入时，三种写法（JSX inline 样式 / 自有样式块 / 文件首行注释）都没能改变
「写死颜色」这个数字，而**同一段表达式在独立进程里算同一个文件得到 9**。
也就是说：审计脚本打印的 0 与它自己的计算对不上 —— 指标疑似失明。

### 处理（先不盲改）
1. 撤掉这条注入（它证明不了检查有效）；
2. `gate-coverage.json` 增加 `suspect` 字段写明原因；
3. `verify-gates` 每次打印「疑似失明」清单；验收清单里显示 `⚠️`；
4. 其余 3 个新注入（语法 / profile 断链 / 单行长度）保留 → 覆盖 **14/27**。

> **这轮最大的产出不是覆盖率 +3，而是发现一条一直在骗人的指标。**

## [0.9.67] - 2026-11-02 —— 注入验证变成"表格驱动 + 覆盖率可见"

### 做了什么
1. `test/fixtures/gate-coverage.json`：哪几项检查有注入样例，一处登记；
2. 新增 3 个注入（**错误建议**超长 / **全库文档一致**假工具名 / **文案快照**改标题）→ **11/11 全被检测到**；
3. `verify-gates` 结尾打印覆盖率：
   ```
   注入覆盖：11/27 项检查有注入验证
   未验证（不一定是问题，但要知道）：单测 node --test、临时目录收口、门禁自检、…
   ```
4. `docs/验收清单.md` 多一列「注入验证」✅/—，并写明 **✅ = 有注入样例；— = 还没注入过，不等于没检查**。

### 为什么值得
"哪些门禁被验过"以前只在我脑子里；现在写在表里，而且**没验过的会自己列出来**。
这让"覆盖率提升"变成一个可以持续推进的清单，而不是一次性的热情。

## [0.9.66] - 2026-11-02 —— 门禁自检扩到 8 项注入（并把它跑快）

### 做了什么
在原有 4 个注入点之外补 4 个：
| 注入 | 检查 |
|---|---|
| 改 `CLIENT_VERSION` | 版本一致 |
| 改一条路由路径 | 路由面 |
| 往判定页塞 4 个 Section | 信息密度 |
| 往 JSON 契约清单加假字段 | JSON 契约 |

实测 `PASS 8/8 项注入都被检测到`。

### 性能教训
最初两个注入点各跑一次完整 `preflight --fast` → **29.5 秒**；
改成只跑相关测试文件（`meta.test.mjs` / `routes.test.mjs`）→ **11.8 秒**。
**注入验证要足够快，否则没人会在改代码时跑它。**

### 一个语法陷阱（第 N 次）
用 Python 往 JS 里写多行字符串时 `
` 又变成了真实换行 → `node --check` 立刻报错。
改用 `[...].join(String.fromCharCode(10) + '        ')` 生成后正常。

## [0.9.65] - 2026-11-02 —— 门禁自检：注入 4 个错误，确认检查真的会红

### 学到的（知识库第 105 条）
变异测试的思路用在门禁上：**给门禁注入缺陷，看它抓不抓**。抓不到的检查就是摆设。

### 做了什么
`scripts/verify-gates.mjs` 四处注入（try/finally 还原）：
| 注入 | 结果 |
|---|---|
| README「N 项单测」改成 9999 | 红 ✅ |
| 临时写一条 `✅ 9.9.9` | 红 ✅ |
| 临时写一个断链 | 红 ✅ |
| 面板文案改一个字 | 红 ✅ |

```
PASS 4/4 项注入都被检测到（门禁是活的）
```
已接进 `preflight`（非 `--fast`，第 25 项「门禁自检」）。

### 顺带修掉一个"假红"
`smoke:observe` 需要真机宿主，本机一直红 9 项 —— 那是**环境不满足**，不是产品问题。
现在脚本自带宿主门禁（`DSH_SMOKE_HOST=1`），否则打印 `SKIP` 并退出 0。

> 假红和假绿一样有害：前者让人麻木，后者让人误以为安全。

## [0.9.64] - 2026-11-02 —— 错误建议变成机械可查：≤60 字符且必须含动作

### 学到的（知识库第 104 条继续）
建议文案会随版本漂移 —— 0.9.62 兜底为空、0.9.63 建议被截断，**两次都是靠人发现**。
这次把判据变成脚本。

### 做法
`scripts/audit-error-hints.mjs`：7 类错误各跑一个样本，逐条检查
- 长度 **≤ 60 字符**（面板窄，超过就折三行）；
- 必须含可执行动作（跑 / 填 / 等 / 检查 / 确认 / 换 / 贴给），或明确写"不需要手动处理"；
- 分类必须对得上（防止正则改动导致归错类）。

实测：`auth 35 / ratelimit 31 / gateway 43 / nogh 22 / notfound 23 / network 35 / other 50`。

### 验证它会红
把 `nogh` 那条临时改成 68 字符 → `FAIL nogh 68 字符`，exit 1；还原后 PASS。

### 门禁
`preflight --fast` 新增「错误建议」→ 现共 **24** 项；验收清单 26 项每项都有解释。

## [0.9.63] - 2026-11-02 —— 错误截断不再切掉建议（三处渲染统一拆开）

### 问题
面板把 `lastError` 整串 `slice(0, 160)`：错误一长，**先被切掉的恰好是末尾的建议**。
0.9.62 刚给每类错误补了"下一步"，结果它可能根本显示不出来。

### 改法
`splitErrorText()`：把 `short +（hint）` 拆成 `{ main, hint }`（建议永远是末尾的括号）。
三处渲染统一：
- 概览行：现象截 120 + 建议单独一行（`dt-hint`）；
- Tickets 行：同上；
- 「需要关注」列表：现象截 120 + 建议完整保留。

### 测试
- 新增 1 例：长错误里建议必须完整出现，且现象部分被截断（避免占满版面）。合计 **191 例**。

## [0.9.62] - 2026-11-02 —— 每一类错误都必须给出"下一步"

### 发现
`classifyGhError` 有 6 类，其中 **`other` 的 hint 是空字符串** ——
客户碰到一条没归类的错误，面板上只有一句看不懂的原文，**没有任何下一步**。
另外两条内部错误更糟：直接写 `bad json` / `unexpected payload`（内部术语，无动作）。

### 改法
| 位置 | 原 | 现 |
|---|---|---|
| `classifyGhError` 兜底 | hint 为空 | 「已按退避自动重试；持续出现就跑 watch_doctor 看检查清单，或把这行贴给对方」 |
| 解析失败 | `bad json` | 「返回内容不是合法 JSON（可能是代理干扰）—— 已自动重试；持续出现请跑 watch_doctor」 |
| 结构不对 | `unexpected payload` | 「返回的数据结构不对（预期是数组）—— 已自动重试；持续出现请跑 watch_doctor」 |

### 测试
- 新增 1 例：7 个样本（含兜底）都必须有非空 hint 与非空 short；兜底要匹配 `watch_doctor|重试`。合计 **190 例**。

## [0.9.61] - 2026-11-02 —— 把客户不认识的行业词换掉（3 处）+ 术语表补 3 条

### 学到的（知识库第 103 条）
curse of knowledge：写的人知道 `worktree` / `ack` / "回音"指什么，客户不知道。

### 改动
| 原 | 现 | 为什么 |
|---|---|---|
| 一次性 **worktree** | 一个**临时副本** | git 术语，客户不需要知道实现 |
| 被叫醒后**没有回音** | 被叫醒后**没有动作**（没看到 `watch_ack` 标签） | "回音"是比喻；"没有动作"是可观察的事实 |
| 术语表缺「上限」 | 两种上限（单守 6 / 会话 12）+ **和 GitHub 限流不是一回事** | 最容易误解的歧义词 |

术语表另补「没有动作」「临时副本」，用例锁死这 5 个词必须在里面。

### 测试
- 新增 1 例。合计 **189 例**；面板文案快照 129 行（最长 77 字符、超 80 字符 0 条）。

## [0.9.60] - 2026-11-02 —— 测试漏掉的临时目录：本机攒了 1654 个

### 发现（实测，不是猜）
```
临时目录残留: 1654
一次测试后新残留: 8（superagent-routes-* / zhuli-acct-* / zhuli-fmt-* …）
```
根因：测试里到处 `mkdtempSync(join(tmpdir(), …))`，有的删了有的没删，
还有的在模块顶层创建（失败时走不到清理）。

### 改法
1. `test/fixtures/tmpdir.mjs`：`tempDir()` 建目录并登记，进程退出统一删除；
2. 9 个测试文件全部改用它 —— `mkdtempSync(join(tmpdir()` 出现次数 **0**；
3. `scripts/clean-tmp.mjs` 清历史残留（支持 `--dry`）；
4. `preflight` 新增「临时目录收口」：还有测试自己建临时目录就红。

### 效果
清理后残留 **0**；改造后跑一次测试残留 **0**（原 8）；188 例全过。

## [0.9.59] - 2026-11-02 —— 把唯一会走网络的单测改成离线（消除偶发红）

### 发现
`/update` 那条用例会真的去请求 `registry.npmjs.org` —— 本小时它就让 `node --test` 偶发红一次
（`176/177` 之类），重跑又绿。**门禁偶发红比不绿更糟：会让人开始怀疑门禁。**

### 改法
- `checkUpdate` 增加离线开关：`DSH_SUPERAGENT_UPDATE_OFFLINE=1` 时跳过网络、只回 current + 命令模板；
- 该用例显式打开开关 —— 从此不受 npm registry 抖动影响。

### 验证
连跑 3 次 `node --test`：`187/187` ×3。

## [0.9.58] - 2026-11-02 —— 文案长度改成预算制：超过 80 字符的最多 3 条

### 学到的（知识库第 100 条）
一刀切的行宽在真实文案里会误伤；**预算制**（允许少量例外）才既挡趋势又不逼着把话说半截。
（同 performance budget 思路）

### 做法
`render-panel-copy.mjs --check` 现在同时报统计并执行上限：
```
PASS 面板文案与当前实现一致（129 行；最长 77 字符；超过 80 字符的 0 条（上限 3））
```

### 验证（不是"应该有效"）
把阈值调到 `-1`：
```
$ node scripts/render-panel-copy.mjs --check --limit -1
FAIL 最长 77 字符；超过 80 字符的 0 条（上限 -1）
$ echo $?
1
```
恢复正常阈值 → 0。

### 当前数据
104 条面板文案 / 最长 77 字符 / 超 80 字符 **0 条**。

## [0.9.57] - 2026-11-02 —— 对着全文抽检文案：最长 10 条里两处真问题

### 学到的（知识库第 99 条）
错误信息三原则里最容易破的一条：**别让用户猜主语**。

### 抓到两处
1. **占位符没填**（真 bug）：`accessNoteForPanel(access)` 拿不到仓库名，
   输出"你对 **这个仓库** 只有读权限" —— 读着像半成品。
   改成传 `watcher.repo`：`你对 acme/widgets 只有读权限：…`；用例锁死不许再出现"你对 这个仓库"。
2. **按钮旁边还教一遍**：没回音那行右侧本来就有「看建议规则」，正文又写"检查 AGENTS.md"，
   72 字重复。改成说清后果：`连续 2 次被叫醒后没有回音 —— 会话可能没按规则处理`（55 字）。

### 判据（写进 KB）
1. 主语必须具体（不许"这个仓库""它"）；
2. 旁边有按钮时，正文不重复动作；
3. 单条 ≤ 80 字符。

### 测试
- 新增 1 例。合计 **187 例**；面板文案快照 129 行已刷新。

## [0.9.56] - 2026-11-02 —— README 被自己清空过一次（已恢复；原因记进知识库）

### 事件
把 README 版本号从 0.9.54 更新到 0.9.55 时写成了一行链式调用：

```python
io.open('README.md','w').write(io.open('README.md').read().replace(...))
```

外层 `open(...,'w')` **先**执行并截断文件，内层读到空串 —— **208 行变 0 行**。

### 怎么发现的
门禁同时红三条，其中 `badge undefined` 最先露馅（连版本徽章那行都没了，不只是数字没更新）：
```
FAIL README 徽章版本 = package.json 版本
FAIL README 单测数    README 没写单测数
FAIL 版本一致（4 处）  … badge undefined …
```

### 恢复
`git show HEAD:README.md > README.md` —— 上一版刚提交过，零损失。
**这就是"每轮都 commit"的实际价值：任何时刻都有回退点。**

### 本轮同时交付
面板文案快照（`docs/面板文案.md`，129 行）+ 面板渲染桩抽成共享模块
`test/fixtures/panel-harness.mjs`（测试与快照脚本共用，避免两份实现漂移）。

## [0.9.55] - 2026-11-02 —— 面板文案也有快照了（129 行）

### 学到的（知识库第 74 条延伸）
唤醒消息早有文案快照，但**面板上那几十条提示**一直是"改了也没人看见"。

### 做了什么
1. 把面板渲染桩抽成 `test/fixtures/panel-harness.mjs`（测试与快照脚本共用，避免两份实现漂移）；
2. `scripts/render-panel-copy.mjs`：用同一套桩渲染四个 tab，抽出可见文字 → `docs/面板文案.md`（129 行）；
3. `--write` / `--check`；`--check` 进 preflight 第 25 项。

### 覆盖内容
`总览 40 条 / 判定 / 触发 / 设置` 四页的全部可见文字（含空态、暂停原因、权限提示、诊断按钮）。

### 顺带
`docs/验收清单.md` 新增一行解释（面板文案快照防什么），所以它自己也是被校验的。

## [0.9.54] - 2026-11-02 —— 演练脚本补上失败路径与"不唤醒"

### 学到的（知识库第 73 条继续追加）
客户最常问"为什么没动静"，答案有三种：网络抖动、被限流、会话正忙。
**这三种以前一条都没演示过。**

### 做了什么
`first-run.mjs` 第 5b 段打印三者的**面板文案与建议**，数据来自真实函数：
`classifyGhError`（network / ratelimit / notfound）与 `decideWake`（agent busy → 不唤醒）。

```
kind=network　面板显示：GitHub API 请求: EOF　建议：（网络抖动：已按退避自动重试，不需要手动处理）
kind=ratelimit　面板显示：HTTP 403: API rate limit exceeded…
· 会话正忙（不在 idle）→ 不唤醒：{"ok":false,"reason":"agent busy (running)"}
```

纳入文案快照（50 → 62 行）；单行长度仍 ≤ 120。

### 为什么关键
演示里的字符串**不是手写的示例** —— 与真实代码同源。文案一改，快照就变。

## [0.9.53] - 2026-11-02 —— 演练脚本补上"有跳过"分支（那个 bug 藏了两小时的原因）

### 学到的（知识库第 73 条追加）
演练脚本如果只跑主路径，它就只是"主路径回放"，不是演练。

### 做了什么
`first-run.mjs` 新增第 3b 段：用真实过滤数据（已关闭 × 2、机器人 × 1、已 ack × 1）演示
"有跳过时的同一条消息"，并纳入文案快照（47 → 50 行）。

```
【为什么是这几条】本轮共 7 条变化；按「最近更新」取前 2 条；本轮跳过 4 条（已关闭 × 2、机器人 × 1、已 ack × 1）
```

### 为什么值得
0.9.52 修的那个"累计冒充本轮"的 bug 之所以藏了很久，就是因为这行**从来没被演练出来过**。

## [0.9.52] - 2026-11-02 —— "跳过"那一行原来是累计值，而且不报总数

### 发现（两个都是真的）
1. **累计冒充本轮**：`filterCounts` 从创建守起一直累加，而唤醒消息写的是"同时跳过 …"，
   读起来像本轮 —— 跑一上午之后这条数字会大得离谱；
2. **只报原因不报总数**：只列前 3 个原因，`已 ack × 1` 这种被截掉的完全看不见，
   读者会以为"就跳过了这几条"。

### 改法
- 每轮开始重置 `filterCounts`（语义改成"本轮"）；
- 消息里改成 `本轮跳过 9 条（已关闭 × 5、机器人 × 2、草稿 PR × 1 等）` —— 有总数、有前三个原因、有"等"。

### 测试
- 新增 1 例（总数 = 9、前三个原因都在、第四个不列、标"等"、没有跳过时不出现该行）。合计 **185 例**。

## [0.9.51] - 2026-11-02 —— 验收清单的证据本身也被校验（抓到 4 条假引用）

### 学到的（知识库第 96 条追加）
「可解释」升级成「解释本身也被验证」—— 否则证据栏会变成写空话的地方。

### 做法
`render-acceptance.mjs` 的 `WHY` 表现在要过两道检查：
- `KB \`xxx.md\`` 必须存在于 `docs/kb/`；
- `CHANGELOG x.y.z` 必须真有这个版本。

### 第一次跑就抓到 4 条
`profile-link.md` / `version-skew.md` / `route-resilience.md` / `design-tokens` ——
**全是我凭记忆写的文件名**，一个都不存在。换成真实条目（`limits-must-track-code.md` 等）后 PASS。

验证：临时把一条证据改成 `nonexistent.md` →
`FAIL 文案快照 → 知识库没有 docs/kb/nonexistent.md`，还原后 PASS。

## [0.9.50] - 2026-11-02 —— 验收清单：每项门禁都能解释"防什么"

### 学到的（知识库第 96 条）
不可解释的门禁等于没有门禁 —— 红了没人知道该不该急。

### 做了什么
`scripts/render-acceptance.mjs` 生成 `docs/验收清单.md`（23 行）：
每一项 preflight 检查配一行"防止什么 + 证据（真实事故或 KB 条目）"。
**每个 `record(...)` 都必须在 `WHY` 表里有解释**，否则 `--check` 直接 FAIL。

### 一次自我指涉
接进 preflight 后它立刻红：`FAIL 这些检查没有解释：验收清单` ——
**新加的检查自己没写解释**。补上后 21 项全绿。
判据生效的样子就是这样：任何门禁都不能例外，包括守门禁的那条。

## [0.9.49] - 2026-11-02 —— 条件断言普查：15 个测试文件里抓到 1 处真的

### 学到的（知识库第 95 条）
这类 smell 没有可靠静态规则（两分支都断言是正常的），工具只能**列出来给人看**。

### 脚本
`scripts/audit-conditional-asserts.mjs` 扫三类形态：`if(){…assert…}` 多行、`if(…) assert` 单行、
`if(…)` 换行后无花括号。**故意不接进 preflight** —— 正常分支也会被列出，接成门禁只会制造噪音。

### 普查结果（15 个测试文件，2 处）
| 位置 | 判定 |
|---|---|
| `meta.test.mjs:66` | 正常（while 里的转义分支，断言在循环外） |
| `watch.test.mjs:405` | **真问题**：`if (hintPart) assert…` —— 'other' 那一档等于没检查 |

修法：两分支都断言（`hintPart` 为空时断言 hint 必须为空）。77 例仍全过，但那一档从"没检查"变成"必须不给提示"。

## [0.9.48] - 2026-11-02 —— 契约从测试目录搬进文档：`docs/json-契约.md`

### 学到的（延续知识库第 93 条）
契约要出现在**客户看得见的地方**，不能只躺在 `test/fixtures/` 里。

### 做了什么
1. 清单补上 `watch_trace.results[]` 的结构（含 `filtered[]` / `wakes[]` 的子字段）；
2. `scripts/render-contract.mjs` 把清单渲染成 `docs/json-契约.md`（149 行，含每个字段的稳定性）；
3. `--write` / `--check` 两种模式；`--check` 进 preflight 第 20 项 —— 清单改了没重新生成就红；
4. README「工具输出」小节指向这份文档。

### 一个"假通过"被自己抓住
`results[]` 的断言原本写成 `if (results.length > 0) {...}` —— 空数组时整段被跳过，
**等于永远通过**。改成先断言"必须非空"（并在测试里造痕迹），断到真的执行。

### 测试
- 契约用例仍 2 例，但 `results[]` 分支现在真的跑；preflight 20 项全绿。

## [0.9.47] - 2026-11-02 —— 字段稳定性清单：哪个字段可以被依赖

### 学到的（知识库第 93 条）
`schemaVersion` 只说"什么时候算破坏性变更"，不回答**哪个字段**是承诺。
参考 Kubernetes 的 stable / beta / alpha，我们缩成 `stable` / `experimental` 两档。

### 做法
`test/fixtures/contract-stability.json` 作为唯一口径；配套用例：
1. 实测 JSON 的字段集合必须与清单**完全一致**（新增字段不登记就红）；
2. 级别只能是 stable / experimental，且至少一个 stable（防清单自我腐烂）。

### 第一次跑就红两次（都是"我以为我记得返回值"）
- `watch_stop` 实际返回 `{schemaVersion, ok, id, repo}` —— 漏登记 `repo`；
- `watch_ack` 失败时形状不同（`{schemaVersion, ok, repo, acked, failed}`）—— 用例改成两种都接受。

### 测试
- 新增 2 例；合计 **184 例**。

## [0.9.46] - 2026-11-02 —— 写工具也给 JSON：成功与否不再靠读中文

### 学到的（延续知识库第 91 条）
只读工具有了 `format=json`，但**写工具**仍返回自然语言：
`acked o/r #12 with label …` / `stopped o/r#s` —— agent 判断成功与否只能读中文，改一次措辞就误判。

### 改法
`watch_start` / `watch_stop` / `watch_ack` 补上 `format: 'json'`：
| 场景 | JSON |
|---|---|
| start 成功 | `{ schemaVersion, ok: true, repo, id, intervalSec, flags, updated }` |
| stop 成功 | `{ schemaVersion, ok: true, id }` |
| ack 成功 | `{ schemaVersion, ok: true, repo, label, acked, at }` |
| 失败 | `{ schemaVersion, ok: false, error }` |

文本形态**保持不变**（老调用方不受影响），顺序是"先判断 json，再拼文本"。

### 测试
- 新增 1 例（start 新建/更新、stop 成功/不存在、默认仍返回文本）。合计 **182 例**。

## [0.9.45] - 2026-11-02 —— README 写着 136 项单测，实际 181（现在会自动报错）

### 学到的（知识库第 92 条）
散文里的数字最容易过期：结构性内容有人维护，顺带提的数字没人看。

### 发现
README「开发」小节写着 `node --test  # 136 项单测` —— 实际 **181 项**，
跨了四十多个版本没人发现（谁加用例都不会想起改 README 注释）。

### 改法
`preflight` 跑完 `node --test` 后顺手比对 README 里的数字：
```
FAIL README 单测数    README 写 136，实际 181（改 README）
```
改成 181 后 → `PASS README 单测数　README 写 181，实际 181`。

顺带把这个数字同时当作"用例数只增不减"的哨兵：数字变小也会立刻暴露。

### 顺带补的对外契约
README 新增「工具输出」小节：三个只读工具的 `format: 'json'` 形态与 `schemaVersion: 1`；
`docs/规则对照表.md` 加一行（协议类约定也进对照表）。

## [0.9.44] - 2026-11-02 —— 三个只读工具口径统一：都支持 `format=json` + `schemaVersion`

### 做了什么
- `watch_doctor` 与 `watch_trace` 补上 `format` 参数（与 0.9.43 的 `watch_status` 一致）；
- 三者统一带 `schemaVersion: 1`；
- **错误也走 JSON**（`{ schemaVersion, error }`）—— 消费方不用在两种格式间猜；
- `watch_doctor` 的 JSON 从同一份文本行解析（`OK/WARN/FAIL/INFO`），单一来源。

### 踩到的两个坑
1. 用 `rfind` + 精确字符串匹配去插代码，连续两次 `anchor missing`（CRLF 与转义细节）——
   最后改成**按索引插入**才稳定；每次生成后都 `node --check`。
2. 空态没带 `schemaVersion`（`{session:null,watchers:[]}`），被新用例当场抓到。

### 测试
- 新增 1 例（三工具参数 + status/doctor 可解析 + trace 错误态 JSON + 建守后 results）。合计 **181 例**。

## [0.9.43] - 2026-11-02 —— `watch_status` 支持 `format=json`（同一份数据两种渲染）

### 学到的（知识库第 91 条）
CLI 的通用形态：**默认给人看，`--json` 给机器**（gh / kubectl -o json 都这样）。

### 之前的风险
`watch_status` 只返回拼接字符串，agent 靠子串解析 —— **我们改一次措辞，agent 的解析就静默失效**。

### 改法
1. 纯函数 `statusView(entries)` 产出结构（session + watchers 全字段）；
2. 工具加 `format` 参数：`text`（默认）/ `json`；
3. **文本由结构渲染**，所以两者永远一致（不是两份实现）。

### 测试
- 新增 2 例（结构 7 项断言 + 空输入；工具 json 可解析、默认仍是文本）。合计 **180 例**。

## [0.9.42] - 2026-11-02 —— `watch_status` 带上诊断字段，agent 能自诊

### 学到的（知识库第 90 条）
可观测性对 agent 同样重要：机器能查的，别让人截屏。

### 缺口
| 信息 | 面板 | watch_status（改前） |
|---|---|---|
| 为什么暂停（`deferReason`） | ✅ | ❌ |
| 叫醒后没回音几次（`silentWakes`） | ✅ | ❌ |
| 会话用量 / 上限 / 建议值 | ✅ | ❌ |

### 改法
每条守多输出 `defer=<原因码>` `silent=N`，末尾加会话汇总行：
```
session: 12/12 wakes last hour，2 条守正因上限暂停，建议把会话上限调到 24
```

### 一个自己挖的坑
用模板字符串生成代码时 `'
'` 被写成真实换行，`node --check` 立刻报错。
**用脚本生成代码，生成后要马上 `node --check`。**

### 测试
- 新增 1 例（三个诊断字段 + 汇总行格式）。合计 **178 例**。

## [0.9.41] - 2026-11-02 —— `watch_start` 补齐面板已有的三项参数

### 学到的（知识库第 89 条）
工具能做的要和面板能做的对齐，否则用户会以为其中一个是残的。

### 具体缺口
| 配置 | 面板 | watch_start（改前） |
|---|---|---|
| 整条会话每小时上限 | ✅ | ❌ |
| 隔离区保留天数 | ✅ | ❌ |
| 最多留几个隔离区 | ✅ | ❌ |

客户说"把隔离区最多留 3 个"，agent 只能答"你去面板点一下" —— 一句话能完成的事变成了手动操作。

### 改法
补三个参数，**夹紧范围与面板完全一致**（1-60 / 1-30 / 1-50），描述里写清默认值。

### 一个实现细节
工具参数在 `tool.parameters.properties`（JSON Schema），不是 `tool.parameters[key]` ——
第一条断言写错路径导致"缺参数"假警报。

### 测试
- 新增 1 例（参数存在 + 真的写入状态 24/7/3）。合计 **177 例**。

## [0.9.40] - 2026-11-02 —— 规则对照表：同一条规则不能只在一边

### 学到的（知识库第 88 条）
把"文案一致性"从一次性检查变成**可维护的对照表**：改一边就知道另一边要跟着改。

### 做了什么
新增 `docs/规则对照表.md`：把唤醒消息里的 10 条硬规则逐条列出，
标明它在消息/面板/文档里分别出现在哪，并标注缺口。

### 核对出的缺口（已补）
| 规则 | 原来 |
|---|---|
| 不做也要说明理由并 ack | 只在消息里 |
| **不要扩大范围**（只处理列出的那几条） | 只在消息里 → 面板空态补上 |
| 隔离区用完会回收 | 面板只说"每次唤醒开一次性 worktree" → 补"在副本里改，用完会自动回收" |

### 测试
- 一致性用例补三条断言（不会扩大范围 / 自动回收）；渲染"触发"页验证隔离说明。合计 **176 例**。

## [0.9.39] - 2026-11-02 —— 面板补上「叫醒之后会发生什么」

### 学到的（知识库第 87 条）
同一套规则、两个读者：文案可以不同，**规则必须一致**。

### 比对结果
| 位置 | 原来说了什么 |
|---|---|
| 唤醒消息 | 接下来 1/2/3：读 AGENTS.md → 修/回/待定 → 写回 + `watch_ack` |
| 面板 | 只说"会被叫醒"和"点立刻/看需要关注"，**完全没提叫醒之后的三步** |

客户因此不知道"不做也要 ack"这条 —— 而这正是 0.9.11「叫醒了没回音」要治的病。

### 改法
面板空态提示补一句（人的视角，规则不变）：
> 叫醒之后：会话先读仓库 AGENTS.md → 决定「修 / 回 / 待定」→ 做完写回并 watch_ack 打标签；不做也要说明理由并 ack。

用例锁死三件事都在面板出现：`AGENTS.md` / `修 / 回 / 待定` / `watch_ack`。

## [0.9.38] - 2026-11-02 —— 全 docs/ 一致性体检（并删掉一条假警报太多的检查）

### 学到的（知识库第 86 条）
静态检查最怕的不是查不出，而是**假警报** —— 假警报一多，人就学会无视工具，门禁等于失效。

### 本轮我自己制造的三次假警报
| 检查 | 假警报 | 真因 |
|---|---|---|
| 路由存在性 | `~/.dsh/state/session-superagent/watchers.json` 被当成路由 | 文件路径与路由同形，要排除 `state/` 与 `.json` |
| 字段存在性 | `button` / `loading` / `glossary` 被判"lib 里没有" | 这些是**面板**的 React 概念，判据选错了层 |
| 路径存在性 | `lib/client.js` 被判不存在 | 那份文档描述的是**官方仓库**的文件 |

### 最终留下的四条硬检查（17 份文档）
```
PASS 工具名都对得上
PASS 路由都对得上
PASS 版本号都对得上
PASS 文件路径都对得上
```
字段检查**直接删掉**：无法区分组件名与服务端字段，假警报率太高 —— 宁可少一条检查，也不让门禁不可信。

### 门禁
`preflight --fast` 第 **18** 项：`PASS 全库文档一致　17 份文档的工具/路由/版本/路径都对得上`。

## [0.9.37] - 2026-11-02 —— 唤醒消息单行 ≤ 120 字符（按字符算，不是字节）

### 学到的（知识库第 85 条）
中英混排下**一个汉字 = 3 字节**；用字节数判断"这行多长"会高估 2~3 倍。
第一次测量就掉进坑里：`awk length` 报 128，按字符数实际只有 102 ——
**差点去修一个不存在的问题**。

### 做了什么
1. `scripts/audit-line-length.mjs`：用 `[...line].length` 算字符数，上限 120；
2. `formatWatchText` 加保护性规则：单行 > 120 就把补充信息折到下一行；
3. 顺带把消息末尾那段 260 字节的"墙"（接下来 1/2/3）改成分行编号。

### 实测
```
检查 48 行 / 最长一行 102 字符 / PASS 全部 ≤ 120
```

### 门禁
`preflight --fast` 第 17 项：`PASS 单行长度　最长 102 字符（上限 120）`；文案快照同步（44 → 47 行）。

## [0.9.36] - 2026-11-02 —— 信息密度体检：首屏区块数 ≤ 6 且写进判据

### 学到的（知识库第 84 条）
把"信息密度"从感觉变成**可执行的数字**：默认展开的区块数 ≤ 6。

### 体检脚本
`scripts/audit-density.mjs` 静态解析 `client.js`，数每个 tab 里 `h(Section, …)` 的个数。

### 抓到的两处并修掉
1. **judge 页有两个都叫「追溯一条」的区块**（上一轮为"有编号/无编号"写了两个分支，各返回一个 Section）
   → 合并成一个，内部按是否有编号分岔；
2. **trigger 页 7 个区块**超过上限 → 把「诊断」并进「版本与更新」（同属排查/维护）。

修完：**最密集一页 6 个区块**，正好压在上限内。

### 门禁
`preflight --fast` 第 **16** 项：`PASS 信息密度　最密集一页 6 个区块（上限 6）`。

## [0.9.35] - 2026-11-02 —— 「今天明显比平时忙」：阈值故意定高

### 学到的（知识库第 83 条）
用历史影响判断时，阈值要故意定高 —— 告警疲劳的代价远大于少提示一次。

### 规则（`busierThanUsual`）
| 条件 | 结论 |
|---|---|
| 历史不足 3 天 / 日均 0 | 不提示（没有基线） |
| 今天 < 日均 × 2 | 不提示 |
| 今天 ≥ 日均 × 2 | 「今天明显比平时忙 —— 上限可能不够用」 |

阈值下限写死 1.5 倍（调用方传更小也不会更低）。

### 判断放在服务端
`/state` 回传 `busy: true/false`，面板只显示 —— 与 0.9.21 一致：**面板不再实现第二份判断逻辑**。

### 为什么宁可不提示
真积压已有更硬的信号（`sessionUsage.capped > 0`）；历史基线是用来**发现异常**，不是制造焦虑。

### 测试
- 新增 2 例（阈值 6 种情况；面板 busy=false 不提示 / true 提示且给原因）。合计 **175 例**。

## [0.9.34] - 2026-11-02 —— 留一份「每天一个数」的极小历史

### 学到的（知识库第 82 条）
只看瞬时值会放大偶发尖峰；基线要按天聚合，但**不必**是完整日志。

### 改法
`bumpDailyWakes(daily, atIso, keepDays = 7)`：key 是 `YYYY-MM-DD`，同日累加，只留最近 7 天（**几十字节**）。
`dailySummary()` → `{ days, total, avg }`，面板显示：
> 过去 3 天：共 9 次（日均 3）

### 为什么不做更细
每小时 × 7 天 = 168 个数字，收益低；`events`（最近 20 条）已经回答"刚才发生了什么"，
`daily` 只回答"最近忙不忙"，两者职责不同。

### 诚实说明
**建议逻辑仍只看当前一小时** —— 历史目前只用于展示。用它改建议需要更多真实数据验证，
现在改了反而可能误导。

### 测试
- 新增 2 例（同日累加 / 只留 7 天 / 坏日期 / summary；面板显示历史）。合计 **173 例**。

## [0.9.33] - 2026-11-02 —— 到上限时给出具体数字，而不是"把上限调大"

### 学到的（知识库第 81 条）
错误信息要给**可执行动作**："调大"是方向，"调到 24"才是动作。

### 规则（`suggestSessionCap`）
| 情况 | 建议 |
|---|---|
| 没用满 | 不给（不打扰） |
| 用满、无守被挡 | `cap × 1.5`（12 → 18） |
| 用满、有守被挡 | `cap × 2`（12 → 24） |
| 超过 60 | 封顶 |

面板文案：
> 已到上限：新条目会攒到下一小时；**建议把「这条会话每小时最多被唤醒」调到 24**

### 数字从哪来
离线模拟：3 个活跃仓库每小时约 30 条变化，上限 12 只处理 40%；要全部处理需约 30 次/小时。
翻倍到 24 已覆盖八成 —— 再高就该考虑减少仓库数量了（说明上限不是无止境的解）。

### 测试
- 新增 1 例（5 种情况）；面板用例改成断言必须出现"调到 24"。合计 **171 例**。

## [0.9.32] - 2026-11-02 —— 文档标识符门禁 + README 补全三层限制

### 学到的（知识库第 80 条）
文档里的标识符（工具名、路由）会漂移，能自动查的那一半先查掉。

### 新增：`scripts/audit-claims-consistency.mjs`
从 `lib/index.js` 抽真实工具名与路由，扫 5 份文档里提到的同名标识符，对不上就 FAIL。
```
工具 6 个：watch_ack watch_trace watch_doctor watch_start watch_status watch_stop
路由 9 条
PASS 文档里提到的工具名都真实存在
PASS 文档里提到的路由都真实存在
```
**这次没抓到漂移** —— 说明最近的重构都同步改了文档。门禁的价值是"以后忘改会红"。

### 顺手补的真缺口
README 原来只写「会话级 12 次/小时」，**漏了单守 6 次/小时与冷却期 3 分钟** ——
客户看到"6 次"会以为是会话级。现在三层并列写清（数字与代码常量一致）。

### 门禁
`preflight --fast` 第 **15** 项：`PASS 文档标识符　6 个工具 / 9 条路由都对得上`。

## [0.9.31] - 2026-11-02 —— 面板也能追溯了（`/trace` 路由，路由面 8 → 9）

### 做了什么
- 新增 `GET /session-superagent/trace?repo=&number=`：返回结论 + 水位 + 上次上报 + 过滤原因 + 唤醒历史；
- 面板「判定」页新增「追溯一条」：在右上角搜索框输入编号（如 `42`），点「追溯 #42」把结论显示在提示区。

### 为什么走服务端而不是在客户端再算一遍
客户端本地算需要 `seen` / `lastReported` —— 那是**大字段**，而既有用例明确要求
`/state` 不回传服务端自己用的字段（面板每 5 秒拉一次，省的是真流量）。
所以走 `/trace`，按需请求、只回传结论。**同时避免了第三份重复实现**（服务端有 `itemTrace`，客户端不需要再有）。

### 连带改动
路由面从 8 条变 9 条：相关用例（跨实例接管 / 撞车重放 / 卸载 / 路由清单）与 preflight 的期望值一并更新。

### 测试
- 新增 1 例（未输入时给提示、输入编号后出现追溯按钮、单守时说明在哪个仓库查）。合计 **170 例**。

## [0.9.30] - 2026-11-02 —— 单条追溯：`watch_trace` 工具 + `trace-item` 脚本

### 学到的（知识库第 78 条）
PostgreSQL 的 `EXPLAIN`：不改变执行，只解释"为什么是这个结果"。

### 之前的状态
同一件事的数据散在三处：`seen[number]`（水位）、`filteredLog`（过滤记录）、`history`（唤醒历史）。
客户问"#42 为什么没叫醒我"，得在脑子里拼 —— 拼错就给错答案。

### 做了什么
`itemTrace(watcher, number)` 拼成一条结论 + 明细：
`被过滤掉了：已关闭` / `已经唤醒过 N 次` / `已记入水位但没唤醒` / `尝试唤醒过 N 次但都没成功` / `还没轮到它`。

两个入口：工具 **`watch_trace`**（agent 直接查）+ 脚本 `node scripts/trace-item.mjs <编号>`
（支持 `--demo` 和 `--state <path>`）。

### 一个真实实现坑
`String(null) === 'null'` 是真值 → `if (!target)` 拦不住 null 入参，用例当场红。先判入参再转字符串。

### 测试
- 新增 1 例（5 种情况）。合计 **169 例**；工具已进契约快照。

## [0.9.29] - 2026-11-02 —— 「多久会叫醒我」现在能算给人看

### 学到的（知识库第 77 条）
延迟要拆成可归因的几段（tail latency 分解的思路），用户才能判断该调哪一头。

### 新增：`scripts/explain-latency.mjs`
用真实函数算出五段耗时并打印成表：
```
① 提交                0 秒        客户动作
② 下一次轮询看到它      1 分 2 秒    最多一个轮询周期 + 抖动 1794 毫秒
③ 冷却期门禁           0 秒        只吸收「自己刚碰过的条目」
④ 活跃时段门禁          0 秒        当前在 09:00-23:00 内
⑤ 频率上限排队          30 分 0 秒    假设这一小时已用完 6 次
```
常见 ≈「一个间隔 + 抖动」；最坏 ≈ 五段叠加（半小时级）。
并明确区分**唤醒延迟**与**失败重试退避**（后者 2→4→8→16 分钟，客户最容易混淆）。

### 它纠正了我的理解
第 ② 段我一开始只算抖动（2 秒），忘了提交时刻相对下一次轮询是随机的 ——
最坏要等满一个周期。跑出来"最常见 1 分 2 秒"和表里对不上，一眼发现。

### README
「一次真实运行长什么样」末尾直接指向这条命令。

## [0.9.28] - 2026-11-02 —— 并发隔离真跑通；隔离区不再污染 `git status`

### 新增：`scripts/verify-concurrency.mjs`（9 步）
两个会话同时对同一仓库开隔离区，改**同一个文件**，各自提交，再尝试合入主线：

```
PASS 两个隔离区并存　zhuli/a + zhuli/b
PASS .dsh-zhuli 不污染 git status　status 干净
PASS 各自改同一文件互不干扰
PASS A 提交不影响 B 的工作区
PASS 两条分支各自独立提交
PASS 先合的能进
PASS 后合的会冲突（同文件同区域）　自动检测为冲突，符合预期
PASS 冲突可中止，仓库回到干净状态
```

### 它发现并修掉的产品问题
隔离区开在仓库内的 `.dsh-zhuli/`，默认是**未跟踪目录** ——
客户一切 `git status` 就看到它，甚至可能顺手 `git add` 进去。
修法：开隔离区前把 `.dsh-zhuli/` 写进 `.git/info/exclude`
（本地、不提交、**不改客户的 .gitignore**）。

### 边界写进 README
两个会话守同一仓库不会互相踩，但**改同一文件同一区域**时后合并的会冲突 —— 这是 git 的语义。

### 门禁
`preflight --fast` 第 **14** 项：`PASS 并发隔离　9 步全部通过`。

## [0.9.27] - 2026-11-02 —— 隔离执行链路在本机真跑通了（9 步）

### 为什么做
唤醒消息里写着"在隔离工作区里改，推分支开 PR"，但这条链路一直只有"读过代码"
和"worktree list 里出现过目录" —— 从没真跑过一遍完整流程。

### 新增：`scripts/verify-isolation.mjs`
在本机临时仓库里真开 worktree、真改文件、真提交、真回收，输出 9 步结论：
```
PASS 临时仓库就绪
PASS 开隔离工作区　<tmp>
epo\.dsh-zhuli\zhuli-demo
PASS 隔离区里能改能提交　d08af28 fix: #42
PASS 主工作区没被污染　README.md 仍是原样
PASS 回收隔离区　1 个 worktree
PASS 回收后分支仍在（remove 不管分支）　zhuli/demo
PASS 显式删分支才真的清掉　zhuli/demo 已删除
PASS 数量线回收最旧的 3 个　wt6,wt7,wt8
PASS 孤儿目录 prune 后不再挂着　1 个 worktree
PASS 隔离链路 9 步全部通过
```

### 它纠正了一个误解
`git worktree remove` **不会**删分支。产品里是显式再跑 `git branch -D` 才清理干净 ——
脚本第一版断言"分支随回收删除"，直接 FAIL，按产品的真实命令序列改写后才通过。
**这就是"读代码以为懂"和"真跑一遍"的差别。**

### 门禁
`preflight --fast` 第 **13** 项：`PASS 隔离链路　9 步全部通过`（1.3 秒）。

## [0.9.26] - 2026-11-02 —— 客户会读到的文字有了快照，改动必须是有意的

### 做法
`scripts/first-run.mjs` 新增两个模式：
- `--write`：把当前输出写成 `docs/示例-唤醒消息.md`（44 行，含唤醒消息原文）；
- `--check`：与快照比对，不一致则退出码 1 并提示"确认没问题后 --write 更新示例"。

实测验证有效（临时把 `【为什么是这几条】` 改成别的字样）：
```
提示 客户会读到的文字有变化：约 1 行不同
exit=1
```

### 为什么做成门禁而不是"提醒"
文案是**客户唯一能读到的产品**。改文案必须是显式决定 ——
一旦快照对不上，就必须在同一轮里跑 `--write` 并看 diff，避免"顺手改了措辞"却没人注意。

### 门禁
`preflight --fast` 第 **12** 项：`PASS 文案快照　示例与当前实现一致（44 行）`

## [0.9.25] - 2026-11-02 —— 首次演练脚本一跑，就抓到唤醒消息里的重复条目

### 新增：`scripts/first-run.mjs`
不需要宿主、不需要 gh，用 `lib/watch.js` 的真实函数把
「轮询 → 挑批 → 唤醒消息 → 面板 → 异常文案」完整跑一遍并打印。
任何人（包括我改文案时）都能直接看到客户会读到什么。

### 它当场抓到的 bug
唤醒消息里同一条出现两次：
```
#77 [open] 修复表头错位 … (PR)
【为什么是这几条】本轮共 3 条变化；按「最近更新」取前 2 条
（另有 1 条：#77，处理完这批再看）   ← 已在上面的列表里
```

根因：剩余写成 `fresh.slice(listed.length)`，而 `batchFresh` 会**按优先级重排**，
切片拿到的是原始顺序的尾巴，里面可能包含已选中的条目。

### 改法
抽出 `splitBatch(fresh, limit, priority)` → `{ listed, rest }`，用**编号差集**算剩余；
产品与演练脚本都改用它。用例锁死：两边加起来等于全部、且不重叠。

### 测试
- 新增 1 例。合计 **168 例**。

## [0.9.24] - 2026-11-02 —— KB 里的文件路径也交叉验证，抓到 1 个真实漂移

### 做法（延续上一条"KB 要能被审计"）
审计脚本再扫一遍 KB 里形如 `scripts/…` / `lib/…` / `docs/…` 的路径，逐个 `existsSync`。

### 实测
```
提到的文件路径    26 个
FAIL 这些路径在仓库里不存在（重构后忘了改 KB）：
  docs/UPDATING.md  <- docs-four-kinds.md
PASS KB 提到的每个文件路径都真实存在（修正后）
```
`UPDATING.md` 真实位置是**仓库根目录**，KB 里多写了 `docs/` 前缀 ——
这种错客户照着找会直接掉进死胡同。

（顺带把自己也修了一遍：审计文档里描述这条错误时又写了一次该路径，导致自检红；改成描述性说法。）

### 门禁
已并入 `preflight --fast` 的「知识库有据」一项，输出改为同时包含 ✅ 与路径两项结论。

## [0.9.23] - 2026-11-02 —— 知识库的 ✅ 现在要能被 CHANGELOG 交叉验证

### 学到的（知识库第 72 条）
只由自己维护的索引一定会漂移。对照 SBOM 的思路：清单要能被**外部数据源**交叉验证。

### 做了什么
`scripts/audit-kb-claims.mjs`：抽 CHANGELOG 的已发布版本 → 扫 KB 里每条 `✅ … x.y.z` →
核对版本是否存在，并检查每篇是否写了「是否已落地」。

实测：
```
知识库文档 71 篇 / CHANGELOG 152 个版本 / ✅ 声明 68 条 / 没写落地状态 0 篇
PASS 所有 ✅ 的版本都能在 CHANGELOG 找到对应发布
```

### 抓到过一次"审计器口径错"
最初要求"✅ 与版本号同行"，三篇早期文档被判成没写状态 —— 它们其实有「是否已落地」，
只是结论是"不做"或"⚠ 部分"。**审计器口径错会给出假警报**，改成按段落判断后归零。

### 已接进门禁
`preflight --fast` 第 **11** 项：`PASS 知识库有据　68 条 ✅ 都能找到发布`。

## [0.9.22] - 2026-11-02 —— 暂停原因可以按原因码筛选

### 背景
0.9.21 让服务端写了结构化的 `deferReason`，但面板还没用它做任何事 —— 只是"数据有了"。

### 改法
「判定」页新增一排「暂停原因」Pill（`撞会话上限 ×2` / `被 GitHub 限流 ×1` …），
点一下只看那一类；**复用已有的 `reasonFilter` 槽位**（零新增 state），
但内部用 `defer:` 前缀与"跳过原因"筛选区分开。

同时把「需要关注」也一起收窄 —— 否则列表只剩一条、上面告警还列着别的仓库，自相矛盾。

### 一个实现顺序问题（被用例抓到）
`DEFER_LABELS` 一开始定义在组件中段，判定页先用到 → `Cannot access before initialization`。
常量要放在**组件最前面**（所有 `useState` 之前），因为它不依赖任何状态。

### 测试
- 新增 1 例（原因码翻成人话 + 选中后明细只剩那一类）。合计 **167 例**。

## [0.9.21] - 2026-11-02 —— 用原因码替代"匹配提示文案"

### 学到的（知识库第 70 条）
把展示层当数据层是反模式。OTel 的 log record 带结构化 attributes，文案只负责给人看。
一旦拿文案当判据，任何一次文案优化都会**静默改变统计数据**。

### 修的是什么
0.9.20 统计"几条守被上限挡住"用的是 `lastDeferred.includes('上限')`：
- 文案一改统计归零；
- "额度紧张（剩余 …）"这类含"上限"但不是频率上限的提示会被误算。

### 改法
服务端在各暂停分支写 `entry.deferReason`（`active-hours` / `ratelimit` / `quota` /
`unchanged` / `observe` / `cap-session` / `cap-watcher` / `busy`），
统计改用 `countCapped()` 只认两种 cap 码；`/state` 也回传 `deferReason`。

### 用例锁住的误判
```js
countCapped([{ lastDeferred: '每小时最多唤醒 6 次' }]) === 0   // 文案有"上限"也不算
```

### 测试
- 新增 2 例（计数语义 + `/state` 契约）。合计 **166 例**。

## [0.9.20] - 2026-11-02 —— 面板显示"还能用几次"（会话唤醒用量）

### 学到的（知识库第 69 条）
Google SRE 四个黄金指标里的 **saturation**：错误和延迟都是事后，**饱和是唯一能提前预警的**。
<https://sre.google/sre-book/monitoring-distributed-systems/#:~:text=Saturation>

### 上一轮模拟给的证据
离线跑一小时：**实际上报 12 / 共 30 条，被会话上限挡住 241 次** ——
默认参数下一半条目在排队，而界面上看不出来。

### 改法
`/state` 新增 `sessionUsage: { used, cap, capped }`（复用 `sessionWakesLastHour`，**零新增请求**）。
面板在「按仓库」旁显示：
- 常态 `本会话近一小时唤醒 3/12`；
- 到顶 `已到上限：新条目会攒到下一小时，可以把「这条会话每小时最多被唤醒」调大` + `2 条守正因上限暂停`。

只写"已到上限"等于把问题丢回客户；带上"把某个字段调大"才是可执行动作。

### 测试
- 新增 2 例（路由契约三字段；面板：没用满不报警 / 用满给建议 / 说清几条被挡）。合计 **164 例**。

## [0.9.19] - 2026-11-02 —— 离线跑一小时：限流/合并/去重没有互相打架

### 学到的（知识库第 68 条）
单点行为能单测，**时间维度**（滑动窗口、冷却、合并、节流）只能压缩时间模拟。
新增 `scripts/simulate-hour.mjs`，用**真实的纯函数**跑事件序列。

### 实测（3 仓库 / 30 秒一轮 / 每仓库每小时 10 条 / 上限 6+12）
```
轮询次数            361
实际唤醒次数        12
被单守上限挡住      0 次
被会话上限挡住      241 次
合并成消息          6 条（含 12 份唤醒）
上报条目数          12 / 共 30
PASS 限流/合并/去重没有互相打架
```

三点被证实：① 会话上限精确压住 12 次，无超额；② 合并真的生效（12 次唤醒 → 6 条消息）；
③ **默认上限对 3 个活跃仓库偏紧** —— 一小时能处理 12 条，剩 18 条等下一小时。
第 3 点不是 bug，但以前没有数字，现在有了，已写进 README「已知限制」。

### 模拟器自身的坑（值得记）
第一版用"相位取模"决定谁轮询：相位 7 秒、间隔 30 秒时**永远不会命中** ——
只有第一个仓库在跑，指标全错。改成"三个守的时刻合并成一条事件序列"才对。
**模拟器本身也是被测对象**：现在脚本会打印每次唤醒（`SIM_DEBUG=1`）。

## [0.9.18] - 2026-11-02 —— 知识库索引重排：66 行扁平表 → 9 个板块

### 学到的（知识库第 67 条）
索引按**问题**分组，别按时间堆。读者是带着"为什么没叫醒我"来的，不是带着版本号来的。

### 重构前（实测）
66 行一张表、14 个标签，其中 `GitHub API 性能` / `状态可靠性` / `限额` 分别是前几组的子集 ——
近义重复让"查资料"变成"读表格"。

### 重构后
9 个板块 + 顶部"板块 → 篇数 → 看点"表；每篇保留「状态」列（✅ 版本 / ⚠️ 未落地），
不会因为重排丢掉"哪些是真做过的"。

### 顺手给索引加门禁
`check-docs.mjs` 原本只查孤儿文档，现在多查一项：**顶部声明的篇数必须等于板块下实际列出的条数**。
重构索引最易出的错就是"表头写 11 篇、下面只列 9 篇"，这种错单看表看不出来。

实测输出：
```
扫描 89 篇 Markdown，86 个内部链接目标
PASS 所有内部链接都能解析
PASS 知识库文档全部被索引
PASS 索引板块篇数与实际条目一致
```

## [0.9.17] - 2026-11-02 —— 抽检扩到六条路径：抓到"同一件事两种说法"

### 学到的（知识库第 66 条）
同语义的两份实现（服务端 + 客户端）会慢慢走偏 —— 本轮有实测证据。

### 抓到的三处
| 路径 | 抽检发现 | 处理 |
|---|---|---|
| ④ 面板接口 500 | 已有"复制诊断 → 重启"的下一步 | ✅ 不动 |
| ⑤ gh 未安装/未登录 | 设置页只有原始错误，且**不进「需要关注」** | ✅ 补人话 + 后果 + 下一步 |
| ⑥ 归档 / 禁用仓库 | **客户端 `repoStructureNote` 少了这两条**（服务端早有） | ✅ 对齐，顺序也统一 |

### 为什么⑥ 会发生
面板不能跨包 import 服务端模块，于是 `repoBadges` / `durationText` / `accessNote` / `repoStructureNote`
各有一份同语义实现。改一边忘另一边，就出现"唤醒消息说已归档、面板什么都不说"。

### 防再走偏
1. 每处重复都要**两端各一条用例**（本轮补了客户端这条）；
2. 改一边时同步 `grep` 另一边；
3. 抽检脚本把面板文案打出来，走查时更容易发现不一致。

### 测试
- 新增 2 例（gh 不可用的文案与后果；归档/禁用必须在面板出现）。合计 **162 例**。

## [0.9.16] - 2026-11-02 —— 可用性抽检：只读仓库没进「需要关注」

### 怎么做的（知识库第 65 条）
写了 `scripts/audit-ux-copy.mjs`，把三条失败路径的**现有文案**直接打出来看，
而不是凭记忆判断：
- ① 仓库没写权限 → 只有行内一个 `只读` 徽章，**「需要关注」里没有** ❌
- ② 会话没规则 → 有原因 + 「看建议规则」✅
- ③ 一直没动静 → 时间线 + 「还没唤醒过…点立刻 / 看需要关注」✅

### 改了什么
补上 `accessNoteForPanel()`（与服务端 `accessNote` 同语义），写进「需要关注」：
> 你对 owner/name 只有读权限：能看、能被叫醒，但没法回写评论或打标签 ——
> 要么换有写权限的 token，要么把结论写在本地/PR 描述里。

客户端独立一份是有意为之（不把服务端依赖带进浏览器包），这已是第三个这样的重复
（`repoBadges` / `durationText` / 本项）—— **每次都要两端各有用例**。

### 测试
- 新增 1 例。合计 **160 例**。

## [0.9.15] - 2026-11-02 —— 「只看有问题的」一键筛掉健康的守

### 学到的（知识库第 64 条）
任何收窄视图的操作都必须有一个**显眼的还原方式**，否则用户会以为"数据没了"。

### 改法
「按仓库」标题旁加 Pill：`只看有问题的 (2)`
- 什么算有问题：有 `lastError` / 未回音 ≥2 / 仓库结构问题 / 警示或危险徽章；
- 数量直接写在 Pill 上；
- 开启时出现「全部」还原；筛选后为空还有一句说明；
- **纯前端筛选，零新增请求**。

### 又一次 useState 槽位的坑（第二次，这次更隐蔽）
按上轮教训追加在最后，但测试里 `[...deskQueue(snapshot), true]` 是靠"追加到末尾"来点亮确认删除的。
新增槽位后那个 `true` 落到 `problemsOnly` 上 → 该行被筛掉 → 用例红。
修法：`deskQueue` 默认值补第 18 个槽（`false`）。
**教训**：位置型测试桩，新增槽位既要追加在代码末尾，**还要同步默认队列长度**。

### 测试
- 新增 1 例。合计 **159 例**。

## [0.9.14] - 2026-11-02 —— 「按仓库」的仓库名可以点了

### 学到的（知识库第 63 条）
概览层的作用是**导航**，不是再显示一遍信息；看起来像可点的就必须可点。

### 问题
0.9.13 的汇总里仓库名是纯文本 —— 像标题、点了没反应，明细还得自己去列表里找。

### 改法
仓库名改成按钮，点一下把 `search` 设成该仓库（再点取消），复用已有搜索过滤：
- **零新增 state**（`search` 已在槽位里）；
- 类名用 `dt-textlink dt-row-name`，**不用 `dt-open`** —— 后者是明细行的展开按钮，
  已有用例按"每行恰好 1 个 dt-open"断言。

### 又一次同一个坑
先用 `dt-open` → 「每行有编辑按钮」用例立刻红（2 !== 1）。
**共用类名导致语义混淆**：`dt-open` 是"展开这一行"，"筛选列表"是另一件事。

### 测试
- 新增 1 例（每仓库一个可点名字 + 搜索命中时明细只剩它）。合计 **158 例**。

## [0.9.13] - 2026-11-02 —— 总览加「按仓库」汇总

### 学到的（知识库第 62 条）
NN/g《Progressive Disclosure》：把细节推迟到第二层，先给概览。
<https://www.nngroup.com/articles/progressive-disclosure/>

### 问题
总览把所有守平铺，守 5 个仓库时客户要一行行读才知道"哪个健康/哪个一直跳过"。仓库越多越像日志。

### 改法
`summarizeByRepo()` 按仓库聚合，总览顶部多一个「按仓库」小节：
状态点 + 仓库名 + 徽章（去重）+ `N 条守（启用 M）` + 最近唤醒 + 未回音 + 报错数。
排序：**报错 > 未回音≥2 > 其它**。

### 两个实现坑（都被用例抓到）
1. **必须跟随筛选**：用 `visible` 而不是 `watchers`，否则"只看只读"时下面的列表空了、上面还列着别的仓库；
2. `repoBadges` 在拆分后的 `gh-format.js` 里，`watch.js` 之前只做了 re-export 没 import ——
   运行时 `repoBadges is not defined`。

### 测试
- 新增 1 例。合计 **157 例**。

## [0.9.12] - 2026-11-02 —— "叫醒了没回音"现在有下一步动作

### 学到的（知识库第 61 条）
AGENTS.md 是"给 agent 看的 README"（<https://agents.md>），要解决的正是"agent 不知道该按什么规则干活"。

### 上一轮的断头路
0.9.11 会提示"检查 AGENTS.md"，但**提示之后没有下一步** —— 客户还得自己想规则该写什么。

### 改法（克制版）
「需要关注」那条提示挂了「看建议规则」按钮，弹层给出可直接粘贴的片段（含"无论做不做都要 ack"）。
**不直接写进客户仓库**：可能覆盖、可能和他们的规范冲突。给可复制的文本，收益 90%、风险 0。

### 一个真实的实现坑
弹层最初用**新加的 useState**，整套用例立刻红 ——
测试桩的 `useState` 是**按位置取队列**的，中间插一个 state 会让后面全部错位。
改成复用已有 `glossary`（`false` 关 / `true` 术语表 / `'rules:owner/name'` 规则弹层），零新增槽位。

### 测试
- 新增 1 例（未点开不渲染 / 点开后出现规则与 ack 要求 / 有复制动作）。合计 **156 例**。

## [0.9.11] - 2026-11-02 —— "叫醒了但没回音"现在看得见了

### 学到的（知识库第 60 条）
RabbitMQ 的 ack 语义：**投递成功不代表处理完成**，消费者必须显式 ack。
<https://www.rabbitmq.com/docs/confirms>

搬过来就是：`wake()` 成功只说明消息进了会话，真正"处理了"的证据是后来出现 `watch_ack`。

### 原盲区
`wakeTimes` 一直在涨、面板显示"唤醒过 N 次"，看起来正常。
但客户真实遇到的是「守在工作、消息也进去了、会话没动手」——
因为仓库 `AGENTS.md` 没给规则。现有指标**完全看不到**。

### 改法
`silentStreak`：上一次唤醒之后有 ack → 清零；没有 → +1；ack 在唤醒之前不算。
连续 ≥2 次时面板「需要关注」提示：
> repo 已连续 3 次唤醒后没有回音（没看到 watch_ack）—— 检查这个仓库的 AGENTS.md

### 测试
- 新增 1 例（6 种情况）。合计 **155 例**。

## [0.9.10] - 2026-11-02 —— 事件带上「持续了多久」

### 补的是上一轮自己记下的缺口
0.9.9 合并时把 `at` 更新成最新时间，**首次发生时间被覆盖** ——
于是 `×10` 看不出是 10 分钟还是 10 小时。

### 改法
每条事件加 `since`（首次发生时间，合并时**不更新**），`at` 仍然更新为最新：

| 字段 | 合并时 |
|---|---|
| `since` | 不变 |
| `at` | 更新 |
| `count` | +1 |

`durationText()` 输出人话：`不到 1 分钟` / `42 分钟` / `2 小时` / `2 小时 5 分`；
面板显示 `cap-watcher ×10 · 持续 42 分钟`。

### 测试
- 新增 1 例（since 不被覆盖 / at 更新 / count 累加 / 四种时长文案 / 缺输入与反向时间）。合计 **154 例**。

## [0.9.9] - 2026-11-02 —— 时间线降噪：连续同类事件合并成一条带次数

### 学到的（知识库第 58 条）
PagerDuty《Alert Grouping》：**同一根因的多次告警要合并**，否则值班的人会被重复信息淹没。
<https://support.pagerduty.com/docs/alert-grouping>

### 问题（0.9.8 我自己留下的）
撞每小时上限时每 60 秒写一条一模一样的 `cap-watcher` —— 一小时 60 条，把 20 条位置占满，
**真正一次性的事件（唤醒、失败）反而被挤掉**。

### 改法
`pushEvent`：与上一条 kind 和文案完全相同 → 不新增，只累加 `count` 并更新时间。
- 不连续就不合并（时序不能被压扁）；
- kind 同文案不同也不合并（会话上限 vs 单守上限要分开看）；
- 合并后仍受 max 限制。

面板显示 `cap-watcher ×10`。

### 测试
- 新增 1 例（连续 10 次→1 条 count=10 / 夹别的事件→3 条 / kind 同文案不同不合并 / 50 条交错仍剩 20）。合计 **153 例**。

## [0.9.8] - 2026-11-02 —— 时间线：回答"为什么这一轮没叫醒我"

### 学到的（知识库第 57 条）
OTel 把一条日志定义成「时间戳 + 主体 + 结构化属性」；日志系统普遍**只留最近 N 条**——
"记录一切"本身会变成新的故障源。
<https://opentelemetry.io/docs/concepts/signals/logs/>

### 问题
原来只有一个 `lastDeferred` 字符串，只描述最后一次，看不出因果。
客户问"我加了标签为什么没叫醒"，我们只能看到屏幕上一句 + 累计计数。

### 改法
`pushEvent(events, {kind, text}, 20)`：有界 20 条，kind 截 24、text 截 160（防脏数据撑大状态）。
打点全在**既有分支**里，不新增逻辑：
`defer`（时段外）/ `ratelimit` / `unchanged`（304）/ `observe` /
`cap-session` / `cap-watcher` / `wake`（带条号）/ `wake-failed`。

面板「判定」页新增「时间线（最近 20 条）」，按类型着色。

### 测试
- 新增 2 例（纯函数有界与裁剪；判定页必须出现时间线与事件内容）。合计 **152 例**。

## [0.9.7] - 2026-11-02 —— 隔离区回收节流：没超额就不必每次唤醒都跑 git

### 学到的（知识库第 56 条）
常规清理按**时间**跑，越界清理**立刻**跑 —— 两者混在一起，最坏就是每次业务请求都跑一遍 gc。

### 问题
`cleanupWorktrees()` 每次唤醒都跑（间隔可短到 30 秒），里面是 `readdir` +
每个过期副本 `worktree remove` + `prune` + `branch -D`。本机实测单次 git 调用 0.19s ——
而绝大多数时候根本没有过期副本。

### 改法（两条线，别只用一条）
| 条件 | 动作 |
|---|---|
| `count > keepCount` 超额 | **立刻跑**（不跑就会堆，违反数量线） |
| 距上次 < 10 分钟 | 跳过 |
| 其它 | 跑（兜底） |

节流状态记在 `entry.lastCleanupAt`，**只在实际执行时更新** ——
"打算跑"不能算数（同 0.9.5 那条教训）。

### 测试
- 新增 1 例（5 种情况）。合计 **150 例**。

## [0.9.6] - 2026-11-02 —— 会话忙时不再白开隔离区

### 学到的（知识库第 55 条）
把"能不能做"的**便宜判断**放在"做"之前。这里的代价不是网络，而是本地 git：
本机实测 `git worktree add` **0.187s**，回收阶段每个过期副本还要 `remove` + `branch -D` 各一次。

### 原来的顺序（浪费）
`pollOnce` 先 `prepareIsolation()`（回收 + 开新副本）再 `wake()`，
而 `wake()` 第一步 `decideWake(agent.status)` —— 会话不是 idle 就直接拒绝。
于是"会话忙"这个常见状态，会白白付出一次完整隔离区开销，开出来的副本还没人用。

### 改了什么
在 `prepareIsolation()` 之前先判一次；忙则写清「这一轮不准备隔离区，下一轮再试」并返回。
省 git 开销，面板原因也更准确（以前只写 `wake failed`）。

### 测试
- 新增 `test/wake-order.test.mjs`：**源码顺序断言** —— 前置判断必须在 `prepareIsolation` 之前，
  且文案含"下一轮再试"。（顺序约束没法用行为测试表达。）合计 **149 例**。

## [0.9.5] - 2026-11-02 —— 修掉 0.9.3 引入的「丢消息」bug

### 学到的（知识库第 54 条）
记账要放在**真的做到**之后，不是"打算做"的时候 —— 把"写日志"当成"写数据"是经典错误。

### 0.9.3 我引入的两个后果
加合并窗口时把记账写在了入队处（`wakeMerged` 只是入队，却返回 `ok:true`）：
1. **丢消息**：`seen` 水位入队时就推进了；3 秒后若会话不是 idle，`decideWake` 拒绝 →
   那几条**永远不会重试**；
2. **虚报次数**：`wakeTimes` 提前记一次，撞上限时会把真正该唤醒的挡掉。

### 改法
记账整体挪进回调，只有 `wake()` 真返回才生效；失败时保留水位等下一轮，
会话忙只写"下一轮重试"、**不进退避**（退避会越拖越久）。

顺带把合并窗口做成可配（`DSH_SUPERAGENT_WAKE_WINDOW_MS`），测试压到 5 ms。

### 测试
- 新增 `test/wake-accounting.test.mjs` 2 例：会话忙必须 `ok:false`；
  idle 时同窗口两条只发一次且内容都在。合计 **148 例**。

## [0.9.4] - 2026-11-02 —— 合并之后去重：三条唤醒从 1065 字砍到 575 字

### 学到的（知识库第 53 条）
合并只是第一步，**去重是第二步**：合并减少了"消息条数"，但重复的样板文字仍占上下文。
（同源：SRE《Handling Overload》的 coalesce 思路。）

### 实测
三条唤醒直接拼接：
```
长度 1065 字符；【完成标准】3 次；goal 行 3 次
```
样板段落每条都一样 —— 合并后纯属噪音，占了近一半长度。

### 改法
`mergeWakeTexts` 拼接前先过一遍：
1. 【完成标准】块内容**完全相同**才只留第一份，不同则各自保留；
2. `本条目主理目标：`行同理。

效果：**1066 → 575 字符（-46%）**，【完成标准】3→1、goal 3→1。

### 测试
- 新增 1 例（相同只留一份 / 不同都要留 / 两仓库内容都在 / 明显短于简单拼接）。合计 **146 例**。

## [0.9.3] - 2026-11-02 —— 同一会话的多条唤醒合并成一条

### 学到的（知识库第 52 条）
Google SRE《Handling Overload》：过载时要**减少工作**（coalesce/shed），不是更快失败。
<https://sre.google/sre-book/handling-overload/>

### 实测出来的形态
同会话 3 个守、间隔 60 秒：
```
首轮相位: 1184 / 2145 / 3106 ms
相邻两次唤醒间隔: 最小 0.96s / 中位 0.96s / 最大 0.96s
```
抖动是**一次性**的 —— 之后每个守按自己的 every 推进，相对相位几乎不变，
所以**每一轮**都会在约 1 秒内连着收到 3 条注入（5 个守就是 5 条）。

### 为什么不用"最小间隔"
先到的守会永远赢，后面的饿死 —— 和"固定窗口让突发者占名额"是同一类错。

### 改法：合并
同会话 **3 秒窗口**内的多条唤醒攒成一条：
```
【主理鱼】这一小段时间内有 3 处变化，合并成一条：
—— 第 1 处 —— … —— 第 2 处 —— …
```
单条不加包装；`decideWake`（是否 idle）在真正发送时再判，比原来更新鲜。

### 测试
- 新增 1 例。合计 **145 例**。

## [0.9.2] - 2026-11-02 —— 会话级唤醒上限：单守上限挡不住"多守叠加"

### 学到的（知识库第 51 条）
K8s `ResourceQuota`：**单个 Pod 的 limits 不能防止 namespace 被打满**，要在上一层再加配额。
<https://kubernetes.io/docs/concepts/policy/resource-quotas/>

### 代码里核实出来的漏洞
`maxWakesPerHour` 记在**每条守**身上（`entry.wakeTimes`）：
```
1 条会话守 5 个仓库 → 实际上限 5 × 6 = 30 次/小时；每次 5 条 → 最多 150 条/小时注进同一会话
```
而设这个上限的原因正是"别把上下文打爆" —— 多守叠加后它完全没起作用。

### 改了什么
新增**会话级上限 `sessionMaxWakes`（默认 12/小时，跨所有守累计）**：
> 这条会话一小时内已被唤醒 8 次（上限 12），已攒 3 条待处理

三层限额：单次批量 5 / 单守 6 / **会话总量 12**。面板可改，`/state` 回传。

### 测试
- 新增 1 例（跨守累加、过期不计、多会话隔离、对象/数组入参、坏数据不崩）。合计 **144 例**。

## [0.9.1] - 2026-11-02 —— 修正「已知限制」：一条是错的，三条缺

### 核对出来的（知识库第 50 条）
把 README 的限制逐条对照代码：

| README 原文 | 实际 |
|---|---|
| 「单会话单仓库」 | **错** —— 守的 id 是 `repo#sessionId`，同一会话可多条 |
| 「`node --test # 136 项单测`」 | 过时（143），且每版都变 |
| 未写「服务端改动要重启」 | **缺**（本机踩得最多的一条） |
| 未写「每小时上限是滑动窗口」 | **缺**（客户会以为整点重置） |
| 未写「隔离区最多 5 个」 | **缺**（这轮才有的行为） |

### 两条做法
1. **限制要写"客户会误判什么"**，不是写"我们实现了什么"；
2. **易变数字（单测条数）不要写进 README** —— 忘改就是谎话，放 CHANGELOG/MAINTENANCE 更合适。

### 顺带
`docs/whats-new-0.9.md` 从"预告"改成"已发布"，补上 0.9 的四项新行为（时段前移、等待可见、
隔离区数量线、错误人话）。文档体检 71 篇 / 68 链接全 PASS。

## [0.9.0] - 2026-11-02 —— 隔离区加"数量线"：最坏 432 个副本 → 最多 5 个

### 学到的（知识库第 49 条）
`git worktree prune` 只清"目录已不在的管理记录"，**不管副本数量**。
清理策略要 **时间线 + 数量线** 双保险，只靠一条会被极端情况绕过。

### 实测与推演
| 场景 | 数字 |
|---|---|
| 合成仓库（3 MB 文件） | 每个 worktree **2.9 MB**（≈ 工作树大小） |
| 6 次/小时 × 保留 3 天 | 最坏 **432 个副本** |
| 按 10 MB/副本估 | ≈ **4 GB** |

### 改了什么
`staleWorktrees` 加数量线：按 mtime 倒序只留最近 `keepCount`（默认 5）个，其余回收；
两条线结果去重，**最近 N 个无论多老都留着**（正在用的那个不能删）。

配置 `entry.maxIsolated`（1–50，默认 5），面板「隔离」区可改，`/state` 回传。

### 测试
- 新增 1 例（4 种情况）。合计 **143 例**。

## [0.8.99] - 2026-11-02 —— 被每小时上限挡住时，告诉你还要等多久

### 先模拟，再看要不要改（知识库第 48 条）
用真实的 `pruneWakeTimes` 跑 6 小时模拟（cap=6/小时）：
```
间隔  30s -> 两次唤醒最大间隔 3480s（58 分钟）
间隔   60s -> 3360s（56 分钟）
间隔  120s -> 3120s（52 分钟）
```
滑动窗口下如果 6 次集中在开头，下一次要等近 1 小时。**这不是 bug**（限额就是限额），
但客户看到「已攒 N 条」却不知道要等多久，很容易以为卡死。

### 改法：不改限额，只让等待可见
`nextWaketimeAt(wakeTimes, cap, now)` 算出下一个名额空出的时刻，提示语变成：
> 每小时最多唤醒 6 次，已攒 3 条待处理（**约 43 分钟后可再唤醒**）

边界：名额没满 → 现在；超过 1 小时的自动剔除；cap 非法按 6 兜底。

### 测试
- 新增 1 例（4 种情况）。合计 **142 例**。

## [0.8.98] - 2026-11-02 —— 时段外不再空打 API（一夜能省 800+ 次）

### 学到的（知识库第 47 条）
Renovate 的 `schedule`：**不在时间窗内就不去查更新**，而不是"查完再决定"。
通用原则：把"不做"的判断尽量前移。
<https://docs.renovatebot.com/configuration-options/#schedule>

### 抓到的浪费
`pollOnce` 里 `activeHours` 的判断原来在**拉完 API 之后**：
```js
const res = await run('gh', ...)            // 先打一次 GitHub
if (!inActiveHours(entry.activeHours)) return  // 才决定不叫醒
```
客户设 `09:00-18:00`，**夜里 14 小时照样每 N 秒打一次**：60 秒间隔 ≈ **一夜 840 次**
（多数是 304 不计额度，但每次都要起 `gh` 进程 + 一次网络往返），且开门后还要等下一个周期。

### 改了什么
1. 时段判断**移到函数最前**（拉数据之前）；
2. 用 `msUntilActiveWindow()` 算出开门时间，把 `nextAt` 设到那一刻。

用例锁死语义：23:30 → 9.5 小时；07:00 → 2 小时；跨夜 15:00 → 7 小时；非法/空 → 0；最小 1 秒。

### 测试
- 新增 1 例（8 种情况）。合计 **141 例**。

## [0.8.97] - 2026-11-02 —— 错误提示要回答"我该做什么"

### 学到的（知识库第 46 条）
NN/g《Error-Message Guidelines》：用平实语言说明问题**并给出建设性解决方案**，不要只显示系统错误码。
<https://www.nngroup.com/articles/error-message-guidelines/>

### 拿真机见过的 12 条错误串去测，只命中 8 条
```
other | （无提示）| error: unable to get local issuer certificate
other | （无提示）| HTTP 502 Bad Gateway
other | （无提示）| repository "o/r" not found
other | （无提示）| context deadline exceeded
```

### 补齐到 12/12
- `notfound`：补 `repository "x" not found` 这类（但不能把 `command not found` 误判进来）；
- `network`：补证书 / `context deadline exceeded` / x509；
- 新增 `gateway`：GitHub 或本地代理短暂故障 —— 这类最容易被误当成"我的仓库有问题"。

### 面板自己的错误也要人话
面板拉自己接口失败**不经过**上面那套，以前直接显示 `Failed to fetch`。
现在：连不上宿主 / 5xx / 404 / 超时 各有对应说明 + 动作（去诊断、重启、或"会自动重试不用管"）。

### 测试
- 新增 2 例（12 种错误的归类与 hint、面板 `Failed to fetch` 必须翻译且提到「诊断」）。合计 **140 例**。

## [0.8.96] - 2026-11-02 —— index.js 量完不拆；顺手加文档体检

### 一、为什么**不**拆 index.js（知识库第 45 条）
用拆 watch.js 的同一套方法量化：
```
基建区 1000 行 / 注册区 796 行
注册区用到的基建名字：25 个（占 46 个定义）
每条路由平均跨度：53 行
```
对比 watch.js 那次是**零依赖单向关系**，这边是 25 个共享符号 ——
拆开等于给每条路由传一大包依赖或造"上帝对象"，复杂度从一维变两维。
它已是"上基建、下注册"的纵向结构，**不拆**。

### 二、顺手加的：文档体检
45+ 篇文档互相引用，写错的链接没人会发现。新增 `scripts/check-docs.mjs`：
- 扫全部 Markdown，只查仓库内相对链接；
- 额外查**孤儿文档**（`docs/kb/*.md` 没被索引 = 客户永远看不到）。

首跑结果：
```
扫描 66 篇 Markdown，63 个内部链接目标
PASS 所有内部链接都能解析
PASS 知识库文档全部被索引
```
都健康 —— 但**这是运气不是保证**。已接入 preflight（第 10 项）。

### 测试
- 138 例全过；preflight **10 项**全过。

## [0.8.95] - 2026-11-02 —— 按「改动轴」拆开 watch.js（883 → 486 行）

### 学到的（知识库第 44 条）
判断该不该拆，看的是「**改一个功能要不要同时读几块不相干的地方**」，不是行数。
`lib/watch.js` 里混着两类东西：**调度与状态**（水位/抖动/退避/时段/合并写）
和 **GitHub 交互与措辞**（错误归类/Retry-After/徽章/提示语/GraphQL 批量），修改动机完全不同。

### 先核对依赖，再动手
脚本统计两块之间的引用：
```
tail 用到的 head 名字：（无）
head 用到的 tail 名字：assignmentNote, commentSummaryLine, linkedPrNote, stalenessNote, stateReasonNote
```
尾部 422 行对前半**零依赖**，只被 `formatWatchText` 用到 5 个函数 —— 这种单向稀疏依赖才适合拆。

### 结果
| 文件 | 行数 | 职责 |
|---|---|---|
| `lib/watch.js` | 883 → **486** | 调度与状态 |
| `lib/gh-format.js` | **430**（新） | 解析/归类/措辞，不发请求、不碰状态 |

`watch.js` 转出 19 个名字，`index.js` 与 8 个测试文件**一行未改**。

### 拆完必须同步的三处（都有专门门禁守着）
1. `sync-profile.mjs` 的 `TARGETS` —— 漏了就是「新文件不进 profile → 插件整体挂不上」，这个坑踩过；
2. `preflight.mjs` 的语法检查列表（现在 6 个文件）；
3. `contract.mjs --update` 确认接口形状未变。

### 测试
- 138 例全过；preflight 9 项全过。

## [0.8.94] - 2026-11-02 —— 面板顶部直接告诉你「该重启了」

### 学到的（知识库第 43 条）
Kubernetes 的 `generation` vs `observedGeneration` 是同一类问题：
**声明的版本**和**控制器实际处理到的版本**要分别暴露，否则"看起来生效了"和"真的生效了"分不清。
<https://kubernetes.io/docs/reference/using-api/api-concepts/#generation-and-observedgeneration>
（我们对应的是「磁盘装好的版本」vs「进程里跑着的版本」。）

### 为什么值得
上一轮 `watch_doctor` 能报版本漂移，但**只有 agent 调 doctor 才看得到**，客户看不到。
而"客户端热重载生效、服务端不生效"正是最容易让人困惑的状态：界面是新样式，功能却没生效。

### 改了什么
- `/state` 新增 `installedVersion`（磁盘）与 `runningVersion`（进程）；
- 两者不一致时，面板**顶部横幅**：
  > 代码已更新到 0.9.0，但宿主还在跑 0.8.4 —— 服务端改动需要重启宿主才生效（客户端部分已生效，所以界面可能看起来是新的）。

### 测试
- 新增 1 例：漂移时必须出现横幅且写出两个版本号；一致时不得出现。合计 **138 例**。

## [0.8.93] - 2026-11-02 —— 让 watch_doctor 自己说出"改了没重启"

### 背景
上一轮的 `verify-live` 是从**外面**看（HTTP）；这一轮让**宿主内部**也能自己发现同一个问题：
`SERVER_VERSION` 是当前进程加载的代码版本，磁盘 `package.json` 是装好的版本 —— 两者不同就是
「文件换了但宿主还在跑老模块」。本机反复出现过这种情况（客户端热重载会生效，服务端不会）。

### 改了什么
`watch_doctor` 的第一行现在是版本检查：
```
WARN 代码已更新但未生效：磁盘 0.8.92 / 正在运行 0.8.93 —— 需要重启宿主（不是重装）
```
一致时输出 `OK 版本一致：0.8.93`。

### 实测
在真机上直接调 doctor（版本故意错开一版），确实输出了上面这行 WARN —— 检查有效。

### 测试
- 新增 1 例：源码里必须有 `installedVersion` 与提示文案；且 `package.json` 与 `SERVER_VERSION` 必须一致。
- 合计 **137 例**。

## [0.8.92] - 2026-11-02 —— 重启之后怎么确认"新代码真的在跑"

### 背景（这轮的核心事实）
线上 `/state` 的 `serverVersion` 是 **0.8.38**，仓库已到 0.8.92。
服务端改动只有重启宿主才生效，所以最近 54 个版本的服务端改进**一次都还没在真机跑过**。

### 改了什么
新增 `scripts/verify-live.mjs`：一条命令逐项 PASS/FAIL。

**重启前在本机实测**：
```
PASS /state 可达          HTTP 200，26ms
FAIL 版本对齐               线上 0.8.38 ≠ 仓库 0.8.91 —— 需要重启宿主（不是重装）
FAIL 响应带 ETag           没有 etag 头：这个版本早于 0.8.85
FAIL 条件请求可用（304）        跳过：没有 ETag
FAIL /diagnose 可用       HTTP 404
PASS /update 可用         current=0.8.38 latest=0.8.90
PASS 守的投影完整             1 条，其中隔离执行 1 条
```
→ **4 项 FAIL**，与"线上跑的是老代码"完全吻合。重启后这四项应翻绿。

新增 `docs/真机验证清单.md`：三条命令 + 三个界面动作，每项都写了"没翻绿怎么处理"。

### 说明
本版不改变运行时行为（新增脚本与文档）；单测 136 例。

## [0.8.91] - 2026-11-02 —— 新客户第一次被叫醒，照着走一遍就行

### 学到的（知识库第 40 条）
Divio Documentation System 把文档分四类：tutorial / how-to / reference / explanation，
**它们的写法互相冲突**，用一个文件全做等于三件都做不好。
<https://docs.divio.com/documentation-system/>

我们原来有 README（reference）、CHANGELOG（开发视角）、`docs/kb`（explanation），
缺最影响首次体验的一类：**tutorial**。客户装完了仍不知道"怎么确认它真的在工作"。

### 改了什么
新增 `docs/首次唤醒走查.md`：7 步，**每步写清"你应该看到什么"和"没看到时看哪里"**：
1. 确认 gh 可用 + token 权限 → 2. 加一条守（先勾仅观察）→ 3. 看它轮询 →
4. 制造一次动静 → 5. 判定页确认被判定到 → 6. 关掉仅观察，真的叫醒一次 →
7. 处理完 `watch_ack` 打标签。

最后附一页速查表（现象 → 先看哪里）。

### 说明
本版只动文档，运行时行为未变。

## [0.8.90] - 2026-11-02 —— 给使用者写一页"0.9 有什么新变化"

### 学到的（知识库第 39 条）
Keep a Changelog 的第一原则是 **"Changelogs are for humans, not machines."** ——
但"人类"也分开发者与使用者；四十段 CHANGELOG 对客户仍然不可读。
<https://keepachangelog.com/en/1.1.0/>

### 改了什么
新增 `docs/whats-new-0.9.md`，四条规则：
1. 只写"你会感觉到"的变化；
2. 每条都是"以前 → 现在"对照，不写内部名词；
3. 每条能点进 `docs/kb/` 看调研与取舍；
4. 结尾必写**这次升级要注意什么**（我们的是"要重启宿主才生效"）。

README 顶部加了入口。

### 说明
本版只动文档，运行时行为未变。

## [0.8.89] - 2026-11-02 —— 「在等」也是一种空态，别让它沉默

### 学到的（知识库第 38 条）
NN/g《Empty-State Interface Design》：空态不只有"新手引导"一种，
还有"内容被过滤""还没开始"等形态，各自需要不同提示。
<https://www.nngroup.com/articles/empty-state-interface-design/>

### 抓到的缺口
面板原来只有两种状态：**一条守都没有**（三步引导）、**有守**（显示列表）。
但最常见的是中间态：**已经有守，但一次都没被唤醒过** —— 这时界面一片安静，客户以为坏了。

### 改了什么
加一句明确的"在等"，并且**指向下一步动作**：
> 还没有唤醒过：守会在仓库出现新条目时叫醒这个会话。想先试一次，点行里的「立刻」；
> 如果一直没动静，看上面「需要关注」里有没有被过滤的记录。

只在"全部守都没唤醒过"时出现，唤醒过就消失，不占版面。

### 顺带
`docs/optimization-plan.md` 的指标表更新到当前状态（新增 17–20 项：中间态、知识库 37 条、
契约快照、挂载冒烟）。

### 测试
- 新增 1 例，合计 **136 例**。

## [0.8.88] - 2026-11-02 —— 契约快照：数量对，形状也要对

### 学到的（知识库第 37 条）
Node 有 Snapshot testing 一节，但本机 `assert.snapshot` 是 `undefined`（`t.assert.snapshot` 属实验 API），
**所以没用它** —— 改用最朴素的「JSON fixture + deepEqual」，即 approval testing。

### 为什么需要
0.8.87 的挂载冒烟只验**数量**（8 路由 / 7 工具）。路由改名、工具少一个参数时，数量仍可能是 8/7，
但客户调用会**全废**。数量和形状是两件事。

### 改了什么
- `scripts/contract.mjs`：假 ctx → 真 `apply()` → 抽出 `{version, inject, tools[{name,params,required}], routes}`；
- `test/fixtures/contract.json` 存快照；`test/contract-shape.test.mjs` 每次 deepEqual；
- 只记**参数名**不记描述文案 —— 改文案不该红。
- 改形状必须 `node scripts/contract.mjs --update` 并在 CHANGELOG 说明。

### 负例验证（重要）
故意把 `github` 的 params 改成只剩 `path` → 测试**立刻红**；`--update` 后恢复绿。

### 当轮修正的一处设计错误
第一版把 `version` 也写进快照 —— 结果每次发版都必须手工 `--update`，纯摩擦。
已移除（版本由 meta 测试守）。**"测试不该逼人做无意义的操作"** 也是设计标准之一。

### 测试
- 新增 1 例，合计 **135 例**。

## [0.8.87] - 2026-11-02 —— 离线挂载冒烟：下次重启前先证明"挂得上去"

### 为什么这轮做这个（知识库第 36 条）
线上 `/state` 的 `serverVersion` 还是 **0.8.38**，仓库已 0.8.87 —— 下次重启会一口气跳 49 个版本。
一次性跨越这么多改动，最该担心的不是某条逻辑，而是**能不能挂上去**：
新增文件没同步进 profile、路由撞车、import 写错，任何一种都会让整块功能消失，
而真机上只表现为「面板空白 / 工具不见了」。

### 改了什么
`scripts/smoke-mount.mjs`：造假 ctx → 真 `import` + `apply(ctx)` → 断言 8 条路由一条不少、工具 > 0、无异常。
```
挂载冒烟 OK：0.8.87，工具 7 个（watch_ack,watch_doctor,github,repo_here,watch_start,watch_status,watch_stop），路由 8 条
```
已接入 `preflight`（第 9 项检查），每次推送前都会守一次。

### 测试
- `preflight --fast` 现在 9 项检查，全绿；单测仍 134 例。

## [0.8.86] - 2026-11-02 —— SSE 可行性量完了：不改（并发现线上落后 47 个版本）

### 学到的（知识库第 35 条）
本机实测 `/state` 回环往返：
```
200: 0.002052s / 0.002166s / 0.002003s（空仓 1815 B）
```
720 次/小时 × 2 ms ≈ **1.44 秒/小时**；0.8.85 之后 ≥99% 已是 304。

改成 SSE 要付出：长连接生命周期、断线重连、与宿主重载的交互（我们被重载坑过两次）、流上鉴权、
多面板连接复用 —— 换来的是每小时 1.44 秒。**收益与复杂度严重不成比例，不做。**

（0.8.84 减字段 + 0.8.85 条件请求已经吃掉 95% 的空间。）

### 顺带发现（重要，已记进 HANDOFF）
线上 `/state` 的 `serverVersion` 是 **0.8.38**，仓库已到 0.8.86 ——
服务端改动只有重启宿主才生效，所以最近几十个版本的服务端改进**都还没在真机跑过**。
按本机铁律重启由用户执行，我只准备核对步骤。

## [0.8.85] - 2026-11-02 —— /state 接上 ETag/304：没变化就不重传

### 学到的（知识库第 34 条）
RFC 9110 §15.4.5：304 响应**不带正文**，客户端沿用本地缓存。
<https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5>

面板每 5 秒拉一次 `/state`，而 99% 的轮询都是"没变化"。上一轮我们减了单次体积（3.8→2.2 KB），
这一轮把**没变化时整份重传**这件事也去掉 —— 照搬我们对 GitHub 用的那套，只是方向反过来。

### 改了什么
1. 服务端对响应体算 SHA-1 前 16 位作为 `ETag`；
2. 客户端把上次的 ETag 放进 `If-None-Match`；
3. 命中回 **304 空响应**，客户端保持现状（不 setState、不重渲染）。

### 踩到的坑
响应体里有 `updatedAt`（每次都变），直接算指纹的话 **ETag 永不命中**。
指纹改为基于 `JSON.stringify({ ...stateBody, updatedAt: undefined })`。

### 测试
- 新增 1 例：200 必须带 ETag、同内容回 304 且无正文、ETag 不匹配必须给完整内容。
- 测试基础设施（`makeReq` / `call`）补了 headers 支持。合计 **134 例**。

## [0.8.84] - 2026-11-02 —— 接口做减法：/state 少传 3 个没人读的字段

### 怎么找出来的（知识库第 33 条）
写脚本把 `/state` 的投影字段逐个在 `client.js` 里数引用：`cooldownMs` / `wakeTimes` / `lastBatch`
**各 0 次**。它们只服务端自己用（`wakeTimes` 用于限流），没必要每次推给界面。

### 数字
| | 一条满载守的体积 |
|---|---|
| 含这三个字段 | **3.8 KB** |
| 去掉 | **2.2 KB** |

单条省 1.6 KB；10 条守省 **16.9 KB / 次**。面板每 5 秒拉一次 → 一小时约 **12 MB** 的无用流量。

### 改了什么
`/state` 不再回传这三个字段（**状态文件里保留**，服务端照旧用）。
新增回归用例：一旦它们回到 `/state` 就红；同时确保在用字段（id/repo/intervalSec/enabled/filters/priority/history）仍在。

### 测试
- 合计 **133 例**。

## [0.8.83] - 2026-11-02 —— CI 红绿：上一轮的顾虑被实测推翻

### 学到的（知识库第 32 条）
上一轮我说"取 CI 状态可能要多一轮查询，先不做"。**实测推翻了这个顾虑**：
把 `statusCheckRollup { state }` 加进**已有的** cross-reference 查询，请求数不变
（拿到 `"statusCheckRollup":{"state":"SUCCESS"}`）。
<https://docs.github.com/en/graphql/reference/objects#pullrequest>

### 改了什么
`·CI 失败`（FAILURE/ERROR）、`·CI 运行中`（PENDING/EXPECTED）叠加进 PR 提示；
**`SUCCESS` 不显示**（绿的不用提，避免噪音）。

### 测试
- 用例扩充（FAILURE/PENDING 显示、SUCCESS 不显示）。合计 **132 例**。

## [0.8.82] - 2026-11-02 —— 关联 PR 要说清"卡在哪"

### 学到的（知识库第 31 条）
`reviewDecision`（REVIEW_REQUIRED / APPROVED / CHANGES_REQUESTED）+ `mergeable`（MERGEABLE / CONFLICTING）。
本机实测 `cli/cli` 前 3 个 open PR：2 个 `CONFLICTING`、全部 `REVIEW_REQUIRED`、全部草稿。
<https://docs.github.com/en/graphql/reference/objects#pullrequest>

### 为什么值得
「已有 PR」还不足以判断**该不该接管**：
- 有冲突 → 可能该接手；
- 等 review → 通常不该插手；
- 被要求修改 → 作者要动，别抢。

### 改了什么
状态**叠加**（不是互斥，一个 PR 可以又草稿又有冲突还等 review）：
```
已有 PR #25（进行中·草稿·有冲突·等 review）
```
只在 `state === 'OPEN'` 时附加这些后缀。

### 测试
- 用例扩充（单个状态 / 三状态叠加 / merged 不加后缀）。合计 **132 例**。

## [0.8.81] - 2026-11-02 —— 草稿 PR 要标出来，别当成"有人在推进"

### 学到的（知识库第 30 条）
GraphQL `PullRequest.isDraft`（本机实测 `cli/cli` 前 3 个 open PR 全是 `isDraft: true`）。
草稿 PR 不触发通知、不能合并 —— 作者明确表示"还没准备好"。
<https://docs.github.com/en/graphql/reference/objects#pullrequest>

### 为什么值得
上一轮加了「已有 PR 在做」。但如果是草稿，会话可能误判"有人推进，我不用管" —— 漏活。
现在区分：`已有 PR #20（进行中·草稿）`；合并态即使 `isDraft=true` 也不加后缀（防御性）。

### 测试
- 用例扩充（草稿带后缀 / 合并态不带后缀）。合计 **132 例**。

## [0.8.80] - 2026-11-02 —— 「已经有 PR 在做了」：避免重复劳动

### 学到的（知识库第 29 条）
GraphQL `CrossReferencedEvent` 能拿到引用过这条 issue 的 PR；`source` 是 **union**，
必须 `source { __typename ... on PullRequest { … } }`，否则报
`Selections can't be made directly on unions`（实测踩到）。
<https://docs.github.com/en/graphql/reference/objects#crossreferencedevent>

### 为什么值得
评论只能看出"有人在说话"，**关联 PR** 才能看出"已经有人在写代码"。
会话最怕重复劳动：其实已经有人开了 PR，它又从零改一遍。

### 改了什么（零额外请求）
把时间线查询**挂进已有的批量 GraphQL**，解析出关联 PR：
- 去重、忽略非 PR 引用；
- 排序 `OPEN > MERGED > CLOSED`；
- 消息里提示 `已有 PR #20（进行中）` / `已有 PR #21（已合并）` / `等 N 个`。

### 测试
- 新增 1 例（open 优先/去重/忽略 Issue 类型/null 源/各状态文案/等 N 个/消息提醒）。合计 **132 例**。

## [0.8.79] - 2026-11-02 —— 「躺了 62 天」：积压看得见

### 学到的（知识库第 28 条）
`actions/stale` 的 `days-before-stale` 默认 **60 天**；社区 30/60 两档都常见。
<https://github.com/actions/stale#readme>

我们的定位不是清理而是**提醒还有积压**，所以用 **30 天**（早一档，留人工决策时间）：
- 只标 `open`（closed 不吵）；
- 默认**只展示**（`躺了 62 天`），加权默认关，开启后 +2；
- 阈值可配置。

### 写代码时踩的一个坑（已修）
```js
// 错：Number(now) || (Date.now() - at) —— 传了 now 就把 epoch 毫秒当成天数差
const days = Math.floor((Number(options.now) || Date.now() - at) / 86400000)
```
用例立刻抓到（显示成 `躺了 20759 天`）。运算符优先级这类错误，有测试就是一行红，没测试就上线错。

### 测试
- 新增 1 例（62 天会标/刚更新不标/closed 不标/无时间戳不猜/阈值可调/默认 0/开启 +2）。合计 **131 例**。

## [0.8.78] - 2026-11-02 —— 分诊信号收成一张表，界面上直接看

### 学到的（知识库第 27 条）
顺带核对了 `milestone` 与新版 `type` 字段：**存在但不稳定**（实测 `cli/cli` 多为 `null`），
所以不纳入权重。事实类信号仍只用 `state_reason` / `comments` / `labels` / `assignees`。

### 改了什么
`lib/watch.js` 里新增唯一口径 `TRIAGE_SIGNALS`（key / 标签 / 事实还是判断 / 权重 / 默认 / 理由），
`/state` 直接回传，面板「设置 → 分诊信号与取舍」原样展示：

```
被重新打开 [事实][默认开] +100 分   之前判"不做"被推翻
有人评论   [事实][默认开] +10 分    在等回应
带标签     [事实][默认开] +5 分     命中过某个分类
无人认领   [判断][默认关] +3 分     团队经验，无官方依据
长期没动静 [事实][默认关] +0 分     仅展示
```

### 用例守着的两条不变量
1. **判断类默认必须是关的** —— 我们的判断不该默认生效；
2. **表里的权重必须和 `priorityScore` 实际打分一致** —— 防止文档与代码走偏。

### 测试
- 新增 1 例。合计 **130 例**。

## [0.8.77] - 2026-11-02 —— 标出"未认领"，但不偷偷加权

### 学到的（知识库第 26 条）
GitHub 只给事实（`assignees` 是谁），不给"因此谁更紧急"的判断。
<b>「无人认领更紧急」是团队经验</b>，本轮没找到官方依据 —— 所以它不该进默认权重。

### 改了什么
- 唤醒消息里给无人认领的条目加一句 **`未认领`**（事实，不需要理由）；
- 面板新增「未认领优先」开关（+3 分），**默认关闭** —— 想用的人自己开。

分寸：**事实默认展示，判断默认关闭。**

### 测试
- 新增 1 例（null/有指派/空数组/缺字段、消息标注、默认 0 分、开启 +3、已认领不加分）。合计 **129 例**。

## [0.8.76] - 2026-11-02 —— 优先级权重可关掉（因为它是产品判断，不是标准）

### 诚实说明（知识库第 25 条）
GitHub 提供 `sort=created|updated|comments`，但**没有官方推荐的"权重"**。
本轮想找 triage 优先级的官方说明时页面 404 / 抓不到正文 ——
所以 100/10/5 这套权重**是我们自己的产品判断**，不是抄的行业标准。

既然是自己拍的，就该让用户能关掉。

### 改了什么
- 每条守存 `priority: { reopened, comments, labels }`（默认全开）；
- 面板「编辑」页三个开关：重开优先 / 评论优先 / 标签优先；
- **三项全关 = 退回 GitHub 的 updated 顺序**（仍是稳定排序，不会乱跳）；
- `/state` 回传 `priority`，`/watch` 接受 `priority`。

### 测试
- 新增 1 例（全开/关一项/全关/权重不受开关影响）。合计 **128 例**；
- 源码级守门里补了 3 个新字段（编辑态回填必须列全）。

## [0.8.75] - 2026-11-02 —— 一次 N 条时，先处理更该处理的

### 学到的（知识库第 24 条）
GitHub 列表支持 `sort=created|updated|comments`，但那是"热度/时间"维度；
我们要的是"**哪条更该现在处理**"，所以在本地排。权重可解释、可测：
<https://docs.github.com/en/rest/issues/issues#list-repository-issues>

| 信号 | 权重 |
|---|---|
| 被重开（`state_reason=reopened`） | **100** |
| 有人评论 | 10 |
| 有标签 | 5 |

### 关键实现细节
**稳定排序**：分数相同保持 GitHub 给的 updated 顺序。否则同一批条目每次顺序都可能不同，
客户会以为数据在乱跳 —— 用例专门验了"多次调用顺序一致"。

### 测试
- 新增 1 例（单项权重、组合 115、重开第一/有评论第二、稳定排序）。合计 **127 例**。

## [0.8.74] - 2026-11-02 —— 「判过不做」又被重开的条目，要显眼

### 学到的（知识库第 23 条）
issue 对象带 `state_reason`：`completed` / `not_planned` / `reopened`。
本机实测 `cli/cli` 最近 5 条里 4 条是 `not_planned`。
<https://docs.github.com/en/rest/issues/issues>

主理鱼默认跳过 closed，但**判过 not_planned 之后又被重开**说明"不做"的判断被推翻了 ——
这是最该被人看一眼的信号。

### 改了什么
1. 轮询记住最近一条 `reopened` 的 issue 号（`entry.lastReopened`）；
2. 唤醒消息给重开条目加 `⚠ 这条被重新打开过（之前关过，判"不做"可能不对）`；
3. 面板「需要关注」显示 `o/r #N 被重新打开过`；
4. **正常的 not_planned / completed 在消息里不提示** —— 不喧哗。

### 测试
- 新增 1 例（null / 无原因 / reopened / not_planned / completed / 只有重开带 ⚠）。合计 **126 例**。

## [0.8.73] - 2026-11-02 —— 主轮询要不要换 GraphQL：测完结论是**不换**（并留下基准脚本）

### 学到/测到的（知识库第 22 条）
新增可复现基准 `node scripts/bench-api.mjs owner/name`，实测：

| 场景 | REST（我们现在的） | GraphQL |
|---|---|---|
| 小仓库 20 条 | 769ms / 13.9 KB | 709ms / 1.0 KB |
| 大仓库 20 条 | 1418ms / 113 KB | 1067ms / 6.9 KB |
| 取 3 条最后评论 | 逐条 1786ms | 批量 439ms |

### 为什么**不**换主路径
1. 我们已经用 **ETag**：没变化时整轮 304，**零解析零传输**。GraphQL 没有等价用法，
   换过去等于把"大多数轮次几乎免费"变成"每轮都拉一遍"——净亏。
2. GraphQL 的优势只在"确实有变化"时兑现，而那时我们的评论请求已在 0.8.72 批量化了（快 4 倍）。
3. 主路径是核心，收益要靠侧证；**侧证不支持就不动**。

### 顺带证伪一个"想当然"
"用 `state=open` 代替 `state=all` 能减小响应" —— 实测同仓库同 20 条：
`all` **113,895 字节** vs `open` **130,274 字节**（反而更大）。所以这条优化不做。

### 本版改动
- 新增 `scripts/bench-api.mjs`（这只是量具，不改变运行时行为）；
- 版本号/文档同步。**没有改主轮询逻辑 —— 这是有意识的选择。**

## [0.8.72] - 2026-11-02 —— 取「最后评论」改成一次 GraphQL 批量

### 学到的（知识库第 21 条）
GraphQL 可以在同一请求里用别名查多个对象 —— 3 条 issue 的最后评论，从 **3 次 REST + 1 次 `/user`**
变成 **1 次请求**。
<https://docs.github.com/en/graphql>

### 本机实测
```
批量 GraphQL: 671ms，命中 2/3 条（第 3 条作者已注销）
逐条 REST  : 1443ms（3 次调用）
```
→ 耗时约 **1/2.1**，调用次数 **3 → 1**。

### 两个坑（都处理了）
1. **`gh api graphql` 有 `errors` 时退出码是 1，但 `stdout` 的 `data` 仍然完整** ——
   必须先解析 stdout，不能因退出码非 0 就整批放弃（否则只要有一条 issue 不存在就白跑）。
   用例专门造了 `i1: null` + `errors` 的形态锁这个行为。
2. 保留**逐条 REST 兜底**（GraphQL 不可用时仍能工作）。

### 测试
- 新增 1 例。合计 **125 例**。

## [0.8.71] - 2026-11-02 —— 「最后一条是我发的」不能当成"有人在处理"

### 学到的（知识库第 20 条）
REST 用 `GET /user` 表示"我是谁"（GraphQL 叫 `viewer`）。本机实测 `gh api user --jq .login` 可用。
<https://docs.github.com/en/rest/users/users#get-the-authenticated-user>

### 为什么这是要命的 bug 级歧义
上一轮加了「最后评论: @helper 时间」。可如果最后一条**是我们自己**在上一轮留下的，
会话会误判成"已经有人在处理"，于是什么都不做 —— **最坏的一种静默失效**。

### 改了什么
- 取评论时同时拿 `/user`（**缓存 10 分钟**），比较后标记 `self`；
- 消息里呈现 `最后评论: 我（上一轮留的） 2026-11-02T06:00:00Z`；
- 大小写不敏感；拿不到"我是谁"时**照常显示 @login**，不猜。

### 测试
- 新增 1 例（4 种情况）。合计 **124 例**。

## [0.8.70] - 2026-11-02 —— 唤醒消息补「最后是谁在说话」

### 学到的（知识库第 19 条）
评论是**独立资源**（issue 对象只带 `comments` 计数），要"最后一条评论是谁"必须单独取一次
—— 这是有成本的信息。`sort=created&direction=desc&per_page=1` 一次拿到。
<https://docs.github.com/en/rest/issues/comments#list-issue-comments>

### 为什么值得
会话被叫醒后第一件事是判断「是不是已经有人处理了」。我们原来只给 issue 作者 + 更新时间，
但**更新时间可能是我自己打标签引起的**，作者永远是开 issue 的人 —— 真正该看的是最后一条评论。

### 改了什么（成本受控）
- 只对批次**前 3 条**且 `comments > 0` 的条目取；
- 并发取、单条 12 秒超时；
- 失败**静默省略**该行，绝不阻断唤醒；
- 消息里呈现 `最后评论: @helper 2026-11-02T07:00:00Z`。

### 测试
- 新增 1 例：null / 空对象 / 只有 login / 完整信息 / 出现在消息里。合计 **123 例**。

## [0.8.69] - 2026-11-02 —— 填错仓库名时给个"是不是想填 X"

### 学到的（知识库第 18 条，实测数字）
`search/repositories` 的响应头本机实测：`x-ratelimit-limit: 30`（30 次/分钟）；
对照 core 的 `5000` —— **两个池差 166 倍**。
<https://docs.github.com/en/rest/search/search#search-repositories>

这给知识库第 16 条（限流分池）补上了具体数字，也决定了本轮实现的边界。

### 改了什么
添加守时若仓库 404，用搜索找最像的仓库，提示「是不是想填 owner/name？」。因为 search 池很紧：
- 只在 **404 之后**才搜（正常路径零调用）；
- 名字短于 5 字符不搜；
- `per_page=5` 拿到就停；
- 搜索失败/被限流**静默放弃**，不影响添加。

排序规则：**仓库名完全相同 > 名字包含**；owner 相同但仓库名不相关的**不给建议**（避免误导）。

### 测试
- 新增 1 例（同名优先 / 包含关系 / 不相关不乱猜 / 空输入 / 无候选 / 短名同名）。合计 **122 例**。

## [0.8.68] - 2026-11-02 —— 添加时就告诉你仓库有问题，不用等十几秒

### 学到的（知识库第 17 条）
`GET /repos/{owner}/{repo}` 对**不存在**和**无权访问**都返回 404 —— 所以文案必须同时覆盖两种可能，
否则会误导。而 `has_issues` / `archived` / `permissions.push` 都是"读一次就知道"的事实，
没有理由等运行失败才说。
<https://docs.github.com/en/rest/repos/repos#get-a-repository>

### 改了什么
- 新建守时**同步**体检（10 秒超时），结论直接放进 `POST /watch` 的响应 `warnings`；
- 面板拿到就立刻提示：`已添加，但注意：仓库 o/x 不存在，或当前 token 没有访问权限 …`；
- **只告警不阻断**（网络抖动不该让人加不了守）；编辑已有守不做体检；测试环境跳过网络但字段保留。

### 测试
- 新增 1 例：`POST /watch` 的 `warnings` 必须始终是数组。合计 **121 例**。

## [0.8.67] - 2026-11-02 —— 能力徽章可点筛选；顺手记下「限流是分池的」

### 学到的（知识库第 16 条，判断准则）
GitHub 限流**分池**：`X-RateLimit-Resource` 就是池名（core / search / graphql …），
search 池额度更紧、GraphQL 完全独立。
<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

我们 0.8.53 的「剩余 < 500 推到 reset」没区分池 —— 目前只打 core，所以没出错；
但将来加"按关键字搜 issue"就必须按 `resource` 分账。这条**先记准则、暂不改代码**（诚实标注：未落地）。

### 改了什么（本轮代码）
行内能力徽章从 `Tag`（只读）换成官方 `Pill`（可点）：
- 点 `只读` / `已归档` / `无 Issues` / `私有` → 只看这类守，再点取消；
- 顶部显示「只看 只读 的守（1 条）· 清除」，与「跳过原因」的交互一致。

### 测试
- 新增 1 例：未筛选两条都在 → 选「只读」只剩 ro/two 且有状态提示。合计 **120 例**。

## [0.8.66] - 2026-11-02 —— 归档仓库：能读不能写，行内加能力徽章

### 学到的（知识库第 15 条）
`GET /repos` 还有 `archived` / `disabled` / `visibility`（实测 `atom/atom` 就是 `archived: true`）。
归档是 GitHub 的"冻结"：内容只读，评论/打标签全部失败 —— **换 token 也没用**，比"没写权限"更彻底。

### 改了什么
1. `probeAccess` 一并取 `archived` / `disabled`；
2. 「需要关注」区新增归档 / 禁用两条人话（排在轮询失败之前）；
3. 行内加**能力徽章**：`已归档` `已禁用` `无 Issues` `fork · 上游 x/y` `只读` `私有`。

### 测试
- 新增 1 例（6 种组合 + fork 自己开了 Issues 不误伤）。合计 **119 例**。

## [0.8.65] - 2026-11-02 —— 关闭 Issues / 是 fork 的仓库，提前说清楚

### 学到的（知识库第 14 条）
`GET /repos` 自带结构信息：`has_issues` / `fork` / `parent.full_name`（本机实测都在）。
主理鱼只认 issue / PR，所以「关闭了 Issues」的仓库注定永远安静 ——
客户会以为插件坏了。

（诚实标注：想抓 fork 文档正文说明"fork 默认不带 Issues"时页面没给出可读文本，
这句按社区常识使用、未取得官方引用；因此对 **自己开了 Issues 的 fork 不提示**，避免误伤。）

### 改了什么
- `probeAccess` 一并取 `fork / hasIssues / parent`，存进 `entry.repoAccess`；
- `/state` 回传 `repoAccess`；
- 面板「需要关注」区新增两条人话提示（**排在轮询失败之前**）：
  - `o/r 关闭了 Issues —— 主理鱼只认 issue / PR，这里不会有任何条目可接。`
  - `me/r 是 up/r 的 fork。fork 默认不带 Issues … 确认你要守的是哪一个。`

### 测试
- 新增 1 例（5 种情况）。合计 **118 例**。

## [0.8.64] - 2026-11-02 —— 只读仓库提前说清楚，别等它吃 403

### 学到的（知识库第 13 条）
`GET /repos/{owner}/{repo}` 返回 `permissions: { admin, push, pull … }` ——
「你对这个仓库能做什么」的权威答案，读之前就知道，不用试一次拿 403。
<https://docs.github.com/en/rest/repos/repos#get-a-repository>

### 改了什么
- 新增守时**后台**查一次仓库权限（不阻塞创建），存 `entry.repoAccess`；
- `push === false` 时唤醒消息多一行 `【权限提示】… 只有读权限 …`；
- 还没探测到（未知）时**不猜、不提示**。

### 测试
- 新增 1 例：有写权限不提示 / null 与空对象不提示 / 只读给人话 / 消息里单独成行。合计 **117 例**。

## [0.8.63] - 2026-11-02 —— 面板显示 token 权限范围，宽 scope 会提醒

### 学到的（知识库第 12 条）
GitHub 细粒度 token 按「资源 × 操作 × 仓库」授权，经典 PAT 的 `repo` 却是该账号可见仓库的**全部读写**。
最小权限的意义在于泄漏后的影响面 —— 对一个跑在客户机器上的插件尤其重要。

本机实测当前 token 的 scopes：

```
admin:repo_hook, delete:packages, gist, notifications, project,
read:org, read:user, repo, workflow, write:discussion, write:packages
```

其中 `delete:packages` / `admin:repo_hook` / `workflow` **我们一个都用不到**。

### 改了什么
- `gh api -i user` 读 `x-oauth-scopes`（**缓存 5 分钟**，不额外给每次 `/state` 加一次网络往返）；
- `/state` 带 `tokenScopes`；设置页「来源」显示「权限范围: …」；
- 命中宽 scope 时多一行提示：建议换细粒度 token，只授 Issues 读写。

### 测试
- 合计 **116 例**（复用既有 /state 契约用例，未新增网络依赖）。

## [0.8.62] - 2026-11-02 —— Windows 上 `chmod 0600` 是假的，改用 ACL

### 学到的（知识库第 11 条，安全问题）
Node 文档 `fs.chmod` Caveats 原文：*"on Windows only the write permission can be changed,
and the distinction among the permissions of group, owner, or others is not implemented."*

我们把 GitHub token 写在 `<state>/secrets.json`，一直用 `{ mode: 0o600 }` —— **Windows 上约等于没保护**。

### 改了什么
写完立刻收紧：
- POSIX → `chmod 0600`；
- Windows → `icacls <file> /inheritance:r /grant:r <当前用户>:F`（断开继承，只留本人）。
结果记进 `secretsHardened`，`/diagnose` 显示「凭证保护: win32-acl」。

### 本机实测
```
收紧前： SYSTEM:(I)(F) / BUILTIN\Administrators:(I)(F) / OWNER RIGHTS:(I)(F)
收紧后： <用户>:(F)
```

### 测试
- 新增 `test/secrets-acl.test.mjs`（Windows 专用）：调 `hardenSecretsFile` 后用 `icacls` 回读，
  断言当前用户有 `(F)`、且没有残留 Users 组。合计 **116 例**。

## [0.8.61] - 2026-11-02 —— 状态文件写坏了，也别把客户的守当"空"

### 学到的（知识库第 10 条）
SQLite 的 WAL 思路：**先保证有一份已提交的好副本**，主文件坏了还能恢复；
而不是"就地覆盖，坏了就从头开始"。
<https://www.sqlite.org/wal.html>

我们的 `watchers.json` 有原子写 + 合并写 + 墓碑，但**只有一份**。
主文件被写坏（断电、磁盘满、手改、杀软截断）时，`readState()` 直接返回空 ——
客户看到的是「所有守一夜消失」。

### 改了什么
1. 覆盖前若当前主文件**能正常解析**，先存成 `watchers.json.bak`；
2. 读取时主文件坏了 → 退回 `.bak` 并写回主文件；
3. 备份也坏 → 坏文件改名 `watchers.json.corrupt-<时间戳>` 留证，再从空状态开始；
4. `/state` 暴露 `stateSource`（ok / backup / corrupt / new）。

### 顺带修的测试问题
`/update` 用例会真的访问 npm registry，机器慢时跑到 **5010ms** 才超时失败（本轮真出现）。
已给它 60 秒独立超时 —— 这条要验的是「离线也必须给出 current」，不是网速。

### 测试
- 新增 1 例：造 `.bak` → 主文件写成非法 JSON → 必须从备份恢复，且主文件被修好。合计 **115 例**。

## [0.8.60] - 2026-11-02 —— 保留天数可配；顺手修掉一个会写坏配置的真 bug

### 学到的（知识库第 9 条）
GitHub Actions 的产物保留天数可按仓库配（默认 90 天，1–90 可选）——
会长期增长的资源（日志/产物/缓存）应当**可调 + 有默认值 + 有上下限**。
<https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/removing-workflow-artifacts>

我们的 `isolateKeepDays` 服务端早就支持（默认 3 天），**面板一直没有入口**。

### 改了什么
1. 编辑表单加「隔离区保留天数」（留空用默认 3），保存走 `/watch`；
2. **修掉一个真 bug**：打开编辑态时只回填了 5 个字段（间隔/标签/时段/目标/已指派），
   `observe / isolated / workdir / batchLimit / maxWakesPerHour` 都没填 ——
   打开一条"隔离执行"的守、不作修改直接「保存」，会把 `isolated` 写回 `false`。
   已补齐全部 10 个字段。

### 为什么这条只能用源码级守门
假 DOM 的 `setState` 是空实现，点标题触发 `setDraft` 后拿不到新渲染，
所以行为测不出来。改成**静态检查**：编辑态初始化块必须包含全部 10 个字段名。

### 测试
- 合计 **114 例**（新增源码级守门）。

## [0.8.59] - 2026-11-02 —— 孤儿 worktree 删了目录还得 prune；占用看得见

### 学到的（知识库第 8 条）
`git worktree remove` 会同时删目录和 `.git/worktrees/<id>/` 的管理记录；但**目录是被外部删掉**时，
记录会留下 —— `git worktree list` 就一直显示一个不存在的路径。

我们的清理有两条路径：`worktree remove --force` 成功走第一条（没问题），
失败时走 `rmSync` 兜底删目录 —— **没人清记录**，长期运行会攒 ghost worktree。

### 改了什么
1. 孤儿分支删完目录后补一条 `git worktree prune`；
2. `/state` 新增 `isolation`：每个 worktree 根下的**个数与总字节**，
   面板「设置 → 来源」显示「隔离占用 3 个 · 3.2 MB（合计 9.8 MB）」——客户能看见磁盘在涨。

### 测试
- 新增 `test/worktree-prune.test.mjs`：用**真 git 仓库**复现现象（建 worktree → 手删目录 →
  `list` 仍显示 → `prune` 后干净），不靠 mock。
- 合计 **113 例**。

## [0.8.58] - 2026-11-02 —— 完成标准从"一大句"改成可逐条核对的三条

### 学到的（知识库第 7 条）
Martin Fowler《Given When Then》：验收要写成**可观察的结果**，而不是一句愿望。
<https://martinfowler.com/bliki/GivenWhenThen.html>

### 改了什么
唤醒消息结尾原来是一大句「完成标准 = 有测试结果…」，信息都在但**不可逐条核对**。现在独立成块：

```
【完成标准】
1. 改了什么：文件清单 + 一句话为什么（别只写"已修复"）
2. 怎么验证的：跑过的测试/命令 + 结果；跑不了就写清为什么跑不了
3. 回写到哪：推分支并开 PR（隔离模式）/ 在 issue 里留言 + watch_ack 打标签
```

第 3 条随「是否隔离执行」变化；最多 4 条，超出丢弃；不传时退回原那句话（不硬编）。

### 测试
- 新增 1 例：必须出现【完成标准】、按序号列出、第 5 条起丢弃、不传时不出现。合计 **112 例**。

## [0.8.57] - 2026-11-02 —— 唤醒消息带上「为什么是这几条」

### 学到的（知识库第 6 条）
GitHub 通知自带 `reason`（为什么通知你），Slack 摘要把分组依据写出来。
共性：**只给结果不给依据，接收方没法判断要不要调过滤条件。**

主理鱼的唤醒消息就是任务书，原来只有条目列表 —— 会话看到 3 条，不知道是不是一共 9 条、
也不知道另外 30 条被什么刷掉了。

### 改了什么
唤醒消息里多一行：

```
【为什么是这几条】本轮共 9 条变化；按「最近更新」取前 3 条；同时跳过 不在标签白名单: ai-fix × 5、机器人 × 3
```

数据来自本轮统计（`changedTotal` / `batchLimit` / `filterCounts`），次数为 0 的原因不凑数；
拿不到依据时**不加这一行**（不硬编）。

### 测试
- 新增 1 例：有依据必须出现该行、0 次数不出现、无信息时不出现。合计 **111 例**。

## [0.8.56] - 2026-11-02 —— 跳过原因可点开看明细

0.8.55 把「跳过原因」做成了累计分布，但只能看数字。客户下一步必然问「那这 37 条是哪些？」

### 改法
- 原因标签从 `Tag`（纯展示）换成官方 `Pill`（可点）；
- 点一下 → 只看这类条目（`#42 一个被刷掉的 issue`），再点一次取消；
- 旁边多一个「清除筛选」，避免不知道自己在筛选状态。

顺带说明一次**没做**的事：我本来想加「分页拉取防止一次刷新超过 20 条漏掉」，
实测目标仓库 `MYCF711/dsh-GOkifu-compact` 只有 4 条 issue，而且我们是
`sort=updated&direction=desc` 取最近 20 条 —— 这正是变更检测需要的形态，
**加分页是凭空的复杂度**，故放弃（这条判断记在知识库里，免得以后又想起来重做）。

### 测试
- 新增 1 例：原因渲染成 Pill、文案带次数、选中后列出该类条目（#42）。
- 合计 **110 例**。

## [0.8.55] - 2026-11-02 —— 「为什么没叫醒」现在有答案

### 学到的（知识库第 5 条）
GitHub 的 issue 过滤语义是「限定词 + 集合运算」，用户能自己复现「为什么这条没出现」——
**可枚举的条件**，而不是黑盒结果。
<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests>

主理鱼有 8 种过滤原因，但原来只保留最近 5 条日志。客户问「我加了标签为什么还是一条都没叫醒」，
我们只能看到最近 5 条，说不出全貌。

### 改了什么
- 按原因**累计计数**（`countReasons`，只留最多的 12 种），存进每条守的 `filterCounts`；
- `/state` 回传，「判定」页顶部显示一行：
  `跳过原因累计： 不在标签白名单: ai-fix × 37  机器人 × 12  …`

### 测试
- 新增 1 例：累计 / 排序 / 空原因不记 / 种类上限。合计 **109 例**。

## [0.8.54] - 2026-11-02 —— 第二阶段限流：照 Retry-After 等，别猜

### 学到的一条（知识库第 4 条）
GitHub 有两种限流：**primary**（固定窗口，有 `X-RateLimit-*` 预警）和 **secondary**（突发触发，403/429 + `Retry-After`）。
primary 我们 0.8.53 已经自适应；secondary **没有预警**，一旦触发继续按间隔重试只会延长封禁。

实测证据：`gh api --include` 的 `Access-Control-Expose-Headers` 里明确列着 `Retry-After`，
404 响应也能看到这一行 —— 它是协议里的正式头。

### 改了什么
失败路径先看 `Retry-After`：
- 有值 → 就按它等（封顶 1 小时），`lastDeferred` 写「被 GitHub 限流，按 Retry-After 等 N 秒」；
- 没值 → 走原来的指数退避。

### 顺带结案：那个"并发偶发红"
这轮又跑 **10 次全绿**（前几轮还有 4+6 次）。回看两次失败都发生在
**版本号刚改、文件正在被重写的同一秒** —— 是测试读文件与改文件撞车，不是产品问题。
判定为**人为窗口，不是 flake**，不再追。

### 测试
- 新增 1 例（403 + `Retry-After` 解析、正常值、0/非数字、封顶）。合计 **108 例**。

## [0.8.53] - 2026-11-02 —— 按剩余额度自适应降频（别把 5000/小时打光）

### 算一笔账
core 额度 **5000 次/小时**。客户挂 10 条守、间隔 60s → **600 次/小时**，一天 14,400 次。
之前的实现会一直按间隔撞墙，然后每条守开始报 403 —— 客户看到的是"突然全挂"。

### 改了什么
GitHub 每个响应都带 `X-Ratelimit-Remaining` / `X-Ratelimit-Reset`（本次实测头值：
`Limit: 5000 / Remaining: 4771 / Reset: 1793608466`）。现在每轮读它们：

- 剩余 **< 500** → 把下一轮直接推到额度重置时刻（+1 秒缓冲，最多等 1 小时）；
- 同时在 `lastDeferred` 写明「额度紧张（剩余 N），已推迟到 HH:MM」—— **面板上看得见**，不是静默变慢。

### 测试
- 新增 2 例：真实头格式解析（含 limit/remaining/resetAt）、throttle 五种边界
  （充足不推迟 / 没头不推迟 / 推到重置 / 超 1 小时封顶 / 重置已过）。合计 **107 例**。
- **发现一个并发下的偶发红**（约 1/5）：并发跑整套时偶有 1 例失败，串行跑 3 次全绿。
  各个测试文件单独跑 4~5 次都不复现，且四个"没设 `DSH_SUPERAGENT_STATE`"的文件也都不 import `lib/index.js`，
  所以不是写真实状态导致的。下一轮优先定位（会按文件两两组合来缩小范围）。

## [0.8.52] - 2026-11-02 —— 首轮抖动：多条守不再同一毫秒一起发车

### 学到的一条（知识库第 2 条）
AWS《Exponential Backoff And Jitter》：固定周期的客户端会同步成 thundering herd，加抖动摊平峰值。
<https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/>

我们的 `inFlight` 闸是**按 watcher**的，挡不住「N 条守在同一毫秒一起打 gh api」。

### 改了什么
`jitterMs(entry.id, min(5000, 间隔×10%))` 用 **id 哈希**算偏移（可复现，不是随机数），
只延迟**首轮**，之后按 `every` 稳定推进。

### 顺带做了三组实测（都写进知识库）
| 测什么 | 结果 |
|---|---|
| 单条 watcher 满载状态 | **21.8 KB**（seen 500 + history 20 + filteredLog 5），10 条 ≈ 218 KB，有上限 |
| `gh api` vs `gh api --include` | 稳态几乎同速（~500-650 ms）—— 0.8.51 的 `--include` 没有额外开销 |
| 抖动分布 | 20 条守 → 17 个不同偏移（用例里要求 >8） |

### 测试
- 合计 **105 例**；UI 体检 11/11。

## [0.8.51] - 2026-11-02 —— 条件请求：没变化不计入速率限制

### 学到了什么（新知识库 `docs/kb/` 的第一条）
GitHub 官方最佳实践原文：*"Make authenticated conditional requests, so that unchanged data does not
count against your primary rate limit."*
出处：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

主理鱼每 N 秒拉一次 issue 列表，**大多数轮次其实什么都没变** —— 全量拉属于纯浪费，还占额度。

### 改了什么
- 每条 watcher 记住 `etag`；下一轮带 `-H 'If-None-Match: <etag>'`；
- 收到 **304** 当「本轮无变化」：不解析、不记失败、**不动退避**（退避是给失败的，304 是成功）；
- `gh api --include` 会输出「状态行 + 头 + 空行 + 正文」，新增纯函数 `parseGhInclude` 解析，
  用例覆盖 200 / 304 / 纯正文三种形态。

### 效果
没变化时：网络传输从「20 条 issue 的 JSON」降到「一个空响应」，且**不计入 rate limit**。

### 附带
- 新建 `docs/kb/`（入口索引 + 按主题分组），本轮第一条 `github-conditional-requests.md`；
- 小时级定时任务改为「先学一条 → 再改一处 → 报三段」，作为保底。

### 测试
- 合计 **104 例**；UI 体检 11/11。

## [0.8.50] - 2026-11-02 —— 双主题预览进「一键命令 + 门禁」

以前 `render-preview.mjs` 是个内部脚本，没人知道它存在；现在：

- `pnpm run preview:themes` → 生成 `preview-themes.html`，浏览器直接打开就能看**浅色 + 深色**两套界面；
- `preflight` 新增第 8 项「双主题预览可渲染」：真的跑一遍脚本，检查输出里有两套主题、≥18 块场景 ——
  这条命令坏掉就等于失去了离线验收界面的手段，所以值得守。
- README 新增「验收（不用装宿主也能跑）」小节，把四条命令列出来。

### 为什么值得
「某个主题下颜色写死/漏 token」这类问题，单测永远是绿的；只有把两套主题都渲染出来才看得见。
它也是给客户看的：任何人跑一条命令就能自查界面，而不用听我一句「已经对齐了」。

## [0.8.49] - 2026-11-02 —— 故障排查表补齐最近七个真实事故

都是这轮迭代里真踩到的，写进 README 的表里，客户/未来的我看一眼能对上号：

| 症状 | 根因 |
|---|---|
| 面板显示原始 `Get "…": EOF` | 客户网络抖动（≥0.8.36 显示成人话） |
| 时段外仍显示绿色「主理中」 | 状态没判断是否在活跃窗口内（≥0.8.40 修） |
| 重载了却还是旧行为 | 旧 handler 摘不掉，HTTP 走旧代码（≥0.8.32/0.8.34 自动换前缀并跟过去） |
| 面板建的 watcher 报 `inactive context` | 请求被已释放的旧实例处理（≥0.8.31 直接 503 提示重载） |
| watcher 莫名消失 | 状态整份覆盖（≥0.8.37 合并写 + 墓碑） |
| 客户那边没新功能 | 客户不会主动升级（顶部横幅 + 设置页给命令） |
| 想知道客户现场状态 | 设置 → 诊断 → 复制（已脱敏） |

顺带把 `docs/optimization-plan.md` 与 `docs/ui-inventory.md` 补进 `docs/README.md` 的索引。

## [0.8.48] - 2026-11-02 —— 第一次打开不再白屏：三步上手

客户装完第一次打开「主理鱼」，以前只有一行灰字「还没有主理鱼」。等于让他去翻 README。

现在空态是一张官方 `dt-card`，三步 + 一个能直接开始的按钮：

```
三步让这个会话开始盯办
① 填一个仓库（owner/name，比如 MYCF711/dsh-session-superagent）
② 选间隔（默认 60 秒；建议先设 300 秒，别把 API 打满）
③ 点「添加到当前会话」——之后仓库有动静，这个会话就会被叫醒
[去添加第一条]
想先看看效果？在「触发」页勾上「仅观察」：它只记录本会唤醒哪几条，不会真打扰你。
```

点「去添加第一条」直接切到「触发」页，不用自己找。

### 测试
- 新增用例：空态必须有三步（①③都在）+ 一个「去添加第一条」按钮。合计 **103 例**。

## [0.8.47] - 2026-11-02 —— 客户报障：面板里一键复制诊断

客户在别的电脑上用我们的插件，我们看不到他的状态文件。以前报障只能靠来回问
「你装的哪一版」「面板显示什么」「错误原文是什么」—— 一轮就是半天。

### 做法
- 新增只读接口 `GET /session-superagent/diagnose`，返回一段**已脱敏**的纯文本：
  插件版本、宿主 node 版本、挂载状态（routes/failed/base/at）、每条值守的
  仓库 / 启用状态 / 间隔 / 会话 / 上次轮询 / 连续失败数 / 最近错误；
- 面板「设置 → 诊断」一键复制这段（`navigator.clipboard`），复制成功会提示行数；
- 文本出厂前过一遍 `redact()`：token、私钥、Authorization 头都不会带出去。

### 测试
- 路由面 7 → **8 条**，测试与 `preflight` 里的断言同步（含跨实例接管、整组重放、卸载幂等三条）
- 客户端契约测试逼我改了变量名（`body.text` 会被当成 `/state` 的字段 —— 那是 `/diagnose` 的），
  这条测试挺管用：它保证客户端引用的 `/state` 字段服务端真的回传。
- UI 体检里「图标按钮缺可读名字」的检测器从「固定 420 字符窗口」改成**花括号配对**：
  长 `onClick` 的按钮之前会被误判成没名字（一次误报 16 个）。顺手给 `ConfirmBtn` 补了 `aria-label`。
- 合计 **102 例**；UI 体检 11/11。

## [0.8.46] - 2026-11-02 —— 双主题预览 + 「自造 token」守门

### ① 预览脚本终于能看两套主题
`node scripts/render-preview.mjs out.html` 现在一次输出 **浅色 + 深色**两套（9 个场景 × 2 = 18 块），
覆盖：总览 / 判定 / 触发 / 设置（来源）/ 设置（版本与更新）/ 新版本横幅 / 两种 Toast / 术语表。

顺手修掉一个长期误导：预览的兜底 token 用的是
`--dsw-alias-border-default`、`--dsw-alias-success-500`、`--dsw-alias-accent-primary` ——
**宿主机上根本没有这些变量**，所以以前预览一直"没上色"，看起来像样式没移植对。
现在全部换成真实变量名（`--dsw-alias-border-l3`、`--dsw-alias-state-success-primary`、`--dsw-alias-brand-primary` …）。

### ② 新增守门：自造 token
`ui-audit` 第 11 项 —— 我们自己代码里引用的 `--dsw-*` 必须都在官方 CSS 里出现过。
当前 0 处自造（引用 20 个变量，全部有出处）。这条能防住「变量名拼错→样式静默失效」。

### 指标
```
11/11 通过（100 分）
写死颜色（样式块）0 · 写死颜色（inline/JS）0 · 自造 token 0
官方结构 8/8 · 弹层键盘 3/3 · 裸 button 5/17 · 死代码 0
```

## [0.8.45] - 2026-11-02 —— 表单字段补齐官方 Field，状态色全部 token 化

### ① 表单字段用官方 `Field`（带 hint / note）
官方 `settings-kit.tsx` 的 `Field` 是 `label + hint(InfoTip) + 控件 + note(small)`。
我们之前只有 `label`，说明只能塞进 placeholder。现在字段名旁有 `?` 图标，点开看人话：

- 「间隔（秒）」→ 多长时间检查一次这个仓库，最小 30 秒
- 「活跃时段」→ 只在这个时间段内唤醒；窗口外只攒条目，不打扰

### ② 状态色不再写死
轨道环的四个状态色之前是 `#3fb950 / #d29922 / #f85149 / #8b949e`（写死 hex，深色主题里就是错的），
toast 的错误左边条同样写死了 `#f85149`。现在全部改成 `--dsw-alias-state-*` / `--dsw-alias-label-caption`。

### ③ UI 体检加第 10 项：写死颜色（含 inline style 与 JS 常量）
之前只扫样式块，所以漏掉了上面这些。现在扫整个 client.js（排除搬来的 `PORTED_CSS`），
要求 0 处 —— 否则「换主题就有一条颜色是错的」这类问题永远发现不了。

### 指标
```
10/10 通过（100 分）
写死颜色（样式块）0 · 写死颜色（inline/JS）0 · 官方结构 8/8 · 弹层键盘 3/3
```

### 测试
- 合计 **102 例**。

## [0.8.44] - 2026-11-02 —— 判定页换官方时间线 + 补齐四个原语

按 `docs/ui-inventory.md` 第 3、4 项。

### 判定页：改用官方时间线结构
官方在 `thread.tsx` / `settings-kit.tsx` 里铺「发生过什么」用的是
`ol.dt-timeline > li.dt-event`（含 `dt-event-quiet` 静音态、`dt-event-foot` 元信息行、`dt-event-text` 正文）。
我们之前是普通 `dt-row` 堆叠，现在换成官方结构：跳过/仅观察的条目用 `dt-event-quiet` 弱化。

### 补齐四个官方原语（`controls.tsx`）
| 原语 | 官方行为 |
|---|---|
| `Pill` | 可切换小胶囊（`aria-pressed`） |
| `SegmentedControl` | 表单内互斥分段（`role=radiogroup` + `aria-checked`） |
| `DisclosureRow` | 折叠行：Enter / 空格可切换、`aria-expanded`、展开图标切换 |
| `InfoTip` | 点一下出气泡说明（`role=tooltip`） |

同时 `Section` 补上官方的 `hint` / `action` 两个插槽；「最近被过滤」改用 `DisclosureRow` 折叠
（默认只露第一条摘要，点开看全部）—— 原语不是摆着看的。

### 顺手修掉一个假守门
`meta.test.mjs` 里「watch.js 导出必须被 import」那条用了 `new RegExp('' + name + '')`，
但文件里实际是**单个反斜杠**（`''` 写成了 `''`→退格符），正则永远匹配不到东西 —— 这条守门此前形同虚设。
已改成真正的词边界，并另加一条「官方原语齐全」守门。

### 测试
- 合计 **102 例**；UI 体检 9/9 = 100 分（官方结构采用 8/8）。

## [0.8.43] - 2026-11-02 —— 行结构与设置页改用官方模板

按 `docs/ui-inventory.md` 的第 1、2 项打。

### 行列表：改用官方 `TicketLine` 结构
官方 `rows.tsx` 的行是 `<li class="dt-row dt-link dt-ticket">`，两列网格：
**左列状态（`dt-ticket-stage`）** + **右列正文（`dt-ticket-body`）**，标题本身是 `dt-open` 按钮。
我们之前是普通 `dt-row` + 一个单独的「编辑」按钮。现在：

- 列表容器 `dt-rows` → **`dt-list`**（只有 `.dt-list > .dt-ticket` 才有左侧状态列网格）；
- 标题改成 `dt-open` 按钮（带 `aria-expanded`），点标题展开行内编辑 —— 官方就是点标题进详情；
- 行内 `dt-ticket-note` 承载会话/间隔/轮询/唤醒这串说明，错误行用 `dt-ticket-note-error`；
- 操作收进 `dt-ticket-actions`。

### 设置页：改用官方「左栏 + 内容」
`dt-settings` 网格（140px + 内容）之前搬来了 CSS 却没用。现在是四个分区（来源 / 凭证 / 版本与更新 / 会话 goal）
配 `dt-settings-nav` 左栏，当前项 `aria-current="page"`，深链路里不用一路滚到底。

### UI 体检扩到 9 项
新增「官方结构采用数」（`dt-ticket` / `dt-list` / `dt-open` / `dt-settings` / `dt-settings-nav` /
`dt-timeline` / `dt-event` / `dt-disclosure`），当前 **8/8**。合计 **9/9 = 100 分**。

### 测试
- 新增：设置页必须有 `dt-settings` 网格、4 个左栏项、且只有 1 个 `aria-current=page`；
- 「编辑按钮」用例改成断言 `dt-open` 标题（交互位置变了，行为没丢）。合计 **101 例**。

## [0.8.42] - 2026-11-02 —— 全界面盘点 + 弹层键盘行为对齐官方

用户要求：「所有 UI，包括二三级页面，有官方素材就用官方素材」。先做盘点，再按清单打。

### 新增 `docs/ui-inventory.md`
把每条渲染面列成表：**渲染面 → 页签 → 二级分区 → 三级弹层 → 官方原语对照**，每条写清
我们用什么结构、官方对应哪个文件、差在哪。结论摘要：

- 官方原语 `controls.tsx` 有 13 个，我们缺 4 个（`Pill` / `SegmentedControl` / `DisclosureRow` / `InfoTip` 封装），
  `StateDot` 只做了一半；
- 官方行结构是 `dt-ticket`（左侧状态列 + `dt-open` 标题 + `dt-ticket-actions`），我们用的是普通 `dt-row` —— 待换；
- 官方设置页是「左栏 + 内容」网格（CSS 我们早就搬来了，只是没用上）；
- 官方空态统一用 `<Hint>`，不画插画 —— 我们照此，别再自造。

### 修掉的真差异
**弹层键盘行为**：官方 `Modal` 有「Escape 关闭 + Tab 焦点陷阱 + 关闭后焦点归还」，我们只搬了样式。
现在三件套补全（打开后焦点进弹层、Tab 在弹层内循环、关闭后回到触发元素）。

**悬浮面板改用官方设计系统**：以前是 100 行 inline style 自成一套（还写死了 `#f85149`），
现在 `dt-card` + `dt-row` + `dt-hint` + 官方 `dt-state-dot`，只留定位几个 inline 值。

### UI 体检从 7 项扩到 8 项
新增「弹层键盘行为（Escape/陷阱/归还）」指标，并要求 3/3。当前 **8/8 = 100 分**。

## [0.8.41] - 2026-11-02 —— UI 不再靠肉眼验收：七项指标 + 首次 100 分

用户的原话：「你的 UI 真的完美了吗？要做到 DSH 的原生 UI 一样」。肉眼点一遍既慢又漏，
所以先把**能数的东西**抽出来：新增 `scripts/ui-audit.mjs`（不需要宿主，量源码），
并接进 `preflight`，以后每次推送都会跑。

### 首次体检抓出三处真问题（已修）
| 指标 | 修前 | 修后 |
|---|---|---|
| 可点但不可键盘操作的裸 div | 1（弹层遮罩） | **0**（`role="presentation"`） |
| 图标按钮缺可读名字 | 2（行内「编辑」「暂停/恢复」） | **0**（补 `label`） |
| 空态分支 | 用 `dt-empty` 查不到 | 改按 `length === 0` 数，**10 处** |

### 七项指标（当前全绿）
```
可点裸 div 0 · focus-visible 15 · 写死颜色 0 · 图标按钮缺名字 0
空态分支 10 · 裸 button/Btn 8/15 · 自造类死代码 0   → 100 分
```

指标不是空转：新增指标时都写了**负例**（故意造一个没名字的按钮，确认抓得到）。

### 新增文档
`docs/optimization-plan.md`：指标表 + 下一批目标（换掉 8 个裸 button、间距节奏、空态结构、
双主题实拍、键盘走查）。定时任务的提示词也改成按这张表挑活。

## [0.8.40] - 2026-11-02 —— 时段外不要谎报「主理中」

用户截图指出一处不诚实：一条设了活跃时段 `09:00-23:00` 的主理鱼，
在窗口之外仍然挂着绿色「主理中」—— 但那个时间点它根本不会唤醒，只是把条目攒着。

### 改法
状态判定加第四种 `dormant`（时段外）：
- 设了 `activeHours` 且**此刻不在窗口内** → 标签显示「时段外」（灰色 + 悬停说明「只攒条目，不唤醒」）；
- 窗口内 / 没设时段 → 仍显示「主理中」；
- 支持跨夜窗口（`22:00-06:00`）；时段写错（解析不了）就退回「主理中」，不乱标；
- 顶部统计「N 主理中」与轨道环绕色也跟着只算真正在岗的那些（全时段外时环是灰色，不是琥珀色）。

### 测试
- 新增用例：窗口外的 watcher 必须显示「时段外」且仍显示时段本身。合计 **100 例**。

## [0.8.39] - 2026-11-02 —— 有新版本时，面板顶上直接告诉你

0.8.38 把版本检查放进了「设置」页 —— 但客户不会主动翻设置页，等于没做。
这一版把结果提到**面板顶部**：

```
[ 有新版本 0.9.0（当前 0.8.38）            [看升级命令] ]
```

点「看升级命令」跳到设置页，命令可以直接复制。没有新版本时不显示，不打扰。

### 测试
- 新增用例：有新版时必须出现横幅且写明版本号；无新版时不得出现。合计 **99 例**。

## [0.8.38] - 2026-11-02 —— 面板里就能看到「有没有新版本」

### 为什么
客户在自己电脑上用发布版。我这边修完、发到 npm，**客户不升级就一直跑旧版** ——
而他并不会主动去 `npm view`。所以「有没有新版本、该跑什么命令」应该长在面板里。

### 做法（只读，不替你安装）
新增 `GET /session-superagent/update`：

```json
{ "current": "0.8.38", "latest": "0.8.38", "hasUpdate": false,
  "command": "dsh plugin --profile <你的 profile> add dsh-session-superagent@0.8.38" }
```

- 问 `registry.npmjs.org/<pkg>/latest`，5 秒超时，**内存缓存 10 分钟**（`?refresh=1` 强制刷新）；
- 面板「设置 → 版本与更新」显示：当前版本 / npm 最新 / 状态，有新版本时给出命令 + 复制按钮；
- **不自动安装**：装要改 profile，而且装完必须重载宿主才生效 —— 这一步交给客户自己决定，面板里写明了。

### 顺带
- 路由面 6 → 7 条，测试与 preflight 里的断言同步更新；
- 客户端 hook 顺序变了（多两个 state），测试里的 `deskQueue` 同步补槽位。

### 测试
- 合计 **98 例**。

## [0.8.37] - 2026-11-02 —— 状态文件不再丢 watcher

### 真机现象（本机复现）
用 HTTP 建的一条 watcher，几秒后从状态文件里消失，只剩另一条 —— 同一天出现两次。

> 更正：早先我把一张**客户**截图（`Betsy20/magpie-Jet-Hub`）也算作案例，这是错的。
> 那是别人 PC 上跑我们插件的实例，本机的状态文件里当然没有它的条目；
> 这条修复的依据只是本机那次复现。

### 根因
`writeState()` 是**整份覆盖**。当两个写入者手里的快照不同（宿主热重载时新旧实例交替、
或工具与面板同时写），后写的那个会把别人刚建的条目一起抹掉 —— 原子写只能防"写一半崩掉"，
防不住"用旧快照覆盖新内容"。

### 修法
`writeState()` 改成**合并写**：
- 盘上有、内存里没有的条目**一律保留**；
- 删除时立**墓碑**（`state.deleted[id] = 时间`），只有墓碑里的 id 允许消失，墓碑保留 7 天；
- 仍然原子落盘（tmp + rename）。

### 测试
- 新增 2 例：① 迟到的旧快照不能抹掉别人刚建的 watcher；② 删除后，一个仍持有旧快照的写入不能把它复活。合计 **97 例**。

## [0.8.36] - 2026-11-02 —— 面板上那串 `EOF` 原始报错，应该变成人话

真机截图里出现过这样一条：

```
Get "https://api.github.com/repos/…/issues?state=all&sort=updated&direction=desc&per_page=20": EOF
```

它既长又吓人，其实是**网络抖动**（我同一分钟手工跑 `gh api` 返回 14 条，完全正常）。
之前只有 401/404/找不到 gh 三种情况有提示，`EOF` 这类网络错误就原样怼给用户看。

### 改法
新增纯函数 `classifyGhError(detail)`，把失败分成 `auth / notfound / ratelimit / nogh / network / other`
六类，各配一句「该怎么做」；同时把长 URL 压成 `GitHub API 请求`，避免一整条 API 地址占满面板。

```
EOF                     → 网络抖动：这一轮没连上 GitHub，已按退避自动重试，不需要手动处理
HTTP 401                → gh 登录失效：跑 gh auth login，或在面板填 token
HTTP 403 rate limit     → 被 GitHub 限流：等几分钟，或换成带 token 的凭证
HTTP 404                → 仓库不存在或没权限：检查 owner/name
gh: command not found   → 找不到 gh 命令：确认已安装且在 PATH
```

### 顺带修掉的一个隐蔽 bug
写这个正则时 `` 被写成了**退格符（0x08）**，导致 `EOF` 那条永远匹配不上 ——
是「分类函数跑起来却发现 kind=other」才暴露的。已清掉文件里 4 个控制字符，并加用例钉住六种输入。

### 测试
- 新增用例：六类输入 + 长 URL 压缩。合计 **95 例**。

## [0.8.35] - 2026-11-02 —— 面板在跟哪一代，能查了

排查热重载问题时一直卡在一个观测盲点：面板每 5 秒轮询 `/state`，但**轮询不落任何痕迹**，
所以「客户端有没有跟着换到新前缀（`/rN`）」只能靠猜。

### 新增
- 客户端探测到前缀并**发生切换**时，写一条 `client-base` 探针（服务端 `CLIENT_NOTE_KEYS` 放行该键）。
- 于是 `watchers.json → client['note:client-base']` 能直接回答「这个浏览器现在跟的是哪一代」。

### 真机闭环（2026-11-02 10:48:40）
用户打开一次「主理鱼」页之后：

```
note:client-base = /session-superagent/r5     ← 客户端自称在跟 r5
/session-superagent        → routeBase=None（旧 handler，宿主留着）
/session-superagent/r5     → routeBase=/r5, serverVersion=0.8.35
```

时间线正好证明 0.8.34 的重探逻辑在真实环境里工作：
`02:41` 客户端加载（当时在 r4）→ `02:44:50` 服务端换到 r5 并释放 r4 →
`02:48:40` 面板首次轮询命中 404 → 重探 → 切到 r5 → 写探针。

### 测试
- 合计 **94 例**（探针属于运行时行为，靠真机确认）。

## [0.8.34] - 2026-11-02 —— 前缀失效后自动重探，面板不会卡死

真机时间线：客户端 22:42 加载（当时活着的是 `/r2`），22:45 服务端换到 `/r3` 并**释放了 `/r2`** ——
于是面板手里的前缀失效，后续请求全部打空，除非手动刷新页面。

### 改法
`call()` 遇到「请求抛错」或「404」时，**重新探一次前缀再试一遍**（只重试一次，避免打转）。

这样每一代被接管后，面板自己就跟到新一代，不需要刷新页面。

### 测试
- 合计 **94 例**（该分支靠真机验证，单测的假 fetch 不会产生 404）。

## [0.8.33] - 2026-11-02 —— 客户端按版本挑「最新的那个服务端实例」

### 背景
0.8.32 让服务端在撞车时换前缀重放，客户端按「routeBase 与请求前缀一致」认领。真机又暴露一个新情况：

```
server.base = '/session-superagent'（21:45 那次挂载没报重复、路由 6 条全成功）
GET  /session-superagent/state   -> 没有 routeBase（请求仍被旧 handler 接走）
POST /session-superagent/watch   -> 建的 watcher 仍报 inactive context
```

也就是说「注册成功」不等于「这个实例在服务」。只看前缀匹配会挑到错的实例。

### 改法
- 服务端在 `/state` 里自报 `serverVersion`（`SERVER_VERSION` 常量，meta 测试守着与 package.json 同步）；
- 客户端把所有候选前缀都探一遍，只认「`routeBase === 请求前缀`」的，然后在其中**按版本取最新**。

这样即便某个实例在默认前缀"假装成功"，只要 `/rN` 上有更新的实例，面板就会用 `/rN`。

### 测试
- 新增守门：`SERVER_VERSION` 必须等于 `package.json` 版本。合计 **94 例**。

## [0.8.32] - 2026-11-02 —— 热重载后整组换前缀，面板自己找得到

### 背景（真机实测）
宿主重载后，旧实例注册的 handler **摘不掉**（`webServer.register` 没有可靠的注销，属于宿主路由表行为）。
结果：新实例注册 6 条全部撞车（`duplicate exact route`），HTTP 面永远是旧代码，
从面板加的 watcher 一跑就报 `cannot get required service "agents" in inactive context`。
唯一的解法以前是**整进程重启**。

### 改法
1. **服务端**：注册时如果出现重复，就换一个带序号的前缀（`/session-superagent/r2`、`/r3`…）
   把 6 条**整组重放**，并在 `state.server.base` 与 `GET /state` 的 `routeBase` 里公布当前前缀。
2. **客户端**：面板首次加载时依次探 `/session-superagent`、`/r2`…`/r8`，
   认「`routeBase` 与请求前缀一致」的那个并切换 —— 老版本没有这个字段，行为不变。

这样热重载之后面板会自动用上新代码，不用再重启进程。

### 真机验证（不需要重启）
热重载触发后立刻自证：

```
state.server = {at: 21:41:12Z, routes: 6, failed: [], base: '/session-superagent/r2'}
GET  /session-superagent/r2/state -> 200，routeBase = /session-superagent/r2
POST /session-superagent/r2/watch（绑定不存在的会话）
     -> lastError = 会话已不在：请删除或重建这条主理鱼
     -> consecutiveFailures = 1，nextAt = 22:11:46Z（30 分钟退避）
watch_doctor -> "OK 面板接口挂载：6 条，无失败"
```

也就是说 0.8.21（agentsService）、0.8.22（异常退避）、0.8.29（挂载自检）、0.8.32（前缀接管）
**全部在真机生效，且没有重启进程**。

### 测试
- 路由层用例改成断言「撞车后整组 6 条换到 `/r2` 重放、`state.server.failed` 清零、前缀被记下」。
- 合计 **93 例**。

## [0.8.31] - 2026-11-02 —— 上下文已释放时，别再默默造一条死守

0.8.30 之后真机仍在报 `inactive context`（`server.at` 已经更新到 20:08，说明新实例挂上了），
结论是：**宿主重载后旧实例的 handler 仍然在吃 HTTP 请求**，而那条路径跑在已 dispose 的 ctx 里。
插件侧摘不掉它（这正是宿主的路由表行为，不是我们能改的）。

那就换一个策略：**别再装作成功**。

### 新增
`POST /watch` 在创建前先检查这个实例还能不能摸到 `agents` 服务；摸不到就返回

```
503 {"ok":false,"error":"插件实例已失效（当前 handler 跑在已释放的上下文里）：请重载 DSH 后再添加"}
```

用户会立刻看到"要重载"，而不是加了一条守、第二天发现它从没跑过。

### 测试
- 新增用例：ctx 读 `agents` 就抛且 `get('agents')` 也取不到时，`POST /watch` 必须返回 503 且提示重载。合计 **93 例**。

## [0.8.30] - 2026-11-02 —— 0.8.28 没修好：宿主重载是「重新 import 一份模块」

### 真机判定实验（20:00 重载后，routes 6 / failed []）
面板（HTTP）建的 watcher **仍然报**：

```
lastError: cannot get required service "agents" in inactive context
consecutiveFailures: 0 / nextAt: None
```

说明 0.8.28 的模块级 `activeRoutes` 没有生效 —— 因为**宿主重载是重新 import 一份模块**，
模块级变量全新（数组是空的），新实例根本不知道旧实例注册过什么。

### 修复
把三个必须跨实例共享的结构挂到 `globalThis` 上（用 `Symbol.for` 做键）：

| 结构 | 为什么必须共享 |
|---|---|
| `activeRoutes`（路由 disposer） | 新实例要能摘掉旧实例的路由，否则旧 ctx 继续吃 HTTP |
| `timers`（定时器句柄） | 旧实例的 tick 还持有已 dispose 的 ctx，必须清掉 |
| `inFlight`（并发闸） | 旧实例没跑完的那轮，新实例不能同时再跑一遍 |

### 守门
新增 `test/cross-instance.test.mjs`：用 `import('../lib/index.js?instance=1')` 与 `?instance=2`
模拟两次 import，断言第二个实例会摘掉第一个实例注册的 6 条路由。

### 测试
- 合计 **92 例**。

## [0.8.29] - 2026-11-02 —— `watch_doctor` 现在会告诉你「面板接口死没死」

这一轮的真机事故（重复路由 → 六条接口全灭）有个共同特征：**工具还是好的，只有面板挂了**。
`watch_status` 看不出异常，用户只会觉得"面板空白"。而 `state.server` 里其实一直记着挂载结果。

### 新增
`watch_doctor` 第一行现在是挂载状态：

```
OK   面板接口挂载：6 条，无失败
FAIL 面板接口挂载：webserver: duplicate exact route "/session-superagent/state"（工具仍可用，但面板会空白；重载一次即可）
WARN 面板接口部分失败（5/6 成功）：…
```

### 测试
- 新增用例：doctor 输出里必须有挂载状态行。合计 **91 例**。
  （写这个用例时踩到一个小坑：`cleanup` 用例会删掉临时状态目录，doctor 用例必须排在它前面 —— 否则看到的是"没有挂载记录"。）

## [0.8.28] - 2026-11-02 —— 旧实例还在吃 HTTP 请求（面板建的 watcher 一开就废）

### 真机复验发现
宿主在 19:49 挂载成功（`routes: 6, failed: []`），但**通过 HTTP（面板）建的 watcher 仍然报**：

```
lastError: cannot get required service "agents" in inactive context
consecutiveFailures: 0 / nextAt: None
```

对照实验：用**工具**（`watch_start`）建的 watcher 同一时刻轮询正常、无错误。
差别在于请求被谁处理 —— 路由最初由 19:32 那个实例注册，重载后若没走 dispose，
它继续吃 HTTP 请求，而它的 `ctx` 早已 dispose；于是那些 watcher 的定时器跑在死上下文里。

### 修复
模块级 `activeRoutes`：每次 `apply()` 注册路由前，**先摘掉上一次注册的**（接管而不是并存）。
配合 0.8.25 的单条容错与 0.8.26 的 teardown，重载后的三条路径都覆盖了。

### 测试
- 新增用例：同一模块 `apply` 两次时，第二次会先 unregister 第一批（6 条）再注册新的 6 条。合计 **90 例**。

## [0.8.27] - 2026-11-02 —— 文案核对 + 把 0.8.21–0.8.27 一次发到 npm

### 文案
- 「已添加，30 秒内开始轮询」不准确：`startWatcher()` 会**立刻**跑一次 tick（不等 30 秒的下限），
  改成「已添加，首轮立即开始轮询」。

### 发布
- 一次把 0.8.21–0.8.27 发出去（npm 上原来停在 0.8.20）。已确认 `latest = 0.8.27`，
  tarball 直装验证：`version 0.8.27`、`routes 6`、`client.js` 语法通过、新文案在位。这一批里有三个真机事故修复：
  `inactive context`（唤醒会失败）、未预期异常不退避、热重载后重复路由导致面板全灭。

### 测试
- 合计 **89 例**。

## [0.8.26] - 2026-11-02 —— 卸载时真的把路由摘掉（重复路由的根因）

0.8.25 让「一条重复不再全灭」，这一版处理根因：**卸载时要把旧路由摘掉**，否则宿主重载后
永远是新旧两套并存，面板读到的是旧 handler（改了密码却还是老数据那种感觉）。

### 修复
- 把清理逻辑抽成 `teardown()`，同时挂在 **`ctx.effect(() => teardown)`** 与 `ctx.on('dispose', …)` 两条路上：
  effect 作用域销毁时一定调用，事件广播方式也能覆盖。`teardown()` 本身可重复调用（摘完就清空列表）。

### 测试
- 新增用例：卸载时六条路由都被 unregister；重复卸载不会重复 unregister。合计 **89 例**。

## [0.8.25] - 2026-11-02 —— 热重载时一条重复路由会让**全部**接口消失

### 真机现场
```
server = {at: 19:38:26Z, error: 'webserver: duplicate exact route "/session-superagent/state"'}
```
宿主热重载时，旧实例的路由还没被 dispose，新实例注册第一条就抛 —— 而注册是**一整块 try**，
于是六条路由全军覆没，面板一片空白（数据接口全 404），只有重启才能恢复。

### 修复
每条路由改成单独容错（`addRoute()`）：重复的那条把原因记进 `state.server.failed`，
其余照常注册。单条重复不再等于全站不可用。

### 守门
新增 `test/route-resilience.test.mjs`：让宿主替身在注册 `client-error` 时抛重复路由，
断言其余 5 条仍然注册成功、`/state` 仍在、失败原因被记录下来。

### 测试
- 合计 **88 例**。

## [0.8.24] - 2026-11-02 —— 安装说明是错的（`npm i` 不会让 DSH 加载插件）

### 修复
README 原来写「方式一：npm，`npm i dsh-session-superagent`」，但 **DSH 插件必须装进 profile**
才会被加载（包里的 `dsh.bundle.patch` 由 profile 的安装流程读取）；`npm i` 只是下载到本地
`node_modules`，什么都不会发生。另一条「`dsh plugin add < GitHub URL>`」本机也没有这个子命令。

对照同机的其它插件（`dsh-unlag` 用 `dsh plugin install dsh-unlag`、
`dsh-better-sidebar` 用 `dsh plugin --profile web add …@latest`）改成：

```bash
dsh plugin install dsh-session-superagent
dsh plugin --profile desktop add dsh-session-superagent@latest
dsh plugin install /path/to/dsh-session-superagent      # 本地开发
```

并写清「`npm i` 不会生效」与「装进 profile 后是硬链接、新增文件要 `sync:profile`」。

### 测试
- 合计 **87 例**。

## [0.8.23] - 2026-11-02 —— README 补「故障排查」，并把链接到的文档发进包

### 文档
- README 新增**故障排查**表，全部来自真实事故：新增文件没进 profile 导致插件不挂载、
  硬链接断了导致「改了但没生效」、`inactive context`、幽灵会话不退避、
  npm 刚发布时的 `ETARGET`、以及「有动静但没被叫醒」该看哪里（`watch_status` 的 `deferred=`、面板的「最近被过滤」）。
- README 底部链接的 `UPDATING.md` / `CHECKLIST.md` / `MAINTENANCE.md` 之前**不在 `files` 里**，
  npm 页面上点了是 404。现在一起发出去（`npm pack` 10 → 13 个文件）。

### 测试
- 合计 **87 例**。

## [0.8.22] - 2026-11-02 —— 未预期异常也要退避（0.8.21 的同一类问题再补一刀）

0.8.21 修的是「读 `ctx.agents` 会抛」。修完回头看 tick 的兜底：

```js
} catch (error) {
  entry.lastError = String(error.message)   // 只记错误
}
```

也就是说 **任何**未预期异常都会让 watcher 按 `intervalSec` 无限重试 —— 正是 inactive-context
那次的症状（`consecutiveFailures: 0`、`nextAt: None`）。现在 catch 里也 `bumpFailure(entry, every)`，
坏掉的东西最多 30 分钟试一次，不会持续打 GitHub。

### 说明
这属于「同类问题系统性收口」，不是新功能：凡是走出 `pollOnce` 正常分支的失败，现在都会进退避窗口。

### 测试
- 合计 **87 例**（该分支需要真实定时器上下文，靠重载后的真机复验确认）。

## [0.8.21] - 2026-11-02 —— 真机复验抓到的**唤醒致命 bug**：inactive context

宿主重载后（`routes: 6`，0.8.14–0.8.20 全部生效）做了真机复验，造了一条绑定「不存在会话」的 watcher：

```
lastError: cannot get required service "agents" in inactive context
consecutiveFailures: 0     ← 没进退避
nextAt: None               ← 每 intervalSec 都会再打一次 GitHub
```

### 根因
定时器回调跑在**非活跃上下文**里，直接读 `ctx.agents` 会抛错。读 `goals` 一直用的是
`ctx.get('goals')`（不抛），唯独 `agents` 用的是 `ctx.agents` —— 这行代码在**每一次真唤醒**、
每一次「会话还在不在」判断上都会执行。

### 影响
- 幽灵会话判断（0.8.11）在本机其实从没跑到过：轮询在更早的一行就抛了。
- 更严重的是：**如果宿主对定时器上下文同样报错，真实唤醒也会失败**（看起来"在盯"，其实一次都没成）。

### 修复
新增 `agentsService(ctx)`：优先 `ctx.get('agents')`，取不到再兜底直接读；`wake()`、
`pollOnce()` 与两个工具（`watch_start` / `watch_stop`）全部改走它。

### 守门
新增 `test/agents-context.test.mjs`：用一个**读 `ctx.agents` 就抛**的宿主替身，验证
`watch_start` / `watch_status` 仍然正常，并断言不会把宿主的上下文错误当成轮询错误。这条路以前完全没测过。

### 测试
- 合计 **87 例**。

## [0.8.20] - 2026-11-02 —— 冷启动演练：工具返回要能证明「选项生效了」

照 HANDOFF + README 走一遍「加 watcher → 观察 → 确认」（不看代码，只看文档），暴露的摩擦点：

### 修复
- **`watch_start` 的返回看不出生效项**：只说 `watching … every 3600s`，`observe` / 过滤 / 时段 / 限流
  到底有没有落上，只能再开面板或读状态文件。现在返回会带回显：
  `[observe-only（只记录不唤醒） labels=ai-fix batch=5 perHour=6 goal="…"]`，更新已有 watcher 时标 `(updated existing watcher)`。
- **`watch_status` 同样不回显**：现在每行带 `observe / isolated / paused / hours= / labels= / onlyAssigned / deferred=`，
  一眼能看出「为什么没动静」。
- HANDOFF 补「在会话里自查」小表：首选工具（`watch_status` / `watch_doctor`），其次直接读状态文件，
  HTTP 只在面板/调试时用 —— 并写清端口每次重启都会变、怎么找（会话上下文里的 GUI URL 或按 PID 查 netstat）。
  冷启动演练时就是卡在「端口找不到」这一步。

### 发布
- 已发 `dsh-session-superagent@0.8.20`（一次性带上 0.8.17–0.8.20 的改动；`latest = 0.8.20`）。
- tarball 直装验证：`version 0.8.20`、**routes 6**、`client.js` 语法通过、
  包内只有 7 项（CHANGELOG/LICENSE/README/client.js/cordis.patch.yml/lib/package.json）。
- **CI 已接入 `preflight --fast`**：GitHub Actions 在 Node 22 / 24 两个矩阵上跑
  「单测 / 语法 / 版本一致 / 路由面 / 包内容」，本地无 profile 时该检查自动 SKIP。
  运行记录：`gh run list` → `test (22)` 与 `test (24)` 均 success。

### 测试
- 合计 **85 例**。

## [0.8.19] - 2026-11-02 —— `pnpm run preflight`：把「发版必跑」变成一条命令

### 新增
- `scripts/preflight.mjs`：七项检查一次跑完并以退出码给结论 ——
  单测、语法、profile 一致性（`--check`）、版本五处一致、路由面（6 条）、`npm pack` 内容、冒烟（gh 未登录自动 SKIP）。
  HANDOFF 的验证清单从散文改成这一条命令（散文会过期，脚本不会）。
- 自测时抓到并修掉一个真问题：preflight 自己的 `DSH_SUPERAGENT_NO_POLL=1` 会**泄漏给子进程**，
  导致冒烟「3 项 OK / 9 项 FAIL」。现在子进程环境会剔掉这三个开关。

### 变更
- **包内容精简**：`files` 去掉 `scripts/`，只发运行时需要的 6 项（`lib`、`client.js`、
  `cordis.patch.yml`、README、CHANGELOG、LICENSE）。`npm pack` 从 14 个文件降到 10 个。
  开发脚本仍在仓库里（`pnpm run preview` / `smoke:observe` / `preflight` 照旧可用）。

### 测试
- 合计 **85 例**（本轮无新增用例，改动是工具与打包）。

## [0.8.18] - 2026-11-02 —— watch_start 工具补齐参数（面板能配的，工具也要能配）

### 修复
- **`watch_start` 之前只接受 `repo` / `intervalSec`**：面板上能设的过滤、仅观察、隔离、时段、
  限流、每 watcher 目标，用工具都设不了 —— 而 README 把它们都写成能力。现在工具参数补齐
  （`labels` / `ignoreLabels` / `onlyAssigned` / `assignee` / `observe` / `isolated` / `workdir` /
  `activeHours` / `batchLimit` / `maxWakesPerHour` / `goal`）。
- **`intervalSec` 没夹紧**：工具里只判断 `> 0`，能把 5 秒写进状态文件（调度时按 30 秒跑，
  状态与实际不一致，面板也会显示「每 5s」）。现在夹到 30–3600。
- `workdir` 走工具时也要求绝对路径且存在。

### 测试
- 新增 2 例：工具参数落盘与夹紧（5→30、99→20、0→1）、相对 `workdir` 被拒。合计 **84 例**。

## [0.8.17] - 2026-11-02 —— README 声明与面板能力对齐（限流可改）

对着 README 逐条核代码时发现的落差：`batchLimit` / `maxWakesPerHour` 在服务端和工具里都支持，
**面板却没法设** —— 用户按 README 找这两个开关会找不到。

### 修复
- 「触发」页新增两个字段：**单次最多唤醒条数**（默认 5，夹到 1-20）、**每小时最多唤醒次数**（默认 6，夹到 1-60）。
- 行内编辑器同样能改这两项，保存走同一个 `POST /watch`。
- README 的限流一行补上「面板可改」并标注默认值与范围。

### 测试
- 新增用例：面板设置 `maxWakesPerHour: 99` 会被夹成 60 并回传。合计 **82 例**。

## [0.8.16] - 2026-11-02 —— 第一次在真浏览器里看面板，抓到一个对比度问题

宿主的 web 界面有鉴权（`dsh web authentication required`），ego 浏览器过不去，所以搭了个
**静态预览**：`scripts/render-preview.mjs` 用极简假 React 把真实 `client.js` 的组件渲染成 DOM，
内联移植来的官方 CSS，六个场景（总览/判定/触发/设置/术语表/两种 Toast）一起看。

### 修复（真浏览器里发现的）
- **错误 Toast 白字看不清**：0.8.12 给错误态加了「浅红底」，而官方 toast 是深底白字——
  白字压在浅粉上对比度极低。现在保留官方深底，改用**左侧红条**标记错误。

### 验证（在 Chromium 里读 computed style，不是猜）
```
模态框   position:fixed; inset:0，宽度 380 居中        ← 「弹层掉到页面底部」的 bug 确认已修
Toast    position:fixed; top:40px; z-index:1100; 299×46 深底白字
错误态   背景 #24292f / 白字 / 左边框 #f85149
标签     success 绿底绿字、warning 琥珀底琥珀字（tone 与 CSS 对得上）
列表行   高 102–122px（三线结构：标题 / meta / 操作）
```

顺带搞清了 `dt-tag` 的颜色依赖 `--dsw-alias-state-{success,warn,error,info}-primary` 这几个 token
（之前预览里缺，标签看着是裸文字——这和审核第二轮发现的「状态色全丢」是同一个根因）。

### 工具
- `pnpm run preview` 生成 `preview-panel.html`（已加进 .gitignore，不进仓库/不发包）。

### 测试
- 合计 **81 例**（本次是样式与渲染层修复，靠真浏览器核对）。

## [0.8.15] - 2026-11-02 —— sync-profile 支持修复断链（事故 1 的第二种形态）

### 修什么
`sync-profile.mjs` 之前只会「补缺失文件」，遇到**已存在但 inode 不同**（断链）只打印一句“注意”。
断链的来源很日常：任何用「写临时文件再 rename」保存的工具（含某些编辑器的原子写）都会让
profile 里那份留在旧 inode 上 —— 于是**宿主跑旧代码，仓库里看着是新代码**。

现在三种模式：

```bash
pnpm run sync:profile           # 补齐缺失（不动断链，只警告）
pnpm run sync:profile:repair    # 断链重建硬链接 + 清理 profile 里的陈旧文件
pnpm run sync:profile:check     # 只检查：有缺失/断链/陈旧就 exit 1（CI/发布前用）
```

实测：profile 里 `README.md` / `CHANGELOG.md` 当时确实是断链，`--repair` 重建后
`--check` 从 exit 1 变 exit 0。另外故意把 README 换成新 inode，验证 `--check` 会红（exit 1）。

### 守门
- 新增用例：`sync-profile` 的 `TARGETS` 必须覆盖 `lib/` 下所有 js 文件 ——
  防止「新增 lib 文件忘了登记」再次导致插件不挂载。

### 发布
- 已发 `dsh-session-superagent@0.8.15`（registry `latest = 0.8.15`）。
- tarball 直装验证：`version 0.8.15`、**routes 6**、`client.js` 语法通过、包内 `scripts/` 三个脚本齐全。

### 发布前快照（每次发版都跑这一套）
```
node --test                     81/81
node --check client.js lib/*.js scripts/*.mjs   全过
sync-profile --check            缺失 0 / 断链 0 / 陈旧 0，相对 import 全可解析
smoke-observe                   两场景 12 项 OK
npm pack --dry-run              13 文件 / 75.4 kB
```

### 测试
- 合计 **81 例**。

## [0.8.14] - 2026-11-02 —— 第四轮审核：1 条文档 + 3 条代码建议

审核范围 0.8.9→0.8.13（上一轮门禁只覆盖到 0.8.8）。结论：代码侧无阻塞，文档有 1 处必须修。

### 修复
- **幽灵会话不退避**（真问题）：绑到「已删除会话」的 watcher 每次轮询都打一次 GitHub 且永不休止
  （0.8.11 的分支直接 `return`，没走 `bumpFailure`）。现在会正常进入 30 分钟退避。
- **删掉 `/client-hello` 路由**：客户端只在那里发过一次 fire-and-forget fetch，而 `note('apply')`
  已经覆盖同一用途。路由 7 → 6，并加用例锁死路由集合（`/config`、`/client-hello` 都不该回来）。

### 文档
- HANDOFF 版本号 0.8.11 → 0.8.14；README / MAINTENANCE / HANDOFF 的测试数 77 → 80。

### 未采纳（附理由）
- **goal 文本里的 `【主理鱼】` 内联**：已压平换行（实测伪造抬头不会独占一行），
  且 goal 只能由面板或本地 POST 写入，风险低；强行改写用户文本得不偿失。
- **`sync-profile --repair`**：断链（inode 不同）目前只警告。已在 HANDOFF 写明「新增文件后必须跑」，
  留作后续（改起来简单，但此刻没有证据表明它造成过事故）。

### 发布
- 已发 `dsh-session-superagent@0.8.14`（registry `latest = 0.8.14`）。
- **从 tarball 真装验证**：`npm i https://registry.npmjs.org/dsh-session-superagent/-/dsh-session-superagent-0.8.14.tgz`
  → `apply()` 成功、**路由 6 条**（`/client-hello` 确实没了）、`client.js` 语法通过、`lib/` 四个文件齐全。
  注：刚发布时 `npm i pkg@x.y.z` 可能因客户端元数据缓存报 ETARGET，用 tarball URL 或 `--prefer-online` 可绕过。

### 其他
- `scripts/smoke-observe.mjs` 加 `gh auth status` 预检：没登录时明确 SKIP 并退出 0，
  不再把「凭证/网络问题」混报成逻辑失败（第四轮审核的建议）。

### 测试
- 合计 **80 例**（新增路由集合用例）。

## [0.8.13] - 2026-11-02 —— 真机跑「只观察」闭环，抓出两个真 bug

拿真仓库（MYCF711/dsh-GOkifu-compact，3 个真 issue）跑 observe 模式验证，抓到：

### 修复
- **`filteredLog` 从没落过盘**：`filteredLog` 不在 `POLL_RESULT_FIELDS` 白名单里，
  内存里写得好好的，`persistEntry` 一过滤就没了 → 面板「最近被过滤」永远是空的。
  现在进白名单，并补了守门用例。
- **空轮询不清理 `lastDeferred`**：把过滤器改严之后一条都不该唤醒，但面板仍显示上一轮的
  「仅观察：本轮本会唤醒 4 条（#4 #2 #3 #1）」——那是过期信息。现在 `fresh.length === 0` 时清空。

### 真机证据（修复前）
```
observe: true
lastDeferred: 仅观察：本轮本会唤醒 4 条（#4 #2 #3 #1）
history: [{"numbers":[4,2,3,1],"ok":false,"reason":"observe"}]
filteredLog: []        ← 改成 labels:["ai-fix"] 后仍为空（3 个 issue 都没这个标签）
```

### 发布与真机验证
- 已发 `dsh-session-superagent@0.8.13`。
- **`watch_ack` 第一次在真仓库上验证**：给 `MYCF711/dsh-GOkifu-compact#2` 打上 `主理鱼:已处理`——
  GitHub **接受中文 + 冒号**的标签名（此前审核把它列为"未验证"）；重复 ack 幂等不报错；
  验证完已把 issue 标签与仓库标签定义都撤掉，不留痕迹。

### 测试
- 合计 **79 例**。

### 进程内冒烟（补证：这两个修复到底生效没有）
`pnpm run smoke:observe`（`scripts/smoke-observe.mjs`）—— 独立进程、独立状态目录、
捕获 `setInterval` 手动驱动，会真的读 GitHub 只读 API：

```
OK   观模式仍未唤醒            （followups = 0）
OK   filteredLog 已落盘        （4 条）
OK   过滤原因可读              （"不在标签白名单: ai-fix"）
OK   /state 能读到过滤记录
OK   空轮询清掉了过期的 lastDeferred

== 场景 B：真唤醒 + 隔离 worktree ==
OK   唤醒了一次                        （followups = 1）
OK   消息带【主理鱼】抬头
OK   消息带条目编号                     （#2 #4 #3 #1，真 GitHub 数据）
OK   消息带本条目主理目标               （「把 widget 的 issue 都处理完」）
OK   消息带隔离路径
OK   worktree 真的建了                  （.dsh-zhuli/MYCF711-dsh-GOkifu-compact-smoke-se-…）
OK   .dsh-zhuli 下正好一个副本
```

消息实样（真数据）：

```
【主理鱼】MYCF711/dsh-GOkifu-compact 有 4 条新动态：
#2 [open] docs/bench：给「351 tokens」和「失败保留 8/8」补一条可复跑的复现命令 — @MYCF711 (issue) …
#4 [closed] 【联调】v0.1.0 唤醒链路验证 — @MYCF711 (issue) …
【隔离工作区】…\.dsh-zhuli\MYCF711-dsh-GOkifu-compact-smoke-se-…
本条目主理目标：把 widget 的 issue 都处理完
```

## [0.8.12] - 2026-11-02 —— 体验打磨四条

### 改了什么
- **Toast 改成官方单条语义**：移植来的 `.dt-toast` 是 `position:fixed` 顶部居中、自带淡出动画，
  同时挂多条会**重叠成一团**。现在同一时刻只显示最新一条，停留时长用官方的 `--dt-toast-hold` 控制，
  错误态保留淡红底 + `role=status` / `aria-live=polite`。
- **页签焦点跟随**：方向键/Home/End 切页后，焦点跟到新页签 —— 之前旧页签变 `tabIndex=-1`、
  新页签变 0，但焦点留在原地，键盘用户会「掉出」tablist。
- **删掉 `/session-superagent/config`**：它和 `/state` 重复，是未鉴权的 GET，而且上一轮
  `ReferenceError: gh is not defined` 就出在它身上。现在路由从 8 条减到 7 条，测试改为断言它已下线。

### 发布与验证
- 已发 `dsh-session-superagent@0.8.12`（registry 确认 `latest=0.8.12`）。
- **从 registry 真装一遍验证**（不是只看 `npm pack`）：
  `npm i dsh-session-superagent@0.8.12` → `import(...)/lib/index.js` → `apply()` 成功、
  路由 **7** 条（`/config` 确实没了）、`node --check client.js` 通过。
- 新增守门：`lib/` 里每个相对 import 必须能解析到真实文件（发布前挡住 `body.js` 那类事故）。

### 测试
- 合计 **78 例**（`/config` 用例改为「路由表里不应再有它」+ 相对 import 守门）。

## [0.8.11] - 2026-11-02 —— 真机验证隔离执行 + watch_doctor

### 验证（这轮真的在跑起来的宿主上做的）
- **`watch_doctor` 真机输出**（此前只有单测）：
  ```
  OK   gh 登录：正常
  OK   MYCF711/dsh-GOkifu-compact 可访问
  WARN ack 标签「主理鱼:已处理」：不存在（首次 watch_ack 会自动创建）
  OK   隔离工作目录 E:/temp/iso-smoke：是 git 仓库
  INFO 运行中 · 上次轮询 … · 错误：wake failed: session not live
  ```
- **隔离执行 E2E**：建一条 `isolated:true` + `workdir` 的 watcher → 首轮 tick 真的建出
  `.dsh-zhuli/MYCF711-dsh-GOkifu-compact-<id>` + 分支 `zhuli/<id>`，`/state.lastWorktree` 同步，
  `history` 记下「本会唤醒 #4 #2 #3 #1」。

### 修复
- **会话已不存在时不再白建隔离区**：扫码阶段先查 `ctx.agents.get(sessionId)`，
  没有会话就直接把 `lastError` 写成「会话已不在：请删除或重建这条主理鱼」并跳过本轮，
  不再先 `git worktree add` 再 wake 失败（实测那条会留下一个永远用不上的 worktree）。
- 测试现场已清理（worktree、`zhuli/*` 分支、临时仓库）。
- **重启后在 0.8.11 上复验**：造一条 `sessionId` 不存在的 `isolated:true` watcher，
  结果是 `lastError="会话已不在：请删除或重建这条主理鱼"`、`lastWorktree=null`、**没有** `.dsh-zhuli` 目录
  （修复前会先建一个永远用不上的 worktree）。

### 发布
- **已发布到 npm**：`dsh-session-superagent@0.8.11`（`npm view` 确认，tarball 220.6 kB / 13 文件）。
- 顺手把 `latest` 指向 0.8.11，并把 npm 自动生成的 `0.0.0-stage` 占位版标为弃用
  （否则 `npm i dsh-session-superagent` 会装到那个空占位）。
- GitHub Release：https://github.com/MYCF711/dsh-session-superagent/releases/tag/v0.8.11

### 测试
- 合计 **77 例**（本修复属运行时守卫，靠真机 E2E 验证）。

## [0.8.10] - 2026-11-02 —— 生产事故：新增文件没进 profile，插件整个不挂载

### 事故
23:59 重启后，插件**完全没挂载**：`/session-superagent/*` 全部 404、`watch_*` 工具消失，
但客户端 bundle 照常加载（`client-version 0.8.9` 正常），表面看起来"插件还在"。

根因：profile 是 `file:` 安装，pnpm 只对**安装时已存在的文件**建硬链接。
本次新增的 `lib/body.js` 不在 profile 的 `node_modules/dsh-session-superagent/lib/` 里，
宿主 `import './body.js'` 直接 `ERR_MODULE_NOT_FOUND` → 整个插件加载失败。
改内容会同步（同 inode），**加文件不会** —— 这是硬链接安装方式的隐性坑。

### 修复
- 新增 `scripts/sync-profile.mjs`：把运行时文件同步进 profile（缺的建硬链接、已存在的核对 inode），
  并静态检查 `lib/` 里每个相对 import 都能解析到真实文件（这次事故的直接原因）。
- `package.json` 加 `pnpm run sync:profile`。
- 已手工补齐 `lib/body.js` 并调 `unlag` 刷新，插件当场重新挂载：`server.routes = 8`、
  `/state` 与 `/config` 恢复 200、`gh` 健康字段返回 `gh version 2.101.0`。

### 教训（已写进 HANDOFF 的坑列表）
**新增文件后必须 `pnpm run sync:profile`**，否则下次重启插件会静默消失。

## [0.8.9] - 2026-11-01 —— 终审的两个阻塞项

第三轮（发布门禁）审核指出 0.8.8 有两处必须修，都已修并补了能钉住它的测试：

### 修复
- **「goal 进唤醒消息」是假功能**：0.8.8 只在 `formatWatchText` 里算了 `goalLine`，
  **没有拼进 return**（`grep -c goalLine` = 1）。实测带 goal 与不带 goal 的消息**字节相同**，
  而测试里没有任何断言，所以 75 例全绿。现在真的拼进去了，并且把 goal 里的换行压平成一行
  （避免多行文本切坏消息结构），新增 1 例断言「带 goal 的消息必须和不带的不同」。
- **`sessionFileCache` 的 TTL 被 `|| !file` 废掉**：只要有一个 watcher 的会话日志不存在，
  每次 `/state` 都全量重建索引（终审实测 200 会话从 0.6ms 退化到 130-150ms、800 会话 340-520ms，
  同步 IO 跑在宿主主线程）。改成负缓存：miss 也走 TTL。
- **孤儿目录永远删不掉**：`git worktree remove` 对「已经不是工作树」的目录返回 128，
  原逻辑 `continue` 导致目录和分支都留下。现在失败时 `rmSync` 兜底，并且无论成败都尝试 `branch -D`。

### 其他
- `SegTabs` 空列表守卫（空数组会让 `onChange(undefined)` 把页面置空）。
- 新增 armed 态用例：删除按钮点第二次时仍保留 `dt-btn` 基类并带 `dt-danger`。
- README / MAINTENANCE / HANDOFF 的测试数与版本号同步到 77 / 0.8.9。

### 测试
- 合计 **77 例**。

## [0.8.8] - 2026-11-01 —— 收掉性能与「只写不读」的两个尾巴

### 修复
- **`/state` 的性能坑**：`sessionTitle()` 每条 watcher 都会 `readdirSync(sessions)` +
  逐 group `existsSync`，面板 5 秒一轮就是几十次同步 IO。现在加了 60 秒 TTL 的
  「sessionId → 会话日志路径」索引缓存，命中后只 stat 单个文件。
- **`entry.goal` 只写不读**：「目标/规则」字段之前存进去却没人用（唤醒消息不带、面板不显示）。
  现在真的进唤醒消息（`本条目主理目标：…`），触发页与行内编辑都能改，列表每行也显示 `目标: …`。
  注意区分：`watcher.goal` 是**会话 goal**（`/goal` 那份），`watcher.note` 才是每条自己的目标/规则。
- `useToast` 的定时器数组用后即删（长会话里之前只增不减）。

### 测试
- 合计 **75 例**（用例改为断言「目标/规则」取自 `note` 字段）。

## [0.8.7] - 2026-11-01 —— 审核遗留的三条

第二轮审核「仍未处理」清单里的三项，收掉：

### 修复 / 补齐
- **隔离分支不再泄漏**：回收过期 worktree 时同步 `git branch -D zhuli/<id>`。
  之前只 `worktree remove`，每次唤醒产生一个 `zhuli/*` 分支，分支表会无限增长。
- **恢复会话标题与每行 goal**：GUI 重写时丢了「会话：xxx」和行内 goal 展示，现在补回
  （头部 `会话：<title> · 盯办 + 主动办…`，每行 meta 里 `goal: <objective 前 40 字>`）。
- **SegTabs 键盘导航**：←/→/Home/End 循环切页签，与官方 controls.tsx 行为一致（tablist 语义 + aria-selected）。
- **`StateDot` 透传 `className`**：官方 `.dt-dot` 样式（`flex:none; margin-top:5px`）终于生效。

### 测试
- 新增 1 例：面板恢复显示会话标题与每行 goal。合计 **75 例**。

## [0.8.6] - 2026-11-01 —— 复核发现的最后一个必须修

第二轮审核复核（HEAD 0.8.5）结论：7 个必须修里 6 个通过，第 7 个「只修了一半并引入新 bug」。

### 修复
- **删除按钮样式全丢**：`ConfirmBtn` 传的 `className` 被 `Btn` 里的 `...rest` 整个覆盖
  （`h('button', { className: ..., ...rest })` 展开在后面），实测渲染出的删除按钮 `className: undefined`，
  连 `dt-btn` 基类都没有 —— 比修之前更难看。`Btn` 改成先展开 `rest`、最后合并 `className`。
- **错误 toast 没有底色**：`.dt-toast` 的 `background` 在 CSS 中位于 `.dt-danger` 之后、同权重覆盖，
  错误提示看不出是错误。错误态改为内联 `color-mix` 底色。
- **重入保护缺失**：删掉死代码 `useAction` 后连点两次「保存」仍会发两个 POST。`run()` 加 `busyRef` 闸。
- 去掉与注释不符的 toast 内联容器（`.dt-toast` 自带 fixed 定位，容器尺寸为 0）。
- `test/routes.test.mjs` 的 `cleanup` 挪到文件末尾（新用例原本跑在删目录之后）。
- 清掉两份 markdown 里因转义写坏产生的 0x08 退格符。

### 守门加强
- 「`dt-*` 类名必须存在于移植 CSS」的检查从只扫 `className: '...'` 扩展到**任意字面量**
  （`cx('dt-foo')` / `'dt-btn-danger'` 这类也能抓），并在仓库副本里故意塞假类名验证过会红。
- 新增用例：删除按钮必须保留 `dt-btn` 基类 + `dt-btn-sm` 尺寸类。

### 测试
- 合计 **74 例**。

## [0.8.5] - 2026-11-01 —— 第二轮严格审核后的修复

`docs/review-2026-11-01.md` 第二轮（GUI 移植专题）给出 **7 个必须修 + 13 条建议**，必须修全部已修：

1. `/config` 引用未定义的 `gh` → 每次调用抛 ReferenceError（`gh` 声明在 `/state` 里）。
2. `/state` 根本没返回 `gh`（上一版错插到 `/config`），设置页「来源」永远「检测中…」。
3. GUI 行内保存会清空 watcher 的 `goal`（无条件覆盖）。
4. GUI 只发 `labels/onlyAssigned`，服务端整对象重建 → `ignoreLabels/skip*/assignee` 被抹成默认。
5. `isolated` 只能开不能关（`||` 写法），Toggle 成了单向开关。
6. 术语表 Modal 用了 3 个官方 CSS 里不存在的 class → 弹层落到页面最底部、无遮罩、无 Escape。
7. Tag tone 传 `ok/warn`，而官方 CSS 只有 `success/warning`；另有 8 个 class 缺失（`dt-btn-danger` 等）。

### 顺带
- `useToast` 的定时器在卸载后仍然 `setState` → 现在用 ref 存句柄并清理。
- `ConfirmBtn` 丢掉 `size` 参数、token 输入框明文显示 → 都修了。
- 删除未使用的 `Pill` / `useAction`；判定页列表 key 加 `sessionId`。
- 仓库里 tracked 的两个 `.tgz` 移出版本库（`.gitignore` 早已有 `*.tgz`）。
- README / MAINTENANCE / HANDOFF 的测试数同步到 73。

### 新增守门
- `client.js` 用到的 `dt-*` 类名必须存在于移植的 CSS 里（这次 7 个必须修里有两个属于这类）。
- 路由层：`/state` 必带 `gh`、`/config` 不得抛错、编辑保存不得清空 goal / 抹掉未暴露 filters / 单向 isolated。
- 修掉 `meta.test.mjs` 里 `new RegExp(''+…)` 实为退格符的旧 bug（那条守门此前形同虚设）。

### 测试
- 合计 **73 例**。

## [0.8.4] - 2026-11-01 —— 判定页 + 文档收尾

### 新增
- **「判定」页**（对应官方 `eval` 页）：把每条主理鱼的唤醒历史按时间倒序列出来 ——
  「已唤醒 #12 / 仅观察（未唤醒）#13 / 跳过：agent busy」，一行一条，带状态点和相对时间。
  这是 IPC「主理鱼到底判断了什么」的直接答案。

### 文档
- README 的界面章节改为四页结构（总览 / 判定 / 触发 / 设置）。
- HANDOFF 更新到 0.8.4（70 例测试，能力表补上「移植官方 GUI」一行）。

### 测试
- 新增判定页用例。合计 **70 例**。

## [0.8.3] - 2026-11-01 —— 官方 IA 的收尾三件

对应 `docs/official-gui-ia.md` 映射表里剩下的三个 ➕（全局搜索、术语表、来源健康）。

### 新增
- **来源卡片**：设置页第一屏 —— 绑了哪些仓库、`gh` CLI 是否可用（带版本）、凭证是面板配的还是回退 gh 登录态。
  服务端 `/state` 新增 `gh` 字段，5 分钟缓存的 `gh --version` 探针，不让面板每 5 秒 spawn 一次。
- **全局搜索**：面板头部搜索框，按仓库名 / 编号 / 条目标题过滤主理鱼与被过滤记录，标题变成「搜索结果」。
- **术语表 Modal**：把「主理鱼 / 盯 / 办 / 唤醒 / 过滤 / 时段 / 隔离 / ack / goal / 凭证」做成一张表，
  点头部「术语」打开 —— 对应官方那个 glossary modal。

### 测试
- 新增 1 例：搜索过滤生效、来源卡片显示 gh 版本、术语表可打开。合计 **69 例**。

## [0.8.2] - 2026-11-01 —— 观察模式 + 可解释的过滤

对应 `docs/official-gui-ia.md` 映射表里两个 ➕（官方 `observe` 模式、`source/filtered` 折叠）。

### 新增
- **仅观察模式**（`observe: true`，对标官方 off/observe/auto 三态里的 observe）：
  照常判定、照常写水位，但**不真唤醒**，只把「本轮本会唤醒哪几条」记进 `lastDeferred` 与 `history`。
  灰度上线/调规则时先用它看行为，不用担心手一抖就把会话叫醒。
- **过滤记录**（对应官方 `source/filtered`）：每次轮询把被过滤掉的条目记最多 5 条 +
  人话原因（`已关闭` / `草稿 PR` / `机器人` / `排除标签: x` / `不在标签白名单: x` / `没有指派给人` / `已 ack`），
  面板总览多一个「最近被过滤」区块。这是「主理鱼到底在不在干活」最直接的证据。
- 新增 `filterReason()`：`passesFilters` 现在只是它的布尔包装，原来只能回答「过/不过」，
  现在能回答「因为哪条规则不过」。

### 测试
- 新增 `filterReason` 7 种原因 + `pushFiltered` 环形缓冲 + 面板「仅观察/最近被过滤」。合计 **68 例**。

## [0.8.1] - 2026-11-01 —— 按官方 IA 报告补三块

`docs/official-gui-ia.md`（931 行，独立考古员产出）给的施工建议前三条，这一版做完前两条的全部 + 第三条：

### 新增
- **`usePoll`**（官方 provider 策略）：可见时 5s、**页面隐藏时降频 6 倍**、上一轮没跑完就跳过、卸载清干净。
  替掉原来的裸 `setInterval`。
- **Toast**：操作反馈改成右下角堆叠提示（4 秒消失），错误同时留在顶部横幅。
- **「需要关注」清单**（对标官方 problems）：把 `lastError` / `lastDeferred` / 未配置凭证
  汇总成可读问题列表，而不是散落在每行红字里。
- **行内编辑**（对标官方 SourceCard + SaveBar 精简版）：每条主理鱼多了「编辑」按钮，
  可以就地改间隔 / 标签过滤 / 时段 / 只看指派 / 隔离 / 工作目录，带「保存 / 放弃」；
  保存走同一个 `POST /watch`（同 repo+sessionId 即更新，`enabled` 不传保持原值）。

### 修复
- 改 `intervalSec` 之前要重启宿主才生效 —— 因为 `startWatcher` 见到 timer 已存在会直接返回。
  现在保存配置后先 `stopWatcher` 再 `startWatcher`。

### 测试
- 新增 2 例：problems 清单、编辑态出现「保存/放弃」。合计 **65 例**。

## [0.8.0] - 2026-11-01 —— 移植官方 superagent 的 GUI

把官方 `dsh-superagent`（本地 checkout 的 dsh-superagent-prototype）的**设计系统与信息架构**
搬进「主理鱼」标签页，数据接我们自己的 `/state`、`/watch`。

### 移植了什么
- **整套样式表**：从官方编译产物里抽出 40,557 字符 / 383 行 / 376 条选择器（`dt-*` 设计系统，
  全部基于 `--dsw-alias-*` token），原样注入，视觉与官方一致。
  用 `node scripts/port-official-ui.mjs` 可重复生成，不是手抄。
- **UI 原语**：Icon（含官方 30 个 SVG 图标）、Btn、Tag、Pill、SegTabs、Input、Toggle、
  StateDot、Dot、Section、Hint、KeyValues、Modal、ConfirmBtn。
- **三页信息架构**（对应官方 overview / trigger / settings）：
  - 总览：统计条（条数 / 主理中 / 已暂停 / 异常）+ 每条主理鱼的状态点、标签（时段 / 隔离 / 过滤 / 退避）、
    操作（立刻 / 暂停恢复 / 删除二次确认）
  - 触发：新增表单（仓库 / 间隔 / 标签 / 时段 / 只看指派 / 隔离 / 工作目录）
  - 设置：凭证（token 只显示「已配置」）+ 会话 goal
- 删除旧面板 265 行 + 未使用的 `Field` 辅助（净减 ~110 行代码，功能更多）。

### 没移植的（附理由）
- `source` / `eval` / `execution` / `deployment` / `prompts` 五个页：官方是「飞书 + 执行器 + 评估 + 提示词」
  那一套多 agent 编排，我们没有对应后端，硬搬会变成假按钮。
- `sidebar.panellist` / `plugins.row.config` 两个槽位：我们的插件只 inject `ui-conversation`，
  这两个槽位不在可见面上。

### 测试
- 面板用例重写为官方布局断言（统计条、三个页签、行内三个按钮、退避/隔离标签）。合计 **63 例**。

## [0.7.5] - 2026-11-01 —— 严格审核后的修复

审核专员（独立上下文、只读、9 个复现脚本）对 v0.7.4 给出 **8 个必须修 + 14 个建议**，
完整结论见 `docs/review-2026-11-01.md`。八个必须修**全部已修**：

1. `recordReported` 从未 import —— 每次成功唤醒都抛 `ReferenceError`（冷却吸收因此在线上是死的）。
2. `polling` 并发闸跨对象失效 —— 同一条 issue 被唤醒 3 次、建 3 个 worktree。改成 `inFlight: Set`。
3. 每小时上限分支边「攒」边吞掉条目 —— 现在只记 `lastDeferred`，不动水位。
4. tick 收尾把「暂停」写回成运行中 —— 抽出 `mergePollResult()`，配置字段以盘上为准。
5. 隔离区在 idle 检查之前创建，忙时每轮白建 worktree —— 先 `decideWake` 再隔离。
6. `dispose` 没清定时器 —— 现在清 `timers` 与 5s sweep。
7. `trigger.json` 测试通道随包发布 —— 默认关闭，需 `DSH_SUPERAGENT_TRIGGER=1`。
8. SSH 私钥功能是空的且掩码泄露全路径 —— 面板不再回显路径，token 只回 `configured`。

### 顺带修的
- `workdir` 要求绝对路径 + 存在；`enabled` 未传时保持原值；状态文件改原子写；
  `client-note` 加键白名单；`github` 工具拒绝 `-` 开头的 path；9 处过期文档。

### 测试
- 新增 import 守门（能钉住 #1 这类事故）+ `mergePollResult` 用例。合计 **63 例**。

## [0.7.4] - 2026-11-01

### 新增
- **路由层单测**（`test/routes.test.mjs`，7 例）：此前 HTTP 路由是 0 覆盖，全靠真机 curl 手测。
  现在用假 `ctx` 捕获 `apply()` 注册的工具与路由，再用假 req/res 跑完整链路：
  建 watcher → `/state` 查 → pause → resume → delete、非法 action、未知 id、405、探针写入。
- 两个测试隔离用开关（也是实用功能）：
  - `DSH_SUPERAGENT_STATE` 覆盖状态目录（默认 `~/.dsh/state/session-superagent`）；
  - `DSH_SUPERAGENT_NO_POLL=1` 只登记 watcher 不轮询。

### 变更
- watcher 的 `setInterval` 加 `unref()`，测试进程不会被定时器吊住（宿主不受影响）。

### 测试
- 合计 **61 例**。

## [0.7.3] - 2026-11-01

### 修复
- **CHANGELOG 丢了 14 个版本**：0.3.7 ~ 0.7.2 的条目全没进去。原因是插入新条目时用
  `s.replace('## [0.3.x] ...', 新条目 + 锚点)`，锚点早就不存在 → python 的 `str.replace` **静默无操作**，
  而我当时没 grep 验证。现在已按 git 提交历史补齐 0.3.7 起的全部条目。
- README 版本徽章停在 0.3.6，同步到当前版本。
- `package.json` 缺 `author` / `homepage` / `bugs`；`files` 漏了 `scripts/preview-orbit.mjs`
  （README 里写了 `pnpm run preview:orbit`，但发布包里没有那个文件）。

### 新增
- **版本一致性守门测试**（`test/meta.test.mjs`，4 例）：CHANGELOG 顶部版本、README 徽章版本、
  `CLIENT_VERSION`、必需元数据 —— 三者任一与 `package.json` 不一致就红。

### 测试
- 合计 **54 例**。

## [0.7.2] - 2026-11-01

### 新增
- **`watch_doctor` 自检工具**：一条命令体检所有 watcher —— gh 是否登录、仓库能不能访问、
  ack 标签在不在、隔离 workdir 是不是 git 仓库、上次轮询状态。只读。
- **唤醒历史**：每次唤醒记 `{at, numbers, ok, reason}`（保留 20 条），`/state` 回传最近 5 条；
  面板显示「上次唤醒 #12 #13 · 2 分钟前」或「上次唤醒失败 #7」。

### 测试
- 新增唤醒历史的面板用例。合计 **50 例**。

## [0.7.1] - 2026-11-01

### 新增
- 新增表单补齐三个开关：活跃时段、隔离执行、隔离工作目录（此前只能走 API 传）。
- **ack 标签自动创建**：GitHub 不会因为 `POST /issues/{n}/labels` 而自动建标签（不存在返回 422），
  现在先幂等建一次（已存在也返回 422，忽略），再打标签。
- **失败提示可执行化**：`lastError` 在原始 stderr 后补一句人话 —— 401 → 跑 gh auth login；
  404 → 检查 owner/name；找不到 gh → 确认已安装且在 PATH。

### 文档
- README / HANDOFF 同步。

## [0.7.0] - 2026-11-01

### 新增
- **活跃时段**（`activeHours: "09:00-23:00"`，支持跨夜）：不在时段只攒不唤醒。
- **会话忙时排队重试**：失败原因含 busy/running/idle 时**不退避**，下一轮直接重试；真失败才退避。
- **`watch_ack` 批量**：`numbers: "12,13,14"` 一次 ack 多条。
- **面板显示隔离状态与活跃时段**；**值守台「全部暂停 / 全部恢复」**。

### 测试
- 新增 `inActiveHours` 与两个 UI 用例。合计 **49 例**。

## [0.6.2] - 2026-11-01

### 新增
- **隔离区自动回收**：`staleWorktrees()` + `cleanupWorktrees()`，每次开新隔离区前回收超过
  `isolateKeepDays`（默认 3 天）没动过的旧副本。

### 修复
- 又一个「改了没写盘」：给 `lib/watch.js` 加函数时只改了内存字符串，文件没写，而 `index.js` 已经 import
  —— `node --check` 查不出来，宿主重启时整块插件会加载失败。新增守门测试：解析 import 列表逐个断言导出。

### 测试
- 新增 2 例。合计 **46 例**。

## [0.6.1] - 2026-11-01 —— 隔离执行真机验证暴露的三个问题

### 修复
- **中文路径被写成乱码**：Windows 下 argv 里的中文常是 GBK 字节，按 UTF-8 解得到一串 U+FFFD
  （实测中文路径 `D:/某中文目录/...` 存成 `D:/??????/...`，worktree 建不出来）。新增 `decodeBody()`：
  UTF-8 解码出现替换字符就用 `TextDecoder('gbk')` 重解。
- **同一个 watcher 并跑两轮**：首轮 tick 与手动「立刻」撞车会开两个隔离区。`entry.polling` 做并发闸，重复请求 409。
- `/state` 补 `isolated` / `workdir` / `lastWorktree`。

### 测试
- 新增 `decodeBody` 用例。合计 **44 例**。

## [0.6.0] - 2026-11-01

### 新增
- **隔离执行**（对标 DeepSeek DSec）：watcher 支持 `isolated: true` + `workdir`，每次唤醒前
  `git worktree add` 一个一次性副本（分支 `zhuli/<id>`，目录 `<workdir>/.dsh-zhuli/<id>`），
  唤醒消息给出路径与分支并写明「只在这里改、推这个分支开 PR、别碰主工作区」。
  建不出来不阻断唤醒，消息里改成「【隔离失败】原因」。

### 测试
- 新增 `worktreePlan` 与隔离消息用例。合计 **43 例**。

## [0.5.1] - 2026-11-01

### 新增
- 面板显示过滤器 / 退避 / 攒批；值守台状态列在退避窗口内显示「退避中」。

### 测试
- 合计 **41 例**。

## [0.5.0] - 2026-11-01

第一个「按竞品和论文调过」的版本，整合 0.4.1 + 0.4.2 并补齐文档。

- 触发许可 `filters`、限流 `batchLimit` / `maxWakesPerHour`、失败指数退避
- 幂等 `watch_ack`（GitHub 打标签）、交互「立刻」按钮、可验证的完成标准
- 记忆 `seen` 30 天 / 500 条自动遗忘
- 文档：`docs/competitive-analysis.md`、`docs/deepseek-papers.md`、`HANDOFF.md` 重写

## [0.4.2] - 2026-11-01

### 新增
- **幂等标记落在 GitHub 上**：`watch_ack` 给 issue/PR 打 `主理鱼:已处理` 标签并前移本地水位；
  轮询跳过带标签的条目（换机器、删状态文件都不重报）。
- **立刻跑一次**：`POST /watch {action:"poll"}`，面板/值守台每行「立刻」按钮。
- **面板配过滤器**：新增表单加「只处理这些标签」「只处理已指派给人的条目」。

### 变更
- 唤醒消息的完成标准改成可验证（没跑测试不算完成）。
- `seen` / `lastReported` 增加记忆遗忘。

### 测试
- 合计 **39 例**。

## [0.4.1] - 2026-11-01

### 新增（竞品蒸馏）
- **触发许可**：`filters`（labels / ignoreLabels / skipBots / skipDrafts / skipClosed / onlyAssigned / assignee）。
- **批量铺开**：`batchLimit`（默认 5），其余给编号。
- **每小时上限**：`maxWakesPerHour`（默认 6）。
- **失败退避**：30s → 60s → 120s … 封顶 30 分钟。
- **唤醒消息结构化**：类型、草稿、标签、指派、链接 + 明确约束。

### 测试
- 合计 **37 例**。

## [0.4.0] - 2026-11-01

### 变更
- **「盯办」改名「主理鱼」**：「主理人」的职责（盯场子 + 拿主意 + 动手办）搬到会话里就是这条鱼；
  本机主力模型是条大肥鱼（deepseek-v4.1），所以不叫主理人，叫主理鱼。
- 标签页 `主理鱼`、状态 `主理中`、量词用「条」。

### 测试
- 合计 **30 例**。

## [0.3.9] - 2026-11-01

### 变更
- **「值守」改名「盯办」**：旧词只覆盖被动半边（轮询/去重/唤醒），漏掉醒之后的主动推进。
  标签页 `盯办台`、状态 `盯办中`。

## [0.3.8] - 2026-11-01

### 变更
- 状态栏面板表头由「会话级 superagent」改为「值守」，右侧计数改「0 个」——
  那个短语是插件自称，和会话标题撞名会让人以为是会话名。

## [0.3.7] - 2026-11-01

### 新增
- 客户端版本探针 `CLIENT_VERSION`：每次模块加载写一次 `/client-note?key=client-version`，
  用来确认浏览器里跑的是哪一版（顺带发现客户端插件是**热重载**的，不需要重启）。

## [0.3.6] - 2026-11-01

### 变更
- 空态面板收紧：宽度 344 → 252，正文压成一句「在「值守台」填 owner/name 添加。」，
  不再显示「点「暂停 / 删除」直接停掉」这条脚注（没有值守时它没有指向对象）。

## [0.3.5] - 2026-11-01

### 变更
- **0 个值守也占位**：之前整条直接不渲染，看起来像插件失效；现在画一个灰色空环
  （`currentColor` + 0.38 透明度、无卫星、不转、不呼吸），点开面板提示「还没有值守，去值守台添加」。
- **轨道环挪到 dock 行最左端**：`order: 2` → `order: -10`，排在「轮/步」「token」之前，
  不再紧贴上下文环。
- `pnpm run preview:orbit` 的预览里加了空态这一行。

## [0.3.4] - 2026-11-01

### 修复
- **凭证卡片里的 SSH 路径示例是坏的**：源码写成 `'D:\keys\id_ed25519'`，JS 把 `\k` `\i`
  当转义吃掉，界面上显示成 `D:keysid_ed25519`。现在示例正确显示 `D:\keys\id_ed25519`。

### 变更
- 凭证卡片底部补一句说明：不填也能用（插件直接复用已登录的 gh CLI）；只有想给 agent
  单独一个 token、或走 SSH 推代码时才需要填。

## [0.3.3] - 2026-11-01

### 新增
- **值守能关了**：`POST /session-superagent/watch` 接受 `{ action: "pause" | "resume" | "delete", id }`，
  `id` 形如 `owner/name#session-…`（`/state` 现在会把 `id` 一起返回）。
  - `pause`：`enabled=false` 并**清掉那条定时器**（原来只能靠宿主重启才停得下来）；
  - `resume`：重新起定时器，顺手清掉旧的 `lastError`，卫星不会一上来就是红的；
  - `delete`：连条目一起删（`seen` 水位也走掉，重新加会重新报一遍历史动态）。
- **状态栏面板每行**有「暂停 / 恢复 / 删除」；**值守台表格**新增「操作」列，同样两个按钮。删除前 `confirm` 一次。
- 暂停后的 tick 会直接 return，不再轮询。

### 修复
- `persistEntry` 会把已删除的条目写回来（tick 与删除的竞态）：现在目标条目不在状态里就跳过写回。

### 测试
- `applyWatcherAction` 4 组断言（只动目标条目、恢复时清错误、删除不连带、非法动作/未知 id/空状态全部拒绝）；
- 客户端新增 2 例：状态栏面板每行有暂停/删除、值守台表格有「操作」列且按状态切换暂停/恢复。
  合计 **29 例**。

## [0.3.2] - 2026-11-01

### 变更
- **轨道环从会话头部挪到输入框下方那一行**（`conversation.composer.dock`，与「轮/步 · token · 上下文环」同一行，`order: 2`）。
  会话头部那个"只代表当前会话"的徽章不再注册。
- **改成机器级聚合环**：一个环代表这台机器，环上每一颗卫星 = 一个在运行的会话级 superagent
  （绿=值守中，琥珀=已暂停，红=上次轮询失败）；超过 6 个时环上只画 6 颗，其余进详情面板。
- **点击展开详情面板**：逐条列出 仓库 / 会话标题 / 间隔 / 上次轮询 / 上次唤醒 / 状态 / 错误原文；
  定位在按钮正上方，Esc 或点击空白关闭。无值守时整条不渲染。

### 修复
- **轨道环是个死图标**：`OrbitMark` 给 `<g>` 打了 `class="sa-sat-spin"`，但注入的样式表里
  **根本没有这条规则**（只在代码里引用了类名，没写 CSS），所以环一动不动。
  现在改成把动画写进 SVG 本身：`<animateTransform>` 让卫星公转（6s/圈）、`<animate>` 让环呼吸
  （2.6s）、红点呼吸（1.6s）—— 不依赖注入的 `<style>`，也不吃 CSP / `transform-box` 的差异，
  一个 .html 就能预览。并遵守 `prefers-reduced-motion`。
- 面板每行补 **8 位会话后缀**（标题由标题模型生成，多个会话可能重名）与 **`goal` 摘要**；
  顺带修掉值守台里把 goal 对象直接拼成 `[object Object]` 的老问题。

### 工具
- `pnpm run preview:orbit` → 用**真实组件**渲染出 `orbit-preview.html`（5 种状态 × 放大/原尺寸两种尺寸），
  改动画后不用重启宿主就能先看效果。

### 测试
- 新增 `test/client.test.mjs`（6 例）：在 Node 里用假 React 跑**真实** `client.js`，断言
  槽位注册（含"头部不再注册"）、无值守返回 null、卫星数=值守数且上限 6、
  **动画是 SVG 自带的 SMIL（暂停/异常不转，值守中才转）**、异常点呼吸而正常点不呼吸、
  详情面板文案齐全。合计 26 例。

## [0.3.1] - 2026-11-01

### 修复
- **头部徽章从未注册**：0.3.0 的注册代码插入时目标文本已被其他改动替换，字符串替换静默失败，
  导致组件存在但 `apply()` 没有注册它。现在 `apply()` 整体重写，两处注册分别独立 try/catch 并留探针。
- 诊断探针改为每次页面加载只写一次（原来 `badge-state` 每 5 秒写状态文件）。

### 验证（Windows 11 + DSH 0.2.1-rc.5 真机）
```
apply done · desk-registered ok · badge-registered ok
badge-mount  session-1e82afca-…
badge-state  found:MYCF711/dsh-GOkifu-compact
server.routes 8
```

## [0.3.0] - 2026-11-01

### 新增
- **会话头部轨道点徽章**（`conversation.session.header.actions`，仅图标 + 原生 tooltip）：
  - 值守中：绿点沿环匀速绕行（3s/圈）
  - 已暂停：虚线环 + 琥珀点静止
  - 有错误：实线环 + 红点呼吸闪烁
  - tooltip 三行：仓库 / 每 Ns + 上次轮询 / 状态（与会话列表原生 tooltip 同构）
- **真实会话 goal**：面板读写 `ctx.goals`，与 `/goal` 命令、`create_goal`/`update_goal` 工具同一份状态，5 秒轮询双向同步。
- **面板显示会话标题**：服务端从会话日志 `session/title` 事件解析（按 mtime 缓存），替换原始 session id；标题前加状态点。
- **凭证配置**：面板可填 GitHub token / SSH 私钥路径，存 `~/.dsh/state/session-superagent/secrets.json`（0600），只回显掩码摘要；所有 `gh` 调用自动带 `GH_TOKEN`。
- **新增值守**：面板直接添加 watcher，绑定当前会话。

### 说明
- 侧栏会话列表行**没有**可插入的槽位（`sidebar.workspaces` 是 single slot，由 ui-workspace 独占），
  所以徽章放在会话头部；列表行图标需要上游暴露 row badge 槽位。

## [0.2.1] - 2026-11-01

### 修复
- **面板数据 404**：路由注册的服务名是 `webServer`（大写 S），不是包文档写的 `httpServer`。
  `inject` 改为 `['tools','agents','webServer']`，直接 `ctx.webServer.register(...)`。
- 移除了会静默失败的 `ctx.inject` 延迟注册路径；`registerRoutes` 失败时把错误写进状态文件 `server.error`。

### 新增（诊断）
- 客户端加载时 `GET /session-superagent/client-hello`、注册失败时 `GET /session-superagent/client-error`，
  结果落在状态文件 `client.{hello,error}`，用于区分「客户端没被加载」与「注册抛错」。
- 面板 tab 的 `order` 从 50 调到 30，避免被挤进溢出菜单。

### 验证
- 真机：Windows 11 + DSH 0.2.1-rc.5，面板显示 1 个 watcher（`MYCF711/dsh-GOkifu-compact`，30s，运行中）。

## [0.2.0] - 2026-11-01

### 新增
- **「值守台」中栏面板**：注册到 `conversation.view`，与 Chat / Trajectory / Waterfall 并排。
  每 5 秒读取 `/session-superagent/state`，显示每个 watcher 的仓库、会话、间隔、上次轮询、上次唤醒、运行状态与错误。
- 服务端新增只读路由 `/session-superagent/state`（`ctx.httpServer`，可选注入；无 Web 表面的宿主照常提供工具）。
- `inject` 改为 `{ required: ['tools','agents'], optional: ['httpServer'] }`。

### 说明
- 面板只读：不提供暂停/恢复按钮，也不显示任何凭证。
- 浏览器侧零依赖（React 由宿主提供）。

## [0.1.2] - 2026-11-01

### 修复
- **吸收而非延迟**：冷却窗口内的自更新不再只是“跳过”，而是把水位推到最新（`partitionItems().absorbed`）。
  0.1.1 只延迟，窗口一过同一条 issue 会再次上报；本版彻底吸收，不再复现。
- `pollOnce` 新增 `absorbed` 分支：静默推进 `seen` 与 `cursor`，不唤醒、不计数。

### 测试
- 20 项单测（新增 2 项：吸收行为、窗口结束后不复现）。

## [0.1.1] - 2026-11-01

### 修复
- **冷却窗口**：处理完某条 issue/PR 后，默认 180 秒内忽略它的再次变化。
  原来只靠逐条水位，挡不住“回复完 → 关闭它”这类自己造成的后续 bump，会再唤醒一次。
- 新增 `recordReported()` 与 `splitFresh(..., {now, cooldownMs})`，均有单测覆盖。

### 测试
- 18 项单测（原 15）。

## [0.1.0] - 2026-11-01

### 新增
- `github`：调用 GitHub REST API，凭证不进模型，返回统一脱敏；写方法必须 `confirm: true`。
- `repo_here`：报告当前工作目录对应的仓库。
- `watch_start` / `watch_status` / `watch_stop`：轮询单个仓库并在变化时唤醒当前会话。
- `trigger.json` 手工测试通道：5 秒扫描，用于在不重启宿主的前提下验证注入链路。

### 修复（开发期发现）
- 唤醒失败时不再推进水位，避免事件被永久吞掉。
- 逐条水位替代全局 cursor，消除“自己评论→自己再被唤醒”的回声。
- 仅在 `agent.status === 'idle'` 时注入，消除“已发送内容回退到待发送并重复发送”的客户端草稿回放。

### 已知限制
- 轮询模型，无 webhook。
- 单会话单仓库。
