# 官方 superagent 解构 05：提示词、技能、安装升级与多语言

> 基线：`deepseek-ai/dsh-superagent-prototype@8c32a9dc5d72c033816c6a8110b37f40cf94fba4`（短哈希 `8c32a9d`）。
> 本文引用均为该 commit 的仓库相对路径与 1 起始行号，例如 `src/app/prompts.ts:46-70`。
> 范围是 `prompts/**`、`skills/**`、`SETUP.md`、`官方 docs/**`、`examples/**`、`locale/**`、指定源码及 `tests/` 组织；为还原真实调用链，补读 `context.ts`、`sessions.ts`、`store.ts` 等支撑文件。
> 官方自己把仓库标为 research prototype，而不是生产就绪产品（`README.md:3-5`）；以下区分「代码实际做什么」与「文档声明的设计」。

## 一、目录树与逐文件职责

### 1.1 范围目录树

```text
SETUP.md
prompts/                              # 15 个 Markdown 默认提示词
├── shared.md
├── orchestrator.md
├── worker.md
├── admission.md
├── cli.md
├── dispatch.md
├── replies.md
├── subscriptions.md
├── work.md
├── handoff.md
├── handoff-orchestrator.md
├── handoff-worker.md
└── team/
    ├── communication.md
    ├── scope.md
    └── delivery.md
skills/                               # 2 个随包 Source 技能
├── dsh-superagent-feishu/SKILL.md
└── dsh-superagent-github/SKILL.md
docs/                                 # 000–008 连续编号文档
├── 000-philosophy.md
├── 001-domain.md
├── 002-authorization.md
├── 003-execution.md
├── 004-prompts.md
├── 005-panel.md
├── 006-deployment.md
├── 007-architecture.md
└── 008-cookbook.md
examples/
└── profile.cordis.patch.yml
locale/
├── en.json
└── zh.json
src/
├── app/
│   ├── prompts.ts
│   ├── skill-files.ts
│   ├── migration.ts
│   └── versions.ts
├── client/
│   └── prompt-config.ts
└── deployment.ts
tests/                                # 48 个 .spec.ts + 11 个 .spec.tsx + 6 个 fixture
├── fixtures/
│   ├── async.ts
│   ├── deployment.ts
│   ├── git.ts
│   ├── host.ts
│   ├── panel-server.ts
│   └── panel.tsx
├── admission-context.spec.ts
├── assessment.spec.ts
├── background.spec.ts
├── bundle-patch.spec.ts
├── cache.spec.ts
├── cards.spec.ts
├── class-docs.spec.ts
├── client.spec.tsx
├── commands.spec.ts
├── controls.spec.tsx
├── core-engine.spec.ts
├── delivery.spec.ts
├── deployment.spec.ts
├── docs.spec.ts
├── draft.spec.ts
├── effects.spec.ts
├── environment.spec.ts
├── feishu-image.spec.ts
├── feishu-read.spec.ts
├── followups.spec.ts
├── github-read.spec.ts
├── health.spec.ts
├── http.spec.ts
├── index.spec.ts
├── locales.spec.ts
├── markdown.spec.ts
├── marks.spec.ts
├── migration.spec.ts
├── model-surface.spec.ts
├── navigation.spec.ts
├── outbox.spec.ts
├── panel-deployment.spec.tsx
├── panel-eval.spec.tsx
├── panel-execution.spec.tsx
├── panel-overview.spec.tsx
├── panel-panel.spec.tsx
├── panel-prompts.spec.tsx
├── panel-settings.spec.tsx
├── panel-source.spec.tsx
├── panel-trigger.spec.tsx
├── passes.spec.ts
├── policy.spec.ts
├── prompt-config.spec.ts
├── prompts.spec.ts
├── queue.spec.ts
├── registry.spec.ts
├── retry-health.spec.ts
├── role-models.spec.ts
├── runtime-concurrency.spec.ts
├── runtime.spec.ts
├── service-script.spec.ts
├── settings.spec.ts
├── sources.spec.ts
├── stage.spec.ts
├── store.spec.ts
├── styles.spec.ts
├── timeline.spec.ts
├── tools.spec.ts
└── views.spec.ts
```

`vitest.config.ts:1-3` 只收集 `tests/**/*.spec.{ts,tsx}`，并去重 React/ReactDOM；`package.json:47-55` 将 `check` 定义为 typecheck → Vitest → tsdown build。`官方 docs/007-architecture.md:402-448` 是官方测试索引，`tests/docs.spec.ts:58-67` 又反向检查 src 模块与测试是否都列进 007，避免索引漂移。

### 1.2 `prompts/**`：每个文件管什么

