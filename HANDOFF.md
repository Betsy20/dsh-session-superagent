# HANDOFF —— 会话交接（2026-11-02 03:20，v0.8.14）

> 写给**接手的下一个 agent / 下一个会话**。读完它 + `docs/competitive-analysis.md` + `docs/deepseek-papers.md`，就能接着干，不用翻聊天记录。

## 一、项目现状

- 仓库：https://github.com/MYCF711/dsh-session-superagent
- 版本：**v0.8.20**
- 本地：`<本仓库 checkout 路径>`（profile 里以 `file:` 安装，**硬链接**：改源码即改 profile 内文件）
- 真机：Windows 11 + DSH 0.2.1-rc.5，`node --test` **133/133**（重启后真机复验通过）

| 能力 | 实现位置 | 验证方式 |
|---|---|---|
| 主理鱼标签页（移植官方 GUI） | `client.js` → `conversation.view`，用 `docs/official-gui-ia.md` 的 IA 重建 | `desk-registered ok` + 94 例测试 |
| 状态栏「主理鱼」轨道环（0 条灰环占位 / 卫星公转 / 点击看详情） | `client.js` → `conversation.composer.dock`（`order: -10` 最左端） | `/client-note?key=client-version` 探针 + 面板实测 |
| 轮询 + 唤醒 | `lib/index.js` + `lib/watch.js` | `lastPoll` 前进；`followup` 唤醒 |
| 过滤器 / 批量 / 每小时上限 / 失败退避 | `lib/watch.js` 纯函数 + `/watch` 路由 | `node --test`（`passesFilters` / `batchFresh` / `nextDelayMs` / `pruneWakeTimes`） |
| 活跃时段（含跨夜） | `inActiveHours()` + pollOnce 时段闸 | `node --test`（普通/跨夜/空值/起止相同） |
| 隔离执行 + 自动回收 | `worktreePlan` / `prepareIsolation` / `cleanupWorktrees` | 真机 `git worktree list` 出现 `.dsh-zhuli/<id>` |
| `watch_doctor` / 隔离 E2E | 真机跑过：doctor 五项检查全出；`git worktree list` 出现 `.dsh-zhuli/<id>` + `zhuli/<id>` |
| 幂等标记 | `watch_ack` 工具 + `hasAckLabel` | 打 `主理鱼:已处理` 标签后轮询跳过 |
| 会话 goal（真 goal） | `ctx.goals` | 面板读写，5s 轮询 |
| 凭证 | `~/.dsh/state/session-superagent/secrets.json` 0600 | 只回显掩码 |

**在会话里自查（不需要知道端口）**：

| 想知道什么 | 用什么 | 说明 |
|---|---|---|
| 有哪些主理鱼、上次轮询/唤醒/错误 | `watch_status` 工具 | 一行一条，带 observe/isolated/paused/labels/deferred 标记 |
| 环境是否可用（gh 登录、仓库可读、隔离目录是 git 仓） | `watch_doctor` 工具 | 五项检查一次出结果 |
| 原始状态（过滤记录、水位、历史） | 读 `~/.dsh/state/session-superagent/watchers.json` | 这就是权威数据源；比 HTTP 省事 |
| 面板/HTTP 接口 | 宿主端口 + `/session-superagent/state` | 端口每次重启都变：优先看会话上下文里的 GUI URL，或 `netstat` 按 DSH 进程 PID 查。**探测时要核对返回的是 JSON（含 `gh`/`watchers`）**——本机有别的服务对任意路径都回 200，按状态码猜端口会误判 |

冷启动演练（2026-11-02 03:2x）就是照这条路径走的：`watch_start({observe:true, labels:[...]})` →
`watch_status` → 状态文件确认 `observe: true / filteredLog 4 条`。
发现两个摩擦点并已修：工具返回只说 `every 3600s`，看不出 observe/过滤到底生效没有（现在会回显 `[observe-only labels=ai-fix …]`）；
`watch_status` 同样不回显这些（现在也回显）。

**重启后真机复验（2026-11-02 01:25，v0.8.10）**：

