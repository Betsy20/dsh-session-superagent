# dsh-session-superagent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.7.5-green.svg)](https://github.com/MYCF711/dsh-session-superagent/releases)
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
| 限流 | `batchLimit` / `maxWakesPerHour` | 单次最多铺开 N 条，每小时最多唤醒 N 次，超了攒着 |
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
| 中间栏「主理鱼」标签页 | 新增主理鱼（标签过滤 / 只看已指派 / 活跃时段 / 隔离执行）；顶部 **全部暂停 / 全部恢复**；每行 **立刻 / 暂停 / 恢复 / 删除**；配置凭证；读写会话 goal |
| 会话头部 | 不再挂徽章（0.3.2 起移到上面那行） |

没有主理鱼时这里画一个**灰色空环**（不转、无卫星），点开提示怎么添加 —— 不占位但也不消失，免得看着像功能坏了。

## 环境要求

- DSH ≥ 0.2.1-rc.5（`engines.dsh`）
- Node ≥ 22.19（宿主自带）
- 已登录的 `gh` CLI（插件复用它取凭证；**不会**把 token 交给模型）

## 安装

```sh
dsh plugin --profile <profile> add github:MYCF711/dsh-session-superagent
```

包会带 `cordis.patch.yml`（插入一个 tools-only 行），**不会**自动改你的 `bundles` 列表——那一步是操作者的动作。

装完重启一次宿主，然后在任意会话里：

```
watch_start({ repo: "owner/name", intervalSec: 60 })
```

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
node --test          # 63 项单测
```

版本与发布流程见 [UPDATING.md](UPDATING.md)，交付门见 [CHECKLIST.md](CHECKLIST.md)，接手台账见 [MAINTENANCE.md](MAINTENANCE.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
