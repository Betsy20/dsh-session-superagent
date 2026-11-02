# 旧信息要带年龄，否则它会冒充"刚刚发生"

## 出处
- 时间语义在可观测性里是硬要求：一条没有时间戳的状态**无法判断有效性**。
  Prometheus 的 staleness handling 就是为这件事设计的：
  <https://prometheus.io/docs/prometheus/latest/querying/basics/#staleness>

## 现场
上一轮清掉了「暂停后旧错误永久挂着」，但**没暂停**的守也会有旧错误：
轮询失败一次后不再失败，`lastError` 仍在，面板上看起来像"刚刚又失败了"。
客户看到的红点与「异常」计数，可能是几小时前的记录。

## 改法
1. 所有设置 `lastError` 的地方统一走 `setEntryError()`，顺带记 `lastErrorAt`：
```js
function setEntryError(entry, text) {
  entry.lastError = text
  entry.lastErrorAt = new Date().toISOString()
}
```
2. `/state` 暴露 `lastErrorAt`；
3. 面板分两档显示：
   - 1 小时内：`（3 分钟前） 失败原因…`
   - 超过 1 小时：`旧记录（2 小时前）：失败原因…`

## 判据
**凡是"最后一次 X"的展示，都要配一个"多久之前"。**
否则读者只能假设它发生在刚刚 —— 而这个假设会随着时间推移越来越错。

## 是否已落地
✅ 0.9.112。用例：3 分钟前不标旧记录、150 分钟前标「旧记录」。

## 还没做的
- 只有"错误"带年龄；`lastDeferred`、`cursor`、`lastWake` 在面板上仍无年龄（部分有相对时间）；
- 1 小时这个阈值是拍的，没有依据（可能应该按轮询间隔 × N）。
