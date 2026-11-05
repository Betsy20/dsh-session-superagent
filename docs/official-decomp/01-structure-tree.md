# 官方 superagent 完整结构树与吸收方案

> 基线：[`deepseek-ai/dsh-superagent-prototype@8c32a9d`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/8c32a9dc5d72c033816c6a8110b37f40cf94fba4)。
> 本文是总图；逐文件、逐行证据见同目录 02–05 四份分报告。
> 目标不是「抄得像」，而是回答：**哪些结构能解决主理鱼的真实缺口，哪些会把单人产品变成团队项目。**

## 一、完整目录树

保留了 `src / prompts / skills / docs / examples / locale / scripts / tests` 与根配置，
只省略 `.git`、`node_modules`、构建产物和 `pnpm-lock.yaml`：

```text
.
├── docs/
│   ├── 000-philosophy.md
│   ├── 001-domain.md
│   ├── 002-authorization.md
│   ├── 003-execution.md
│   ├── 004-prompts.md
│   ├── 005-panel.md
│   ├── 006-deployment.md
│   ├── 007-architecture.md
│   └── 008-cookbook.md
├── examples/
│   └── profile.cordis.patch.yml
├── locale/
│   ├── en.json
│   └── zh.json
├── prompts/
│   ├── team/
│   │   ├── communication.md
│   │   ├── delivery.md
│   │   └── scope.md
│   ├── admission.md
│   ├── cli.md
│   ├── dispatch.md
│   ├── handoff-orchestrator.md
│   ├── handoff-worker.md
│   ├── handoff.md
│   ├── orchestrator.md
│   ├── replies.md
│   ├── shared.md
│   ├── subscriptions.md
│   ├── work.md
│   └── worker.md
├── scripts/
│   └── dsh-superagent
├── skills/
│   ├── dsh-superagent-feishu/
│   │   └── SKILL.md
│   └── dsh-superagent-github/
│       └── SKILL.md
├── src/
│   ├── app/
│   │   ├── tools/
│   │   │   ├── executor.ts
│   │   │   ├── main.ts
│   │   │   └── tool.ts
│   │   ├── views/
│   │   │   ├── overview.ts
│   │   │   ├── records.ts
│   │   │   ├── settings.ts
│   │   │   ├── sources.ts
│   │   │   ├── text.ts
│   │   │   ├── threads.ts
│   │   │   └── tickets.ts
│   │   ├── api.ts
│   │   ├── assessment.ts
│   │   ├── cache.ts
│   │   ├── cards.ts
│   │   ├── context.ts
│   │   ├── delivery.ts
│   │   ├── effects.ts
│   │   ├── execution-environment.ts
│   │   ├── http.ts
│   │   ├── links.ts
│   │   ├── migration.ts
│   │   ├── notices.ts
│   │   ├── outbox.ts
│   │   ├── passes.ts
│   │   ├── prompts.ts
│   │   ├── resources.ts
│   │   ├── retry-health.ts
│   │   ├── role-models.ts
│   │   ├── runtime.ts
│   │   ├── sessions.ts
│   │   ├── settings-history.ts
│   │   ├── settings.ts
│   │   ├── setup.ts
│   │   ├── skill-files.ts
│   │   ├── source-context.ts
│   │   ├── store-read.ts
│   │   ├── store.ts
│   │   └── versions.ts
│   ├── client/
│   │   ├── api.ts
│   │   ├── app.tsx
│   │   ├── client.css
│   │   ├── controls.tsx
│   │   ├── css.d.ts
│   │   ├── deployment.tsx
│   │   ├── draft.tsx
│   │   ├── eval.tsx
│   │   ├── execution.tsx
│   │   ├── index.tsx
│   │   ├── locales.ts
│   │   ├── markdown.ts
│   │   ├── marks.ts
│   │   ├── overview.tsx
│   │   ├── prompt-config.ts
│   │   ├── prompts.tsx
│   │   ├── provider.tsx
│   │   ├── route.ts
│   │   ├── rows.tsx
│   │   ├── settings-kit.tsx
│   │   ├── settings.tsx
│   │   ├── source.tsx
│   │   ├── text.ts
│   │   ├── thread.tsx
│   │   ├── ticket.tsx
│   │   ├── trigger.tsx
│   │   └── widgets.tsx
│   ├── core/
│   │   ├── assignments.ts
│   │   ├── engine.ts
│   │   ├── errors.ts
│   │   ├── evals.ts
│   │   ├── ids.ts
│   │   ├── index.ts
│   │   ├── intake.ts
│   │   ├── memory.ts
│   │   ├── model.ts
│   │   ├── part.ts
│   │   ├── ports.ts
│   │   ├── reasons.ts
│   │   ├── replies.ts
│   │   ├── stage.ts
│   │   └── tickets.ts
│   ├── executor/
│   │   ├── background.ts
│   │   └── dsh.ts
│   ├── infra/
│   │   ├── commands.ts
│   │   ├── environment.ts
│   │   ├── health.ts
│   │   ├── paths.ts
│   │   └── text.ts
│   ├── sources/
│   │   ├── admission-context.ts
│   │   ├── feishu-channel.ts
│   │   ├── feishu-image.ts
│   │   ├── feishu-loops.ts
│   │   ├── feishu-read.ts
│   │   ├── feishu-trigger.ts
│   │   ├── feishu.ts
│   │   ├── github-channel.ts
│   │   ├── github-pull.ts
│   │   ├── github-read.ts
│   │   ├── github-trigger.ts
│   │   ├── github.ts
│   │   ├── host.ts
│   │   ├── kind.ts
│   │   ├── poll.ts
│   │   └── registry.ts
│   ├── admission.ts
│   ├── deployment.ts
│   ├── index.ts
│   ├── kv.ts
│   ├── limits.ts
│   ├── navigation.ts
│   ├── policy.ts
│   └── setup.ts
├── tests/
│   ├── fixtures/
│   │   ├── async.ts
│   │   ├── deployment.ts
│   │   ├── git.ts
│   │   ├── host.ts
│   │   ├── panel-server.ts
│   │   └── panel.tsx
│   ├── admission-context.spec.ts
│   ├── assessment.spec.ts
│   ├── background.spec.ts
│   ├── bundle-patch.spec.ts
│   ├── cache.spec.ts
│   ├── cards.spec.ts
│   ├── class-docs.spec.ts
│   ├── client.spec.tsx
│   ├── commands.spec.ts
│   ├── controls.spec.tsx
│   ├── core-engine.spec.ts
│   ├── delivery.spec.ts
│   ├── deployment.spec.ts
│   ├── docs.spec.ts
│   ├── draft.spec.ts
│   ├── effects.spec.ts
│   ├── environment.spec.ts
│   ├── feishu-image.spec.ts
│   ├── feishu-read.spec.ts
│   ├── followups.spec.ts
│   ├── github-read.spec.ts
│   ├── health.spec.ts
│   ├── http.spec.ts
│   ├── index.spec.ts
│   ├── locales.spec.ts
│   ├── markdown.spec.ts
│   ├── marks.spec.ts
│   ├── migration.spec.ts
│   ├── model-surface.spec.ts
│   ├── navigation.spec.ts
│   ├── outbox.spec.ts
│   ├── panel-deployment.spec.tsx
│   ├── panel-eval.spec.tsx
│   ├── panel-execution.spec.tsx
│   ├── panel-overview.spec.tsx
│   ├── panel-panel.spec.tsx
│   ├── panel-prompts.spec.tsx
│   ├── panel-settings.spec.tsx
│   ├── panel-source.spec.tsx
│   ├── panel-trigger.spec.tsx
│   ├── passes.spec.ts
│   ├── policy.spec.ts
│   ├── prompt-config.spec.ts
│   ├── prompts.spec.ts
│   ├── queue.spec.ts
│   ├── registry.spec.ts
│   ├── retry-health.spec.ts
│   ├── role-models.spec.ts
│   ├── runtime-concurrency.spec.ts
│   ├── runtime.spec.ts
│   ├── service-script.spec.ts
│   ├── settings.spec.ts
│   ├── sources.spec.ts
│   ├── stage.spec.ts
│   ├── store.spec.ts
│   ├── styles.spec.ts
│   ├── timeline.spec.ts
│   ├── tools.spec.ts
│   └── views.spec.ts
├── .gitignore
├── cordis.patch.yml
├── LICENSE
├── package.json
├── README.md
├── SETUP.md
├── tsconfig.json
├── tsdown.config.ts
└── vitest.config.ts
```

