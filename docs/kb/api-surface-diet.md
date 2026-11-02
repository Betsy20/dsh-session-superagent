# 接口也要做减法：/state 少传 3 个没人读的字段

## 出处
- GitHub 的 API 弃用实践：用 `Deprecation` / `Sunset` 响应头先告知、再移除，而不是突然删字段。
  <https://docs.github.com/en/rest/using-the-rest-api/api-versions>
- 反过来的教训同样成立：**从没人读的字段开始删是最安全的**（客户端根本没引用 → 零风险）。

## 我们怎么做的审计
写了个一次性脚本，把 `/state` 的投影字段逐个在 `client.js` 里数引用次数：

```
  0 cooldownMs
  0 wakeTimes
  0 lastBatch
  1 triageSignals, 1 lastWorktree
```

三个字段 **0 次引用** —— 客户端从来没读过。

## 数字（一条满载守）
| | 体积 |
|---|---|
| 含 `cooldownMs`/`wakeTimes`/`lastBatch` | **3.8 KB** |
| 去掉这三个 | **2.2 KB** |

单条省 **1.6 KB**，10 条守省 **16.9 KB / 次**。面板每 5 秒拉一次 `/state`，
一小时 ≈ 720 次 → **≈ 12 MB/小时** 的无用流量（10 条守的情况）。

## 是否已落地
✅ 0.8.84：`/state` 不再回传这三个字段（**状态文件里保留**，服务端 `wakeTimes` 仍用于限流）。
回归用例锁住：`/state` 里出现 `wakeTimes` / `cooldownMs` / `lastBatch` 就红；
同时确保 `id` / `repo` / `intervalSec` / `enabled` / `filters` / `priority` / `history` 仍在。

## 还没做的
- `triageSignals`、`lastWorktree` 各 1 次引用 —— 有用途，保留；
- 没做 `/state` 的增量推送（只在有变化时返回），那需要改成 SSE/WebSocket，收益更大但改动面也大。
