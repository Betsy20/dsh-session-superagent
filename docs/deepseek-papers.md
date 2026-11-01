# DeepSeek 官方论文 → 主理鱼可借鉴的机制

> 取数时间 2026-11-01，来源 arXiv API（`research/raw/arxiv-ds-abs.xml`）。
> 只挑对**产品机制**有直接指导意义的，不做模型架构综述。

## 读到的五篇

| 编号 | 标题 | 与我们相关的点 |
|---|---|---|
| [2609.19969](https://arxiv.org/abs/2609.19969) | **DeepSeek-V4.1-Flash: Pushing the Limits of KV Cache Compression** | agent 负载是 **input-heavy**；KV cache 压到 **890 字节/token**（约为 V4-Flash 的 1/4），prefill 只激活 8B |
| [2512.02556](https://arxiv.org/abs/2512.02556) | **DeepSeek-V3.2** | DSA 稀疏注意力；**可扩展 RL**；**大规模 agentic 任务合成流水线**（把推理接进工具使用） |
| [2606.19348](https://arxiv.org/abs/2606.19348) | **DeepSeek-V4** | 百万 token 上下文（CSA + HCA 混合注意力、mHC、Muon） |
| [2510.18234](https://arxiv.org/abs/2510.18234) | **DeepSeek-OCR: Contexts Optical Compression** | 用光学 2D 映射压长上下文：10× 压缩下 OCR 精度 97%，20× 仍约 60%；并提出**记忆遗忘机制** |
| [2609.22978](https://arxiv.org/abs/2609.22978) | **DeepSeek Elastic Compute (DSec)** | 生产级沙箱平台：FnCall / 容器 / microVM / 全 VM 统一 SDK，与 RL 框架协同、**状态化 rollout 与可抢占 GPU 解耦** |

## 四条能直接搬的

### 1. 「输入才是成本」→ 唤醒消息要按预算裁，不是按条数任性

V4.1-Flash 的动机说得很直白：*long-horizon agents 让负载变得 input-heavy*，所以它们把 KV 压到 890B/token。
我们的对应物就是**唤醒消息**：一次塞 20 条 issue，等于给每个会话轮次加一大段前缀。

- 已做：`batchLimit`（默认 5）+ 其余给编号。
- 待做：消息里**去掉重复字段**（url 已经能定位一切，标题别超过 N 字）。

### 2. 「可验证奖励」→ 完成的定义必须是可检验的

V3.2 把 agent 能力归功于「大规模 agentic 任务合成 + 可扩展 RL」，而 RL 的前提是**奖励可计算**。
我们的唤醒消息目前只说「完成一条就写回」——不可验证。改成：

> 完成标准 = 有测试结果。没跑测试不算完成；跑不了就写清原因。

这条已经写进唤醒消息尾巴，见 `lib/watch.js` 的 `formatWatchText`。

### 3. 「记忆要有遗忘」→ 状态文件不能只增不减

DeepSeek-OCR 的论文里明确提到 *memory forgetting mechanisms*。我们的 `watchers.json` 里
`seen` / `lastReported` 只增不减，跑几个月会变成几 MB 的字典。

- 已做：`pruneSeen()` —— 按 30 天 / 最多 500 条裁剪。

### 4. 「沙箱隔离」→ 别在主工作区里动手

DSec 的存在本身就说明：agent 干活必须有**隔离的、有状态的执行环境**。
主理鱼现在直接在你的工作区里改文件 —— 撞上未提交改动就是事故（上次 GOkifu 就是脏工作区）。
下一步：`isolated: true` 时用 `git worktree` 开一次性副本，处理完再把分支推上去。

## 与竞品蒸馏的关系

竞品那篇（`docs/competitive-analysis.md`）解决的是**流程**（触发/限流/幂等/人审），
DeepSeek 论文这批解决的是**成本与安全**（输入预算/验证/记忆衰减/隔离）。两套合起来才是完整的产品约束。