```
server        = {at: 17:21:44Z, routes: 8}     ← 插件正常挂载
client-version= 0.8.10
/state /config= 200 / 200
gh 探针       = {"ok":true,"version":"gh version 2.101.0"}
watch_status  = 工具可用（重启前因插件未挂载曾消失）
建→查→删      = observe:true + note 正常往返
profile 同步   = 相对 import 全部可解析
```

## 一点五、术语：「客户」

**客户 = 在其它电脑上使用本插件的使用者。** 客户机器的状态文件不在本机，本机看不到。

2026-11-02 踩过一次：把客户截图里的 `Betsy20/magpie-Jet-Hub` 条目当成"本机丢的 watcher"，
还写进了 CHANGELOG（已更正）。教训：看到面板截图先问「这是哪台机器」，
再判断是代码问题还是客户环境问题；`EOF` 这类网络错误尤其可能只发生在客户侧。

## 二、必须知道的技术事实

1. **路由服务名是 `webServer`（大写 S）**，不是 `httpServer`。`inject: ['tools','agents','webServer']`。
2. **中栏 tab 槽位** `conversation.view`；**输入框下方那行** `conversation.composer.dock`（`order` 升序，负数即最左）。
3. **侧栏会话列表没有可插入槽位**（`sidebar.workspaces` 由 ui-workspace 独占）。
4. **唤醒必须用 `Agent.followup(msg)`**；`inbox.append('next-turn')` 只会留下「待发送」草稿。
5. **只在 `agent.status === 'idle'` 时注入**，否则草稿回放 → 重复发送。
6. **goal 服务是 `ctx.goals`**：`get(agent)` → `{objective, phase, ref}`，`create/edit/clear`。
7. ⚠️ **热重载的真相（2026-11-01 修正）**：
   - **客户端 `client.js` 会热重载** —— 文件落盘后约 20 秒浏览器里自动换新（`/client-note?key=client-version` 可验证，无需重启、无需刷新）。
   - **服务端 `lib/` 改动必须重启宿主**（托盘退出→重开）。
   - 早先文档写的「客户端必须重启」是错的，已按实测更正。
8. **新增文件不会自动进 profile**（2026-11-01 23:59 事故）：`file:` 安装只对已有文件建硬链接，
   新增的 `lib/body.js` 没进 `node_modules/…/lib/`，宿主 import 失败 → **插件整个不挂载**
   （工具和路由全消失，客户端 bundle 却照常加载）。新增文件后必须 `pnpm run sync:profile`。
   这是硬链接安装的隐性坑，比"改内容要重启"严重得多。

9. **`git checkout -- <file>` / `git restore` 会换 inode**，于是 profile 里的硬链接断掉、
   宿主继续跑旧代码（2026-11-02 就踩到：回滚 `lib/index.js` 后 `--check` 立刻报断链）。
   凡是回滚或重写文件，之后补一次 `pnpm run sync:profile:repair`。

10. **本地模拟 `apply()` 会写真实状态文件**：`state.server` 会被探针结果覆盖（2026-11-02 19:43
    就被一条探针写成 `routes:5 failed:[duplicate client-error]`）。**任何** `node -e "apply(...)"`
    这类探针都必须先 `process.env.DSH_SUPERAGENT_STATE = <临时目录>`；`preflight` 与三个测试文件
    已经这么做了。看到 `server.failed` 里有东西时，先确认那条记录是不是自己刚跑的探针。

11. **宿主热重载 = 重新 import 一份模块，模块级变量一律重置。**（2026-11-02 20:0x 血的教训）
    我以为是「同一个模块再 apply 一次」，用模块级 `activeRoutes` 接管旧路由 —— 真机上完全没生效：
    新实例的数组是空的，旧实例的路由继续吃 HTTP 请求，而它的 ctx 已经 dispose，
    于是**面板建的 watcher 第一轮就报 `inactive context`**。
    结论：凡是「要跨重载生效」的状态（路由 disposer、定时器句柄、并发闸），
    必须挂 `globalThis` 并用 `Symbol.for` 做键（`lib/index.js` 里三处：
    `activeRoutes` / `sharedTimers` / `sharedInFlight`）。守门用例见 `test/cross-instance.test.mjs`
    （用 `import('...?instance=2')` 真的模拟一次重载）。

