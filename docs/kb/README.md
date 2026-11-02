# 知识库（docs/kb）

每一轮开发都先做一次外部学习，把「出处 → 它怎么做的 → 我们能怎么用 → 是否已落地」写成一篇。
这里是入口索引：**先按板块看**，需要细节再点进单篇。

共 **95** 篇，分 **9** 个板块。

| 板块 | 篇数 | 看点 |
|---|---|---|
| 调度、限额与隔离执行 | 15 | 什么时候不该打扰你；多仓库时别把上下文打爆 |
| 通知与消息设计 | 6 | 唤醒消息怎么写才够用、不啰嗦 |
| 判定与优先级 | 11 | 一次只处理 N 条时，先挑哪几条 |
| 可靠性与状态 | 11 | 状态坏了、版本漂了、叫醒了没回音怎么办 |
| 性能 | 8 | 哪些「优化」是测过才做的，哪些测完决定不做 |
| 可观测性 | 11 | 为什么没叫醒我 —— 有据可查 |
| 交互与可用性 | 14 | 每个提示都要能回答「我现在该做什么」 |
| 工程与文档 | 17 | 怎么改才不改坏，文档怎么写才有人读 |
| 安全 | 2 | 凭证与权限的最小面 |

## 调度、限额与隔离执行

| 主题 | 状态 |
|---|---|
| [抖动去同步（jitter）](polling-jitter.md) | ✅ 0.8.52 |
| [按剩余额度自适应降频](rate-limit-adaptive.md) | ✅ 0.8.53 |
| [第二阶段限流：照 Retry-After 等](rate-limit-secondary.md) | ✅ 0.8.54 |
| [删了目录还不够：worktree 要 prune](worktree-prune.md) | ✅ 0.8.59 |
| [保留策略要能配、要可见](retention-configurable.md) | ✅ 0.8.60 |
| [限流是分池的](rate-limit-pools.md) | ⚠️ 准则已记，代码待用 |
| [search 池只有 30 次/分钟](search-rate-pool.md) | ✅ 0.8.69 |
| [时段判断要在拉数据之前](active-hours-before-fetch.md) | ✅ 0.8.98 |
| [被上限挡住时要说还要等多久](wake-cap-wait-visibility.md) | ✅ 0.8.99 |
| [隔离区只按天数回收，管不住"堆"](worktree-count-cap.md) | ✅ 0.9.0 |
| [时间维度只能靠模拟验证：跑一小时](offline-hour-simulation.md) | ✅ 0.9.19 |
| [以为懂的链路，真跑一遍才知道](verify-isolation-chain.md) | ✅ 0.9.27 |
| [并发隔离要证明互不影响，也要说清哪里会打架](concurrent-isolation.md) | ✅ 0.9.28 |
| [「多久会叫醒我」要拆成五段](explain-latency.md) | ✅ 0.9.29 |
| [单个资源的限额保护不了总量](session-level-quota.md) | ✅ 0.9.2 |

## 通知与消息设计

| 主题 | 状态 |
|---|---|
| [通知要带「为什么是你」](notification-rationale.md) | ✅ 0.8.57 |
| [完成标准要可观测](acceptance-criteria.md) | ✅ 0.8.58 |
| [叫醒前先说有没有人在处理](last-commenter.md) | ✅ 0.8.70 |
| [「我发的」≠「有人在处理」](viewer-self-comment.md) | ✅ 0.8.71 |
| [三个守同时有动静 ≠ 三条消息](coalesce-bursts.md) | ✅ 0.9.3 |
| [合并之后还要去重](merge-dedupe.md) | ✅ 0.9.4 |

## 判定与优先级

