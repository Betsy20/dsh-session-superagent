# dsh-session-superagent

<img src="assets/icon-180.png" width="88" height="88" alt="">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.8.85-green.svg)](https://github.com/MYCF711/dsh-session-superagent/releases)
[![npm](https://img.shields.io/npm/v/dsh-session-superagent.svg)](https://www.npmjs.com/package/dsh-session-superagent)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-plugin-orange.svg)](https://github.com/topics/dsh-plugin)

> **一句话**：给一个 DSH 会话装上一条 **主理鱼**——
> **盯**：轮询仓库的 issue/PR，有动静就叫醒本会话；**办**：醒来后按仓库的 `AGENTS.md` 主动推进
> （修 bug、回评论、开 PR、关单），不需要独立实例、PTC 模式或另建 agent 预设。
>
> 名字的来历：「主理人」管一家店的那套职责（盯着 + 拿主意 + 动手办），搬到会话里就是这条鱼；
> 本机的主力模型是条大肥鱼（`deepseek-v4.1`），所以不叫主理人，叫 **主理鱼**。
> 两半缺一不可：只「盯」不「办」是个通知器，只「办」不「盯」就得靠人喊。

## 它做什么

| 能力 | 工具 | 说明 |
|---|---|---|
| 读 GitHub | `github` / `repo_here` | API 调用；**凭证留在插件里，模型永远看不到，所有返回统一脱敏** |
| 盯仓库 | `watch_start` / `watch_status` / `watch_stop` | 30–3600 秒轮询；有变化时用 `Agent.followup()` 唤醒**本会话** |
| 传递规则 | 仓库里的 `AGENTS.md` | 唤醒消息只说“有新动态”，怎么处理由项目规则决定 |
| 收窄范围 | `filters` | 只处理带指定标签、或已指派给人的条目；默认跳过机器人、草稿 PR、已关闭条目 |
| 限流 | `batchLimit` / `maxWakesPerHour` | 单次最多铺开 N 条（默认 5，1-20），每小时最多唤醒 N 次（默认 6，1-60），超了攒着；**面板「触发」页可改** |
| 幂等 | `watch_ack` 工具 | 处理完给条目打「主理鱼:已处理」标签（标签不存在会自动建），轮询直接跳过（换机器也不重报）；支持 `numbers: "12,13"` 批量 |
| 时段 | `activeHours` | 只在 `09:00-23:00` 这类时段唤醒，夜里攒着；支持跨夜 `22:00-06:00` |
| 隔离 | `isolated` | 每次唤醒前开一次性 `git worktree`，改副本、推 `zhuli/*` 分支，不动主工作区；超过 3 天的旧副本自动回收 |

唤醒链路：

```
GitHub 有新动态 → watcher 轮询 → Agent.followup(消息) → 会话跑一轮
                                     ↑ 空闲时才注入（避免污染输入框）
```

## 界面

| 位置 | 是什么 |
|---|---|
| 输入框下面那一行的**最左端**（`轮/步 · token · 上下文环` 同一行） | **总卫星环**：一个环代表这台机器，环上每一颗卫星 = 一个在运行的会话级 superagent。绿=主理中，琥珀=已暂停，红=上次轮询失败；一圈转起来说明至少还有一个在盯。**点一下**展开详情：仓库 / 会话标题 / 间隔 / 上次轮询 / 上次唤醒 / 状态 / 错误原文。 |
| 中间栏「主理鱼」标签页 | **移植自官方 superagent 的 GUI**：总览（统计 + 需要关注 + 最近被过滤）/ 判定（每轮唤醒结果与原因）/ 触发（新增 + 行内编辑）/ 设置（来源 · 凭证 · goal · 术语表） |
| 会话头部 | 不再挂徽章（0.3.2 起移到上面那行） |

没有主理鱼时这里画一个**灰色空环**（不转、无卫星），点开提示怎么添加 —— 不占位但也不消失，免得看着像功能坏了。

## 环境要求

- DSH ≥ 0.2.1-rc.5（`engines.dsh`）
- Node ≥ 22.19（宿主自带）
- 已登录的 `gh` CLI（插件复用它取凭证；**不会**把 token 交给模型）

## 安装

**装进 profile**（DSH 插件不是 `npm i` 就生效，要装到 profile 里）：

```bash
# 默认 profile
dsh plugin install dsh-session-superagent

# 指定 profile / 锁定版本
dsh plugin --profile desktop add dsh-session-superagent@latest

# 本地开发：直接装这个目录（会以 file: 硬链接方式挂进 profile）
dsh plugin install /path/to/dsh-session-superagent
```

> `npm i dsh-session-superagent` 只会把它下载到本地 node_modules，**不会**让 DSH 加载它 ——
> 包里的 `dsh.bundle.patch` 要由 profile 的安装流程来读。
> 也可以在应用内的插件市场里搜索安装。

装进 profile 后是 `file:` 硬链接：改源码即改线上；**但新增文件不会被自动带过去**，
加完文件要跑 `pnpm run sync:profile`（否则下次重启插件会整体不挂载，这坑踩过一次）。

## 一次真实运行长什么样

1. `watch_start` 登记 watcher（状态存 `~/.dsh/state/session-superagent/watchers.json`）；
2. 你在仓库提一个 issue；
3. 轮询命中 → 会话收到 `【主理鱼】owner/name 有 1 条新动态：…`；
4. 会话按 `AGENTS.md` 判断：bug 直接修、范围外的功能请求回复“待定”、需要决策则提问；
5. 处理完写回 issue/PR。

## 安全边界

- **凭证**：插件通过已登录的 `gh` CLI 调用 API，token 不落 workspace、不进会话；所有输出过 `redact()`（`ghp_*` / `github_pat_*` / PEM 私钥 / Authorization 头）。
- **写保护**：`POST/PATCH/PUT/DELETE` 必须显式传 `confirm: true`，否则直接拒绝。
- **注入纪律**：只在 `agent.status === 'idle'` 时唤醒；逐条水位（`seen[number]`）保证自己的写操作不会把自己叫醒。
- **不做的事**：不改你的 profile、不重启宿主；只会在隔离模式（`isolated`）下创建并回收自己的
  `.dsh-zhuli/` worktree（超过 `isolateKeepDays` 才会 `git worktree remove --force`）。

## 已知限制

- 依赖 `gh` CLI 已登录；需要 GitHub 账号权限。
- 轮询而非 webhook：延迟等于轮询间隔。
- 单会话单仓库；多仓库请每仓库一个会话，各自 `watch_start`。
- 宿主重启后 watcher 从状态文件恢复；会话不在则不注入（会记 `lastError`）。

## 开发

```sh
node --test          # 134 项单测
```

版本与发布流程见 [UPDATING.md](UPDATING.md)，交付门见 [CHECKLIST.md](CHECKLIST.md)，接手台账见 [MAINTENANCE.md](MAINTENANCE.md)。

## 客户（Customer）

> **本文档里的「客户」= 在**其它电脑**上使用本插件的使用者**（不是本机的会话，也不是本仓库的贡献者）。

客户和本机的差别，决定了排查要看哪里：

| | 本机（开发者） | 客户 |
|---|---|---|
| 插件来源 | `file:` 硬链接到本仓库 | npm / 市场安装的发布版 |
| 状态文件 | `<DSH_HOME>/state/session-superagent/watchers.json` | 同路径，但在客户自己的 `~/.dsh/` 下 |
| 我能不能直接查 | 能 | **不能** —— 只能让客户贴信息 |

所以客户报问题时要这三样，缺一件就只能猜：

1. **版本**：面板「设置」页，或状态文件里 `client['note:client-version'].detail`；
2. **挂载状态**：状态文件里的 `server` 字段（`routes` / `failed` / `base`），或让客户跑一次 `watch_doctor`；
3. **出错那行的原文**：0.8.36 起 gh 失败会被分类成人话（网络抖动 / 凭证失效 / 限流 / 仓库不存在 / 没装 gh）。

**客户升级**：

```bash
dsh plugin --profile <profile> add dsh-session-superagent@latest
```

（客户机器上 `npm i` 不会生效 —— 必须装进 profile，见上面的「安装」。）

**本机复现不了客户的问题**：`EOF` / 超时 / 代理这类错误取决于客户的网络，本机能访问同一个仓库不代表客户能。
遇到这种情况，先按上面的三样收集信息，再判断是环境还是代码。

## 验收（不用装宿主也能跑）

```bash
node --test                 # 103 例单测
node scripts/ui-audit.mjs   # 11 项 UI 指标（写死颜色 / 自造 token / 官方结构采用 …）
node scripts/preflight.mjs  # 8 项门禁（含上面两条，外加 profile 一致性、路由面、包内容）
node scripts/render-preview.mjs preview.html   # 双主题静态预览，直接浏览器打开
```

`preview.html` 里每个界面都会渲染**浅色 + 深色**两遍（9 个场景 × 2），
用来发现「某个主题下颜色写死 / 漏 token」这类问题 —— 这类 bug 在单测里是绿的。

## 故障排查（都是真实踩过的）

| 症状 | 原因 | 处理 |
|---|---|---|
| 面板空白、`watch_*` 工具消失、`/session-superagent/*` 全 404 | 新增的 `lib/*.js` 没同步进 profile（`file:` 安装只对**已有**文件建硬链接），宿主 import 失败 → 整个插件不挂载 | `pnpm run sync:profile`，然后重载插件 |
| 改了代码但线上行为没变 | 硬链接断了 —— **原子写、`git checkout/restore`、某些编辑器的保存**都会换 inode，profile 里还是旧文件 | `pnpm run sync:profile:check` 看漂移，`sync:profile:repair` 修 |
| 轮询报 `cannot get required service "agents" in inactive context` | 0.8.21 之前的 bug：定时器里直接读 `ctx.agents` | 升级到 ≥0.8.21 |
| 绑定的会话已删除，watcher 还在打 GitHub | 0.8.14 之前的 bug：该类失败没进退避 | 升级到 ≥0.8.14（0.8.22 起未预期异常也会退避） |
| `npm i dsh-session-superagent@<新版本>` 报 `ETARGET` | 刚发布，npm 客户端元数据缓存还没刷新 | 等 1-2 分钟，或 `npm i <tarball URL>` / `--prefer-online` |
| 有动静但会话没被叫醒 | 会话忙 / 时段外 / 每小时上限 / 被子过滤器刷掉 | `watch_status` 会显示 `deferred=` / `paused`；面板「总览」的「最近被过滤」给原因 |

| 面板显示原始 `Get "https://api.github.com/…": EOF` | 客户网络抖动（换网/代理），不是插件坏了 | 升级到 ≥0.8.36：会显示「网络抖动，已按退避自动重试」；本机能访问不代表客户能 |
| 设了时段 `09:00-23:00`，窗口外还显示绿色「主理中」 | 0.8.40 之前的 bug：只判断 enabled，不看是否在窗口内 | 升级到 ≥0.8.40：窗口外显示灰色「时段外」（只攒条目不唤醒） |
| 改了服务端代码、也重载了，面板却还是旧行为 | 宿主重载后**旧 handler 摘不掉**，HTTP 仍走旧代码 | ≥0.8.32 起会自动换到 `/session-superagent/rN` 重放；客户端 ≥0.8.34 会自动跟过去。仍异常时重启一次宿主 |
| 面板建的 watcher 一跑就报 `inactive context`，工具建的却正常 | 同上：那条 HTTP 路径由**已释放的旧实例**处理 | ≥0.8.31 起会直接返回 503 并提示「请重载 DSH」，不再静默造死守 |
| 加过的 watcher 突然不见了 | 0.8.37 之前的 bug：状态整份覆盖，旧快照会抹掉新条目 | 升级到 ≥0.8.37：合并写 + 删除墓碑，迟到写入不会复活/抹掉 |
| 客户机器上「面板是空的 / 没有新功能」 | 客户装的是旧版（客户不会主动升级） | 面板顶部会有「有新版本 x.y.z」横幅，设置 → 版本与更新给出升级命令 |
| 想知道客户现场到底什么状态 | 我们看不到他机器上的状态文件 | 让客户点 设置 → 诊断 → 复制诊断信息（已脱敏，含版本/挂载/每条守的最近错误） |

`pnpm run preflight` 一条命令可自查：单测、语法、profile 一致性、版本一致、路由面、包内容、冒烟。

## 许可

MIT，见 [LICENSE](LICENSE)。