## 二、这棵树的实际分层

```text
GitHub / Feishu
      │
      ▼
Source（读位、去重、机器人过滤、分页、图片、循环检测）
      │ Trigger
      ▼
Thread / Correlation / Channel
      │
      ▼
Admission → Policy → Eval（gate + assessment）
      │ Mandate / Decision
      ▼
Ticket ── Assignment ── Executor（独立 Session + 工作目录）
  │                         │
  │                         ▼
  │                    结果 / 最终报告
  ▼                         │
Subscription ◀──────────────┘
  │
  ▼
Delivery / Outbox（回原 Thread/Channel，失败重试）
  │
  ├─ GitHub 评论 / PR / review
  └─ Feishu 回复

Panel（只读领域状态 + 写配置）  Prompts / Policy / Deployment / Migration
```

| 层 | 官方位置 | 它真正负责的事 |
|---|---|---|
| 事件源 | `src/sources/` | 把外部世界归一成 Trigger，并保存读位；不让重启重放 |
| 领域模型 | `src/core/` | Thread、Ticket、Decision、Subscription 等不变量 |
| 应用编排 | `src/app/` | 评估、执行、投递、设置、视图、迁移 |
| 执行体 | `src/executor/` | 在独立 DSH Session 与目录里完成 Ticket |
| 策略与准入 | `src/policy.ts`、`src/admission.ts` | 谁可以派活、按哪版规则、可以干多远 |
| 面板 | `src/client/` + `src/app/views/` | 只读领域投影 + 配置动作，不另造业务状态 |
| 提示词 | `prompts/` + `src/app/prompts.ts` | 把领域状态组装成主会话/执行体/handoff 的上下文 |
| 运维 | `SETUP.md`、`migration.ts`、`versions.ts`、`locale/` | 安装、迁移、升级、多语言 |

