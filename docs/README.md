# 文档索引

按「什么时候读」排，不按重要程度：

| 文档 | 什么时候读 |
|---|---|
| [README](../README.md) | 第一次接触这个插件：它做什么、怎么装、界面在哪、故障排查 |
| [01-架构](01-架构.md) | 要改服务端逻辑：分层、11 步轮询管线、状态文件与落盘规则 |
| [design-system](design-system.md) | 要改界面：35 个设计 token、常用组件类、加页面的检查清单 |
| [official-gui-ia](official-gui-ia.md) | 想知道「官方原版长什么样、我们砍了什么、为什么」 |
| [awesome-submission](awesome-submission.md) | 要提交到 awesome-dsh-plugin：现成的 YAML、图标、核对结论 |
| [competitive-analysis](competitive-analysis.md) | 想知道和 Sweep / CodeRabbit 这类工具的差别 |
| [deepseek-papers](deepseek-papers.md) | 想知道设计取舍背后的研究依据 |
| [review-2026-11-01](review-2026-11-01.md) | 历次严格审核的结论与遗留项（含每项的闭环状态） |

仓库根部还有三份「维护用」的：`MAINTENANCE.md`（维护者视角的现状与门禁）、
`HANDOFF.md`（会话交接：坑列表、验证台账、下一步）、`CHECKLIST.md`（发布前逐条打勾）。

## 时效性

- `README` / `01-架构` / `design-system` / `HANDOFF` 随代码更新，**以代码为准**；
- `official-gui-ia` 是对官方 0.1.0 的考古快照，不会跟随官方变化；
- `review-*` 是当时的事实记录，不追改（后续闭环写在表格里，不改原文结论）；
- `awesome-submission` 里的门槛时间点会过期，提交前重新核对 `contributing.md`。
