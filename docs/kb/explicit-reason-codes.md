# 别用"匹配提示文案"当数据源

## 出处
- 这是"把展示层当数据层"的经典反模式。对照 OpenTelemetry 的做法：
  **事件带结构化的 `attributes`**（机器可读），文案只负责给人看
  <https://opentelemetry.io/docs/concepts/signals/logs/>。
- 一旦拿文案当判据，任何一次文案优化都会悄悄改变统计数据 —— 而且是**静默的**。

## 本轮修的
0.9.20 里统计"有几条守被上限挡住"是这么写的：

```js
const capped = list.filter((w) => typeof w.lastDeferred === 'string'
  && (w.lastDeferred.includes('上限') || w.lastDeferred.includes('一小时内已被唤醒'))).length
```

问题：① 文案一改统计就归零；② "额度紧张（剩余 …）"这种含"上限"但**不是频率上限**的提示会被误算；
③ 客户改语言/我们改措辞都会影响数字。

## 改法
服务端在每个暂停分支写 `entry.deferReason`：

| 原因码 | 场景 |
|---|---|
| `active-hours` | 不在活跃时段 |
| `ratelimit` | 被 GitHub 限流（按 Retry-After 等） |
| `quota` | 额度紧张 |
| `unchanged` | 304 未变化 |
| `observe` | 仅观察 |
| `cap-session` | 撞会话级小时上限 |
| `cap-watcher` | 撞单守小时上限 |
| `busy` | 会话忙，唤醒被拒 |

统计改成 `countCapped(list)`（只认 `cap-session` / `cap-watcher` 两种码），
`/state` 也把 `deferReason` 回传，面板直接读字段。

## 一个真实的误判例子（用例里锁住了）
```js
countCapped([{ lastDeferred: '每小时最多唤醒 6 次' }]) === 0
```
—— 文案里明明写着"上限"，但没有原因码就不算。这正是旧实现的误判来源。

## 是否已落地
✅ 0.9.21。用例：两种 cap 码计数为 2、`ratelimit`/`null`/无字段不计、对象入参可用、空输入为 0；
`/state` 契约用例断言每条守都带 `deferReason`（新守为 `null` 而不是 `undefined`）。

## 还没做的
- 面板的「暂停唤醒」提示仍在展示 `lastDeferred` 文案（正确用法），没有把原因码做成可筛选的 Pill；
- `deferReason` 目前没有进时间线事件（事件里已经有 kind，重复度较高）。
