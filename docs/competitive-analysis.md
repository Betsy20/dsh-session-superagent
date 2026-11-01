# 同类产品蒸馏 · 主理鱼该抄什么

> 调研时间：2026-11-01 · 对象：**会话级盯办器**（轮询仓库 → 唤醒会话 → 按规则主动处理 issue/PR）
> 方法：扒官方文档 + 开源仓库 README（本机 `web_fetch` 工具不可用，改用 curl/gh 直连，原文存 `research/raw/`）

## 一、同类产品地图

| 产品 | 形态 | 触发方式 | 落地动作 | 我们该看的点 |
|---|---|---|---|---|
| **Sweep** | GitHub App | issue 打标签 | 直接开 PR（搜索→计划→改码→验证→自审） | issue→PR 全自动流水线 |
| **GitHub Copilot coding agent** | GitHub 云沙箱 / Actions | **把 issue 指派给 Copilot** | 在隔离环境里改，产出 PR 等人工审 | 隔离执行 + 明确指派语义 |
| **Claude Code GitHub Action** | 用户自己的 CI | **`@claude` 留言**（交互）或 workflow 里的 `prompt`（自动） | 回评论、开 PR、按 `CLAUDE.md` 干活 | 交互/自动双模 + 谁能触发 |
| **CodeRabbit** | SaaS | PR 打开/更新 | 评审、triage、一键修复 | 「学会团队口味」的配置化评审 |
| **Greptile** | SaaS | PR 打开 | 全库图 + 行内评论 | 上下文检索质量 |
| **Qodo / PR-Agent** | 开源 + SaaS | `/review` `/improve` `/ask` 指令 | 单次 LLM 调用出结构化结果 | 命令面板 + 大 PR 压缩策略 |
| **Renovate / Dependabot** | 机器人 | 定时扫描 | 批量开 PR | **限流/分组/幂等** 的工业标准 |
| **Aider** | CLI | 人盯着跑 | 改码 + 自动提交 + lint/test 回环 | repo map + 验证闭环 |
| **OpenHands / SWE-agent** | 开源 agent | 人派任务 | 沙箱内改码 | ACI（人机接口）+ 沙箱隔离 |

## 二、六个可蒸馏的模式

### 1. 触发要有「许可」，不是「全量轮询」

- Copilot：**指派**给 agent 才算授权；Claude Code Action 有明确的 *Who can trigger runs*（两道 actor 检查，任一不过就直接失败不跑）。
- Sweep：issue 加 label 才触发。
- **我们的差距**：仓库里任何 issue/PR 一更新就叫醒会话，等于把「授权」这一步省掉了 —— 噪音大，也等于默许 agent 处理任何人的请求。
- **落地**：watcher 支持过滤器 —— `labels: ["主理鱼"]`、`skipBots: true`（默认）、`onlyAssigned: true`、`ignoreLabels: ["wontfix"]`。

### 2. 幂等痕迹要留在「外部系统」，不能只在本地

- Claude Code Action：**已经有过 Claude 评论的 PR 直接跳过**（评论即幂等标记）。
- Renovate：PR 标题/正文里埋标记，重启后知道自己开过了。
- **我们的差距**：`seen` 水位存在 `watchers.json`，换台机器、换个会话、或者手滑删了状态文件，同一批 issue 会再报一遍。
- **落地**：处理完在 issue/PR 上留一条固定格式的标记评论（如 `<!-- 主理鱼: handled 2026-11-01T14:00Z -->`），轮询时把带标记的条目当作已处理。

### 3. 限流与分组是标配，不是可选项

- Renovate：`prConcurrentLimit`（并发 PR 上限）、`prHourlyLimit`（**每小时** PR 上限，per-repo）、`branchConcurrentLimit`、`groupName`（多个升级合成一个 PR）。
- Claude Code Action：`--max-turns` + workflow 超时 + concurrency 控制，官方文档专门有一节 *Manage costs*。
- **我们的差距**：只有「agent 空闲才叫醒」这一道闸；一波 20 条动态会连续唤醒 20 次。
- **落地**：`maxWakesPerHour`（默认 6）、单次唤醒最多带 `batchLimit`（默认 3）条、其余顺延到下一轮（digest 思路）。

### 4. 交互模式 ≠ 自动模式

- Claude Code Action 明确分成 Interactive（等人 `@claude`）和 Automation（拿 prompt 直接跑）。
- **我们的差距**：只有自动模式，没有「我现在就叫你跑一次」的入口。
- **落地**：面板每行一个「立刻跑一次」，或在会话里喊一声 `处理一下 #12`。

### 5. 失败要退避，不能定速撞墙

