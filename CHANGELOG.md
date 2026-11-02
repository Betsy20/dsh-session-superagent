# 更新记录

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
