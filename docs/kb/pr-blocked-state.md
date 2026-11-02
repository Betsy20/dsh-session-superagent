# 「有 PR」不够，要说清它卡在哪

## 出处
- GraphQL `PullRequest` 的 `reviewDecision`（`REVIEW_REQUIRED` / `APPROVED` / `CHANGES_REQUESTED`）
  与 `mergeable`（`MERGEABLE` / `CONFLICTING` / `UNKNOWN`）。
  <https://docs.github.com/en/graphql/reference/objects#pullrequest>
- 本机实测（`cli/cli` 前 3 个 open PR）：
  ```json
  {"number":9847,"reviewDecision":"REVIEW_REQUIRED","mergeable":"CONFLICTING","isDraft":true}
  {"number":10253,"reviewDecision":"REVIEW_REQUIRED","mergeable":"MERGEABLE","isDraft":true}
  ```

## 它怎么做的
GitHub 用两个独立字段表达"这个 PR 能不能合"：
`mergeable` 说有没有冲突，`reviewDecision` 说 review 满不满足。

## 我们能怎么用
会话看到「已有 PR #20（进行中）」时，还缺一个关键判断：**该不该我接管？**
- 有冲突 → 需要有人解冲突（可能该接手）；
- 等 review → 通常不该插手，等就行；
- 被要求修改 → 作者得动，别抢。

改法：把这三种状态叠加进同一句提示（只在 `state === 'OPEN'` 时）：
```
已有 PR #25（进行中·草稿·有冲突·等 review）
```
注意是**叠加**而不是互斥：一个 PR 可以既草稿又有冲突还要 review。

## 是否已落地
✅ 0.8.82（查询加 `reviewDecision` / `mergeable`；`pickLinkedPullRequests` 带出；
`linkedPrNote` 叠加 `·有冲突` / `·等 review` / `·被要求修改`）。
用例：单个状态、三个状态叠加、merged 不加这些后缀。

## 还没做的
- 没取 CI 状态（`statusCheckRollup`，取它要多一轮联合查询，成本更高）；
- 没把"有冲突"用于跳过/降低优先级（先只提示）。