| 文件 | 职责与关键边界 |
|---|---|
| `shared.md` | 两角色共同分工：orchestrator 只评估、路由、转达；worker 负责技术调查、方案与验证；路由不得添需求、计划、验收清单。还禁止 orchestrator 在非评估场景读代码、详细日志或替 worker 解 blocker（`prompts/shared.md:1-7`）。 |
| `orchestrator.md` | 主 Session 身份与工具使用总则：用摘要和订阅，不自行 merge/close issue，不把飞书私域内容泄到 GitHub；事件会主动送达，禁止 sleep/poll/job wait（`prompts/orchestrator.md:1-16`）。 |
| `worker.md` | Executor 身份：拥有 ticket 目录内技术工作，读原始输入与仓库 AGENTS，使用对应 Source skill，以 `orchestrator_report` 收尾；规定 gh、提交身份及 merge 禁区（`prompts/worker.md:1-10`）。 |
| `subscriptions.md` | Ticket↔Thread 订阅语义：后续消息只是上下文，不自动授权；人的 follow-up 归 worker 判定，ended/stopped、退订、requeue、bot/CI 的行为在此定义（`prompts/subscriptions.md:1-13`）。 |
| `replies.md` | 人可见消息的契约：ack、answer、result、attention 各自前提，原线程回复、去重、drop 后不可换渠道补发、IM 100 词硬上限；普通 progress 不唤醒 orchestrator（`prompts/replies.md:1-35`）。 |
| `dispatch.md` | 主 Session 路由细则：accept/attach/stop/ignore，批量候选、handed_back、follow_up、merge notice、30 词 routing note；尤其反复强调「只转原始 trigger 与路由事实，不替 worker 写技术方案」（`prompts/dispatch.md:5-14`、`31-59`）。 |
| `admission.md` | 仅主 Session 的主动候选评估：只读工具、逐规则 `rule_assessments`、三项意图事实及原文证据、`target_basis`、ignore/unavailable/accept 分支；禁止把设计讨论或裸赞同变成工单（`prompts/admission.md:1-24`、`28-32`、`64-68`）。 |
| `work.md` | worker 执行细则：重新核对主动工单授权，处理 follow-up/handback，PR 绑定、CI/review、后台任务、ready/blocked/failed/dropped 报告；路由 note 和标题不能增加需求（`prompts/work.md:1-19`、`21-49`）。 |
| `cli.md` | 两角色共享的 CLI 读取说明，实际拼进 Source skill 而非主 system prompt：GitHub 一律 gh，Feishu 只用 bot 身份，递归 root/parent/forward/doc，检查分页/截断并保留 source id（`prompts/cli.md:1-17`）。 |
| `handoff.md` | 两角色共用的交接契约：只有具体人工决定构成 attention；普通进展、模型重试、预算错误不构成 IM 理由；空 final 不抹掉已成功 report（`prompts/handoff.md:1-6`）。 |
| `handoff-orchestrator.md` | 主 Session 看到 `ticket.attention` 后立即 `orchestrator_reply purpose=attention`，原样复制 question 到 `human_action`，不等 blocked、不重复发送（`prompts/handoff-orchestrator.md:1-4`）。 |
| `handoff-worker.md` | worker 通过结构化 `human_action` 提问，并以 `question_for_trigger_id` 回到提问者原消息；说明保留、清除、替换问题的规则，完整证据留 summary（`prompts/handoff-worker.md:1-7`）。 |
| `team/communication.md` | 默认 Communication 团队段：何时沉默、何时 IM、结果如何写、回复 review、自动 reviewer 每 PR 最多三轮；默认不再要求机器人身份前缀，因为代码工具强制添加（`prompts/team/communication.md:1-20`、`43-64`、`92-97`）。 |
| `team/scope.md` | 默认 Ticket scope：按影响而非 LOC/轮数停止；局部改动一路做到 PR/CI，跨模块协调重设计才暂停；人的新线索可解除技术 blocker，但不能解除人的 stop/hold（`prompts/team/scope.md:1-22`）。 |
| `team/delivery.md` | 默认 Delivery requirements：UI 必须 Before+After、review/auto-merge 条件、reviewer Co-authored-by、与人工重复 PR 的处理（`prompts/team/delivery.md:1-28`）。其中改写分支和 force-with-lease 是官方策略，不是所有插件都应照搬的通用规则。 |

### 1.3 技能、文档、配置、指定源码逐文件职责

| 文件 | 职责 |
|---|---|
| `skills/dsh-superagent-github/SKILL.md` | frontmatter 声明名称/描述；正文给 worker 的 GitHub read 资源、分页、ack、review thread 回复/resolve、PR 绑定与 CI 语义（`skills/dsh-superagent-github/SKILL.md:1-14`）。 |
| `skills/dsh-superagent-feishu/SKILL.md` | 飞书 trigger/root/parent/thread/around 读取、分页、合并转发与附件、原始 `source_url`；所有读取只作上下文且保持 bot 身份（`skills/dsh-superagent-feishu/SKILL.md:1-12`）。 |
| `SETUP.md` | 给「安装代理」执行的操作剧本，不是交互式安装程序：一次探测、一次一问、完整计划后确认、操作者终端处理密钥、写入并验证（`SETUP.md:5-14`）。 |
| `官方 docs/000-philosophy.md` | 总原则「少占人的注意力，多给价值」；只在被请求或规则许可时行动，只在结果可用或需要人时发言；要求窄授权起步（`官方 docs/000-philosophy.md:3-15`、`24-31`）。 |
| `官方 docs/001-domain.md` | Source/Trigger/Thread/Eval/Mandate/Ticket/Assignment/Channel 等领域术语与数据流，并给中英文 glossary（`官方 docs/001-domain.md:5-19`、`21-38`）。 |
| `官方 docs/002-authorization.md` | gate 与 assessment 两层、显式请求与订阅 fan-out、follow-up 所有权、Mandate 重新验证和结构化 handoff（`官方 docs/002-authorization.md:5-38`）。 |
| `官方 docs/003-execution.md` | Ticket 状态机、worker Session/目录、后台任务和 slot、Input delivery、Report/Attention、消息回写与恢复（`官方 docs/003-execution.md:5-43`）。 |
| `官方 docs/004-prompts.md` | 提示词可编辑面、15 个 override key、组装顺序、Source skill、版本与升级语义；明确提示词覆盖不改变代码闸门（`官方 docs/004-prompts.md:5-42`、`44-96`）。 |
| `官方 docs/005-panel.md` | 管理面板的信息架构与 Prompts/Deployment 设置；说明 default updated、全文预览、历史和只读/可写状态（`官方 docs/005-panel.md:34-42`）。 |
| `官方 docs/006-deployment.md` | 手动安装、独立 profile、账号 wrapper、配置键、升级/回滚、服务巡检和故障排查（`官方 docs/006-deployment.md:5-27`、`90-149`）。 |
| `官方 docs/007-architecture.md` | Runtime/Engine/Store/Executor 模块地图，以及完整测试索引和持久化说明（`官方 docs/007-architecture.md:27-48`、`402-448`）。 |
| `官方 docs/008-cookbook.md` | 以虚构 `hookq` CLI 演示新增 Source：稳定 id、schema/fields、Trigger/Channel、Policy、环境变量、轮询与测试（`官方 docs/008-cookbook.md:5-21`）。 |
| `examples/profile.cordis.patch.yml` | profile 最小补丁示例：webserver 地址、必须的绝对 `stateDir`，可选启用 Feishu（`examples/profile.cordis.patch.yml:1-12`）。 |
| `locale/en.json` | 包管理器元数据英文标题和描述，仅 `meta` 一组（`locale/en.json:1-6`）。 |
| `locale/zh.json` | 同一包元数据的中文描述；不是面板完整字典（`locale/zh.json:1-6`）。 |
| `src/app/prompts.ts` | 提示词领域核心：配置 schema、默认段、override、动态 environment/Policy、角色组装、技能文本、校验、版本历史和保存通知。 |
| `src/client/prompt-config.ts` | 面板纯函数：section/skill/part 命名与读写、override rebase、变更集合、名称冲突检查、LCS 行 diff 与长相同段折叠（`src/client/prompt-config.ts:5-53`、`55-78`）。 |
| `src/app/skill-files.ts` | 随包文本加载器：读文件、CRLF 归一、严格 skill frontmatter、缺失/空文件/格式错误即失败；把 Markdown 段内单换行折成空格（`src/app/skill-files.ts:1-32`）。 |
| `src/app/migration.ts` | schema 10→11 的单次状态迁移：设置、提示词、Ticket/Decision/Thread、Source cursor、outbox/effect、时间格式与旧英文 reason 全部规范化（`src/app/migration.ts:20-48`）。 |
| `src/app/versions.ts` | 通用编号快照存储：current pointer、不可变版本、原子 save、只保留不切换指针的 keep、按 revision 倒序 list（`src/app/versions.ts:5-33`）。 |
| `src/deployment.ts` | 插件机器配置与部署检查：`stateDir`、三项 volatile limits、旧配置键迁移提示、gh/lark-cli 身份和权限探测（`src/deployment.ts:13-43`、`53-91`）。 |

