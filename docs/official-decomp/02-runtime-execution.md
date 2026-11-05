# 官方 Superagent 运行时与执行链解构

> 基线：`deepseek-ai/dsh-superagent-prototype@8c32a9dc5d72c033816c6a8110b37f40cf94fba4`。
> 本文只覆盖任务指定的 `src/app/**`、`src/core/**`、`src/executor/**` 与六个根级文件；行号均指该基线的官方仓库相对路径。
> 为避免混淆，下文区分 **assessment/relay/notice→主 Session**、**launch/Input→worker Session** 与 **Outbox→外部 Channel** 三个投递平面。

## 一、目录树（逐文件）

### 1.1 `src/` 根级文件

| 文件 | 职责与关键落点 |
|---|---|
| `src/admission.ts` | 定义 `explicit / inferred / ignore`、三种 admission cell 的可选值及默认矩阵；默认“已列名但未点名”为 inferred，其余未列名消息忽略（`src/admission.ts:8-13`）。 |
| `src/policy.ts` | 运行时配置 schema、评估结果校验、授权版本 hash、admission gate、Mandate 重验与配置变更影响计算；`assessmentOutcome` 在 40-61 行，`settingsPolicy` 在 167-242 行。 |
| `src/limits.ts` | 集中定义规则、Eval 超时、worker 数、prepare 命令、prompt 和上下文读取的共享上下限（`src/limits.ts:2-11`）。 |
| `src/kv.ts` | 定义类型化 KV key/family 及 schema、设置、prompt、主 Session、Source cursor 等键；领域 Ticket/Thread/Decision 不在这里，而在独立 SQLite 表（`src/kv.ts:15-21`、`src/kv.ts:21-58`）。 |
| `src/setup.ts` | 定义部署/GitHub/Feishu 的结构化启动问题与 `SetupError`，供设置面板和 HTTP 层定位错误（`src/setup.ts:4-24`、`src/setup.ts:26-39`）。 |
| `src/deployment.ts` | 校验插件配置，解析可执行文件，探测 GitHub 身份/仓库写权限和 Feishu bot 身份，生成 `Deployment`（`src/deployment.ts:14-30`、`src/deployment.ts:60-76`、`src/deployment.ts:86-106`、`src/deployment.ts:110-131`）。 |

### 1.2 `src/core/`：同步领域核心

| 文件 | 职责与关键落点 |
|---|---|
| `src/core/model.ts` | 定义 Trigger、Thread、Evaluation、Decision、Mandate、Ticket、Assignment、Input 等领域模型及 `followupOwners`、`reached`、`waitsForPerson` 等不变量（`src/core/model.ts:22-39`、`src/core/model.ts:96-154`、`src/core/model.ts:156-182`、`src/core/model.ts:190-233`、`src/core/model.ts:271-353`）。 |
| `src/core/ports.ts` | 定义 SourceScope、Policy、Assessor、Executor、Outbox、DomainEvents、Repositories 端口；明确 assessor 只拿事实、Executor 只排队并回调（`src/core/ports.ts:6-27`、`src/core/ports.ts:29-69`、`src/core/ports.ts:105-134`）。 |
| `src/core/part.ts` | `EnginePart` 提供 repo/policy/clock/event 共享能力，以及 follow-up owner、handback、takeUp、Eval 入队、Thread/Ticket 读取等公共操作（`src/core/part.ts:20-35`、`src/core/part.ts:36-80`）。 |
| `src/core/intake.ts` | Trigger 去重、SourceScope 过滤、Thread 关联、Subscription fan-out、Ticket Input、follow-up 分流与 Eval 入队（`src/core/intake.ts:19-61`）。 |
| `src/core/evals.ts` | Thread 级 Trigger 批处理、Policy gate、评估超时/重排、直接 Eval、Decision 记录，以及 accept 后 Mandate/Ticket 创建（`src/core/evals.ts:30-119`、`src/core/evals.ts:125-156`、`src/core/evals.ts:281-339`）。 |
| `src/core/tickets.ts` | Ticket 创建、订阅、输入、恢复、重试、重启、结束、Thread close 与 Assignment 替换的绝大部分状态机（`src/core/tickets.ts:23-56`、`src/core/tickets.ts:57-101`、`src/core/tickets.ts:230-270`、`src/core/tickets.ts:338-423`）。 |
| `src/core/assignments.ts` | 接收 Executor 生命周期事实：started/delivered/read/turnEnded/deliveryFailed/interrupted/report，并联动 Ticket 结束与 Reply 撤回（`src/core/assignments.ts:30-92`、`src/core/assignments.ts:93-140`）。 |
| `src/core/replies.ts` | 对 acknowledgement/answer/result/attention 做路由与资格检查，经 Outbox 以稳定 ID 幂等排队（`src/core/replies.ts:20-47`、`src/core/replies.ts:48-95`）。 |
| `src/core/engine.ts` | 领域唯一事务入口，组合 Intake/Evals/Tickets/Assignments/Replies，并向 Sources、主 Session、面板、Executor 暴露收窄接口（`src/core/engine.ts:19-48`、`src/core/engine.ts:67-85`、`src/core/engine.ts:168-247`、`src/core/engine.ts:260-270`）。 |
| `src/core/stage.ts` | 把存储状态投影为 person/working/idle/ended 阶段，并判断 blocked/failed/投递失败是否可重试（`src/core/stage.ts:4-26`）。 |
| `src/core/memory.ts` | 测试/临时用 Map 版 Repositories，以 clone 和快照回滚模拟 SQLite 顺序与事务（`src/core/memory.ts:5-24`、`src/core/memory.ts:25-50`）。 |
| `src/core/errors.ts` | 用户可操作错误的代码、missing/refused 分类与 `UserError`，供工具和 HTTP 映射（`src/core/errors.ts:1-61`）。 |
| `src/core/reasons.ts` | Decision、过滤与 Assignment 结束原因的结构化代码、模板及 `reasonText` 格式化（`src/core/reasons.ts:1-38`）。 |
| `src/core/ids.ts` | 对 JSON 数组做 SHA-256 并截取 32 位，生成稳定内容派生 ID（`src/core/ids.ts:1-5`）。 |
| `src/core/index.ts` | core 的公共出口，重导出模型、端口、Engine、错误、内存仓库、stage 与 ID 工具（`src/core/index.ts:1-10`）。 |

### 1.3 `src/executor/`：DSH 执行适配器

| 文件 | 职责与关键落点 |
|---|---|
| `src/executor/dsh.ts` | 每 Ticket 一个持久 worker Session 和工作目录；负责 Execution 元数据、worker slots、launch/delivery effects、消息格式、事件回写、重启恢复、后台工作收尾（`src/executor/dsh.ts:201-240`、`src/executor/dsh.ts:263-350`、`src/executor/dsh.ts:424-470`、`src/executor/dsh.ts:476-537`、`src/executor/dsh.ts:601-673`）。 |
| `src/executor/background.ts` | 管理 worker 的 shell jobs 与 subagents：安静等待、回收、kill、停止后台工作及 bounded shutdown（`src/executor/background.ts:66-104`、`src/executor/background.ts:106-165`）。 |

