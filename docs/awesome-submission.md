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
```

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

`node --test` — 63 tests: pure logic (`lib/watch.js`, `lib/redact.js`, `lib/body.js`), route layer (`test/routes.test.mjs`), client render smoke (`test/client.test.mjs`), and meta/version guards.
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
