# 第二阶段限流：照 `Retry-After` 等，别猜

## 出处
- GitHub REST 限流文档（primary / secondary 两种限流）：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>
- **实测证据**：`gh api --include` 的响应头里，`Access-Control-Expose-Headers` 明确列出 `Retry-After`；
  404 响应里也能看到这一行（说明它是协议里的正式头，不是某个端点专属）。

## 它怎么做的
- **primary limit**：固定窗口（我们 core 是 5000/小时），用 `X-RateLimit-Remaining` / `X-RateLimit-Reset`；
- **secondary limit**：突发/并发过高触发，响应 403 或 429，并带 `Retry-After: <秒>`。

## 我们能怎么用
我们已经按 primary 做了自适应（剩余 <500 推到 reset）。但 secondary 是**没有预警**的：
一旦触发，继续按间隔重试只会延长封禁。所以失败路径要先看 `Retry-After`：

- 有值 → 就按它等（封顶 1 小时），并在 `lastDeferred` 写「被 GitHub 限流，按 Retry-After 等 N 秒」；
- 没值 → 走原来的指数退避。

## 是否已落地
✅ 0.8.54（`lib/watch.js:parseGhInclude` 读 `retry-after` + `retryAfterMs`，`lib/index.js` 失败路径接入）。
用例：真实 403 头解析、正常值、0/非数字当没给、超 1 小时封顶。

## 附：并发偶发红的结论
之前记录过「整套并发跑偶发 1 例失败」。这轮又跑了 **10 次全绿**，加上前面 4+6 次也算干净；
回看两次失败都发生在**版本号刚改、文件正在被重写的同一秒**——是"测试读文件"与"我改文件"撞车，不是产品问题。
判定：**人为窗口，不是 flake**，不再追。