### 1.4 `src/app/`：组合、持久化、模型会话与管理面

| 文件 | 职责与关键落点 |
|---|---|
| `src/app/runtime.ts` | 组合根：锁定 stateDir、打开 SQLite，装配 Store/Engine/Sources/Effects/Sessions/DshExecutor/MasterAssessor/Outbox/Passes，并负责启动与关闭（`src/app/runtime.ts:54-99`、`src/app/runtime.ts:121-166`、`src/app/runtime.ts:199-218`、`src/app/runtime.ts:228-254`）。 |
| `src/app/store.ts` | SQLite 领域存储、KV、设置历史、outbox receipt、事务/savepoint、afterCommit 与 active 工作集索引（`src/app/store.ts:26-50`、`src/app/store.ts:51-101`、`src/app/store.ts:133-181`、`src/app/store.ts:201-288`）。 |
| `src/app/store-read.ts` | 对 Trigger/Thread/Decision/Receipt 的只读 SQL 查询，包括时间线、搜索、flow 和失败/丢弃回复（`src/app/store-read.ts:6-81`）。 |
| `src/app/migration.ts` | schema 10→11 的单事务迁移：领域形状、Mandate basis、设置/prompt 版本、effect/outbox、Source 记录、时间戳和旧 KV 清理（`src/app/migration.ts:20-25`、`src/app/migration.ts:35-91`）。 |
| `src/app/effects.ts` | SQLite 持久副作用队列；同事务 enqueue、commit 后异步 dispatch，支持 coalesce、并发上限、顺序、退避和健康状态（`src/app/effects.ts:38-74`、`src/app/effects.ts:83-146`）。 |
| `src/app/passes.ts` | 2 秒周期及按需 pass，串行/coalesce `effects.kick()` 与 `engine.evaluateDue()`；新 Trigger 存储后立即请求 pass（`src/app/passes.ts:17-39`、`src/app/passes.ts:47-68`）。 |
| `src/app/assessment.ts` | `MasterAssessor` 把 Candidate 经 assessment effect 送到主 Session，提供受限上下文读取，并把模型评估转换成 Engine outcome（`src/app/assessment.ts:84-108`、`src/app/assessment.ts:175-220`、`src/app/assessment.ts:221-279`）。 |
| `src/app/sessions.ts` | 主/worker Session 创建、角色模型、prompt/skill/tool 装饰、权限、relay/notice effects、消息投递及 prompt revision 记录（`src/app/sessions.ts:88-106`、`src/app/sessions.ts:137-185`、`src/app/sessions.ts:228-339`）。 |
| `src/app/delivery.ts` | `AgentDelivery` 扫描持久历史和 inbox，以 request ID 去重；发送后 flush Session persistence，再让 producer effect 成功（`src/app/delivery.ts:26-39`、`src/app/delivery.ts:40-85`）。 |
| `src/app/outbox.ts` | 外部 Channel 可靠投递：receipt 与 reply effect 同事务写入，前序失败未满 3 次时按 ticket+conversation 保序，处理等待、gone/ignored 与 sent/dropped（`src/app/outbox.ts:17-38`、`src/app/outbox.ts:39-51`、`src/app/store.ts:258-261`）。 |
| `src/app/cards.ts` | 生成有界的 Trigger/Ticket/Thread/Decision/Input/Assignment 模型卡片和文本分页，避免全文直接进入 prompt（`src/app/cards.ts:7-36`、`src/app/cards.ts:38-96`）。 |
| `src/app/links.ts` | 解析 Source 链接、回复父消息、引用到的相关 Ticket，并组装主 Session candidate card 和 next_action（`src/app/links.ts:20-52`、`src/app/links.ts:54-71`）。 |
| `src/app/notices.ts` | 生成设置/prompt/订阅 notice 与 follow-up、worker report/attention/result relay，供主 Session 消费（`src/app/notices.ts:38-74`、`src/app/notices.ts:76-129`）。 |
| `src/app/resources.ts` | `orchestrator_read` 的资源目录、分页和访问控制；worker 只能读自己的 Ticket 及可达 Trigger/Thread（`src/app/resources.ts:23-57`、`src/app/resources.ts:82-109`、`src/app/resources.ts:118-293`、`src/app/resources.ts:295-308`）。 |
| `src/app/prompts.ts` | 版本化团队 prompt、内建覆盖、skills、执行环境和 Policy section 的组合与保存；明确 prompt 不改变工具权限/gate（`src/app/prompts.ts:87-119`、`src/app/prompts.ts:124-215`、`src/app/prompts.ts:195-200`）。 |
| `src/app/context.ts` | 加载内建角色/策略/团队 prompt 文本，并提供去除流式 chunk、usage、reasoning 的 transcript 投影（`src/app/context.ts:6-26`、`src/app/context.ts:28-33`）。 |
| `src/app/skill-files.ts` | 从包内读取并校验 GitHub/Feishu skill 和 prompt 模板，统一换行及段落格式（`src/app/skill-files.ts:1-32`）。 |
| `src/app/settings.ts` | 分块设置校验、乐观并发、面板专属修改、保存后 Policy 变更通知、Source 同步和暂停/恢复（`src/app/settings.ts:26-53`、`src/app/settings.ts:139-195`、`src/app/settings.ts:197-267`）。 |
| `src/app/settings-history.ts` | 对设置快照计算规则、Source、模型、worker、pause、执行环境等结构化 diff（`src/app/settings-history.ts:47-90`）。 |
| `src/app/versions.ts` | 通用编号快照存储：写新 revision 并原子推进 current pointer，供 settings/prompts 使用（`src/app/versions.ts:5-34`）。 |
| `src/app/setup.ts` | 启动时探测账户并写入/验证隔离 git、PATH shim、blocked-command 环境；维护 setup readiness 和延迟重启（`src/app/setup.ts:20-25`、`src/app/setup.ts:37-99`）。 |
| `src/app/execution-environment.ts` | 声明并生成不含凭据的 ticket/executor/Source 环境变量，确定默认 `<stateDir>/work` 根目录（`src/app/execution-environment.ts:9-46`）。 |
| `src/app/role-models.ts` | 只在新 Session 首次请求前注入角色模型选择，避免修改 DSH 全局默认模型（`src/app/role-models.ts:7-44`）。 |
| `src/app/retry-health.ts` | 从 Session 事件识别模型预算重试，维护 provider/attempts/since 健康投影，不修改重试策略（`src/app/retry-health.ts:9-29`、`src/app/retry-health.ts:32-91`）。 |
| `src/app/source-context.ts` | 给每类 Source 的受限门面：只暴露受控 Store/Engine/Outbox/health 能力，Trigger 经 `deps.receive` 入链（`src/app/source-context.ts:11-27`、`src/app/source-context.ts:29-72`）。 |
| `src/app/http.ts` | loopback + same-origin 管理 API，覆盖 Thread/Trigger/Decision/Ticket 操作、设置、prompt、setup 与错误映射（`src/app/http.ts:75-90`、`src/app/http.ts:151-213`、`src/app/http.ts:230-247`）。 |
| `src/app/api.ts` | 管理面板与 host 之间的纯类型 API 合同及分页/filter 类型，不执行运行逻辑（`src/app/api.ts:12-52`）。 |
| `src/app/cache.ts` | 按 UTF-16 总字符数限制的内存 LRU，用于资源页和 Feishu 链接缓存（`src/app/cache.ts:1-27`）。 |
| `src/app/tools/tool.ts` | 定义 Tool/RegisterTool、ack 文本 schema 和分页 `orchestrator_read` 工具构造器（`src/app/tools/tool.ts:6-35`）。 |
| `src/app/tools/main.ts` | 主 Session 的 route/eval/reply/retry/status/note/requeue/settings/prompt 工具；显式 accept 最终也走 `Engine.decide`（`src/app/tools/main.ts:84-153`、`src/app/tools/main.ts:154-301`）。 |
| `src/app/tools/executor.ts` | worker 的 read/ack/thread follow/thread unrelated/handback/report 工具；report、PR claim 与主 Session relay 同事务（`src/app/tools/executor.ts:23-73`、`src/app/tools/executor.ts:74-103`）。 |
| `src/app/views/records.ts` | 管理视图共享投影：follow-up owner、Ticket/Thread/Trigger/Decision 摘要、Mandate/actor 名称和快照缓存（`src/app/views/records.ts:19-78`、`src/app/views/records.ts:79-210`）。 |
| `src/app/views/overview.ts` | 总览系统问题、待人处理 Ticket、Executor 负载、24 小时流量及最近 unavailable Eval（`src/app/views/overview.ts:12-38`、`src/app/views/overview.ts:38-80`）。 |
| `src/app/views/threads.ts` | Thread 列表/时间线、跨实体搜索与 Decision 列表；游标由时间戳和 ID 组成（`src/app/views/threads.ts:9-54`、`src/app/views/threads.ts:55-95`）。 |
| `src/app/views/tickets.ts` | Ticket 列表/详情、Mandate basis 展示和 Executor 负载；展示每 Ticket 的共享 worker Session（`src/app/views/tickets.ts:10-55`、`src/app/views/tickets.ts:56-87`）。 |
| `src/app/views/settings.ts` | 聚合设置块、Source 表单/修订、setup 状态和执行环境视图（`src/app/views/settings.ts:19-43`）。 |
| `src/app/views/sources.ts` | Source 健康、生命周期、24 小时 Trigger 统计以及 filtered/dropped 消息视图（`src/app/views/sources.ts:11-70`）。 |
| `src/app/views/text.ts` | 视图文本去 HTML、Markdown/JSON 可读化、preview 与 attribute 清洗（`src/app/views/text.ts:1-36`）。 |

