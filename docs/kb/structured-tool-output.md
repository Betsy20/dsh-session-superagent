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

## 0.9.44 追加：三个只读工具口径统一
- `watch_status` / `watch_doctor` / `watch_trace` **都**支持 `format=json`；
- 三者都带 `schemaVersion: 1` —— 将来改字段，消费方能判断语义有没有变；
- **错误也走 JSON**：`{ schemaVersion, error }`，消费方不用在两种格式之间猜；
- `watch_doctor` 的 JSON 从**同一份文本行**解析（`OK/WARN/FAIL/INFO` 前缀），
  不是另写一套判断 —— 单一来源，改一处两边都变。

用例：三个工具的 `format` 参数都在 schema 里；`status`/`doctor` 可解析且带版本；
`trace` 在"没有守"时也返回 JSON 错误；建守后 `results` 是数组。

## 0.9.46 追加：写工具也走 JSON
`watch_start` / `watch_stop` / `watch_ack` 补上 `format: 'json'`：

| 场景 | JSON |
|---|---|
| start 成功 | `{ schemaVersion, ok: true, repo, id, intervalSec, flags, updated }` |
| stop 成功 | `{ schemaVersion, ok: true, id }` |
| ack 成功 | `{ schemaVersion, ok: true, repo, label, acked, at }` |
| 任何失败 | `{ schemaVersion, ok: false, error }`（ack 还带 `failed.number`） |

**为什么重要**：以前 agent 判断"到底成功没有"只能读中文（`acked …` / `stopped …`），
一旦我们改措辞它就误判。现在 `ok` 是布尔真值，不依赖文案。

## 还没做的
- 没有把 `schemaVersion` 写进 README 的对外契约（消费方要自己发现）；
- 面板不吃 JSON（它走 `/state`），两边字段仍靠用例对照。
