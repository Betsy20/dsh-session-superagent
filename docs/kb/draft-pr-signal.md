# 草稿 PR ≠ 有人在推进

## 出处
- GraphQL `PullRequest` 有 `isDraft` 字段（本机实测：`cli/cli` 前 3 个 open PR 全是 `isDraft: true`）。
  <https://docs.github.com/en/graphql/reference/objects#pullrequest>

## 它怎么做
草稿（draft）PR 不触发通知、不能合并，作者明确表示"还没准备好"。

## 我们能怎么用
上一轮我们加了「已有 PR 在做」。但如果是**草稿** PR，那多半是作者自己半成品、
或者只是开个分支占位 —— 会话如果据此判断"有人在推进，我不用管"，就会漏活。

改法：关联 PR 的展示区分状态
- `已有 PR #20（进行中）`
- `已有 PR #20（进行中·草稿）` ← 明确"还没准备好"
- `已有 PR #21（已合并）`（合并不可能是草稿，不加后缀）

## 是否已落地
✅ 0.8.81（查询加 `isDraft`；`pickLinkedPullRequests` 带 `draft`；`linkedPrNote` 文案区分）。
用例：open 草稿带后缀、merged 即使 isDraft=true 也不加后缀（防御性）。

## 还没做的
- 没有按"草稿 PR 存在"降低优先级（会隐藏信息，先只提示）；
- 没有取 PR 的 `reviewDecision` / CI 状态（那是"能不能合"的问题，成本更高）。
