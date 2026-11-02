# 不在活跃时段 = 没有新事实，旧结论必须让位

## 出处
- 这是 [暂停之后，旧状态就不该再代表「现在」](paused-means-no-new-facts.md) 的同族问题：
  **任何"不再执行"的路径，都要把"最后一次结果"降级或清掉**，
  否则它会变成一句越来越久远的断言。
- 观测量领域对应概念是 staleness（Prometheus 会主动标记过期的序列）：
  <https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness>

## 现场（真机重启后实测）
```
插件版本: 0.9.116
值守: 1 条 | 启用 | 间隔 120s | 失败 4 | 错误: gh: HTTP 304（没归类的错误…）
上次轮询: 2026-11-02T14:30:50.655Z（5.4 小时前）
lastDeferred: 不在活跃时段（09:00-23:00），597 分钟后开始
nextAt: 2026-11-03T01:00:00.114Z（本地 09:00）
```

这条守的活跃时段是 09:00–23:00，此刻 03:53 —— **根本不会轮询**。
可面板上那条旧错误、红点、「异常」计数全都还在，看起来像"一直在失败"。

上一版（0.9.111）只处理了**手动暂停**：暂停时清错误。但"时段外"是**另一个不轮询的路径**，
它当时没被覆盖。

## 改法
```js
export function enterActiveHoursDefer(entry, waitMs, hours, at = new Date()) {
  entry.nextAt = new Date(at.getTime() + waitMs).toISOString()
  entry.lastDeferred = `不在活跃时段（${hours}），${Math.round(waitMs / 60000)} 分钟后开始`
  entry.deferReason = 'active-hours'
  entry.lastError = null        // 旧错误不是「现在」的事实
  entry.lastErrorAt = null
  entry.consecutiveFailures = 0
  return entry
}
```

**在数据源头清掉，而不是在每个出口各写一遍"如果是时段外就别显示"。**
`lastError` 会被 `/state`、`watch_status`、`watch_doctor` 三个出口读，出口侧写三遍必然漂。

## 判据
**每增加一个"跳过执行"的分支，就要问：这里会不会留下过期的结论？**
本次的教训是：我修了"暂停"，漏了"时段外"——同一个毛病换了个入口。

## 是否已落地
✅ 0.9.117。新增 1 例（进入时段外等待后错误与失败计数归零）。

## 还没做的
- 其它跳过路径（额度紧张 `quota`、被限流 `ratelimit`）仍会保留旧 `lastError`；
- 面板没有"这条信息是几小时前的"统一时间标注（只有错误有 age）。