补充：`package.json:22-29` 的发布文件清单显式包含 `prompts`、`skills` 和 `locale/*.json`，所以它们不是开发目录里的死资产；`src/infra/paths.ts:7-20` 从编译后的 `lib/` 向上最多六层寻找本包 `package.json`，再定位这些资源。

### 1.4 `tests/` 的组织与逐文件职责

测试不是一堆平铺脚本，而是六层：纯领域、持久化/队列、Source/Executor、模型可见面、真实 Runtime 集成、jsdom 面板。共享 fixture 为：内存 DSH host（`host.ts`）、带请求契约校验的假管理 API（`panel-server.ts`）、React 交互工具（`panel.tsx`）、部署值（`deployment.ts`）、干净 git 环境（`git.ts`）、异步协调（`async.ts`）；官方概述见 `官方 docs/007-architecture.md:448`。

| 文件 | 覆盖职责 |
|---|---|
| `core-engine.spec.ts` | 内存仓储上的接收、Eval、fan-out、resume/stop、暂停、Policy、Report、回复与结束领域规则。 |
| `stage.spec.ts` | Ticket stage 判定表逐行覆盖。 |
| `policy.spec.ts` | Source scope、gate、admission table、Mandate revalidation、Policy version 与设置迁移。 |
| `registry.spec.ts` | SourceRegistry 实例、校验、Policy part、Channel 和 Thread context。 |
| `store.spec.ts` | SQLite/内存 repositories、working set、KV 键集中管理、设置历史与查询。 |
| `migration.spec.ts` | schema 10 fixture 全量迁移、旧库拒绝、迁移失败数据库不变、幂等重开（`tests/migration.spec.ts:40-48`、`350-369`、`474-483`）。 |
| `timeline.spec.ts` | Thread 分页、Trigger 时间邻域和统一时间格式。 |
| `views.spec.ts` | 管理视图从 Store 派生数据，例如 dropped message 所属 Thread。 |
| `cache.spec.ts` | TextCache。 |
| `queue.spec.ts` | Runtime 工作如何进入 effect queue，以及旧版本遗留队列。 |
| `effects.spec.ts` | effect 合并、上限、退避重试、health 与 shutdown。 |
| `passes.spec.ts` | pass 串行、pass 中新增请求合并到下一趟、失败健康状态。 |
| `outbox.spec.ts` | 暂停或未安装 Source 时消息等待，以及运行中 Runtime 的 outbox。 |
| `runtime-concurrency.spec.ts` | pass/delivery/launch 与 Trigger/Ticket 并发变更。 |
| `followups.spec.ts` | follow-up notice、handback、context follow、burst 成本和主 Session note。 |
| `delivery.spec.ts` | AgentDelivery 的消息送达。 |
| `retry-health.spec.ts` | 模型预算重试及健康显示。 |
| `role-models.spec.ts` | orchestrator/worker 两角色模型选择。 |
| `health.spec.ts` | 每个部件独立 health entry，成功后各自清除。 |
| `sources.spec.ts` | GitHub/Feishu 翻译、轮询水位、PR 规则与健康。 |
| `commands.spec.ts` | 以部署账号执行 CLI、Channel 应答和仓库范围 GitHub 调用。 |
| `feishu-read.spec.ts` | 飞书消息、Thread、附件等读取。 |
| `github-read.spec.ts` | Issue/PR/review/CI 等读取。 |
| `feishu-image.spec.ts` | 飞书图片读取。 |
| `admission-context.spec.ts` | assessment 的 Thread 窗口与分页上下文。 |
| `assessment.spec.ts` | MasterAssessor 每个 Eval 保留和释放什么。 |
| `background.spec.ts` | worker shell job/subagent 的唤醒、等待和 host 停止。 |
| `tools.spec.ts` | 两角色 `orchestrator_read` 可见面及其余主 Session 工具的参数/检查。 |
| `runtime.spec.ts` | 模拟 DSH host 上从工具到 HTTP 的全应用集成。 |
| `http.spec.ts` | same-origin/loopback、安全状态码、body 上限、路径参数和 query。 |
| `settings.spec.ts` | 设置保存与模型/账号检查竞争、Policy sync、暂停/同步/block 的拒绝。 |
| `prompts.spec.ts` | 提示词组装、校验、版本、冲突、override 和 default updated（`tests/prompts.spec.ts:24-51`、`156-171`）。 |
| `prompt-config.spec.ts` | 编辑器纯函数、skill 名称、override base/rebase、行 diff（`tests/prompt-config.spec.ts:6-38`）。 |
| `cards.spec.ts` | 逐提示词文件的必含/禁含规则，以及卡片投影（`tests/cards.spec.ts:8-29`）。 |
| `model-surface.spec.ts` | 汇总两角色 tools/prompts/skills/inputs，核对工具名、schema 枚举、环境变量、术语和字数；主/worker 的 prompt+tools 预算分别 59,000/40,500 字符（`tests/model-surface.spec.ts:36-43`、`350-397`）。 |
| `bundle-patch.spec.ts` | 用 Cordis 自己的 patch dialect 读 bundle，验证 router/worker preset 与工具白名单（`tests/bundle-patch.spec.ts:9-20`、`29-72`）。 |
| `deployment.spec.ts` | 配置 schema、旧键拒绝、可执行文件解析、gh/lark-cli 身份和权限（`tests/deployment.spec.ts:42-63`）。 |
| `environment.spec.ts` | worker shim、git 隔离、credential helper、敏感环境变量剥离与外来文件保护（`tests/environment.spec.ts:25-63`、`74-99`）。 |
| `index.spec.ts` | 插件入口、volatile 更新免重启、账号变更重启后的 settings refresh（`tests/index.spec.ts:31-62`）。 |
| `service-script.spec.ts` | 在含空格路径和假 ps/tmux/dsh 下验证服务脚本与退出码。 |
| `locales.spec.ts` | 双语占位符一致、非空文案、reason/health/UserError 覆盖（`tests/locales.spec.ts:7-46`）。 |
| `draft.spec.ts` | 编辑器状态机、三方 merge、冲突路径和保存条。 |
| `markdown.spec.ts` | 面板 Markdown 子集、链接清洗与 URL 标点。 |
| `marks.spec.ts` | Ticket/Thread/Source/Decision 状态的图标、色调和双语文案。 |
| `styles.spec.ts` | 样式表契约。 |
| `client.spec.tsx` | 客户端注册、locale namespace、轮询、Session 打开。 |
| `navigation.spec.ts` | Session catalog hydration、取消导航、路由记忆与非法路由回退。 |
| `controls.spec.tsx` | 客户端 import 边界、无循环依赖、Modal 焦点与 Tab 键盘行为。 |
| `panel-overview.spec.tsx` | Overview 的待人工项、问题、计数、英文渲染和动作。 |
| `panel-source.spec.tsx` | Source 状态/设置、账号检查、失败定位、重启后轮询。 |
| `panel-trigger.spec.tsx` | Thread 时间线、requeue、退订、follow-up 与分页。 |
| `panel-eval.spec.tsx` | Policy/Eval 设置、规则与来源名单编辑、版本历史。 |
| `panel-execution.spec.tsx` | Ticket 列表/详情、停止、输入、设置与回复。 |
| `panel-settings.spec.tsx` | 设置组、独立 revision、历史、保存条和焦点恢复。 |
| `panel-prompts.spec.tsx` | 提示词编辑、冲突、技能、默认更新、占位符、历史恢复（`tests/panel-prompts.spec.tsx:11-45`、`136-173`）。 |
| `panel-deployment.spec.tsx` | Deployment 可写/只读表单、volatile 保存、重检与重启状态。 |
| `panel-panel.spec.tsx` | 搜索、术语表、路由记忆和服务离线。 |
| `class-docs.spec.ts` | 每个 src class 前必须有 JSDoc（`tests/class-docs.spec.ts:1-19`）。 |
| `docs.spec.ts` | 文档连续编号、只向前引用、本地链接有效、无冲突标记、模块/测试索引完整（`tests/docs.spec.ts:37-67`）。 |

