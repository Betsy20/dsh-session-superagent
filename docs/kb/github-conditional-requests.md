# 条件请求：没变化就别算钱

## 出处
- GitHub REST 最佳实践：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>
  原文要点：*"Make authenticated conditional requests, so that unchanged data does not count against your primary rate limit."*
  同页还提到：优先用 webhook 而不是轮询；必须轮询就固定节奏、遵守 `x-poll-interval`。
- 本次抓取时间：2026-11-02。

## 它怎么做的
第一次请求返回 `200` 并带 `ETag`；之后把这个值放进
`If-None-Match` 请求头，没变化时服务端直接回 `304 Not Modified`（无正文），
且该响应**不计入**主速率限制。

## 我们能怎么用
主理鱼是「每 N 秒轮询一个仓库」的工具 —— 大多数轮次其实什么也没变，
全量拉 20 条 issue 纯属浪费额度（也慢）。所以：

- 每条 watcher 记住 `etag`；
- 下一轮带上 `-H 'If-None-Match: <etag>'`；
- 收到 `304` 就当作「本轮无变化」：不解析、不记失败、不动退避。

## 是否已落地
✅ 0.8.51（`lib/watch.js` 的 `parseGhInclude` + `lib/index.js` 的轮询路径）。
`gh api --include` 会输出「状态行 + 头 + 空行 + 正文」，所以加了一个纯函数解析它，
并写了用例覆盖 200 / 304 / 纯正文三种形态。

**还没做的**：`x-poll-interval` 头还没读（GitHub 极少在 issues 列表上发这个头，先记着）。
