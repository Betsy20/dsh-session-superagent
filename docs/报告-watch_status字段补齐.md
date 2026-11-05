# T40 W4：`watch_status` / `statusView()` 可写字段补齐报告

- 仓库版本：`0.9.257`
- 任务日期：2026-11-05
- 本任务改动：`lib/watch.js`、`test/status-view.test.mjs`、本报告
- 未改动：`client.js`、`lib/index.js`、`test/fixtures/contract-stability.json`、`package.json`、版本号、`POLL_RESULT_FIELDS`
- 未执行：commit、push、publish、网络请求、真实 `~/.dsh` 写入

## 1. 修复内容

`statusView()` 的 watcher 投影补齐 11 个可写配置字段。所有值都来自传入的真实 entry；缺省值与现有创建、轮询及 `/state` 投影的口径一致。`priority` 以 `DEFAULT_PRIORITY` 为基底合并 entry 配置，保留面板写入的 `stale` 扩展项。

`labels` 保持原有值语义，但改为返回副本；`ignoreLabels`、`allowAuthors` 同样返回副本。`priority` 也返回新对象，避免调用方修改视图时反向污染 entry。投影没有加入时间戳、随机数等每次调用都会变化的字段。

## 2. 逐字段来源与实测值

| 字段 | entry 来源 | 缺失时默认 | 透传用例实测 | 缺省用例实测 |
|---|---|---|---|---|
| `batchLimit` | `w.batchLimit` | `5` | `3` | `5` |
| `maxWakesPerHour` | `w.maxWakesPerHour` | `6` | `4` | `6` |
| `sessionMaxWakes` | `w.sessionMaxWakes` | `12` | `24` | `12` |
| `isolateKeepDays` | `w.isolateKeepDays` | `3` | `7` | `3` |
| `maxIsolated` | `w.maxIsolated` | `5` | `9` | `5` |
| `ackLabel` | `w.ackLabel` | `DEFAULT_ACK_LABEL`（`主理鱼:已处理`） | `team:done` | `主理鱼:已处理` |
| `workdir` | `w.workdir` | `null` | `D:/repo` | `null` |
| `priority` | `w.priority`，合并到 `DEFAULT_PRIORITY` 副本 | `{ reopened: true, comments: true, labels: true, unassigned: false }` | `{ reopened: false, comments: false, labels: true, unassigned: true, stale: true }` | 与 `DEFAULT_PRIORITY` 深度相等，且不是同一对象引用 |
| `ignoreLabels` | `w.filters.ignoreLabels` | `[]` | `["wontfix", "duplicate"]` | `[]` |
| `assignee` | `w.filters.assignee` | `null` | `octocat` | `null` |
| `allowAuthors` | `w.filters.allowAuthors` | `[]` | `["alice", "bob"]` | `[]` |

## 3. 新增测试覆盖

`test/status-view.test.mjs` 新增 4 条测试：

1. 11 个可写字段全部透传，`priority.stale` 扩展项不丢失。
2. 所有缺省值明确，`priority` 默认形状与 `DEFAULT_PRIORITY` 深度一致且不共享对象。
3. `labels`、`ignoreLabels`、`allowAuthors` 不与 entry 或另一次视图共享修改；双向修改均被隔离。
4. 相同 entry 重复调用返回值深度一致，`JSON.stringify()` 结果逐字一致，满足 ETag 稳定性要求。

## 4. 定向测试实测

命令：

```text
node --test test/status-view.test.mjs
```

退出码：`0`。原始计数输出：

```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 81.9943
```

## 5. 全量测试实测

命令：

```text
npm test
```

该命令经 `node scripts/test.mjs` 设置 `DSH_SUPERAGENT_OFFLINE=1` 与 `DSH_SUPERAGENT_UPDATE_OFFLINE=1`，各用例使用临时状态目录。退出码：`1`。原始计数输出：

```text
ℹ tests 405
ℹ suites 0
ℹ pass 404
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1908.2769
```

唯一失败项原文：

```text
test at test\contract-stability.test.mjs:40:1
✖ 结构化输出的每个字段都在稳定性清单里（新增字段必须登记） (67.6438ms)
  AssertionError [ERR_ASSERTION]: watcher 字段变了：repo,provider,sessionId,enabled,intervalSec,observe,isolated,activeHours,labels,onlyAssigned,batchLimit,maxWakesPerHour,sessionMaxWakes,isolateKeepDays,maxIsolated,ackLabel,workdir,priority,ignoreLabels,assignee,allowAuthors,deferReason,lastDeferred,silentWakes,cursor,lastPoll,lastWake,lastError,lastErrorKind
```

结论：除 contract fixture 尚未登记新增字段外，其余 404 条测试全部通过，符合本任务验收条件。未自行修改 fixture。

## 6. 两项脚本实测

### `node scripts/audit-kb-links.mjs`

退出码：`0`。原始输出：

```text
代码里的 KB 引用：19 处，涉及 18 条
文件：client.js、lib\gh-format.js、lib\index.js、lib\watch.js
---
PASS 每个引用都指到真实条目
PASS 引用数不倒退（19 ≥ 基线 19）
PASS 关键行为类条目都有代码引用（7 条）
```

### `node scripts/measure-state.mjs`

退出码：`0`。原始输出：

```text
守数量 | statusView JSON | 每守平均
---|---|---
1 | 2.4 KB | 2.44 KB
5 | 11.1 KB | 2.22 KB
20 | 43.8 KB | 2.19 KB
50 | 98.0 KB | 1.96 KB
100 | 173.4 KB | 1.73 KB
---
PASS 20 条守（现实上限）43.8 KB ≤ 50 KB；生成耗时 0.1 ms
```

## 7. 主代理需要登记的 fixture 字段

位置：`test/fixtures/contract-stability.json` → `watch_status.watcher`。需要登记的新增字段共 11 个：

```text
batchLimit
maxWakesPerHour
sessionMaxWakes
isolateKeepDays
maxIsolated
ackLabel
workdir
priority
ignoreLabels
assignee
allowAuthors
```

这些字段都是供模型自查配置的契约字段，建议登记为 `stable`。本报告仅列出清单，未改 fixture。