## 二、运行时调用链

### 2.1 启动时先装配“同步领域核心 + 持久副作用队列”

`Runtime` 不是 Trigger 处理器本身，而是 composition root。构造时先锁 `stateDir`，打开 `<stateDir>/orchestrator.sqlite`，再实例化全部服务；`Engine` 的 repo 是 `Store`，`policy()` 每次从当前设置构造，`prepareTicket` 由 `DshExecutor.prepare` 补充执行目录和任务文本（`src/app/runtime.ts:87-105`、`src/app/runtime.ts:121-153`）。`Store` 建表并启用 WAL/FULL sync，schema 10 会迁移到 11；数据库路径和建表语句见 `src/app/runtime.ts:98`、`src/app/store.ts:58-100`。

启动顺序为：注册管理 HTTP → `Setup.run` → 安装 Session/Executor 事件监听 → 确保主 Session → Source policy sync → `executor.resume()` 恢复 Assignment → `passes.start()` → `effects.start()`（`src/app/runtime.ts:201-218`）。因此恢复时先重排中断工作，再开启周期 pass 和副作用分发；尚未 `start` 的 effect 会留在 SQLite（`src/app/effects.ts:54-56`、`src/app/effects.ts:83-104`）。

核心边界是：**Engine 的所有写命令都是同步 `repo.atomic` 事务；assessment、launch、delivery、relay、notice、reply 都是事务内写入、提交后异步执行的 effect**（`src/core/engine.ts:19-48`、`src/app/effects.ts:42-45`、`src/app/store.ts:133-162`）。`afterCommit` 只用于不必跨重启保存的内存动作，例如停止 worker turn；必须跨崩溃恢复的动作走 Effects（`src/app/store.ts:154-162`）。另外，`EnginePart.emit` 只是同步 callback，不是另一条异步事件总线；Runtime 在该 callback 里把领域事件翻译成 notice/relay/outbox，仍经持久 Effects 排队（`src/core/part.ts:64-65`、`src/app/runtime.ts:137-153`）。

### 2.2 主链：Trigger → Admission → Policy/Eval

下面是接受新工作的真实主链，不把概念阶段误当成独立服务：

```text
SourceContext/Runtime.receive
  → Passes.receive
  → Engine.receive [SAVEPOINT]
  → Intake.receive
      → SourceScope.scope（接收范围过滤）
      → Trigger + Disposition 持久化
      → Thread 关联 + Subscription fan-out
      → 无 follow-up owner 时 queueForEval
  → Passes.request / 2 秒 timer
  → Engine.evaluateDue
  → Evals.start
      → settingsPolicy.gate（授权强度与 MandateBasis）
      → Thread.evaluating 持久化
      → MasterAssessor.request
      → effect(assessment)
  → Sessions.prompt(master) / AgentDelivery.send
  → 主 Session 工具
      → 显式：orchestrator_route
      → 推断：orchestrator_eval[_read] → orchestrator_eval_decide
  → Engine.decide [SAVEPOINT]
  → Evals.decideEval
```

这张图展示“Source 新消息进入 pending 后”的路径，不是所有 Decision 的唯一入口：主 Session 对已存 explicit Trigger 可以直接 `orchestrator_route → Engine.decide → directEval`，无需先经过 `MasterAssessor.decide`；而已有 owner 的 follow-up 在 Intake 就已分给 worker（`src/app/tools/main.ts:88-120`、`src/core/evals.ts:131-155`、`src/core/evals.ts:267-280`、`src/core/intake.ts:49-59`）。反过来，admissible 的新 Trigger 即使 strength=explicit，通常也会先由 Evals/MasterAssessor 形成 candidate card，再由主 Session 选择 route，不能概括为“explicit 都不进 Eval”（`src/core/evals.ts:107-119`、`src/app/links.ts:65-70`）。

