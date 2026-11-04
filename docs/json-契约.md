# JSON 契约（由 `scripts/render-contract.mjs` 生成，不要手改）

所有工具都支持 `format: 'json'`，返回带 `schemaVersion` 的对象（当前 `1`）。

**稳定性**：`稳定` = 不会无故改名或删除；`实验` = 可能变化，请容忍缺失。

## watch_status

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `session` | 稳定 |
| `watchers` | 稳定 |

**`session`**

| 字段 | 稳定性 |
|---|---|
| `id` | 稳定 |
| `used` | 稳定 |
| `cap` | 稳定 |
| `capped` | 稳定 |
| `suggest` | 稳定 |

**`watchers[]` 每条**

| 字段 | 稳定性 |
|---|---|
| `repo` | 稳定 |
| `provider` | 稳定 |
| `sessionId` | 稳定 |
| `enabled` | 稳定 |
| `intervalSec` | 稳定 |
| `observe` | 稳定 |
| `isolated` | 稳定 |
| `activeHours` | 稳定 |
| `labels` | 稳定 |
| `onlyAssigned` | 稳定 |
| `deferReason` | 稳定 |
| `lastDeferred` | 实验 |
| `silentWakes` | 稳定 |
| `cursor` | 实验 |
| `lastPoll` | 稳定 |
| `lastWake` | 稳定 |
| `lastError` | 稳定 |

## watch_doctor

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `checks` | 稳定 |

**`checks[]` 每条**

| 字段 | 稳定性 |
|---|---|
| `status` | 稳定 |
| `text` | 稳定 |

## watch_trace

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `number` | 稳定 |
| `results` | 稳定 |

**`results[]` 每条**

| 字段 | 稳定性 |
|---|---|
| `number` | 稳定 |
| `repo` | 稳定 |
| `seen` | 稳定 |
| `reported` | 稳定 |
| `filtered` | 稳定 |
| `wakes` | 稳定 |
| `verdict` | 稳定 |
| `absorbed` | 稳定 |

**`filteredItem`**

| 字段 | 稳定性 |
|---|---|
| `at` | 稳定 |
| `reason` | 稳定 |
| `title` | 实验 |

**`wakeItem`**

| 字段 | 稳定性 |
|---|---|
| `at` | 稳定 |
| `ok` | 稳定 |
| `reason` | 稳定 |

**`absorbedItem`**

| 字段 | 稳定性 |
|---|---|
| `at` | 稳定 |
| `title` | 实验 |

## watch_start

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `ok` | 稳定 |
| `repo` | 稳定 |
| `sessionId` | 稳定 |
| `id` | 稳定 |
| `intervalSec` | 稳定 |
| `flags` | 稳定 |
| `filters` | 稳定 |
| `updated` | 稳定 |
| `observe` | 稳定 |
| `isolated` | 稳定 |
| `activeHours` | 稳定 |
| `repos` | 稳定 |

**`reposItem`**

| 字段 | 稳定性 |
|---|---|
| `repo` | 稳定 |
| `id` | 稳定 |
| `updated` | 稳定 |

## watch_stop

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `ok` | 稳定 |
| `id` | 稳定 |
| `repo` | 稳定 |

## watch_ack

**顶层**

| 字段 | 稳定性 |
|---|---|
| `schemaVersion` | 稳定 |
| `ok` | 稳定 |
| `repo` | 稳定 |
| `label` | 稳定 |
| `acked` | 稳定 |
| `at` | 稳定 |
| `labelNote` | 稳定 |

---

新增字段必须登记在 `test/fixtures/contract-stability.json`，否则 `node --test` 会红；
这份文档由清单生成，跑 `node scripts/render-contract.mjs --write` 刷新。
