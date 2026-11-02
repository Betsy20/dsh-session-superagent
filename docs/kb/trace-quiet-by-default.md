# 追溯工具：正常时两行，异常时才展开

## 出处
- 与 [状态文本：默认写「是什么」，异常才写「为什么」](status-text-shows-exceptions.md) 同源：
  dashboard / 日志设计里"默认视图只给结论，细节按需展开"是通行做法
  （Google SRE 书对"signal vs noise"的讨论：<https://sre.google/sre-book/monitoring-distributed-systems/>）。

## 现场
`watch_trace` 原来固定输出 5 类细节（seen / 上次上报 / 被过滤 / 被冷却吸收 / 唤醒尝试），
**正常条目也全打**。客户问"#55 怎么了"，要在一堆行里找那句结论。

## 改法
```js
const quiet = trace.filtered.length === 0 && trace.absorbed.length === 0
  && trace.wakes.length > 0 && trace.wakes.every((w) => w.ok)
if (!quiet) { …完整细节… } else { '  最近一次唤醒：<时间>（成功）' }
```

| 情况 | 输出 |
|---|---|
| 一切正常 | **2 行**：结论 + 最近一次唤醒时间 |
| 有过滤/吸收/失败 | 完整细节（信息量不变） |
| JSON | 不动（机器契约） |

## 判据
**同一个数据，文本给人扫、JSON 给机器读。** 文本可以省，JSON 不能省 ——
两边语义一致即可，不必字段一一对应。

## 是否已落地
✅ 0.9.99。用例：正常两行且不含 `水位 seen`；有失败时展开并带原因。

## 还没做的
- 面板的「判定日志」没有同样处理（它本来就是逐事件列表，形态不同）；
- 没有统计"正常时平均行数"作为回归指标。