1. **入口与去重。** Source 门面把 Trigger 交给 `deps.receive`，Runtime 将其绑定到 `Passes.receive`；后者调用 `Engine.receive`，仅 `stored` 时请求立即 pass（`src/app/source-context.ts:25-27`、`src/app/source-context.ts:46-47`、`src/app/runtime.ts:157-165`、`src/app/passes.ts:34-39`）。`Intake.receive` 先规范化时间，要求至少一个 Thread，并按 Trigger ID 返回 `duplicate`（`src/core/intake.ts:19-24`）。

2. **第一道 Admission 是 SourceScope，不是 LLM。** `scope.scope(trigger)` 不监听时，Trigger 仍保存，但 disposition 记录 `filtered`，不建立 Thread/Eval；通过后才保存并关联 Thread（`src/core/intake.ts:25-37`、`src/core/intake.ts:47-55`）。所以“收到并持久化”不等于“被授权执行”。

3. **已有 Ticket 的 follow-up 优先给 worker。** Intake 遍历每个 Thread 的 `subscriptions`，向可达 Ticket 写稳定 ID 的 Trigger Input，并唤醒 ended Ticket；只有 `followupOwners(trigger)` 为空才把 Trigger 放进主 Thread 的 Eval 队列（`src/core/intake.ts:31-60`）。owner 判定排除 context-only、已 handback、已 requeue 或正在 Eval 的消息（`src/core/model.ts:68-88`）。这条分支是“Ticket→Input→内部投递”，不会伪造一个新 Decision。

4. **第二道 Admission 是 Policy gate。** pass 调用 `Engine.evaluateDue` 后，`Evals.start` 先剔除已有 owner/已创建 Ticket 的 Trigger，再对批内每个 Trigger 调 `policy.gate(trigger, thread, tickets)`，选择最强且同强度最新的 admissible Trigger 作为 `primary`，把整批写成 `thread.evaluating`（`src/core/engine.ts:75-85`、`src/core/evals.ts:70-119`）。一个 Thread 同时最多一个 Evaluation，Trigger 的 `threads[0]` 是主 Thread（`src/core/model.ts:22-27`、`src/core/model.ts:135-154`）。

5. **gate 输出的是授权事实，不是 Ticket。** 人类已列名且 addressed 直接得到 `explicit`；其他情况由 admission cell、Source 是否 observed、Thread 是否已有参与 Ticket、eval mode 共同决定。机器/CI 只有 listed bot 或 senderless system 事件可进入，而且最多 inferred（`src/policy.ts:166-210`）。gate 返回 `strength + basis`，随后才由评估/路由决定是否 accept（`src/core/ports.ts:16-27`）。

6. **Candidate 通过持久 effect 送到主 Session。** `MasterAssessor.request` enqueue `assessment`；handler 重新读取 Candidate，渲染卡片后 `sessions.prompt(masterId, 'candidate:<evalId>', …, 'steer')`，成功接收才调用 `candidateDelivered` 开始计算超时（`src/app/assessment.ts:93-105`、`src/core/evals.ts:47-55`）。`AgentDelivery` 用相同 request ID 检查历史/inbox，并 flush Session persistence（`src/app/delivery.ts:61-85`）。

7. **显式与 inferred 的模型路径不同。** candidate card 对 explicit 指向 `orchestrator_route`，对 inferred 指向 `orchestrator_eval → orchestrator_eval_read → orchestrator_eval_decide`（`src/app/links.ts:54-70`）。route 的 accept/attach/stop/ignore 每项独立调用 Engine；eval decide 先经 `assessmentOutcome` 校验每条启用规则、方向、证据和 observe/auto 模式，再进入同一个 `Engine.decide`（`src/app/tools/main.ts:88-120`、`src/app/assessment.ts:271-279`、`src/policy.ts:40-61`）。

8. **Engine 在决策时再次授权，而不信任模型。** 对没有 held Eval 的显式 route，`directEval` 会重新 gate；对 inferred accept，`admitsInferred` 要求 auto 且所有匹配规则仍启用；若 Policy version 已变化，则旧 Eval 记 unavailable 并重排或终止（`src/core/evals.ts:131-155`、`src/core/evals.ts:267-303`）。observe 模式下 `assessmentOutcome` 即使得到“可接受”也只返回 ignore，并在 audit 写 `would_accept`（`src/policy.ts:47-60`）。

### 2.3 Decision → Ticket → Assignment → Executor

```text
Evals.accept
  → Evals.record：保存 Decision（含 Mandate + ticketId）
  → Tickets.create
      → DshExecutor.prepare：Execution(name/directory/assignment)
      → 保存 Ticket（首个 Assignment=pending）
      → 订阅来源 Threads
      → 可选 acknowledgement → Outbox
      → DshExecutor.start → effect(launch)
  → DshExecutor.launchQueued / launch
      → reserve worker slot
      → prepareDirectory（只在新目录）
      → Sessions.ensure(worker-<ticketId>)
      → Sessions.prompt(assignment)
      → Engine.assignmentStarted → Assignment=running
  → worker orchestrator_report / DSH events
      → Engine.report → Assignments.report
      → Ticket 更新或结束 + relay 到主 Session
```

1. **accept 先落 Decision，再建 Ticket，二者同一事务。** `Evals.accept` 从 Evaluation 的 strength、policyVersion、actor、basis 和 outcome.scope 构造不可变 Mandate，`record` 先保存含 `ticketId/mandate` 的 Decision，再调用 `Tickets.create`（`src/core/evals.ts:305-315`、`src/core/evals.ts:327-338`）。任一后续写入失败会由外层 `Engine.decide` 的 `repo.atomic` 整体回滚（`src/core/engine.ts:100`）。

2. **Ticket 创建同时固定执行上下文。** `Tickets.create` 汇总 origin/channel，经 `prepareTicket` 调用 `DshExecutor.prepare` 写入 `execution.name/directory/assignment`，随后添加首个 `pending` Assignment、保存 Ticket、订阅批内 Trigger 的所有 Threads，最后 enqueue launch（`src/core/tickets.ts:32-56`、`src/executor/dsh.ts:96-111`、`src/executor/dsh.ts:237-240`）。worktree 名由校验名和 Ticket ID 前 12 位组成（`src/executor/dsh.ts:56-57`）。

3. **Assignment 不是独立表，也不是一次性进程。** 它嵌在 Ticket JSON 中；每个 Ticket 的 worker Session 固定为 `worker-<ticketId>`，多个 Assignment 复用同一 Session 和工作目录（`src/executor/dsh.ts:22-26`、`src/core/model.ts:217-233`、`src/app/views/tickets.ts:78-81`）。`start/deliver` 只分别 enqueue `launch` 和 `delivery` effect（`src/executor/dsh.ts:263-268`）。