## 二、提示词组装链

### 2.1 从 Markdown 到 model request 的完整链

```text
prompts/*.md + skills/*/SKILL.md
  │  packageRoot() 找包根；readFileSync；CRLF → LF；缺失/空文件立即报错
  │  promptFile(): trim → 按空行切段 → 段内每行 trim 后以空格连接 → 段间 \n
  ▼
src/app/context.ts
  │  shared/master/worker、4 个 guides、teamDefaults、admission、handoff、cliNotes、sourceSkills
  ▼
src/app/prompts.ts
  │  builtInPart(): 当前 override.text，否则 built-in 默认
  │  promptParts(): 固定角色顺序 + 空团队段过滤
  │  composePrompt(): 各段正文接在 heading 后，以 \n\n 连接
  ▼
src/app/sessions.ts::decorate/attachBefore（每次 model request）
  │  orchestrator: systemPrompt({complete:true, sections:[完整文本]}) → 替换宿主默认 prompt
  │  worker:       systemPrompt({sections:[完整文本]})             → 追加宿主 persona/AGENTS 等
  │  同一钩子同步重注册当前 revision 的 skills，并记录 session 使用的 revision
  ▼
DSH Agent → 模型
```

证据：文本加载在 `src/app/skill-files.ts:25-32`，静态角色映射在 `src/app/context.ts:6-24`，角色组装在 `src/app/prompts.ts:46-70`，运行时每请求重读在 `src/app/sessions.ts:320-338`，complete/append 的差别在 `src/app/sessions.ts:149-159`。

这意味着两个容易误读的点：

1. Markdown 的一句一行是为了 diff，不会把每个单换行都原样发给模型；空行才保留段落边界。
2. 主 Session 是完整替换，worker 是追加。worker 仍会读宿主 persona 和仓库 `AGENTS.md`，与 `prompts/worker.md:8` 的角色文字相互补充；不能把它理解为「只有 composePrompt 这几段」。

### 2.2 orchestrator / worker / handoff 的层级

`handoff` 不是第三个 Session，而是横跨两个角色的交接协议。`context.ts` 先把 `handoff.md` 与角色文件拼起来，再作为一个角色专属 part 注入（`src/app/context.ts:23-24`）。

