# 重试进度要暴露成状态，而不是藏在日志里

## 出处
Kubernetes Job 的重试策略把关键数字放在 **status** 里：

> The `.spec.backoffLimit` is set by default to **6**. Failed Pods associated with the Job are recreated by
> the Job controller with an **exponential back-off delay (10s, 20s, 40s …) capped at ten minutes**.

<https://kubernetes.io/docs/concepts/workloads/controllers/job/>

两个可借用的点：
1. **默认重试上限 6** —— 和我们 0.9.121 的 `RETRY_BUDGET_ATTEMPTS = 6` 撞上了（巧合，但方向对）；
2. **进度是状态的一部分**：`describe job` 能看到"失败几次、下次什么时候"，不是只能翻日志。

## 现场
0.9.121 把失败后的间隔放慢到最多 2 小时一次。**但面板不写出来的话，客户只看到"它不动了"**——
又把"我们主动放慢"误读成"它坏了"。这与 0.9.96（刚重启 vs 定时器丢了）、0.9.121（放慢 vs 卡住）是同一个病根。

## 改法
面板在 `consecutiveFailures ≥ 1` 时多一行：
```
已连续失败 7 次 · 下次重试约 90 分钟后（已放慢到 2 小时档）
```
数据全部来自 `/state` 里已有的 `consecutiveFailures` / `nextAt` —— **没有新增字段，也没有额外请求**。

## 判据
**凡是"行为变了"的地方，都要有对应的可读状态。**
否则用户只能凭"最近没动静"来猜，而猜错的方向永远是"坏了"。

## 是否已落地
✅ 0.9.122。新增 1 例（失败次数 + 下次重试 + 2 小时档）。

## 还没做的
- 只在总览列表里显示，判定日志/trace 里没有同样的行；
- "2 小时档"写死在文案里，如果以后改 `RETRY_BUDGET_ATTEMPTS` 或上限，这句要同步（目前没有门禁守）。