4. **launch 有明确的并发与恢复门槛。** `launchQueued` 只接受仍为 latest+pending 的 Assignment，预留 slot 后执行；目录不存在才跑 prepare，随后 ensure worker、清理旧 inbox 中未取走的 Input，再发送首条 assignment 消息（`src/executor/dsh.ts:269-285`、`src/executor/dsh.ts:424-470`）。网络/模型临时错误有次数和指数退避，prepare 失败直接报告 failed，避免把半成品目录当成已准备（`src/executor/dsh.ts:27-55`、`src/executor/dsh.ts:276-284`）。

5. **Assignment=running 以 Session 接受消息为事实。** `Sessions.prompt` 最终调用 `AgentDelivery.send`；launch 的 accepted 回调和调用末尾均上报 `assignmentStarted`，`Assignments.started` 幂等地设置 running/startedAt，并在有待投 Input 时请求 delivery（`src/executor/dsh.ts:465-470`、`src/app/delivery.ts:65-85`、`src/core/assignments.ts:33-43`）。

6. **worker report 回到领域核心。** `orchestrator_report` 可先校验/claim PR，再在一个 Store 事务里 `Engine.report` 并入队主 Session relay；普通 progress 不 relay，ready/blocked/failed/dropped/attention/answer 按规则 relay（`src/app/tools/executor.ts:74-103`、`src/app/notices.ts:107-129`）。`Assignments.report` 更新 latest report、attention、answers 和自动 Input hold；ready/dropped 满足条件时结束 Ticket（`src/core/assignments.ts:93-133`）。

### 2.4 三种 Delivery 必须分开看

**主 Session 投递。** assessment 把 candidate steer 给主 Session，relay 把 worker 报告/追问 steer 给主 Session，notice 则注入上下文而不唤醒；三者分别使用 `assessment/relay/notice` effect，relay/notice handler 还按队列顺序执行（`src/app/effects.ts:11-24`、`src/app/sessions.ts:99-106`）。它们最终同样经 `Sessions.prompt/inject → AgentDelivery`，但确认的是主 Session 收到消息，不是 worker 已开始执行，更不是外部用户已收到回复（`src/app/sessions.ts:161-185`、`src/app/delivery.ts:65-85`）。

**worker Input 投递。** 新 Trigger/Policy/note 等 Input 由 `Tickets.addInput` 去重写入 `ticket.inputs` 和 `undelivered`；有 running Assignment 就 enqueue delivery，pending 且不是等待人时则重新 enqueue launch（`src/core/tickets.ts:230-245`）。`deliverQueued` 每条之前重读 Ticket，逐条调用 `sessions.prompt(..., 'steer')`，成功后 `inputsDelivered` 移除 undelivered；Session 真正采纳消息时，`session/event` 触发 `inputsRead`（`src/executor/dsh.ts:286-343`、`src/executor/dsh.ts:493-504`、`src/core/assignments.ts:44-65`）。失败则写 `ticket.delivery`，成功投递会清除（`src/core/assignments.ts:56-77`）。

**外部 Channel 投递。** `Replies` 只负责资格审查与消息路由，`Outbox.send` 在同一事务写 `outbox(status=pending)` 和 `effect(kind=reply)`；reply handler 调 `SourceRegistry.send`，最后 settle 为 sent 或 dropped（`src/core/replies.ts:20-47`、`src/app/outbox.ts:26-50`）。同一 ticket+conversation 的前序 pending 只在它的连续失败少于 3 次时挡住后续消息，达到门槛后允许后续越过，所以保序不是无条件的（`src/app/outbox.ts:44-45`、`src/app/store.ts:258-261`）。accept 自动 acknowledgement、worker 主动 ack、主 Session result/answer/attention 都汇入这里（`src/core/tickets.ts:50-55`、`src/app/tools/executor.ts:28-39`、`src/app/tools/main.ts:223-238`）。

**不能声称端到端 exactly-once。** Session 内部投递通过历史/inbox 去重接近“每 request ID 至多一条消息”（`src/app/delivery.ts:26-29`、`src/app/delivery.ts:65-85`）；外部发送则是先 `sources.send`、后 `receipts.settle`，进程若在两者之间崩溃，重试仍可能重复外发（`src/app/outbox.ts:39-50`）。持久 receipt/effect 提供的是可恢复、可追踪和大部分幂等，不是外部系统的原子提交。

### 2.5 三条重要旁路

- **attach：** 主 Session 把 Trigger 附到已有 Ticket，Engine 先从 Eval withdraw、订阅/写 Input，再把原 Eval 标为 routed 或重排其余 Trigger；不是新 accept，也不生成新 Mandate（`src/core/engine.ts:101-121`、`src/core/tickets.ts:116-144`）。
- **handback：** worker 认为消息超出本 Ticket 时记录 handback；若已没有其他 owner，则重新进入主 Thread Eval（`src/core/part.ts:36-48`、`src/core/evals.ts:176-188`）。
- **resume：** ended Ticket 被非 context 的人类消息命中且 Mandate 仍有效时，删除 `ended`、新建 Assignment、插入 resumed Input 并 launch；没有新 Decision。被人停止或 Policy 重验失败的 Ticket不能这样恢复（`src/core/tickets.ts:246-270`）。

### 2.6 超时、暂停、重试与关闭

- Candidate 未送达不过期；送达后超时最多重排两次，第三次记 `unavailable`。pause 期间记录 `pausedAt`，恢复时顺延 deadline（`src/core/evals.ts:30-69`）。
- `settings.paused` 或 setup 未完成会让 Runtime 进入 paused；Source 仍可记录 Trigger。assessment/launch/delivery/reply 的 effect limit 分别可降为 0，`evaluateDue` 在 paused 时不启动新 Eval（`src/app/runtime.ts:199-200`、`src/core/engine.ts:75-85`、`src/app/assessment.ts:96-101`、`src/executor/dsh.ts:227-236`、`src/app/outbox.ts:23-25`）。
- 人主动 retry 会结束旧 Assignment、回收未被 worker step 采纳的 Input，并以同一 Mandate 新建 pending Assignment（`src/core/tickets.ts:164-179`、`src/core/tickets.ts:328-337`）。host restart 对 running Assignment 则按“是否已 settled”选择重启或只补投（`src/core/assignments.ts:78-92`、`src/executor/dsh.ts:519-537`）。
- 关闭时先停止新 pass、abort lifetime、取消 Session，drain effects/agents，再停后台 jobs/subagents、flush Session persistence、关 SQLite、释放目录锁（`src/app/runtime.ts:228-254`）。

## 三、状态与持久化

### 3.1 实际落库位置

