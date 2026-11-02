# 把我们对 GitHub 做的事，反过来用在自己的接口上

## 出处
- RFC 9110 §15.4.5（304 Not Modified）：304 响应**不带正文**，客户端沿用本地缓存。
  <https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5>

## 我们怎么用
面板每 5 秒拉一次 `/state`。0.8.84 我们刚把一个满载守从 3.8 KB 减到 2.2 KB，
但「没变化时仍然整份重传」这件事没解决 —— 而 99% 的轮询都是"没变化"。

于是照搬我们对 GitHub 用的那套：
1. 服务端对响应体算 SHA-1 前 16 位作为 `ETag`；
2. 客户端把上次的 ETag 放进 `If-None-Match`；
3. 命中就回 **304 空响应**，客户端保持现状（不 setState、不重渲染）。

## 一个必须注意的坑
响应体里有 `updatedAt: new Date().toISOString()` —— **每次都不一样**，
直接对它算指纹的话 ETag 永不命中。所以指纹基于
`JSON.stringify({ ...stateBody, updatedAt: undefined })`（`undefined` 在序列化时被丢掉）。

## 是否已落地
✅ 0.8.85（服务端 `createHash('sha1')` + `If-None-Match`；客户端 `stateEtag` + 304 短路）。
用例：200 必须带 ETag、同内容回 304 且无正文、ETag 不匹配必须给完整内容。

## 还没做的
- 没有 `Cache-Control: must-revalidate` 之类的语义扩展（我们本来就 `no-store`，ETag 足够）；
- 没做 SSE/WebSocket 推送（收益更大但改动面大，先用条件请求拿到 80% 的收益）。
