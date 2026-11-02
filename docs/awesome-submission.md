# awesome-dsh-plugin 收录材料（待提交）

提交目标：`awesome-dsh-plugin/awesome-dsh-plugin`（社区列表，21.8k★）
提交方式：PR，只加一个文件 `data/plugins/MYCF711__dsh-session-superagent.yml`
门槛：仓库创建满 1 天（`contributing.md:79`，CI 校验 `created_at`）
本仓库 created = 2026-11-01T09:53Z → **最早可提交 2026-11-02T09:53Z（明天 17:53 +08）**

## 文件内容

```yaml
url: https://github.com/MYCF711/dsh-session-superagent
name: MYCF711/dsh-session-superagent
category: session
description:
  en: 'Session-level superagent: watch one GitHub repository and wake this session when an issue or pull request changes. The credential never reaches the model.'
  zh: '会话级 superagent：盯一个 GitHub 仓库，issue/PR 有变化就唤醒本会话；凭证留在插件内，不进模型。'
icon: https://raw.githubusercontent.com/MYCF711/dsh-session-superagent/main/assets/icon-180.png
```

> 已逐条核对上游 `contributing.md`（2026-11-02）：
> - 文件名 `<owner>__<repo>.yml` ✅
> - `category: session` 在合法列表里（`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`）✅
> - 只有 `description.en` 必填；**含 `: ` 的描述必须加引号**（我们的 en 用单引号包了）✅
> - 要求 `package.json` 声明 `dsh.bundle` —— 我们的 `dsh.bundle.patch` 已声明 ✅
> - `icon` 可选，已生成 `assets/icon-180.png`（180×180，GitHub raw 直链）✅

分类理由：它是"给一个会话加一对眼睛"，不是 git 工具（不收 git 命令），也不是 usage 统计。
维护者可能改判——`contributing.md` 明说分类不会导致打回。

## PR 标题

```
Add dsh-session-superagent — session-level superagent
```

## PR 正文

```markdown
## What it is

A DSH plugin that gives one session a pair of eyes on one GitHub repository:

- `watch_start({ repo, intervalSec })` polls that repo's issues and pull requests;
- when something changes it wakes **that session** through `Agent.followup()`;
- the session then acts by the project's own `AGENTS.md` rules.

No separate profile, no second process, no setup questionnaire — one command inside a session you already use.

## Why it is not another dsh-superagent instance

The official `dsh-superagent` prototype runs as its own profile with a ticket state machine, a policy layer and a panel. That is the right shape for a team. This one targets the opposite end: a single person who already has a session per repository and wants it to notice a new issue without polling by hand.

## Installability

- `package.json` declares `dsh.bundle.patch` → `cordis.patch.yml`;
- install: `dsh plugin --profile <p> add github:MYCF711/dsh-session-superagent`;
- verified on DSH 0.2.1-rc.5 / Windows 11: panel renders in `conversation.view`, watcher wakes the session, watermark suppresses self-echo.

## Safety

- the GitHub credential never leaves the plugin: it reuses the host's `gh` CLI, and every tool result passes through `redact()` (`ghp_*`, `github_pat_*`, PEM blocks, `Authorization` headers);
- write methods require an explicit `confirm: true`;
- no injection while a turn is running (draft-replay hazard), per-item watermarks so our own writes never wake us.

## Tests

`node --test` — 85 tests: pure logic (`lib/watch.js`, `lib/redact.js`, `lib/body.js`), route layer (`test/routes.test.mjs`), client render smoke (`test/client.test.mjs`), and meta/version guards.
```

## 提交命令（明天 17:53 之后）

```bash
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=true --remote=false
# 在 fork 里新建分支，写入上面的 yml，然后：
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin   --title "Add dsh-session-superagent — session-level superagent"   --body-file <上面的正文>
```

---

## npm 包（2026-11-02 已发布）

- 包名：`dsh-session-superagent`
- 版本：`0.8.11`（`latest` 已指向；`0.0.0-stage` 是 npm 自动占位，已标弃用）
- 地址：https://www.npmjs.com/package/dsh-session-superagent
- 安装：`npm i dsh-session-superagent`

---

---

## 提交状态（2026-11-02 11:2x +08，共 3 条）

**PR：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/11266>**（标题已改为三条一起）

| 条目文件 | 仓库 | 分类 | 为什么 |
|---|---|---|---|
| `MYCF711__dsh-session-superagent.yml` | dsh-session-superagent | `session` | 会话级的「盯 + 办」 |
| `MYCF711__dsh-GOkifu-compact.yml` | dsh-GOkifu-compact | `memory` | 棋谱式上下文压缩（DAG + 热清单） |
| `MYCF711__dsh-sovereign.yml` | dsh-sovereign | `security` | 主权条款 + 工具结果清洗 + 不可逆操作前置裁决 |

规范复核（`contributing.md`）：
- **一个 PR 最多 3 条**（§"One PR, at most 3 entries"）→ 正好 3 条，没有超；
- 一个插件一个文件（`data/plugins/<owner>__<repo>.yml`）；
- 只有 `description.en` 必填；含 `: ` 必须加引号（三条都加了）；
- 要求 `package.json` 声明 `dsh.bundle`（三条都有 `./cordis.patch.yml`）；
- 分类不准不会被打回，维护者会直接改。

CI：新加的两次提交触发了新的 run。年龄门槛 `MIN_AGE_DAYS = 1` 由**最新的那个仓库**决定
（`dsh-session-superagent` 于 2026-11-01 创建，17h/24h），另两个仓库都是 10 月创建、已满足。
按官方说明这条会自动重跑并在满 1 天后转绿 —— 预计 **17:53 +08**。
