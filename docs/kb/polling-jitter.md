# 抖动：别让所有守在同一条时间线上发车

## 出处
- AWS Architecture Blog《Exponential Backoff And Jitter》：<https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/>
  要点：多个客户端按固定周期重试/轮询时，会**同步**（thundering herd）；加入抖动（jitter）把峰值摊平。
- 交叉印证：GitHub REST 最佳实践要求「固定节奏轮询」，但社区实现普遍在固定节奏之上加抖动。
  <https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>
- 抓取时间：2026-11-02。

## 它怎么做的
给每个客户端的**首次**触发加一个随机（或哈希）偏移，之后保持自己的节奏。
关键是「只错开起始点」，不要每次 tick 都随机，否则节奏抖动会让调试和限流判断都变难。

## 我们能怎么用
主理鱼可能有 N 条守，间隔都设 60s —— 一旦同时启动（重载后尤其明显），
它们会在同一毫秒一起打 `gh api`。我们的 `inFlight` 闸是**按 watcher** 的，挡不住跨 watcher 的并发。

改法：`jitterMs(entry.id, max)` 用 **id 哈希**算偏移（可复现，不是随机数），
范围 0 ~ min(5000ms, 间隔的 10%)；只有**首轮**延迟，之后按 `every` 稳定推进。

## 是否已落地
✅ 0.8.52（`lib/watch.js:jitterMs` + `lib/index.js` 的 `startWatcher`）。
用例：同 key 稳定、落在窗口内、20 条守能散开（>8 个不同偏移）。

## 附带的一份实测（说明我们没白改）
- 单条 watcher 满载状态（seen 500 + history 20 + filteredLog 5）≈ **21.8 KB**，10 条 ≈ **218 KB** —— 有上限，不会无限涨；
- `gh api` 与 `gh api --include` 稳态耗时几乎相同（~500-650 ms，首次冷启动是异常值），
  说明 0.8.51 引入 `--include` 没有带来额外开销；真正的大头是进程启动 + 网络。
