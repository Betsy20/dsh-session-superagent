# 文档索引

按「什么时候读」排，不按重要程度：

| 文档 | 什么时候读 |
|---|---|
| [README](../README.md) | 第一次接触这个插件：它做什么、怎么装、界面在哪、故障排查 |
| [SETUP](../SETUP.md) | 让 coding agent 陪操作者安装：只读探测、一次一问、计划确认、首轮唤醒验收 |
| [01-架构](01-架构.md) | 要改服务端逻辑：分层、11 步轮询管线、状态文件与落盘规则 |
| [design-system](design-system.md) | 要改界面：35 个设计 token、常用组件类、加页面的检查清单 |
| [official-gui-ia](official-gui-ia.md) | 想知道「官方原版长什么样、我们砍了什么、为什么」 |
| [awesome-submission](awesome-submission.md) | 要提交到 awesome-dsh-plugin：现成的 YAML、图标、核对结论 |
| [为什么做这个产品](为什么做这个产品.md) | **动任何功能之前先读**：谁在痛、三条不变量（不打断 / 不留手尾 / 不失控）、明确不做什么 |
| [对比-官方原型](对比-官方原型.md) | 想知道和官方 `dsh-superagent-prototype` 的功能差距、哪些该抄哪些不该 |
| [official-decomp/](official-decomp/01-structure-tree.md) | **完整官方结构树**：运行时/事件源/面板/提示词运维逐文件解构，以及已落地与待吸收清单 |
| [ui-decomp/](ui-decomp/03-gap-map.md) | **UI 复用主任务**：DSH 主库素材、superagent 控件、逐页差距、宿主原语 smoke 与实施回写 |
| [competitive-analysis](competitive-analysis.md) | 想知道和 Sweep / CodeRabbit 这类工具的差别 |
| [deepseek-papers](deepseek-papers.md) | 想知道设计取舍背后的研究依据 |
| [真机验证清单](真机验证清单.md) | 重启后三条命令 + 三个动作，5 分钟确认新代码在跑 |
| [首次唤醒走查](首次唤醒走查.md) | 新客户照着走一遍：7 步 + 每步该看到什么 |
| [kb/](kb/README.md) | 每轮外部学习沉淀：出处 / 做法 / 我们能怎么用 / 是否已落地 |
| [optimization-plan](optimization-plan.md) | 要挑活时：11 项 UI/可靠性/客户体验指标 + 当前分数 + 下一批目标 |
| [ui-inventory](ui-inventory.md) | 要改界面时：渲染面 → 页签 → 二级 → 三级 → 官方原语对照，逐条标差异 |
| [review-2026-11-01](review-2026-11-01.md) | 历次严格审核的结论与遗留项（含每项的闭环状态） |

仓库根部还有三份「维护用」的：`MAINTENANCE.md`（维护者视角的现状与门禁）、
`HANDOFF.md`（会话交接：坑列表、验证台账、下一步）、`CHECKLIST.md`（发布前逐条打勾）。

## 时效性

- `README` / `01-架构` / `design-system` / `HANDOFF` / `optimization-plan` / `ui-inventory` 随代码更新，**以代码为准**；
- `official-gui-ia` 是对官方 0.1.0 的考古快照，不会跟随官方变化；
- `review-*` 是当时的事实记录，不追改（后续闭环写在表格里，不改原文结论）；
- `awesome-submission` 里的门槛时间点会过期，提交前重新核对 `contributing.md`。
