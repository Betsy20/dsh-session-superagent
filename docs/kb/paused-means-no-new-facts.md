# 暂停之后，旧状态就不该再代表"现在"

## 出处
- 状态新鲜度（staleness）是监控系统的老问题：**一个不再更新的状态，其展示必须降级或标注时间**，
  否则它会被读成"当前事实"。
  （Prometheus 的 staleness 处理就是这个思路：<https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness>）

## 现场（从截图那条误报想到的）
304 误报修好之后，还有个遗留问题：**暂停的守不再轮询**，旧的 `lastError` 就永远挂在面板上。
客户看到的红点与「异常」计数，其实是几小时前的旧记录 —— 而"现在"根本没有失败。

## 改法
暂停 / 恢复时清掉瞬时状态：
```js
if (body.enabled === false || body.enabled === true) {
  entry.lastError = null
  entry.deferReason = null
  entry.lastDeferred = null
  entry.consecutiveFailures = 0
  entry.nextAt = null
}
```

## 判据
**凡是"最后一次结果"的字段，都要回答：它还会被更新吗？**
- 会 → 可以当"现在"；
- 不会（暂停/停用/放弃）→ 必须清掉，或至少带上时间戳，否则它会变成一句永久的谎。

## 顺带：给"第三类装死"加了全库扫描
`scripts/audit-exit-codes.mjs`：扫 `scripts/*.mjs`，**打印了 FAIL 却没返回非 0** 的一律报出来。
验证方式：把 `audit-promises.mjs` 里两处 `process.exitCode = 1` 全换成 `void 0` → 立刻红；
还原后 PASS。已接进 `preflight` 第 36 项。

## 是否已落地
✅ 0.9.111。

## 后续（0.9.130，真机复验发现）
重启后实测：启用的那条守已经成功轮询（`lastError` 清空、`nextAt` 归 null），
**但另一条更早就暂停的守仍然挂着旧错误** —— 0.9.111 只在「暂停动作发生时」清，
这条守是在那之前暂停的，错误就冻在状态文件里了。

于是加了 `normalizePaused()`：`readState()` 读出来时对 `enabled === false` 的条目清掉
`lastError` / `lastErrorAt` / `consecutiveFailures` / `needsReauth`（幂等，下次写盘自然带走）。

**教训：修"动作发生时"的行为不够，历史数据也要归一。** 否则老数据会一直按老逻辑呈现。

## 还没做的
- 其它状态字段（如 `cursor`、`lastDeferred`）在一段时间不轮询后仍会显示旧值；
- 归一发生在读路径，磁盘上的旧字段要等下一次写盘才真正消失。
