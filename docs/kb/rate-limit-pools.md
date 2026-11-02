# 限流是**分池**的：别用一个池的数字判断另一个池

## 出处
- GitHub REST 限流文档原文：*"Some endpoints, like the search endpoints, have more restrictive limits."*
  同页还写：GraphQL 有**独立的** primary rate limit，与 REST 不共享。
  <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

## 它怎么做的
`X-RateLimit-Resource` 这个响应头就是**池名**（`core` / `search` / `graphql` / `integration_manifest` …），
每个池各有自己的 `Remaining` / `Reset`。

## 我们能怎么用
我们 0.8.53 做了「剩余 < 500 时推到 reset」，但**没有区分池**：
如果在 search 池（额度小得多，认证用户 30 次/分钟）里套用 core 的阈值，判断会完全错位。

当前实现只打 `core` 池（issues 列表走 REST），所以现在没出错；
但一旦加"按关键字搜 issue"这类功能，就必须按 `resource` 分开记额度。

本轮先把结论固化下来：**判额度前先看 `x-ratelimit-resource`**。

## 是否已落地
⚠️ 部分：这条是**判断准则**，本版代码尚未按池分账（因为目前只有一个池在用）。
已记进知识库，等加了 search/graphql 调用时按此实现。

## 顺带交付（本轮的代码改动）
「能力徽章」可点：点 `只读` / `已归档` / `无 Issues` / `私有` 等就只看这类守，再点取消；
顶部显示「只看 只读 的守（1 条）· 清除」。与「跳过原因」的 Pill 交互保持一致。