12. **本地模拟 `apply()` 会写真实状态文件（重复条目，保留以免打乱编号）**：`server` 字段被模拟脚本的报错覆盖过
   （`webserver: duplicate exact route ...`）。写这类脚本必须先设 `DSH_SUPERAGENT_STATE` 指向临时目录，
   `scripts/smoke-observe.mjs` 就是这么做的。

10. **`file:` 安装是硬链接**：`edit` 工具原子替换会**断链**；用 python in-place 写不会。断链后 `cp` 回 profile 并 `ln -f` 重建。

## 三、踩过的坑（按代价排序）

1. **字符串替换静默失败**：替换目标文本已被改动时 `replace` 无操作 → 组件写好却没注册，白折腾 4 次重启。**每次替换后必须 grep 断言。**
2. **工具转义**：通过 shell 传给 python 的 `\\` 会被工具吃掉一层，写 `\n` / Windows 路径时用 `chr(92)` 拼，或先把代码块写文件再 splice。
3. **`bash` 工具可能整个消失**：插件层热重载失败时工具注册表会只剩插件工具；`pwsh`/`bash` 全无。重启宿主可恢复。
4. **`taskkill` / `schtasks` 的 `/run` 被 MSYS 改写** → `MSYS2_ARG_CONV_EXCL='*'`。
5. **`web_search` 工具在本机不可用**（magpie 端点不返回 search blocks）→ 用 `curl` + `gh api`；脚本在 `<WORKSPACE>\research\web.py`。

## 四、验证与审核台账

### 审核（三轮，全部有结论落盘）
| 轮 | 对象 | 结论 | 落盘 |
|---|---|---|---|
| 一 | v0.7.4 全仓 | 8 个必须修 + 14 建议 | `docs/review-2026-11-01.md` |
| 二 | v0.8.4 GUI 移植 | 7 个必须修 + 13 建议；复核再抓出第 8 个（删除按钮 className 被覆盖） | 同上 |
| 三 | v0.8.8 发布门禁 | 2 个阻塞（goal 只算没拼、缓存 TTL 失效）；修复后复核 **「可以发布，无阻塞项」** | 同上 |

### 真机验证（不是单测，是跑起来的宿主上做的）
| 时间 | 验了什么 | 证据 |
|---|---|---|
| 01:25 | 重启后插件挂载 | `server.routes=8`、`/state /config` 200、`client-version` 一致（注：`/config` 已在 **0.8.12 删除**，现为 7 条路由） |
| 01:41 | `watch_doctor` 五项检查 | gh 登录 / 仓库可访问 / ack 标签 / 隔离目录是 git 仓库 / 上次轮询与错误 |
| 01:41 | 隔离执行 E2E | `git worktree list` 出现 `.dsh-zhuli/<id>` + `zhuli/<id>`；`lastWorktree`、`history` 正确 |
| 02:41 | 幽灵会话守卫（0.8.11） | 会话不存在时 `lastError="会话已不在…"`、**不建** worktree（修复前会白建一个） |
| 03:1x | 0.8.15 发布前快照 | 测试 81/81、语法全过、profile 一致性 0 漂移、冒烟 12/12、包 13 文件/75.4kB、tarball 直装 routes=6 |
| 03:4x | npm 0.8.14 可安装性 | tarball 直装 → `apply()` 成功、路由 6 条、`lib/` 齐全（注意刚发布时 `npm i pkg@ver` 可能 ETARGET，用 tarball URL） |
| 03:1x | `/state` 真实性能 | 真机 92 个会话日志 / 4 个分组；有 watcher 时连打 5 次 1.7–2.0 ms（索引缓存命中） |
| 03:01 | **0.8.13 线上复验（真宿主）** | 宿主重启后 `routes=7`、`client=0.8.13`；严格标签过滤时 `filteredLog` 显示 4 条「不在标签白名单: ai-fix」且 `lastDeferred=null`；放宽过滤后变「仅观察：本轮本会唤醒 4 条（#2 #4 #3 #1）」而**唤醒数为 0** |
| 04:0x | 真唤醒 + 隔离（进程内冒烟 B） | followup 1 次、消息含【主理鱼】/编号/本条目主理目标/隔离路径、`.dsh-zhuli/` 下正好一个副本 |
| 03:5x | observe + 过滤落盘（进程内冒烟） | `pnpm run smoke:observe` 五项全 OK：不唤醒 / filteredLog 落盘 / 原因可读 / `/state` 读得到 / 空轮询清 deferred |
| 03:0x | **ack 幂等闭环（真 GitHub）** | `watch_ack` 给 `MYCF711/dsh-GOkifu-compact#2` 打上 `主理鱼:已处理`（中文+冒号 GitHub 接受），再 ack 一次不报错；随后已把标签与定义都撤掉 |
| 02:50 | npm 发布可安装性 | `npm i dsh-session-superagent@0.8.12` → `apply()` 成功、路由 7 条、client 语法通过 |
| 02:41 | 真实业务闭环前的数据面 | `/state.gh` = `gh version 2.101.0`；建→查→删 watcher 全部往返正常 |

