# 给 agent 的输出要能结构化，但不能只有结构化

## 出处
- CLI 的通用做法：**默认给人看，`--json` 给机器**（`gh`、`kubectl -o json`、`docker inspect` 都是这个形态）。
- 好处很具体：解析方不再依赖文案（我们改一次措辞，字符串匹配就崩）。

## 之前的形态
`watch_status` 直接拼字符串返回：
```
o/a → s1 | every 60s | defer=cap-session ...
```
agent 只能靠正则/子串解析 —— **文案一改，agent 的解析就静默失效**。

## 改法（同一份数据，两种渲染）
1. 纯函数 `statusView(entries)` 产出结构：
   ```js
   { session: { id, used, cap, capped, suggest },
     watchers: [{ repo, sessionId, enabled, intervalSec, observe, isolated,
                  activeHours, labels, onlyAssigned, deferReason, silentWakes,
                  cursor, lastPoll, lastWake, lastError }] }
   ```
2. `watch_status` 加参数 `format`：`text`（默认，人读）/ `json`（机器读）；
3. **文本由结构渲染**，所以两者永远对得上（不是两份独立实现）。

## 为什么默认仍是文本
- 老调用方不受影响；
- 人看文本更快，JSON 反而要多一步解析。

## 用例
- `statusView` 结构：两个守、暂停态、observe、labels、onlyAssigned、空输入；
- 工具：`format=json` 可 `JSON.parse` 且字段对得上；不带参数仍是文本（含 `session:` 行）。

## 是否已落地
✅ 0.9.43。测试 178 → 180。

## 还没做的
- 其它工具（`watch_doctor`、`watch_trace`）还没加 `format`；
- 没有定义 JSON schema 版本号（将来改字段，消费方无从判断）。