数据库为 `<stateDir>/orchestrator.sqlite`，核心记录是 JSON value，辅以索引/生成列；并不是每个领域名词都有表（`src/app/runtime.ts:98`、`src/app/store.ts:64-90`）。

| 对象 | 持久化位置 | 关键结论 |
|---|---|---|
| Trigger | `trigger(id,value,at)`；`trigger_thread(thread,id,at,human)` 是时间线索引 | Trigger 本身不可变；路由结果在同 ID 的 `disposition` 表（`src/app/store.ts:72-85`、`src/app/store.ts:127-132`、`src/app/store.ts:201-209`）。 |
| TriggerDisposition | `disposition(id,value)` | 保存 filtered/fanout/context/evalId/decisionId/requeued/handbacks/acked，是路由事实，不授予权限（`src/core/model.ts:41-61`）。 |
| Thread | `thread(key,value)` | JSON 内嵌 `subscriptions/context/correlated/pending/evaluating/expired/meta`；active/subscribed 是生成列和 partial index（`src/core/model.ts:156-182`、`src/app/store.ts:37-43`、`src/app/store.ts:210-232`）。 |
| Subscription | **没有 subscription 表** | 就是 `thread.value.subscriptions: ticketId[]`；只读上下文另存 `thread.value.context`，Ticket 的 Source 绑定/关闭状态另存 `ticket.follows`（`src/core/model.ts:163-169`、`src/core/model.ts:292-314`）。 |
| Decision | `decision(id,thread,value)` | 含 evalId、triggerIds、kind、reason、strength、可选 ticketId/mandate/audit/dismissed；按 thread 有索引（`src/core/model.ts:190-209`、`src/app/store.ts:243-247`）。 |
| Mandate | **没有 mandate 表** | accept Decision 保存一份，Ticket 也保存同一授权快照；进行中的 Evaluation 只保存其 actor/basis/strength/policyVersion（`src/core/evals.ts:305-315`、`src/core/model.ts:125-154`、`src/core/model.ts:276-305`）。 |
| Ticket | `ticket(id,value)` | 内嵌 Mandate、Assignments、Inputs、undelivered、follows、origin、execution、ended/attention/delivery；open/active 是生成列（`src/core/model.ts:276-308`、`src/app/store.ts:30-36`、`src/app/store.ts:233-242`）。 |
| Assignment / Evaluation | 分别嵌在 Ticket / Thread | Assignment 无独立表；Evaluation 无独立表，Decision 才是评估结束后的持久事实（`src/core/model.ts:135-154`、`src/core/model.ts:211-233`）。 |
| Effect | `effect(kind,key,value,seq,generation,attempts,error,due,since)` | `(kind,key)` 唯一；payload 更新递增 generation，避免运行中的旧 attempt 删除新任务（`src/app/store.ts:80-86`、`src/app/effects.ts:38-40`、`src/app/effects.ts:130-145`）。 |
| 外部回复 | `outbox(id,value)` | receipt 永久保留 pending/sent/dropped；delivery 尝试次数在对应 reply effect 上（`src/app/store.ts:15-20`、`src/app/store.ts:251-288`）。 |
| 设置、prompt、cursor | `kv(key,value)` | 包括 schema、current revision、版本快照、master-id、Session prompt revisions 和 Source cursor（`src/kv.ts:21-58`、`src/app/versions.ts:10-33`）。 |
| DSH Session 历史 | DSH `sessionPersistence`，不在上述领域表 | `AgentDelivery` 打开持久事件流做去重；worker 文件则在 `ticket.execution.directory` 指向的工作目录（`src/app/delivery.ts:40-59`、`src/executor/dsh.ts:424-470`）。 |

### 3.2 Thread / Evaluation / Subscription 状态迁移

```text
Thread.pending += trigger
  → Evals.start：pending=[]，evaluating={...}
  → ├─ decide/ignore/unavailable：写 Decision，清 evaluating + expired
  │    └─ accept 另外创建 Ticket，并订阅来源 Threads
  ├─ timeout：evaluating 删除，Triggers 回 pending；最多重排两次，下一次过期转 unavailable
  ├─ policyChanged：写 unavailable，剩余 Triggers 回 pending
  └─ pause：只调整 evaluating.pausedAt/deadline
```

依据：`Evals.start/due/expire/finish` 位于 `src/core/evals.ts:30-69`、`src/core/evals.ts:70-119`、`src/core/evals.ts:217-229`、`src/core/evals.ts:317-339`。`ignore` 即使不启动真实评估，也会生成一个 ignored evaluation ID 和 Decision 作为审计事实（`src/core/evals.ts:243-253`）。

Subscription 的迁移是：

- **添加：** accept 后对批内 Trigger 的所有 Thread 调 `subscribe`；attach/bind 也可添加；重复添加幂等，并移除该 Ticket 的 context-only 标记（`src/core/tickets.ts:45-53`、`src/core/tickets.ts:61-71`、`src/core/tickets.ts:416-422`）。
- **context-only：** `followForContext` 同时写 subscriptions 和 context，消息可读但不授权、不能恢复 ended Ticket（`src/core/tickets.ts:402-415`、`src/core/intake.ts:38-45`）。
- **删除：** 人或 `markUnrelated` 调 `dropSubscriptions`，从 Thread 删除 Ticket，并同步移除 `ticket.follows`；Ticket 已收到的消息归属按 disposition/handback 规则继续处理（`src/core/tickets.ts:181-195`、`src/core/tickets.ts:209-229`）。
- **Ticket 结束不自动清空 Subscription。** `Tickets.end` 结束 Assignment、清 undelivered/attention/delivery，但不删除 Thread.subscriptions；因此以后人类非 context 消息仍可能走 resume（`src/core/tickets.ts:345-363`、`src/core/tickets.ts:246-270`）。

### 3.3 Mandate / Decision 状态迁移

Mandate 只在 accept 时生成：`strength + policyVersion + basis + actor + scope`，其中 basis 可追加评估匹配 rules（`src/core/evals.ts:305-315`）。其注释和类型明确“immutable authorization”，之后不会因设置保存而被改写（`src/core/model.ts:125-133`）。

它的生命周期不是 active/revoked 字段迁移，而是以下判断：

1. **创建：** accept Decision 与 Ticket 同事务各保存一份（`src/core/evals.ts:305-315`）。
2. **持续执行：** Policy 改变时 `policyEffects` 计算影响，`Tickets.policyChanged` 给 open Ticket 加 `policy-changed` Input；Mandate 原值不变（`src/policy.ts:143-165`、`src/core/tickets.ts:196-208`）。
3. **再次使用：** attach ended Ticket 或 resume 前调用 `Policy.revalidate`；admission row、allowlist、bot list、auto mode、匹配规则和 Source scope 都可能使旧 Mandate 不再可用于新消息（`src/core/tickets.ts:103-115`、`src/core/tickets.ts:252-269`、`src/policy.ts:213-240`）。
4. **人停止：** `stop` 将 Ticket 以 `by=human,outcome=stopped` 结束，之后 intake/attach/resume 都拒绝恢复，语义上等同撤回 Mandate，但数据库不会删除历史 Mandate（`src/core/engine.ts:152-160`、`src/core/intake.ts:38-45`、`src/core/tickets.ts:103-114`）。

