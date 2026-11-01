# dsh-session-superagent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.3-green.svg)](https://github.com/MYCF711/dsh-session-superagent/releases)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-plugin-orange.svg)](https://github.com/topics/dsh-plugin)

> **一句话**：给一个 DSH 会话装上“盯仓库”的能力——仓库有新 issue/PR，会话自己醒过来，按你预先写好的规则处理。
> 不需要独立实例、不需要 PTC 模式、不需要另建 agent 预设。

## 它做什么

| 能力 | 工具 | 说明 |
|---|---|---|
| 读 GitHub | `github` / `repo_here` | API 调用；**凭证留在插件里，模型永远看不到，所有返回统一脱敏** |
| 盯仓库 | `watch_start` / `watch_status` / `watch_stop` | 30–3600 秒轮询；有变化时用 `Agent.followup()` 唤醒**本会话** |
| 传递规则 | 仓库里的 `AGENTS.md` | 唤醒消息只说“有新动态”，怎么处理由项目规则决定 |

唤醒链路：

```
GitHub 有新动态 → watcher 轮询 → Agent.followup(消息) → 会话跑一轮
                                     ↑ 空闲时才注入（避免污染输入框）
```

## 界面

| 位置 | 是什么 |
|---|---|
| 输入框下面那一行（`轮/步 · token · 上下文环` 所在行） | **总卫星环**：一个环代表这台机器，环上每一颗卫星 = 一个在运行的会话级 superagent。绿=值守中，琥珀=已暂停，红=上次轮询失败；一圈转起来说明至少还有一个在盯。**点一下**展开详情：仓库 / 会话标题 / 间隔 / 上次轮询 / 上次唤醒 / 状态 / 错误原文。 |
| 中间栏「值守台」标签页 | 新增值守；每行有 **暂停 / 恢复 / 删除**；配置凭证；读写会话 goal |
| 会话头部 | 不再挂徽章（0.3.2 起移到上面那行） |

没有值守时这里什么都不渲染——不占位，也不空转轮询。

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
3. 轮询命中 → 会话收到 `【watch】owner/name 有 1 条新动态：…`；
4. 会话按 `AGENTS.md` 判断：bug 直接修、范围外的功能请求回复“待定”、需要决策则提问；
5. 处理完写回 issue/PR。

## 安全边界

- **凭证**：插件通过已登录的 `gh` CLI 调用 API，token 不落 workspace、不进会话；所有输出过 `redact()`（`ghp_*` / `github_pat_*` / PEM 私钥 / Authorization 头）。
- **写保护**：`POST/PATCH/PUT/DELETE` 必须显式传 `confirm: true`，否则直接拒绝。
- **注入纪律**：只在 `agent.status === 'idle'` 时唤醒；逐条水位（`seen[number]`）保证自己的写操作不会把自己叫醒。
- **不做的事**：不改你的 profile、不重启宿主、不删除任何文件。

## 已知限制

- 依赖 `gh` CLI 已登录；需要 GitHub 账号权限。
- 轮询而非 webhook：延迟等于轮询间隔。
- 单会话单仓库；多仓库请每仓库一个会话，各自 `watch_start`。
- 宿主重启后 watcher 从状态文件恢复；会话不在则不注入（会记 `lastError`）。

## 开发

```sh
node --test          # 20 项单测
```

版本与发布流程见 [UPDATING.md](UPDATING.md)，交付门见 [CHECKLIST.md](CHECKLIST.md)，接手台账见 [MAINTENANCE.md](MAINTENANCE.md)。

## 许可

MIT，见 [LICENSE](LICENSE)。
