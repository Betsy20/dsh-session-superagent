# 先量再裁：/state 的体积是从 3.5 KB/守开始算的

## 出处
- 性能优化第一原则：**先测量再优化**（Knuth 的"过早优化是万恶之源"常被误引，
  但"先测量"这半句才是重点；Wirth/Van Deursen 的"性能工程"方法论同此：
  <https://en.wikipedia.org/wiki/Program_optimization#When_to_optimize>）。

## 先量（`scripts/measure-state.mjs`）
按 `/state` 的**真实形状**建模（比 `statusView` 多 `filteredLog(5)` / `history(5)` / `events(20)`）：

| 守数量 | 修改前 | 修改后 |
|---|---|---|
| 1 | 3.7 KB | 2.1 KB |
| 5 | 17.5 KB | 9.6 KB |
| 20 | 69.6 KB | **37.8 KB** |
| 50 | 173.7 KB | 82.8 KB |
| 100 | **347.3 KB** | 143.0 KB |

**3.5 KB/守 → 1.4 KB/守**，`events` 每守 20 条是主因。

⚠️ 第一版测量只量了 `statusView`，得出"100 条守 35 KB，不用改" ——
**量错了对象**，差点得出相反结论。

## 改法
```js
const perWatcher = Math.max(1, Math.min(6, Math.floor(240 / allWatchers.length)))
events: (w.events ?? []).slice(-perWatcher)
```
守越多，每守分到的越少（100 条守时每人 2 条），总量恒定 ≤ 240。

## 判据按"现实上限"定
面板是会话级的，一个会话挂 20 条守已经很极端 → 上限取 **50 KB @ 20 条守**。
100 条守不是目标，**不为了它把字段砍到没法用**。判据写进脚本注释，不是拍脑袋。

## 是否已落地
✅ 0.9.88。新增 1 例（40 守 × 20 事件 → 每守 ≤ 6、总数 ≤ 240）。

## 还没做的
- `/state` 没有 ETag/304（此前做过 conditional request 的探索，未用到自己的 API）；
- 面板渲染耗时没测（只测了 JSON 生成，0.5 ms）。