| 顺序 | orchestrator（主 Session） | worker（每个 Ticket 的 Executor） |
|---:|---|---|
| 1 | `runtime/shared` | `runtime/shared` |
| 2 | `runtime/orchestrator` | `runtime/worker` |
| 3–5 | Communication → Ticket scope → Delivery requirements（空段省略） | 同左 |
| 6–7 | `runtime/subscriptions` → `runtime/replies` | 同左 |
| 8 | `runtime/dispatch` | `runtime/work` |
| 9 | `runtime/admission` | — |
| 10 | `runtime/handoff/orchestrator` = 共用 handoff + 主角色 handoff | `runtime/handoff/worker` = 共用 handoff + worker handoff |
| 11 | `runtime/environment` | `runtime/environment` |
| 12 | `runtime/policy` | — |

责任链因此是：

```text
原始 Trigger / Policy / Thread facts
  → orchestrator：判断 accept / attach / stop / ignore，只传原 trigger + 路由事实
  → worker：重新核对授权，技术调查 → 修改 → 验证 → PR → Report
  → worker human_action / ready
  → orchestrator：从 Ticket 与简报生成短消息，回到原 Source Conversation
```

关键防串层约束：orchestrator 不读代码/详细日志、不设计实现，worker 不自行决定 IM 交付（`prompts/shared.md:1-7`；`prompts/work.md:14-19`）。attention 则走 `Ticket` 结构化状态，不靠 worker 在 final 里留一句问题：worker 写 `human_action`，host 中继，orchestrator 复制 `ticket.attention.question` 回复（`prompts/handoff-worker.md:1-6`；`prompts/handoff-orchestrator.md:1-4`）。

worker 的 spawned subagent 使用 DSH `standard` preset，不再复制一套 worker/orchestrator 提示词层级；bundle 明确禁掉 forked subagent，以免它意外继承 worker preset（`cordis.patch.yml:13-19`、`112-120`）。

### 2.3 可配置段与不可配置边界

配置对象只有三类顶层内容：三个团队段、`skills` 字典、可选 `overrides` 字典（`src/app/prompts.ts:35-42`）。

| 可配置面 | 默认值与生效方式 |
|---|---|
| `communication` / `scope` / `delivery` | 分别来自 `prompts/team/*.md`；按固定 heading 插入两角色；空字符串整段消失，固定段仍保留（`src/app/prompts.ts:46-50`）。 |
| 团队 skills | key 必须匹配 `^[a-z][a-z0-9-]*$`，且不能叫 `github`/`feishu`；正文不额外加 heading，注册名自动加 `dsh-superagent-`（`src/app/prompts.ts:18-26`、`83-85`）。 |
| 内建 part override | `{ text, base? }`；`base` 指向编辑时的内建文本，未写则保留旧 base。与默认相同的 override 会被删除，使其重新跟随升级（`src/app/prompts.ts:29-37`、`177-186`）。 |
| 动态模板 | `runtime/environment` 必须保留 `{variables}`；`runtime/policy` 必须有 `{version}/{mode}/{rules}`；`runtime/policy/none` 必须有 `{version}/{mode}`。replaceAll 替换，其他大括号原样保留（`src/app/prompts.ts:44-58`、`97-102`、`179-185`）。 |
| 生效时间 | 保存不重启、不取消、不主动 wake；下一次 model request 生效，包括同一 turn 的后续 step。非 tool 保存给主 Session 发通知（`src/app/prompts.ts:238-247`；`官方 docs/004-prompts.md:91-96`）。 |

15 个内建 override key 是：

```text
runtime/shared                 runtime/orchestrator           runtime/worker
runtime/subscriptions          runtime/replies                runtime/dispatch
runtime/work                   runtime/admission
runtime/handoff/orchestrator   runtime/handoff/worker
runtime/environment            runtime/policy                 runtime/policy/none
skill/feishu                   skill/github
```

注意没有独立的 `runtime/handoff` key：共用 `handoff.md` 已折叠进两个角色 part；一旦 override 某角色 handoff，替换的是「共用 + 该角色」的整段。

不可由 Prompts 面板修改的面包括工具 description、notice、card 文本，以及 gate、Mandate、工具参数检查、账号 wrapper；这些仍在代码强制执行（`官方 docs/004-prompts.md:7`、`36-40`）。因此「可覆盖 system prompt」不等于「可用提示词绕过授权」。

### 2.4 随包 skills 的加载，而非把正文全塞 system prompt

技能链与 prompt 链平行：

```text
SKILL.md
  → 严格解析 `--- / name / description / ---`，正文与 frontmatter 分离
  → bundledSkills.{github,feishu}
  → composeSkill(): 正文 + `## CLI usage` + prompts/cli.md
  → Prompts.skills(): github 总是注册；feishu 仅在已配置时注册；再加团队技能
  → Sessions.attachBefore(): 在当前 revision 变化时 dispose 旧 scope 并重注册
  → DSH skill 工具按需加载；resourceBase 指到技能目录，供附带资源使用