| 主题 | 状态 |
|---|---|
| [让「为什么没叫醒」有答案](filter-explainability.md) | ✅ 0.8.55 |
| [「判过不做」又被重开才是信号](state-reason.md) | ✅ 0.8.74 |
| [一次 N 条时先处理更该处理的](batch-priority.md) | ✅ 0.8.75 |
| [权重是产品判断，别写死](priority-configurable.md) | ✅ 0.8.76 |
| [认领状态：事实默认展示，判断默认关闭](assignment-signal.md) | ✅ 0.8.77 |
| [一张表说清分诊信号与取舍](triage-signal-table.md) | ✅ 0.8.78 |
| [躺了多久：60 天是社区默认，我们用 30 天](stale-threshold.md) | ✅ 0.8.79 |
| [「已有 PR 在做」比评论更硬的信号](linked-pull-requests.md) | ✅ 0.8.80 |
| [草稿 PR ≠ 有人在推进](draft-pr-signal.md) | ✅ 0.8.81 |
| [「有 PR」不够，要说清卡在哪](pr-blocked-state.md) | ✅ 0.8.82 |
| [CI 红绿零成本拿到，值得展示](ci-status-on-linked-pr.md) | ✅ 0.8.83 |

## 可靠性与状态

| 主题 | 状态 |
|---|---|
| [状态文件被写坏时别当空状态](state-crash-safety.md) | ✅ 0.8.61 |
| [先查写权限再让它跑](repo-permissions.md) | ✅ 0.8.64 |
| [守一个没有 issue 的仓库是空转](repo-structure.md) | ✅ 0.8.65 |
| [归档仓库是只读的](archived-repo.md) | ✅ 0.8.66 |
| [「挂不挂得上去」要在离线有答案](offline-mount-smoke.md) | ✅ 0.8.87 |
| [数量对不等于形状对：契约快照](contract-snapshot.md) | ✅ 0.8.88 |
| [版本差 54 个版本，界面上看不出来](verify-live-gap.md) | ✅ 0.8.92 |
| [从内部发现版本漂移](version-drift-inside.md) | ✅ 0.8.93 |
| [声明版本 vs 已生效版本要分别暴露](generation-vs-observed.md) | ✅ 0.8.94 |
| [记账要在"真的做到"之后](account-after-send.md) | ✅ 0.9.5（修掉 0.9.3 引入的丢消息 bug） |
| [投递成功 ≠ 有人动手](wake-without-ack.md) | ✅ 0.9.11 |

## 性能

| 主题 | 状态 |
|---|---|
| [条件请求（ETag / 304）](github-conditional-requests.md) | ✅ 0.8.51 |
| [一次 GraphQL 查 N 条，别 N 次 REST](graphql-batch.md) | ✅ 0.8.72 |
| [主轮询要不要换 GraphQL：测了，不换](list-path-decision.md) | ✅ 决定 + 基准脚本（0.8.73） |
| [接口也要做减法：/state 少传 3 个字段](api-surface-diet.md) | ✅ 0.8.84 |
| [把自己接口也接上 ETag/304](etag-on-our-own-api.md) | ✅ 0.8.85 |
| [要不要改 SSE？量完，不值得](no-sse-decision.md) | ✅ 决定（不改代码） |
| [贵的动作放在便宜的判断之后](skip-expensive-work-early.md) | ✅ 0.9.6 |
| [热路径上的维护动作要节流](throttle-cleanup.md) | ✅ 0.9.7 |

## 可观测性

| 主题 | 状态 |
|---|---|
| ["为什么没叫醒我"要有据可查](bounded-event-timeline.md) | ✅ 0.9.8 |
| [噪声会淹没信号：连续同类事件合并](event-noise-reduction.md) | ✅ 0.9.9 |
| [合并了次数，还要能说出持续多久](event-duration.md) | ✅ 0.9.10 |
| [只显示"用了几次"没用，要显示"还能用几次"](show-saturation.md) | ✅ 0.9.20 |
| [别用"匹配提示文案"当数据源](explicit-reason-codes.md) | ✅ 0.9.21 |
| ["这条为什么没叫醒我"要能像 EXPLAIN 一样查](explain-item-trace.md) | ✅ 0.9.30 |
| [解释类功能按需拉，别塞进轮询负载](explain-on-demand.md) | ✅ 0.9.31 |
| [建议需要上下文：留一份每天一个数的极小历史](daily-history.md) | ✅ 0.9.34 |
| [用历史影响判断时，阈值要故意定高](conservative-thresholds.md) | ✅ 0.9.35 |
| [agent 要能靠工具自诊，不用让人截屏面板](agent-self-diagnosis.md) | ✅ 0.9.42 |
| [给 agent 的输出要能结构化](structured-tool-output.md) | ✅ 0.9.43 |

## 交互与可用性