### 两次生产事故（都已修 + 有守门）
| 事故 | 根因 | 守门 |
|---|---|---|
| GBK 路径乱码导致 body 解码失败 | Python/Git 输出 CP936 | `decodeBody` 字节层兜底 + 7 例路由测试 |
| 重启后插件整体不挂载（路由/工具全消失） | 新增 `lib/body.js` 没进 profile（`file:` 安装只对已有文件建硬链接） | `scripts/sync-profile.mjs`（同步 + 相对 import 自检） |

## 五、自动化约定（每小时定时任务）

- 定时任务每轮**第一步是自愈 goal**：`get_goal`，若不是 active 就 `create_goal`/`update_goal resume`。
  自动化不允许停在「无 goal / goal 已封存」状态 —— 这是用户明确要求的行为。
- 每轮开工先 `node --test`，红了先修红再干别的。
- 哨兵数据：`/session-superagent/state`（含 `server.at`、`client.note:client-version`、`gh`）。
- **新增文件后必须 `pnpm run sync:profile`**，否则下次重启插件整体不挂载（2026-11-01 23:59 事故）。

### UI 走查（真浏览器，2026-11-02 03:2x）

用 `pnpm run preview` 生成静态预览，在 Chromium 里逐场景量：

| 场景 | 横向溢出 | 越界元素 | 行 | 标签 | 按钮 |
|---|---|---|---|---|---|
| 总览 | 无 | 无 | 3 | 8 | 20 |
| 判定 | 无 | 无 | 2 | 0 | 8 |
| 触发 | 无 | 无 | — | — | 12（6 个输入框） |
| 设置 | 无 | 无 | — | — | 10（1 个 textarea） |
| Toast×2 | 无 | 无 | 3 | 8 | 20 |
| 术语表 | 无 | 仅 fixed 遮罩（设计如此） | 3 | 8 | 21 |

computed style 核对：模态 `fixed/inset:0`、宽 380 居中；Toast `fixed/top:40px/z:1100`、299×46 深底白字；
标签 `success` 绿 / `warning` 琥珀；列表行 102–122px（三线结构）。

### 唤醒链路的两条闸门真机验证（2026-11-02 12:40，0.8.35 全新进程）

```
① 绑定不存在的会话（面板路径建 watcher）
   lastError = 会话已不在：请删除或重建这条主理鱼
   consecutiveFailures = 1，nextAt = +30 分钟（退避生效）      ← 以前这里报 inactive context 且不退避
② 绑定正在跑的这一轮（工具路径建 watcher，仓库有真 issue）
   lastDeferred = 会话正忙，下一轮重试
   seen = 0（水位没推进 → 下一轮还会认成 fresh），history 空（没真唤醒）
```

② 是之前从未在真机上走到过的分支：忙的时候**不推进水位、不建隔离区、不注入**，
把活儿留给下一轮。这条跑通，说明「只在 idle 才唤醒」的约束是真的生效，而不只是代码里写着。