```

实现证据在 `src/app/skill-files.ts:18-24`、`src/app/prompts.ts:70-85`、`src/app/sessions.ts:185-204`、`299-338`。几个细节：

- 内建技能描述来自 frontmatter；团队技能没有 frontmatter，描述取正文首段的前 120 个规范化字符，空正文则回退为技能名（`src/app/prompts.ts:71-85`）。
- `skill/github`、`skill/feishu` override 会替换技能正文及追加 CLI 说明前的基础内容，不是改包里的文件。
- 注册顺序是 Feishu（若配置）→ GitHub → 团队技能；团队技能不能占用内建短名。
- 缺文件、空文件或 frontmatter 稍有形状不符会在模块加载时直接失败，不会静默降级成空技能（`src/app/skill-files.ts:8-24`）。

### 2.5 版本、升级默认文本与冲突处理

- revision 0 是内建默认快照，只 `keep`，不推进 current pointer；首次保存成为 revision 1（`src/app/prompts.ts:132-145`；`src/app/versions.ts:21-32`）。
- 每次保存写完整配置、`previousRevision`、`savedAt`、`source`；恢复历史或 defaults 也产生新版本，不改写旧版本。
- `baseRevision` 是乐观锁：盘上 revision 已变化就报 `versionChanged`，草稿不丢（`src/app/prompts.ts:163-175`）。
- 保存先严格校验，再过滤当前版本已不存在的 override；真正未知的 part 拒绝。总配置超过 `promptMaxChars` 也拒绝，不静默截断（`src/app/prompts.ts:169-186`）。
- 升级后，未 override 的 part 自动跟新默认；override 保留团队文本。`builtInBase()` 比较 override 的 `base` 与当前默认，输出 `default_changed`，面板展示 old default/new default/团队文本三方差异（`src/app/prompts.ts:204-228`；`官方 docs/005-panel.md:39-42`）。
- 旧 schema 无法比较的提示词版本不伪装成可 diff：当前版本回退可读配置并保留 `legacy.config`，历史把变化标为 `legacy`（`src/app/prompts.ts:136-155`）。

## 三、安装、状态迁移、版本升级与多语言

### 3.1 SETUP：一次一问、先收集再执行、密钥不进聊天如何落地

`SETUP.md` 是给 coding agent 的 runbook；没有一个隐藏的安装向导 Session 在跑它。它把流程拆成「探测 → 问完 → 计划确认 → 一次配置 → 验证」五段：

1. **先只读两份文档并探测一次。** 第一个问题之前只允许读 SETUP 与 philosophy，运行 Node/pnpm/git/tmux/Python/gh/dsh、GitHub 登录、lark-cli、已有 profile 的探测；结果不回灌给用户。缺前置条件进入计划，不变成问题；已有安装转升级分支（`SETUP.md:7-29`）。
2. **一次消息只问一件事。** 每题带推荐答案和一句「为什么重要」，少于 300 词；probe 已回答的跳过。顺序是 Sources（GitHub/飞书、repo、agent 账号、群）→ Policy（谁可派活）→ Execution（checkout、commit identity、review bots、merge CLI）（`SETUP.md:31-56`）。
3. **先收集全部答案，再展示完整计划。** 提问期间不得执行；计划一次性列出准备动作、需要操作者亲手做的步骤、完整 profile 配置和 verify 命令，确认后才动手（`SETUP.md:12-13`、`58-60`）。自动合并行数、主动规则、Source/Policy 等非机器配置也先写进计划，不在边问边改。
4. **密钥只走操作者自己的终端。** 建账号、`gh auth login`、lark-cli 的 `config init --app-secret-stdin` 都归入 operator steps；`cat` 的指令与 stdin 输入在操作者终端完成，聊天里只出现 wrapper 路径，不出现 token/secret（`SETUP.md:13`、`63-65`；`官方 docs/006-deployment.md:31-65`）。
5. **一次 `configure`，再 status。** configure 写 profile、copy bundle、启用可选 Feishu、设置 Source/Policy/Execution 并启动；安装错误先按 troubleshooting 修复。最后 `scripts/dsh-superagent status` 必须成功，再安排 hourly check 并交付 panel URL 和试用方式（`SETUP.md:63-79`）。

运行时继续兑现「密钥不进模型」：`src/infra/environment.ts:42-58` 清除 `GH_TOKEN/GITHUB_TOKEN` 和交互 askpass，把 git 指向独立 config，凭据只经 `gh auth git-credential` helper；`src/app/execution-environment.ts:1` 明确声明注入 worker prompt/prepare command 的变量绝不含凭据。这里保护的是默认路径，不是 OS 沙箱：官方也承认 worker 与操作者同 OS 用户、能读 home，真正隔离需专用 OS 账号（`官方 docs/006-deployment.md:13-19`）。

### 3.2 安装与启动检查链

手动安装主链是：准备独立 DSH profile 和 agent GitHub 账号（可选飞书 bot）→ 安装 DSH/构建 checkout → 以 `link:$PWD` 挂 bundle → 复制 profile 示例并填绝对 `stateDir` → `status`（`官方 docs/006-deployment.md:78-121`）。

- bundle 默认插入主插件、GitHub watcher、默认禁用的 Feishu watcher、worker preset、router preset 五项（`cordis.patch.yml:4-20`、`125-130`）。
- profile 侧只需要 `stateDir`；`promptMaxChars`、`admissionContextMaxPages`、`admissionContextTimeoutMs` 是 volatile，可在面板/Plugin Manager 改且免重启。`stateDir` 改变会 remount（`src/deployment.ts:13-30`；`src/client/deployment.tsx:20-51`）。
- 旧配置中的 `repository/github/feishu/author/repositoryPath/worktreeRoot/blockedCommands` 等不被悄悄接受，而是报出「现在应去哪里设置」（`src/deployment.ts:31-42`）。
- 启动时 GitHub 检查依次解析 executable → `gh api user` → `gh api repos/<repo>`，要求 login、push permission，并跟随仓库 rename 更新 Source 配置；飞书检查 auth status、bot ready、strict mode=bot、bot info（`src/deployment.ts:66-91`、`105-131`）。
- Setup 用 worker 视角 probe，写 shims/git config、应用进程环境、再验证；Feishu 失败可只停用 Feishu，GitHub/环境失败则整体未就绪（`src/app/setup.ts:71-98`）。
- `scripts/dsh-superagent` 将状态明确编码为 0=正常、1=停止/重复/不可达/运行错误、2=组件错误、3=等待 setup；重启不能代替修复 2/3（`scripts/dsh-superagent:1-7`）。巡检遵循「能自己重启修复才 restart，否则交 operator」，见 `官方 docs/006-deployment.md:219-244`。

### 3.3 状态 migration：先一次性改写，运行时只认新形状

当前 `SCHEMA_VERSION=11`，只允许直接从 schema 10 迁移；小于 10 要求新 state directory，大于 11 拒绝打开（`src/app/migration.ts:20-25`；`src/app/store.ts:60-68`）。打开流程是：

```text
锁 stateDir → 打开 SQLite/WAL → 读 KV schema
  → 建新表/补 generated columns
  → 若非当前版本：single atomic transaction
       ├─ migrateTo11(store)
       └─ 写 schema=11
  → 任一步失败：rollback、关闭 handle、数据库保持原版本与原记录