| 主题 | 状态 |
|---|---|
| [输入错误要在点添加那一刻说](add-time-precheck.md) | ✅ 0.8.68 |
| [「在等」也是一种空态](waiting-state.md) | ✅ 0.8.89 |
| [错误提示要回答"我该做什么"](humanize-errors.md) | ✅ 0.8.97 |
| [提示之后要有下一步动作，但别替客户改仓库](close-the-loop-with-action.md) | ✅ 0.9.12 |
| [守多个仓库时先给"哪个仓库有问题"](repo-level-summary.md) | ✅ 0.9.13 |
| [汇总行要么能点，要么就是装饰](summary-as-navigation.md) | ✅ 0.9.14 |
| [快捷筛选要带数量、能一键退回](filter-shortcut.md) | ✅ 0.9.15 |
| [有了原因码，就要能按原因归类看](filter-by-reason-code.md) | ✅ 0.9.22 |
| [建议要给数字，不要给方向](actionable-suggestion.md) | ✅ 0.9.33 |
| [首屏区块数要有个写死的上限](information-density.md) | ✅ 0.9.36 |
| [文案的"行"要按字符数算，别按字节](line-length-limit.md) | ✅ 0.9.37 |
| [同一套规则，两个读者](two-audiences-one-contract.md) | ✅ 0.9.39 |
| [把"文案一致性"做成一张能维护的表](rule-matrix.md) | ✅ 0.9.40 |
| [可用性抽检：三条失败路径的第一句话](ux-copy-audit.md) | ✅ 0.9.16 |

## 工程与文档

| 主题 | 状态 |
|---|---|
| [四十个版本的 CHANGELOG ≠ 客户能读的东西](release-notes-for-humans.md) | ✅ 0.8.90 |
| [文档分四种，别用一种应付](docs-four-kinds.md) | ✅ 0.8.91 |
| [拆分文件看「改动轴」，不看行数](split-by-change-axis.md) | ✅ 0.8.95 |
| [1795 行的 index.js：量完，不拆](why-not-split-index.md) | ✅ 决定 + 文档体检工具（0.8.96） |
| ["已知限制"要和代码一起改](limits-must-track-code.md) | ✅ 0.9.1 |
| [同一段文案有两份实现，就会慢慢走偏](two-copies-drift.md) | ✅ 0.9.17 |
| [索引按主题分组，别按时间堆](index-by-theme.md) | ✅ 0.9.18 |
| [知识库的 ✅ 不能只靠自己声称](audit-kb-claims.md) | ✅ 0.9.23 |
| [文档里的标识符会漂移](identifier-drift.md) | ✅ 0.9.32 |
| [审计器最怕的不是查不出，而是假警报](audit-false-positives.md) | ✅ 0.9.38 |
| [工具能做的要和面板能做的对齐](tool-panel-parity.md) | ✅ 0.9.41 |
| [散文里的数字最容易过期](prose-numbers-drift.md) | ✅ 0.9.45 |
| [schemaVersion 还不够，要说清哪个字段可以依赖](field-stability-manifest.md) | ✅ 0.9.47 |
| [条件断言等于永远通过](fake-pass.md) | ✅ 0.9.48 |
| [条件断言普查：脚本只能列，判断靠人](conditional-assertion-sweep.md) | ✅ 0.9.49 |
| [写一条演练脚本，比自己读代码更能发现问题](dry-run-first-use.md) | ✅ 0.9.25 |
| [客户读到的文字要有快照](copy-snapshot.md) | ✅ 0.9.26 |

## 安全

| 主题 | 状态 |
|---|---|
| [Windows 上 chmod 0600 保护不了 token](windows-secrets-perms.md) | ✅ 0.8.62 |
| [token 权限要看得见、也要够窄](token-scopes.md) | ✅ 0.8.63 |

## 怎么读这些条目

每篇固定四段：**出处（带 URL）/ 它怎么做的 / 我们能怎么用 / 是否已落地**。
"未落地"是真话，不是遗漏 —— 比如限流分池那条当时只记了准则、没改代码。

## 索引本身也有门禁

`node scripts/check-docs.mjs` 会检查两件事：所有相对链接都能解析、`docs/kb/*.md` 没有孤儿（没进索引 = 客户永远看不到）。已接入 `preflight`（第 10 项）。
