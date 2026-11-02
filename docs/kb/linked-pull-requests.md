# 「已经有 PR 在做了」比评论更硬的信号

## 出处
- GraphQL `CrossReferencedEvent`：issue 的时间线会记录"谁引用了这条 issue"，
  其中 `source` 是 **union**（可能是 PullRequest / Issue / Commit）。
  <https://docs.github.com/en/graphql/reference/objects#crossreferencedevent>
- **踩到的坑**：直接写 `source { number }` 会报
  `Selections can't be made directly on unions` —— 必须先 `source { __typename ... on PullRequest { … } }`。

## 它怎么做的
```graphql
issue(number: 14718) {
  timelineItems(last: 5, itemTypes: [CROSS_REFERENCED_EVENT]) {
    nodes { ... on CrossReferencedEvent {
      source { __typename ... on PullRequest { number state url } }
    } }
  }
}
```
本机实测返回：`{"number":14719,"state":"MERGED","url":"…"}` —— 说明这条 issue 已经有 PR 且已合并。

## 我们能怎么用
会话被叫醒后最怕**重复劳动**：其实已经有人开了 PR，它又从零改一遍。
评论能看出"有人在说话"，但**关联 PR** 能看出"已经有人在写代码了"。

改法：把时间线查询挂进已有的**批量 GraphQL**（不多一次请求），解析出关联 PR：
- 去重、忽略非 PR 的引用；
- 排序 `OPEN > MERGED > CLOSED`（进行中的最需要知道）；
- 消息里加 `已有 PR #20（进行中）` / `已有 PR #21（已合并）` / `等 N 个`。

## 是否已落地
✅ 0.8.80（`watch.js:pickLinkedPullRequests` / `linkedPrNote` + 批量查询扩展 + 消息行尾）。
用例：open 优先与去重、忽略 Issue 类型、null 源、各种状态文案、"等 N 个"、消息里出现提醒。

## 还没做的
- 只取 `last: 5` 条时间线，很早以前的引用看不到；
- 没有把"已有 open PR"用于**跳过唤醒**（有人可能希望直接跳过，但那会隐藏信息，先只提示）。