### 外部事项（需要别人动作，别每小时重复提）
- **awesome 收录**：PR <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11266>
  状态 `OPEN / MERGEABLE`、`check=SUCCESS`、0 review / 0 comment —— **在等维护者合并**，我们这边无需动作。
  合并后再更新 README 徽章与 `docs/awesome-submission.md` 的状态。
- **真机验证**（需宿主）：双主题实拍、键盘走查（Tab→Escape→焦点归还）、真实唤醒闭环。
  攒成一批，等用户有空一次验。

### 热重载链路已端到端证明（2026-11-02 10:48）

```
02:41    客户端加载（0.8.35），当时活着一代是 /r4
02:44:50 服务端热重载 → /r5（v0.8.35），/r4 被释放
02:48:40 用户打开「主理鱼」页 → 首次轮询 404 → 重探 → 切到 /r5 → 写 note:client-base
结果：note:client-base = /session-superagent/r5，/session-superagent 仍是旧 handler
```

结论：**改服务端代码不再需要重启 DSH** —— 换前缀重放（0.8.32/33）+ 失效重探（0.8.34）+
探针（0.8.35）三段拼起来，在真机上跑通了。

### 交付快照（2026-11-02 04:14，当时 0.8.31 —— 属历史记录）

```
preflight（全量，7 项）                                         全部通过
  单测 93/93 · 语法 5 文件 · profile 一致（0 缺失/0 断链/0 陈旧）
  版本五处 0.8.31 · 路由面 6 条 · npm pack 13 文件 · 冒烟 12 项 OK
npm latest = 0.8.31（tarball 直装验证：routes 6、client 语法通过）
CI（GitHub Actions，Node 22 & 24）                              success
审核轮次：4 轮（8 + 7 + 2 + 0 个必须修，最后一轮「代码侧无阻塞」）
```

**已闭环（0.8.32）**：服务端改动现在**热重载即可生效**，不需要重启 DSH ——
旧 handler 摘不掉时，新实例会整组换到 `/session-superagent/rN` 重放，面板自己探测并切过去。
真机验证：`server.base='/session-superagent/r2'`、`/r2/state` 200、面板建的 watcher 正确报「会话已不在」并退避。

历史记录（0.8.32 之前的行为，留作对照）：

```
真机判定实验（20:13 重载后）：
  POST /watch -> 200（旧代码没有 0.8.31 的 503 守卫）
  随后 tick  -> lastError = cannot get required service "agents" in inactive context
```

也就是说：热重载换不掉服务端 handler；**改完 lib/ 必须重启一次 DSH**。
在那之前从面板加的 watcher 会跑在旧代码上，行为可能异常（工具路径不受影响）。

## 六、下一步（按性价比）

| # | 项 | 说明 |
|---|---|---|
| 1 | ~~npm publish~~ | ✅ 2026-11-02 已发 `dsh-session-superagent@0.8.11`（latest 已指向它，占位版已弃用） |
| 2 | awesome-dsh-plugin 上架 | 仓库满 1 天后可提（11-02 17:53 +08 之后），材料在 `docs/awesome-submission.md` |
| 3 | 真实仓库的隔离闭环 | 用真会话 + `isolated:true` 跑一次唤醒，确认 agent 在 worktree 里干活 |
| 4 | 仍未做的审核建议 | SegTabs 焦点跟随、Toast 顶部居中（内联容器已删但没用官方定位）、`/config` 与 `/state` 字段可再收敛 |

## 七、验证清单（改完必跑）

```bash
pnpm run preflight      # 一条命令跑完 7 项：单测 / 语法 / profile 一致性 / 版本一致 / 路由面 / 包内容 / 冒烟
pnpm run preflight -- --fast   # 跳过冒烟（不请求 GitHub、不建 worktree）
```

`scripts/preflight.mjs` 会打印 PASS/FAIL 表并以退出码给结论。其中冒烟一项需要 `gh` 已登录，
不可用时自动 SKIP（不算失败）。

以前这里是散文清单（容易过期、也记不住要跑哪些），现在脚本是唯一事实源。