Decision 的当前写入种类为 `accept / ignore / stop / unavailable`；模型还保留 `reopen` 类型和迁移/查询兼容，但当前 resume 路径明确“不产生新 Decision”，不能把它画成现行主链上的 reopen（`src/core/model.ts:190-209`、`src/core/evals.ts:281-315`、`src/core/tickets.ts:246-250`）。`unavailable` 后续只能补 `dismissed=true`，不是改成已解决（`src/core/evals.ts:189-199`）。

### 3.4 Ticket / Assignment / Input 状态迁移

**Ticket 主状态：**

```text
accept → open + Assignment(pending)
     → Assignment(running)
     → progress / waiting / ready / blocked / failed / dropped
     → ready 且无 follows → completed
     → ready/dropped 且 followsDone → merged / closed（取 followsDone.outcome）
     → dropped 且没有已完成的 follows → dropped
     → 来源 Thread merged/closed 且工作完成 → merged / closed
     → human stop → stopped
     → ended 后人类有效 follow-up → 删除 ended + 新 Assignment（resume）
```

- 创建与 pending：见 `src/core/tickets.ts:37-55`、`src/core/tickets.ts:380-385`。
- pending→running：见 `src/core/assignments.ts:33-43`。
- ready 有 follows 时先留在 open/person-review，等 `followsDone`；PR close 若仍有未完成工作，也会等下一次 ready/dropped（`src/core/assignments.ts:122-133`、`src/core/tickets.ts:73-101`）。
- blocked/failed 不一定立即 ended，而是形成 `waitsForPerson`；新的人类非 context Input 或 retry 可解除等待（`src/core/model.ts:345-353`、`src/core/tickets.ts:164-179`）。
- 结束时所有未 ended Assignment 一起 ended，并调用 Executor.stop；ready/dropped 自己结束的 turn 与仍需 cancel 的 turn 在适配器里区分（`src/core/tickets.ts:345-363`、`src/executor/dsh.ts:352-370`）。

**Input 投递子状态：** `inputs[] + undelivered[]` → Executor 接受后从 undelivered 移除，Trigger Input 标 `readAt=null/deliveredTo` → Session step 采纳后 `readAt=<time>`。retry/restart 会把旧 Assignment 中仍为 `readAt=null` 的 Input 重新放回队首（`src/core/assignments.ts:44-65`、`src/core/tickets.ts:328-337`）。首个 origin Trigger 不进入 `undelivered` 队列，而是由 launch 直接随首条 assignment 消息交给 worker（`src/core/tickets.ts:37-55`、`src/executor/dsh.ts:449-469`）。

**Assignment 替换：** retry、host interruption、resume 都会新建 Assignment；旧 Assignment 保留 report/endedReason 作为历史，latest Assignment 才拥有当前 Ticket（`src/core/tickets.ts:164-179`、`src/core/tickets.ts:252-269`、`src/core/assignments.ts:78-92`）。

### 3.5 事务、恢复与审计边界

`Store.atomic` 使用嵌套 savepoint，失败回滚本层；afterCommit 回调也只在外层提交后运行（`src/app/store.ts:133-162`）。Effects 的 enqueue 与领域状态因此能同生共死，但 handler 的异步执行不在该事务里；effect 成功后删除，失败更新 attempts/error/due，shutdown 时保留运行行供下次重试（`src/app/effects.ts:123-146`）。普通错误按 capped exponential backoff 持续重试，没有全局最大次数；`Later` 只推迟 due、不增加 attempts，3 次失败是健康报错和 Outbox 前序阻塞门槛，不是自动丢弃阈值（`src/app/effects.ts:5-7`、`src/app/effects.ts:130-159`、`src/app/outbox.ts:44-45`）。

审计读取也不依赖内存：`Store.read` 提供 Trigger flow、时间线、Decision 和失败回复查询（`src/app/store-read.ts:6-81`）；模型侧则通过受限资源读取同一批持久记录（`src/app/resources.ts:295-308`）。SQLite schema 迁移在打开数据库时完成，旧 schema 不受支持或迁移失败都会关闭 handle，避免带着半转换状态继续跑（`src/app/store.ts:54-100`、`src/app/migration.ts:35-91`）。

## 四、可吸收/不吸收

这里的“单人会话 watcher”按 **一个操作者、少量来源、每 Thread 通常一个活动任务、一个主会话直接协调** 来划分；不是说官方模块不能运行，而是区分可复用机制与为多人、多 Ticket、多 Source 协同付出的复杂度。

### 4.1 适合吸收：优先保留这些机制

| 优先级 | 可吸收机制 | 单人 watcher 的裁剪方式与依据 |
|---|---|---|
| P0 | Trigger 持久化 + ID 去重 + disposition | 保留 `receive` 的“先存事实，再路由”与 duplicate 返回；即使 watcher 重启也不重复处理。官方落点是 `Intake.receive` 和 trigger/disposition 表（`src/core/intake.ts:19-31`、`src/app/store.ts:201-209`）。 |
| P0 | 同步事务内写状态与 effect | watcher 可用一个 SQLite 连接和同样的 savepoint 模式，把 watermark、任务状态、待投递消息原子写入；异步 worker 只消费 effect（`src/app/store.ts:133-162`、`src/app/effects.ts:60-74`）。 |
| P0 | 稳定 request ID + 历史/inbox 去重 + flush | 直接借鉴 `AgentDelivery`；这是单会话防重复 steer/queue 的关键，且不需要多人机制（`src/app/delivery.ts:15-29`、`src/app/delivery.ts:40-85`）。 |
| P0 | pending/running/ended Assignment 与恢复扫描 | 单人也能从崩溃恢复受益；可只保留一个 running Assignment 和一个 worker Session，复用 `resume` 的 pending/running 对账思路（`src/core/model.ts:211-233`、`src/executor/dsh.ts:519-537`）。 |
| P0 | 报告与外部结果分离 | worker 先持久 report，主会话再决定 result reply；不要把普通 progress 直接发回来源。官方 gate 在 `Replies` 和 `reportRelay`（`src/core/replies.ts:64-91`、`src/app/notices.ts:115-129`）。 |
| P0 | Outbox receipt + reply effect | 单人也需要 pending/sent/dropped、失败次数和重试；可只保留单 Source，不必保留跨团队路由（`src/app/store.ts:251-288`、`src/app/outbox.ts:26-50`）。 |
| P1 | 2 秒周期 + 新事件立即 pass + coalesce | 实现简单，能统一驱动 timeout、重试和新任务；单 watcher 不必拆成独立服务，可直接函数调用（`src/app/passes.ts:28-68`）。 |
| P1 | paused 时继续记录、停止新评估/投递 | 对单人“只观察不执行”很有价值；保留 deadline 顺延，避免恢复后全部超时（`src/app/runtime.ts:199-200`、`src/core/evals.ts:30-46`）。 |
| P1 | 明确的 accept 审计快照 | 即使不需要完整 Mandate，也应在 Decision/任务里保存原始 Trigger、scope、规则版本和接受时间；官方 accept 先写 Decision 再建 Ticket 的顺序可复用（`src/core/evals.ts:305-338`）。 |
| P1 | 工作目录只 prepare 一次 + 失败不自动重跑 | 单 worktree 同样适用，避免把失败 prepare 的残留目录误判为成功（`src/executor/dsh.ts:241-262`、`src/executor/dsh.ts:424-438`）。 |
| P1 | ready/blocked/failed/dropped 与人工 retry | 单人操作模型足够表达大部分生命周期；retry 可沿用“结束旧 Assignment、新建 Assignment、保留 Mandate”（`src/core/model.ts:211-216`、`src/core/tickets.ts:164-179`）。 |
| P2 | 只读资源卡片与分页 | watcher 要读长 Thread/结果时可复用 cards/resources 思路，避免把全量 SQLite JSON 注入模型（`src/app/cards.ts:38-68`、`src/app/resources.ts:295-308`）。 |

