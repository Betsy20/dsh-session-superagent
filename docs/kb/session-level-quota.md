# 单个资源的限额，保护不了"总量"

## 出处
- Kubernetes 的 `ResourceQuota`：**单个 Pod 的 limits 不能防止整个 namespace 被打满**，
  所以要在 namespace 级别再加一道配额。
  <https://kubernetes.io/docs/concepts/policy/resource-quotas/>

## 我们的问题（代码里核实过）
`maxWakesPerHour` 记在 **每条守** 自己身上（`entry.wakeTimes`），所以：

```
1 条会话守 5 个仓库 → 实际上限 = 5 × 6 = 30 次/小时
每次最多带 5 条 → 最多 150 条/小时注进同一个会话
```

而当初设这个上限的原因正是"别把会话的上下文打爆" —— 多守叠加后它完全没起作用。

## 改法
新增**会话级上限**（`sessionMaxWakes`，默认 **12**/小时，跨所有守累计）：

```js
sessionUsed = Σ wakes(同 sessionId 的所有守, 最近一小时)
if (sessionUsed >= sessionCap) → 攒着，写清原因
```

提示语：
> 这条会话一小时内已被唤醒 8 次（上限 12），已攒 3 条待处理

三层限额的关系：

| 层 | 字段 | 默认 | 拦截什么 |
|---|---|---|---|
| 单次批量 | `batchLimit` | 5 | 一次别铺开太多 |
| 单守频率 | `maxWakesPerHour` | 6 | 一个仓库别太吵 |
| **会话总量** | `sessionMaxWakes` | **12** | **多个守叠加别爆上下文** |

## 是否已落地
✅ 0.9.2（`watch.js:sessionWakesLastHour` + `pollOnce` 会话级判断 + 面板输入 + `/state` 回传）。
用例：跨守累加、过期不计、单会话 vs 多会话、对象/数组两种入参、空与坏数据不崩。

## 还没做的
- 没有"会话级小时上限也用滑动窗口并给出等待时间"（单守那边已有 `nextWaketimeAt`，可以复用）；
- 没有在面板上显示"本会话过去一小时被唤醒了几次"（数据已经在状态里，接一下即可）。
