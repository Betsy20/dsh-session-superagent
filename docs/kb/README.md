# 知识库索引

每轮学习一条，按**主题**分组（不按时间堆）。每条都必须写清：出处 / 它怎么做 / 我们能怎么用 / 是否已落地。

| 主题 | 条目 | 已落地 |
|---|---|---|
| GitHub API 性能 | [条件请求（ETag / 304）](github-conditional-requests.md) | ✅ 0.8.51 |
| 轮询调度 | [抖动去同步（jitter）](polling-jitter.md) | ✅ 0.8.52 |
| 轮询调度 | [按剩余额度自适应降频](rate-limit-adaptive.md) | ✅ 0.8.53 |
| 轮询调度 | [第二阶段限流：照 Retry-After 等](rate-limit-secondary.md) | ✅ 0.8.54 |
| 判定与可解释性 | [让「为什么没叫醒」有答案](filter-explainability.md) | ✅ 0.8.55 |
| 通知设计 | [通知要带「为什么是你」](notification-rationale.md) | ✅ 0.8.57 |
| 通知设计 | [完成标准要可观测](acceptance-criteria.md) | ✅ 0.8.58 |
| 隔离执行 | [删了目录还不够：worktree 要 prune](worktree-prune.md) | ✅ 0.8.59 |
| 隔离执行 | [保留策略要能配、要可见](retention-configurable.md) | ✅ 0.8.60 |
| 状态可靠性 | [状态文件被写坏时别当空状态](state-crash-safety.md) | ✅ 0.8.61 |
| 安全 | [Windows 上 chmod 0600 保护不了 token](windows-secrets-perms.md) | ✅ 0.8.62 |
| 安全 | [token 权限要看得见、也要够窄](token-scopes.md) | ✅ 0.8.63 |
| 可靠性 | [先查写权限再让它跑](repo-permissions.md) | ✅ 0.8.64 |
| 可靠性 | [守一个没有 issue 的仓库是空转](repo-structure.md) | ✅ 0.8.65 |
| 可靠性 | [归档仓库是只读的](archived-repo.md) | ✅ 0.8.66 |
| 轮询调度 | [限流是分池的](rate-limit-pools.md) | ⚠️ 准则已记，代码待用 |
| 交互 | [输入错误要在点添加那一刻说](add-time-precheck.md) | ✅ 0.8.68 |
| 轮询调度 | [search 池只有 30 次/分钟](search-rate-pool.md) | ✅ 0.8.69 |
| 通知设计 | [叫醒前先说有没有人在处理](last-commenter.md) | ✅ 0.8.70 |
| 通知设计 | [「我发的」≠「有人在处理」](viewer-self-comment.md) | ✅ 0.8.71 |
| 性能 | [一次 GraphQL 查 N 条，别 N 次 REST](graphql-batch.md) | ✅ 0.8.72 |
| 性能 | [主轮询要不要换 GraphQL：测了，不换](list-path-decision.md) | ✅ 决定 + 基准脚本（0.8.73） |
| 判定与可解释性 | [「判过不做」又被重开才是信号](state-reason.md) | ✅ 0.8.74 |
| 判定与可解释性 | [一次 N 条时先处理更该处理的](batch-priority.md) | ✅ 0.8.75 |
| 判定与可解释性 | [权重是产品判断，别写死](priority-configurable.md) | ✅ 0.8.76 |
| 判定与可解释性 | [认领状态：事实默认展示，判断默认关闭](assignment-signal.md) | ✅ 0.8.77 |
| 判定与可解释性 | [一张表说清分诊信号与取舍](triage-signal-table.md) | ✅ 0.8.78 |
| 判定与可解释性 | [躺了多久：60 天是社区默认，我们用 30 天](stale-threshold.md) | ✅ 0.8.79 |
| 判定与可解释性 | [「已有 PR 在做」比评论更硬的信号](linked-pull-requests.md) | ✅ 0.8.80 |
| 判定与可解释性 | [草稿 PR ≠ 有人在推进](draft-pr-signal.md) | ✅ 0.8.81 |
| 判定与可解释性 | [「有 PR」不够，要说清卡在哪](pr-blocked-state.md) | ✅ 0.8.82 |
| 判定与可解释性 | [CI 红绿零成本拿到，值得展示](ci-status-on-linked-pr.md) | ✅ 0.8.83 |
| 性能 | [接口也要做减法：/state 少传 3 个字段](api-surface-diet.md) | ✅ 0.8.84 |
| 性能 | [把自己接口也接上 ETag/304](etag-on-our-own-api.md) | ✅ 0.8.85 |