## 三、和主理鱼的结构映射

| 官方结构 | 主理鱼现状 | 结论 |
|---|---|---|
| Source 读位 + Trigger 幂等 | `cursor / seen / lastReported` + 水位只前进 | **已有同构核心**，继续保留 |
| Policy：谁可以派活 | `filters.allowAuthors`（0.9.252） | 已吸收最小版，不引入完整版本化 Policy |
| Ticket 的 open/ended | `pendingRetry` + `watch_ack` + `acked.note` | 已吸收「未回执再提」，不复制完整 Ticket 状态机 |
| Assignment / Executor 多实例 | 隔离 worktree，但仍在本会话执行 | **不照搬**；单人会话不需要执行体编排 |
| Subscription：后续讨论自动到达 | `seen` 检测 `updated_at`，reopen/评论可再唤醒 | 已覆盖主要收益；不引入多对多订阅表 |
| Delivery / Outbox | **0.9.261 已吸收**：`watch_ack(comment:true)` 回写原条目；会话级 FIFO，忙时排队、空闲按序送达 | 不复制 SQLite Outbox；未送达不推进水位，重启后由轮询重建 |
| Records / Threads / Tickets 视图 | 总览 / 判定 / 触发 / 设置 + 单条追溯 | 把记录并入现有页，不盲目加到 6 个 Tab |
| Prompt sections 可配置 | 唤醒任务书 + 每守 `goal` | 保留单一目标入口，不引入多角色提示词 |
| Migration / Versions | `readState()` 归一与备份恢复 | 可补显式 `schemaVersion` 与迁移表，非当前阻塞 |
| Locale | 中文文案 | 可做英文资源层，但不改变交互结构 |
| Feishu / 多 Source / orchestrator-worker | GitHub + Gitee，单会话 | **不吸收**：解决的是团队协作，不是当前诉求 |

## 四、吸收顺序（按真实缺口，不按官方目录顺序）

### P0：直接解决现有问题

1. **Outbox FIFO（L79，0.9.261 已落地）**
   - 会话忙时进入会话级 FIFO；空闲自动按顺序 `followup`，面板显示「排队 N」。
   - 送达前回调仍 `ok:false`，不计次数、不推进水位；同一 `queueKey` 去重。
   - 进程内保存队列；重启后由未推进的水位重建，不复制官方 SQLite Effects。
   - 证据：`test/wake-queue.test.mjs` 3/3，覆盖 FIFO、去重、实例隔离。

2. **Delivery 回写原条目（L80，0.9.261 已落地）**
   - `watch_ack({ note, comment:true })` 把处理结论评论到原 issue/PR；默认仍只打标签。
   - Gitee 用 `kind:'issue'|'pull'` 选择正确端点；缺 note 时在任何外部写操作前拒绝。
   - 证据：`test/delivery-comment.test.mjs` 3/3，覆盖 issue、pull、默认不评论与参数拒绝。

### P1：能明显降低维护成本

3. **显式状态迁移表**：为 `watchers.json` 增加 `schemaVersion`，把分散的兼容归一逐步收成迁移函数。
4. **记录视图合并**：把官方 records/threads/tickets 的审计信息并入「判定」和单条追溯，不新增平级 Tab。
5. **提示词分段常量**：完成标准、投递方式、回写规则从长模板中抽成可测试段落；不引入 orchestrator/worker 多角色。

### 不吸收（写清理由）

- 飞书与通用 Source kind 抽象：当前没有对应用户诉求；
- 完整 Policy/Mandate/Decision 版本链：会把「谁提的」一个过滤器扩大成规则系统；
- Ticket/Assignment/Executor 多实例与 handoff：团队执行拓扑，不是单人会话；
- 独立安装向导：当前一条命令已能装好，增加访谈反而提高门槛。

## 五、分报告

- [02-runtime-execution.md](02-runtime-execution.md)：运行时、Ticket/Executor、状态与持久化
- [03-sources.md](03-sources.md)：Source、Trigger、Channel、Subscription、读位与幂等
- [04-panel-tree.md](04-panel-tree.md)：完整页面树、数据依赖与官方组件
- [05-prompts-skills-operations.md](05-prompts-skills-operations.md)：提示词、skills、SETUP、迁移与多语言

> 只有分报告中的「可吸收」结论经过代码与测试落地后，才会在派单表标 DONE；本目录文档本身不算功能完成。
