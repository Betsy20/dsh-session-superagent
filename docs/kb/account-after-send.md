# 记账要放在"真的做到"之后，不是"打算做"的时候

## 出处
- 这一类错误在分布式系统里有个名字：**把"写日志"当成了"写数据"**。
  经典做法是先做动作、再做可观测的记账；顺序反了，记账就会撒谎
  （同源讨论见 AWS《Timeouts, retries, and backoff》里"幂等与可观测性"一节：
  <https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/>）。
- 更贴切的类比：付款流程不能"下单即扣款"，得"支付成功才扣款"。

## 我们自己造出来的 bug（0.9.3 引入）
加合并窗口时，我把记账写在了**入队**处：

```js
const result = wakeMerged(ctx, entry.sessionId, wakeText)  // 只是入队，返回 ok:true
if (result.ok) { entry.wakeTimes.push(Date.now()); entry.seen = advanceSeen(seen, fresh); … }
```

后果（两处都严重）：
1. **丢消息**：`seen` 水位在入队时就推进了。3 秒后真要发送时，若会话不是 idle，
   `decideWake` 会拒绝 —— 那几条**永远不会重试**（水位已过）。
2. **虚报次数**：`wakeTimes` 提前记了一次，撞到「每小时上限」时会把真正该唤醒的挡掉。

## 改法
把记账整体挪进回调，只有 `wake()` 真正返回才生效：

```js
wakeMerged(ctx, entry.sessionId, wakeText, (result) => {
  if (result.ok) { wakeTimes.push(now); seen = advanceSeen(...) }
  else { lastError = …; 会话忙则下一轮重试 }
  persistEntry(entry)
})
```

顺带把合并窗口做成可配（`DSH_SUPERAGENT_WAKE_WINDOW_MS`），测试里压到 5 ms ——
否则每个用例都得等 3 秒。

## 是否已落地
✅ 0.9.5。新增 `test/wake-accounting.test.mjs`：
- 会话忙 → 回调必须 `ok:false`（调用方据此不记账、不推进水位）；
- 会话 idle → `ok:true`，且同窗口两条**只发一次**、内容都在。

## 还没做的
- 发送失败后没有"重试队列"，仍依赖下一轮轮询（对 60 秒间隔可接受）；
- 没有把"入队未发送"的状态暴露到面板（只在 `lastDeferred` 里写"会话正忙"）。
