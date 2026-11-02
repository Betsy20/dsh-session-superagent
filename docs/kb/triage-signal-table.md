# 一张表说清"我们看哪些信号、哪些是判断"

## 出处（含坦白）
- 事实类信号来自 issue 对象本身：`state_reason` / `comments` / `labels` / `assignees`
  <https://docs.github.com/en/rest/issues/issues>
- 顺带核对了 `milestone` 与新版 `type` 字段是否存在（本机实测 `cli/cli` 上两者多为 `null`）——
  **存在但不稳定**，所以本轮不纳入权重。
- **坦白**：`UNASSIGNED 更紧急`、权重数值 100/10/5/3 都是我们的产品判断，
  GitHub 没有官方推荐值（前几轮已多次确认抓不到官方正文）。

## 它怎么做的（我们）
`lib/watch.js` 里有一张 `TRIAGE_SIGNALS` 表，是唯一口径：

| key | 标签 | 类型 | 权重 | 默认 | 理由 |
|---|---|---|---|---|---|
| reopened | 被重新打开 | 事实 | 100 | 开 | 之前判"不做"被推翻 |
| comments | 有人评论 | 事实 | 10 | 开 | 在等回应 |
| labels | 带标签 | 事实 | 5 | 开 | 命中过某个分类 |
| unassigned | 无人认领 | **判断** | 3 | **关** | 团队经验，无官方依据 |
| stale | 长期没动静 | 事实 | 0 | 关 | 仅展示，不参与排序 |

`/state.triageSignals` 直接回传这张表，面板「设置 → 分诊信号与取舍」原样展示。

## 关键约束（用例守着）
1. 每条必须有 `kind`（fact/judgment），**判断类默认必须是关的** —— 我们的判断不该默认生效；
2. 表里的权重必须和 `priorityScore` 的实际打分一致，防止文档与代码走偏。

## 是否已落地
✅ 0.8.78（`watch.js:TRIAGE_SIGNALS` + `/state` 回传 + 面板展示 + 一致性用例）。

## 还没做的
- `stale`（长期没动静）只列了没算 —— 要用 `updated_at` 计算，还没接；
- 权重仍不可自定义数值（只能开/关）。