**推荐的最小链：** `Trigger → 去重/来源过滤 → 单用户显式 gate → 可选人工/模型 Decision → Ticket(含一个 Assignment) → 持久 worker Session → report → Outbox`。它保留官方最有价值的可靠性机制，但不复制团队协作层。

### 4.2 应裁剪：保留思想，不照搬完整状态机

| 官方机制 | 单人 watcher 的简化建议 |
|---|---|
| Admission 三格矩阵 + bot/allowlist + followup | 若只有一个操作者，可先实现“本人白名单 + addressed/direct 才 explicit”；官方完整矩阵在 `src/policy.ts:166-210`，只有需要群聊/多人时再引入。 |
| off/observe/auto + LLM Eval | 可先只用 observe 或人工 accept；auto 需要规则覆盖、证据、direction、policy version 重验一起成立，不能只复制一个模型调用（`src/policy.ts:40-61`、`src/core/evals.ts:147-155`）。 |
| Thread 批 Eval 与 strongest Trigger | 单 watcher 可一 Trigger 一 Eval；只有需要去抖、合并连续消息时再引入 `pending/evaluating`（`src/core/evals.ts:70-119`）。 |
| Mandate revalidate / policyEffects | 固定单用户、规则运行期不变时可退化为配置版本号 + 停止新任务；多人授权动态变化时才需要完整 basis/revalidate（`src/policy.ts:143-165`、`src/policy.ts:213-240`）。 |
| ready 等多 Thread followsDone | 单 watcher 若只跟踪一个 PR，可保留“ready 等 PR 终态”一条规则，不必实现 own/non-own 多 Thread 聚合（`src/core/tickets.ts:73-101`）。 |
| blocked/failed 后自动 Input hold | 可保留“人类新消息解除阻塞”，但自动 CI/bot 输入较少的 watcher 不必实现全部 readBefore/letGo 边界（`src/core/assignments.ts:122-127`、`src/core/tickets.ts:288-363`）。 |

### 4.3 不吸收：属于团队级或通用产品复杂度

1. **多 Ticket Subscription fan-out、context-only、owner/handback/letGo。** 这套逻辑解决多个 worker 共享 Thread 时“谁有权决定一条 follow-up”的问题；单 Thread 单任务时可省略，官方主要复杂度在 `followupOwners`、Intake fan-out 和 Ticket letGo（`src/core/model.ts:62-88`、`src/core/intake.ts:31-60`、`src/core/tickets.ts:276-316`）。
2. **多 Source 身份体系与机器人 admission。** GitHub/Feishu 各自 actor、bot、scope、row、allowlist 的映射是团队接入成本；单用户单 Source 不必先建通用矩阵（`src/policy.ts:119-140`、`src/policy.ts:166-210`）。
3. **独立主路由 Session + 每 Ticket worker Session 的双层模型编排。** 单人 watcher 若只需确定性分派，可让同一会话消费事件；只有需要独立 Eval 上下文、受限工具和多 worker 时才有收益（`src/app/sessions.ts:228-296`、`src/app/assessment.ts:84-108`）。
4. **1-16 worker slots、人的额外 slot、后台 job/subagent 30 分钟 settling。** 这些是多任务执行与团队吞吐控制；单 worker 可只保留互斥锁和 shutdown（`src/executor/dsh.ts:165-199`、`src/executor/dsh.ts:601-656`、`src/executor/background.ts:89-104`）。
5. **完整管理面板、设置/prompt 多版本、Source policy sync。** 单人 watcher 用静态配置和少量审计日志即可；版本化有利于多人 optimistic concurrency、审计和 prompt 运维，但不是执行链必要条件（`src/app/settings.ts:139-195`、`src/app/prompts.ts:124-247`、`src/app/settings-history.ts:81-90`）。
6. **通用 schema 10→11 在线迁移。** 新 watcher 没有历史数据库时直接定义当前 schema；只有兼容官方存量状态才需要这套大规模转换（`src/app/migration.ts:20-25`、`src/app/migration.ts:35-91`）。
7. **跨 Source 的完整账户/CLI/bot setup。** 单人 watcher 只接一种来源时，保留可执行文件和权限检查即可，不必同时实现 GitHub 写权限、Feishu strict bot 与环境 shim 的全套产品化部署（`src/deployment.ts:86-131`、`src/app/setup.ts:71-99`）。
8. **全部视图/搜索/健康投影。** 它们是运维界面，不是授权或执行正确性的来源；核心 watcher 只需最基本的 ticket/decision/effect 查询（`src/app/views/overview.ts:34-80`、`src/app/store-read.ts:6-81`）。

### 4.4 最终切分结论

单人 watcher 最值得吸收的是 **持久 Trigger/disposition、事务性 effect、幂等 Session 投递、可恢复 Assignment、受限 result Outbox**；最不应提前复制的是 **多人 admission、多个 Ticket 对同一 Thread 的所有权仲裁、双层模型路由、通用团队设置/迁移体系**。这样仍能保留官方执行链的关键正确性——先记录、再授权、后执行、可恢复、结果受控——同时把状态机收敛到单用户可维护的规模（`src/core/engine.ts:19-48`、`src/app/effects.ts:42-45`、`src/app/delivery.ts:26-29`、`src/executor/dsh.ts:519-537`）。
