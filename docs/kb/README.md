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
| 性能 | [要不要改 SSE？量完，不值得](no-sse-decision.md) | ✅ 决定（不改代码） |
| 可靠性 | [「挂不挂得上去」要在离线有答案](offline-mount-smoke.md) | ✅ 0.8.87 |
| 可靠性 | [数量对不等于形状对：契约快照](contract-snapshot.md) | ✅ 0.8.88 |
| 交互 | [「在等」也是一种空态](waiting-state.md) | ✅ 0.8.89 |
| 文档 | [四十个版本的 CHANGELOG ≠ 客户能读的东西](release-notes-for-humans.md) | ✅ 0.8.90 |
| 文档 | [文档分四种，别用一种应付](docs-four-kinds.md) | ✅ 0.8.91 |
| 可靠性 | [版本差 54 个版本，界面上看不出来](verify-live-gap.md) | ✅ 0.8.92 |
| 可靠性 | [从内部发现版本漂移](version-drift-inside.md) | ✅ 0.8.93 |
| 可靠性 | [声明版本 vs 已生效版本要分别暴露](generation-vs-observed.md) | ✅ 0.8.94 |
| 工程 | [拆分文件看「改动轴」，不看行数](split-by-change-axis.md) | ✅ 0.8.95 |
| 工程 | [1795 行的 index.js：量完，不拆](why-not-split-index.md) | ✅ 决定 + 文档体检工具（0.8.96） |
| 交互 | [错误提示要回答"我该做什么"](humanize-errors.md) | ✅ 0.8.97 |
| 轮询调度 | [时段判断要在拉数据之前](active-hours-before-fetch.md) | ✅ 0.8.98 |
| 轮询调度 | [被上限挡住时要说还要等多久](wake-cap-wait-visibility.md) | ✅ 0.8.99 |
| 隔离执行 | [隔离区只按天数回收，管不住"堆"](worktree-count-cap.md) | ✅ 0.9.0 |
| 文档 | ["已知限制"要和代码一起改](limits-must-track-code.md) | ✅ 0.9.1 |
| 限额 | [单个资源的限额保护不了总量](session-level-quota.md) | ✅ 0.9.2 |
| 通知设计 | [三个守同时有动静 ≠ 三条消息](coalesce-bursts.md) | ✅ 0.9.3 |
| 通知设计 | [合并之后还要去重](merge-dedupe.md) | ✅ 0.9.4 |
| 可靠性 | [记账要在"真的做到"之后](account-after-send.md) | ✅ 0.9.5（修掉 0.9.3 引入的丢消息 bug） |
| 性能 | [贵的动作放在便宜的判断之后](skip-expensive-work-early.md) | ✅ 0.9.6 |
| 性能 | [热路径上的维护动作要节流](throttle-cleanup.md) | ✅ 0.9.7 |
| 可观测性 | ["为什么没叫醒我"要有据可查](bounded-event-timeline.md) | ✅ 0.9.8 |
| 可观测性 | [噪声会淹没信号：连续同类事件合并](event-noise-reduction.md) | ✅ 0.9.9 |
| 可观测性 | [合并了次数，还要能说出持续多久](event-duration.md) | ✅ 0.9.10 |
| 可靠性 | [投递成功 ≠ 有人动手](wake-without-ack.md) | ✅ 0.9.11 |
| 交互 | [提示之后要有下一步动作，但别替客户改仓库](close-the-loop-with-action.md) | ✅ 0.9.12 |
| 交互 | [守多个仓库时先给"哪个仓库有问题"](repo-level-summary.md) | ✅ 0.9.13 |