- 竞品的 CI 轮询普遍是「失败就退，别把配额打光」。
- **我们的差距**：`lastError` 只是显示，间隔不变 —— 401 时会每 30 秒打一次 GitHub API。
- **落地**：连续失败 n 次后间隔翻倍，上限 30 分钟；成功一次立刻复位。

### 6. 唤醒消息就是「任务书」，得能直接照着干

- Aider 会先给 repo map；PR-Agent 对大 PR 做压缩；Claude Code Action 要求 `CLAUDE.md` 写清规则（并且提示「保持简洁，因为每次都会读」）。
- **我们的差距**：唤醒消息只有一行「有 N 条新动态」，剩下的靠 agent 自己翻。
- **落地**：每条带上 `类型（issue/PR）/ 状态 / 标题 / 作者 / 标签 / 是否草稿 / 链接`，并附一句固定约束（读 `AGENTS.md`、别扩大范围、完成后写回）。

## 三、我们**已经领先**的地方（别丢）

| 能力 | 说明 |
|---|---|
| **会话级**而非实例级 | 竞品都是「又一个机器人账号」；我们直接唤醒**你这个会话**，带着完整上下文和你的 `AGENTS.md` |
| **状态可见** | 竞品要打开网页看；我们在输入框那行有环，点开能看每条的状态/轮询/唤醒时间 |
| **零边际成本** | 云端 agent 按分钟计费；我们复用一个已经在跑的会话 |
| **规则即 `AGENTS.md`** | 不用学新配置文件（竞品各有 `.coderabbit.yaml` / `sweep.yaml` / `CLAUDE.md`） |

## 四、落地清单（按性价比排序）

| # | 改动 | 状态 |
|---|---|---|
| 1 | watcher 过滤器：label / 跳过机器人 / 只看指派 | 本轮实现 |
| 2 | 单次唤醒批量上限 + 每小时唤醒上限 | 本轮实现 |
| 3 | 连续失败指数退避（30s → 60 → 120 … 上限 30min） | 本轮实现 |
| 4 | 唤醒消息结构化（类型/状态/作者/标签/链接） | 本轮实现 |
| 5 | 处理完在 GitHub 留幂等标记 | ✅ 已实现（`watch_ack` 打「主理鱼:已处理」标签，2026-11-02 真机验证） |
| 6 | 面板「立刻跑一次」 | ✅ 已实现（每行「立刻」按钮 → `POST /watch {action:'poll'}`） |
| 7 | 面板里配过滤器 | ✅ 已实现（触发页 + 行内编辑，含标签白/黑名单、只看已指派） |

## 四、六个模式的落地对照（2026-11-02 复核）

分析写在 11-01，这里逐条核对"到底有没有做"：

| 模式 | 落地在哪 | 状态与证据 |
|---|---|---|
| ① 触发要有许可，不是全量轮询 | `filters.labels` / `ignoreLabels` / `onlyAssigned` + `filterReason()` | ✅ 面板与工具都能配；被过滤的条目连原因一起记进 `filteredLog`（真机 4 条「不在标签白名单: ai-fix」） |
| ② 幂等痕迹留在外部系统 | `watch_ack` → GitHub 标签「主理鱼:已处理」 + `hasAckLabel` | ✅ 真机打过标签、重复 ack 幂等；换机器也认（痕迹在 GitHub 上，不在本地状态里） |
| ③ 限流与分组是标配 | `batchLimit`（1-20）+ `maxWakesPerHour`（1-60）+ 单轮 `inFlight` 闸 | ✅ 面板可改、工具可设、超限只记 `lastDeferred` 攒着 |
| ④ 交互模式 ≠ 自动模式 | `observe: true`：照常判定，只记录「本会唤醒哪几条」，不唤醒 | ✅ 真机验证：`lastDeferred = 仅观察：本轮本会唤醒 4 条…`，`history.reason = "observe"` |
| ⑤ 失败要退避，不能定速撞墙 | `bumpFailure()` + `nextDelayMs()`（指数退避封顶 30 分钟） | ✅ 幽灵会话、未预期异常、gh 失败三条路径都进退避（0.8.14 / 0.8.22 修的就是这里） |
| ⑥ 唤醒消息就是任务书 | `formatWatchText()`：条目 + 隔离路径 + 本条目目标 + 完成标准（要有测试结果） | ✅ 冒烟场景 B 打印过真实消息，含「先读仓库 AGENTS.md…完成标准 = 有测试结果」 |

**还没抄的**：
- Sweep 的「搜索→计划→改码→验证→自审」流水线 —— 我们把这步交给会话自己按仓库 `AGENTS.md` 决定，**故意不做**，否则就变成又一个固定流水线；
- CodeRabbit 的「学会团队口味」配置化评审 —— 需要长期数据沉淀，单机插件没有这个样本量；
- Greptile 的全库代码图 —— 成本远超本插件的定位。