```

`store.atomic()` 用 BEGIN IMMEDIATE + COMMIT/ROLLBACK 包整个迁移，错误信息带上失败记录，例如 `ticket t9`，而不是留半新半旧数据库（`src/app/store.ts:72-103`、`267-281`）。

`migrateTo11` 的主要内容可按八组理解（`src/app/migration.ts:35-168`）：

1. **Settings**：统一新 SettingsSchema，删除已被版本历史取代的旧 settings key，校正 current revision 与最新快照。
2. **Prompts**：三个团队段、旧 guide 拆并、自动合并行数写入 Delivery、内建技能排除、旧 origin/source 词汇迁移；不可解析文本以 `legacy` 保留（`src/app/migration.ts:170-250`）。
3. **Ticket/Assignment**：复制 meta 中的 origin/execution，重建报告与结束记录，去掉可派生 session，保留 blocker 对应 answer 和 follow-up 时间（`src/app/migration.ts:254-364`）。
4. **Decision/Eval/Mandate**：旧 basis 统一成 `via: listed|chat|addressed|inferred`，回复/评估状态改为当前 shape。
5. **Trigger/Disposition/Reason**：旧英文句子映射为结构化 code/values；无法映射的人写理由保留为 `said`，不丢文本（`src/app/migration.ts:377-452`）。
6. **Source 状态**：GitHub issue source 归一、cursor/retry 迁移、Feishu thread cursor、私聊 direct 标记、Feishu/Lark 链接与缓存（`src/app/migration.ts:454-559`）。
7. **Outbox/Effect**：旧 outbox 变 receipt + reply effect，relay/assessment 重新入队，未送达的活跃评估重新建立 timeout 起点（`src/app/migration.ts:590-615`）。
8. **时间**：所有 Trigger/Thread 时间转毫秒 ISO，Thread createdAt/lastAt 由真实 Trigger 重算（`src/app/migration.ts:561-588`）。

测试不仅验证「能打开」，还构造最后一个 schema 10 版本的真实 DDL，验证迁移后重开结果相同、迁移失败 schema 和 ticket JSON 原样保留（`tests/migration.spec.ts:311-369`、`474-483`）。

### 3.4 版本升级与回滚

官方推荐开发 checkout 固定到公开发布的 DSH 版本，`pnpm build` 后以 `link:$PWD` 安装，因此升级实际是：备份 → `git pull` → `pnpm build` → 停/起专用 profile → `status`；数据库升级失败就恢复备份，源码回退后若库已是更新 schema，仍需用备份或新 stateDir（`官方 docs/006-deployment.md:123-148`）。

升级同时有三条独立兼容线：

| 线 | 机制 |
|---|---|
| 包/宿主 | `package.json:53-56` 限制 Node 与 `engines.dsh`；不匹配不能靠提示词修补。 |
| 持久化状态 | 上述 schema 检查与事务迁移；无向下迁移承诺。 |
| 团队提示词 | 默认文本随包更新；无 override 自动跟随，有 override 保留团队文本并标 `default_changed`，由人选择 keep/rebase，不用新默认静默覆盖团队策略（`官方 docs/004-prompts.md:38-42`）。 |

机器 limits 的保存不重启；Source 账号 CLI 等 setup 字段变化会重启本插件 fiber 以重新 probe，完成后再让 DSH settings service `describe()`，保持打开的配置表单可编辑（`src/index.ts:14-23`；`tests/index.spec.ts:44-55`）。这与「整台 DSH 随意重启」不是一回事。

### 3.5 i18n：包元数据、面板字典、领域文本三层

1. **包元数据层**：`locale/en.json`、`locale/zh.json` 只有 `meta.title/description`，经 `package.json:11-21` 的 `./locale/*.json` export 给宿主包管理界面。
2. **面板完整字典层**：真正的几百组中英 UI 文案在 `src/client/locales.ts`，每键形状为 `[zh,en]`，`language(0/1)` 投影成两个 dictionary（`src/client/locales.ts:749-752`）。客户端以 namespace `dshSuperagent` 注册并 bind，slot 也带同一 locale（`src/client/index.tsx:48-57`）。
3. **领域/动态文本层**：Source 字段和 actor 等使用 `{zh,en}` 的 `Localized`，`localized()` 按 `t('lang')` 选择；持久化 reason 尽量存 code+values，UI 再翻译，未知 code 或旧英文文本回退原文，不阻碍新版本读取旧记录（`src/client/text.ts:11-36`）。

术语表是有意的双语例外：界面保持当前语言，但 glossary 同时列中英，以对应代码、工具和文档里的英文术语（`src/client/app.tsx:27-52`；`src/client/locales.ts:754-766`）。时间格式经 `Intl.RelativeTimeFormat` 和 `toLocaleString` 在 `zh-CN/en` 间切换（`src/client/text.ts:44-62`）。

**提示词和随包 skills 不做中英双版**：`官方 docs/004-prompts.md:3` 明确 prompt text 用英文；execution environment 也固定取 `description.en`（`src/app/execution-environment.ts:44-46`）。人的 ack 才要求使用 source language。这是「管理界面 i18n」，不是「模型指令全多语言」。`tests/locales.spec.ts:9-46` 以双语占位符一致、非空、reason/health/UserError 覆盖来防止翻译漂移。

## 四、可低成本吸收到我们插件的清单

我们的插件是「轮询 → `Agent.followup()` 唤醒当前 Session → 按仓库 AGENTS.md 工作」，不是官方的独立 orchestrator/worker 池。现有 `formatWatchText()` 已是可单测纯函数（`lib/watch.js:111-138`），状态也已有 JSON 备份/恢复。因此优先吸收**文本工程、安装剧本、契约测试和小型版本机制**，不要把整套多 Session 架构搬来。

### 4.1 建议按此顺序吸收

| 优先级 / 成本 | 可吸收项 | 落到我们插件的最小形态 | 官方依据 |
|---|---|---|---|
| P0 / 小 | **模型可见面契约测试** | 新增一个测试聚合 7 个工具 schema/description、`formatWatchText()`、唤醒/错误通知；断言工具名真实存在、枚举一致、goal 换行被清洗、无禁用旧术语，并给单条唤醒文本设字符预算。无需 DSH host。 | `tests/model-surface.spec.ts:1-4`、`350-397` |
| P0 / 小 | **提示词文件规则测试 + 有序 section 纯函数** | 不先做编辑器；只把唤醒文本的「事实 / 为什么这几条 / 隔离 / goal / 完成标准 / 下一步」定义成稳定 section 数组，逐项快照和禁含断言。保留现有 provider/goal 参数，不引入 orchestrator。 | `src/app/prompts.ts:46-70`；`tests/cards.spec.ts:8-29` |
| P0 / 小 | **SETUP.md 代理安装剧本** | 写我们的一份精简 runbook：先跑 `watch_doctor` 和版本/profile/token 探测；一次只问 repo、session、过滤、隔离、goal；最后给完整计划，确认后安装。token 仍只在面板凭证字段或用户终端，聊天只要引用。 | `SETUP.md:7-14`、`31-65` |
| P0 / 小 | **「路由不添实现」规则** | 唤醒文本继续保留原始 issue/PR 引用、人的明确约束和 watcher goal，但不自动编造技术方案、文件清单或宽泛验收；可观测完成标准只从原请求/仓库规则提取。 | `prompts/shared.md:4-7`；`prompts/dispatch.md:37-52` |
| P0 / 小 | **文档/测试索引门禁** | 在现有 `check-docs`/preflight 增加：官方解构编号连续、本地链接存在、每篇有职责；若维护模块索引，则自动枚举 src/test 检查漏项，不靠人手记总数。 | `tests/docs.spec.ts:37-67` |
| P1 / 小 | **最小 state schema migration** | 给 `watchers.json` 增加 `schemaVersion` 与一个纯 `migrateState()`；启动先迁移再 normalize，未知未来版本拒绝，迁移失败继续用 `.bak`。只迁移我们实际字段，不搬 616 行 SQLite 转换。补 old/current/future/corrupt 四类测试。 | `src/app/store.ts:60-103`；`tests/migration.spec.ts:474-493` |
| P1 / 小 | **集中文案 + 占位符 parity 测试** | 先把 client.js 散落中文集中为 `TEXT[key]=[zh,en]` 或先中文单表，再逐步补 en；测试两种语言 `{placeholders}` 完全一致。包元数据可低成本补 `locale/*.json`，不必一次翻译全部历史文档。 | `src/client/locales.ts:749-752`；`tests/locales.spec.ts:7-13` |
| P1 / 小 | **结构化新 reason，旧文本兼容** | 新增的 filtered/wake reason 用 `{code,values}` 存，面板按语言翻译；读取旧中文 reason 时原样显示。不要为 i18n 一次性重写所有历史状态。 | `src/client/text.ts:21-36`；`src/app/migration.ts:424-452` |
| P1 / 小 | **部署 preflight 的结构化错误与旧键导航** | 扩展 `watch_doctor`：把 gh 未装/未登录、repo 不可达、凭证过期、profile 不符分别返回稳定 code；旧设置项若改名，错误直接说新位置。面板按 code 给修复入口。 | `src/deployment.ts:31-42`、`66-91` |
| P1 / 中 | **随包 skill 的单文件加载器** | 若确实要让模型按需读取 GitHub/Gitee 操作知识，再引入一个 `skills/<name>/SKILL.md`、严格 frontmatter、包文件清单和缺失即错测试。当前没有 `skills`/agent decoration 注入，不应只复制文件就宣称「技能已加载」。 | `src/app/skill-files.ts:8-24`；`src/app/sessions.ts:185-204` |
| P1 / 中 | **可配置唤醒模板的 default base** | 只有在开放用户自定义模板后再做：override 存 `{text,base}`；升级保留用户文本并显示「默认已更新」，相同于默认则删除 override。无需第一版就搬完整 Full prompt/diff UI。 | `src/app/prompts.ts:204-228`；`src/client/prompt-config.ts:24-34` |

### 4.2 暂不建议吸收，或必须改约束后再吸收

- **完整 orchestrator/worker/handoff 多 Session 体系**：我们的价值恰是轻量唤醒当前会话；引入独立 preset、worker pool、Mandate、Ticket SQLite 会改变产品，而不是低成本增强。
- **整套 Prompts 管理器**：15 个 override key、不可变历史、三方 diff、每请求 skill 重注册都依赖独立 Runtime/Store；在没有用户需求前，先做 4.1 的纯 section 与契约测试即可。
- **官方默认 Delivery 的 reviewer credit 流程**：它会 `git filter-branch` 改写整串 commit 并 `push --force-with-lease`（`prompts/team/delivery.md:17-23`），与我们「PR 分支永不强推、只追加 commit」规则冲突，不能照搬。
- **独立 profile + tmux 服务脚本**：官方需要隔离进程环境，且有 Unix `fcntl/tmux/ps` 依赖；我们的插件由现有 DSH profile 承载，保留 `dsh plugin --profile ... update` 和现有更新面板即可。
- **把完整中文界面翻译成中文提示词**：官方自己也只 i18n 管理界面，模型提示词固定英文。我们应优先保持唤醒文本与仓库 AGENTS.md 的一致语言，而不是引入两套会漂移的行为规则。
- **把 `danger-full-access` 当成隔离**：官方明确账号 wrapper 不是安全边界（`官方 docs/006-deployment.md:15-19`）。我们的 isolated worktree 只隔离工作区，不应宣传成凭证/OS 隔离。

**最小落地组合**：先做「模型可见面契约测试 + SETUP runbook + 唤醒 section 稳定化 + state schemaVersion」四项。它们都不要求新角色、新 Session、新数据库或生产架构迁移，却能吸收官方最有价值的工程纪律：模型看到的文字可审查、安装过程可复述、状态升级可回滚、默认变化不覆盖人的策略。
