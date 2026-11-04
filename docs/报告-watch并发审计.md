# lib/watch.js 并发与错误路径审计（只读）

> 审计对象：`D:\主工作区\projects\dsh-session-superagent`，基线提交 `dc2b612`（版本 0.9.193）
> 方式：只读（本报告是本次唯一新增的文件），所有结论都给了行号、原文、触发条件与复现命令。
> 门禁：`DSH_SUPERAGENT_OFFLINE=1 node --test` → **331 tests / 331 pass / 0 fail**（真实输出见文末附录 A）。
> 行号说明：`lib/watch.js` 自审计开始（05:34）起未被改动；`lib/index.js` 在 05:37 被另一个并发会话改过一行（`SERVER_VERSION` 0.9.193→0.9.194，同一行替换，不产生行号漂移），所以下面的 `index.js:行号` 在 0.9.194 上仍然对得上。

## 0. 先把前提摆正：并发与错误路径的真实位置

`lib/watch.js` **没有任何定时器，也没有任何 I/O**。文件头第 1–6 行写得很明确：

```js
1: /**
2:  * Pure watcher logic — no I/O, no timers, no Cordis.
3:  *
4:  * Kept separate so the behaviour that matters (what counts as news, when a wake
5:  * is allowed, what the wake text says) is unit-testable without a DSH host.
6:  */
```

实测：

```bash
$ grep -c "setInterval\|setTimeout" lib/watch.js
0
$ grep -n "setInterval\|setTimeout\|clearInterval" lib/index.js
565:    const timer = setTimeout(() => {          # run() 的子进程超时
1489:    timers.set(entry.id, setInterval(tick, every).unref?.())
1494:      const boot = setTimeout(() => { tick() }, firstDelay)
1506:    clearInterval(timer)
1559:    for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
2056:    for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
2097:  const sweepHandle = setInterval(sweepTrigger, 5000)
2707:      if (timer) { clearInterval(timer); timers.delete(id) }
```

所以下面「必须修」里，**M1 / M4 的病灶在 watch.js**（纯函数），**M2 / M3 的病灶在 watch.js 的白名单契约**，但并发现场在 `lib/index.js` 的 `persistEntry` / `watch_ack`。按调用链给位置，不按文件名给位置。

---

## 一、必须修

### M1 `POLL_RESULT_FIELDS` 还漏 13 个字段 —— 上一轮补的 `lastReopened`/`lastStates` 只是同一类漏的两个

**位置**：`lib/watch.js:560-569`（白名单）、`lib/watch.js:575-581`（合并）、`lib/index.js:396-406`（唯一写回路径）

```js
560: export const POLL_RESULT_FIELDS = [
561:   'lastPoll', 'lastError', 'nextAt', 'consecutiveFailures', 'seen', 'cursor', 'lastReported',
562:   'lastWake', 'lastWakeCount', 'lastBatch', 'lastAbsorbed', 'wakeTimes', 'lastDeferred',
563:   'history', 'lastWorktree', 'lastAcked', 'lastTrigger',
564:   // 过滤记录也是轮询结果：漏了它面板上的「最近被过滤」永远是空的
565:   'filteredLog',
566:   // lastReopened / lastStates 是「这一轮判出重新打开」的产物：漏了它们，
567:   // /state 永远回 null，面板上的 ⚠ 与 problems 也永远不出现（对 GitHub 同样成立）。
568:   'lastReopened', 'lastStates',
569: ]
```

```js
575: export function mergePollResult(stored, polled) {
576:   const merged = { ...(stored || {}) }
577:   for (const key of POLL_RESULT_FIELDS) {
578:     if (polled && polled[key] !== undefined) merged[key] = polled[key]
579:   }
580:   return merged
581: }
```

**触发条件**：任何一次轮询只要「在内存 entry 上写了白名单外的字段」，`persistEntry()` 走 `mergePollResult(stored, entry)` 时就把它丢掉 —— 不报错、不记日志、面板读到的是默认值。

**被丢的 13 个字段（全部有赋值点，全部读不到）**：

| 字段 | 写入点 | 被谁读（读盘） | 现场表现 |
|---|---|---|---|
| `etag` | index.js:1154 | index.js:1056 | 条件请求永远不带 `If-None-Match` → 每轮全量拉取，白烧 API 额度 |
| `needsReauth` | index.js:1034/1089 等 | index.js:1640、2284 | `watch_doctor` 的「凭证失效」分支永不触发 |
| `lastErrorAt` | index.js:54（`setEntryError`） | index.js:1639 | 面板「12 分钟前的错误」永远显示 `null` |
| `deferReason` | index.js:1028/1067/1111 等 | index.js:1641、watch.js:880-883 | `countCapped()` 恒 0 →「N 条守正因上限暂停」永不出现 |
| `silentWakes` | index.js:1376 | watch.js:1036、index.js:1644 | 「叫醒 N 次没回音」永远 0 |
| `prevWakeAt` | index.js:1382 | index.js:1377 | 无回音判定的基准永远缺失 |
| `dailyWakes` | index.js:1384 | index.js:1642-1643 | 过去 7 天总量/日均永远 `null` |
| `absorbedLog` | index.js:1222 | watch.js:917 | `watch_trace` 的「被冷却期吸收」永远查不到 |
| `filterCounts` | index.js:1187/1191/1196 | index.js:1623 | 面板「本轮跳过 N 条」永远 `{}` |
| `repoAccess` | index.js:1432/1443/1858 | index.js:1624、watch.js:862 | 只读仓库的徽标/权限提示永不出现 |
| `sessionMissingSince` | index.js:1292/1304 | （仅内存） | 进程重启后 10 分钟宽限期重新计时 |
| `minIntervalSec` | index.js:1102/1104 | index.js:424/1476 | `x-poll-interval` 的硬下限每次重启丢失 |
| `lastCleanupAt` | index.js:515 | index.js:514 | 隔离区回收节流失效（每次唤醒都跑 git） |

**怎么确认的**：把「盘上记录」和「轮询后的 entry」喂给真实的 `mergePollResult`，看谁没了。脚本见附录 B（`/tmp/watch-audit-proof.mjs`，跑完已删），实测输出：

```
白名单条数        : 20
轮询写进 entry 的字段数: 16
落盘时被丢掉的字段 : etag, needsReauth, lastErrorAt, deferReason, silentWakes, prevWakeAt, dailyWakes, absorbedLog, filterCounts, repoAccess, sessionMissingSince, minIntervalSec, lastCleanupAt
写回后 etag       : undefined   needsReauth: undefined   deferReason: undefined
写回后 /state 读的 : dailyWakes= undefined  silentWakes= undefined  lastErrorAt= undefined
```

**为什么现有 331 条测试挡不住**：`test/watch.test.mjs:1480-1482` 只钉了上一轮补进去的两个字段：

```js
1480:   const { mergePollResult, POLL_RESULT_FIELDS } = await import('../lib/watch.js')
1481:   assert.ok(POLL_RESULT_FIELDS.includes('lastReopened'), 'lastReopened 要在白名单里')
1482:   assert.ok(POLL_RESULT_FIELDS.includes('lastStates'), 'lastStates 要在白名单里')
```

测试是「枚举已知字段」，而 bug 是「未知字段」—— 全绿和「白名单完整」之间没有因果关系。

**修法方向**（不在本次改动范围）：白名单改成黑名单（`CONFIG_FIELDS` 之外全写回），或给 `persistEntry` 加一条「entry 有、merged 没有」的断言，让漏字段在测试里直接炸。

---

### M2 `watch_ack` 推进的水位，被并发 tick 的 `persistEntry` 回退 → 同一条被重复唤醒

**位置**：`lib/index.js:2184-2193`（ack 写盘）与 `lib/index.js:396-406`（tick 写盘）

```js
2184:       const latest = readState()
2185:       const live = latest.watchers && latest.watchers[entry.id]
2186:       const nowIso = new Date().toISOString()
2187:       if (live) {
2188:         live.seen = advanceSeen(live.seen, results.map((number) => ({ number, updated_at: nowIso })))
2189:         // 打标签本身就是一次外部更新，把光标推到当下，避免自己把自己叫醒
2190:         live.cursor = nowIso
2191:         live.lastAcked = { numbers: results, label, at: nowIso }
2192:         writeState(latest)
2193:       }
```

```js
396: function persistEntry(entry) {
397:   try {
398:     const state = readState()
399:     state.watchers = state.watchers || {}
400:     const stored = state.watchers[entry.id]
401:     // Deleted between the tick start and its write-back: never resurrect it.
402:     if (!stored) return
403:     state.watchers[entry.id] = mergePollResult(stored, entry)
404:     writeState(state)
405:   } catch {}
406: }
```

**触发条件**：一次 tick 正在跑（`gh` 超时上限 45 秒，index.js:1057），这期间 `watch_ack` 把 `seen`/`cursor` 推到「现在」；tick 收尾时 `persistEntry(entry)` 用**轮询开始时的那份内存快照**覆盖 `seen`/`cursor`（两者都在白名单里）—— ack 的水位被写回旧值，且**不会自愈**（tick 从不回读 `entry.seen`）。

**后果**：`lastReported` 的时间戳是新的，所以默认 180 秒冷却期会先吸收一次；**3 分钟一过，同一条又被算成 fresh 再唤醒一次**。这正是「叫醒了没回音」和「重复唤醒」的上游。

**怎么确认的**：用真实的 `mergePollResult` + `partitionItems` 复现水位回退（附录 B 脚本第 2 段）：

```
ack 之后盘上 seen[42] : 2026-11-05T05:00:00.000Z
tick 回写后 seen[42] : 2026-11-05T04:59:00.000Z   cursor: 2026-11-05T04:59:00.000Z
水位后退了？         : true
下一轮是否又算出 fresh : [42]
```

**注**：`watch_start`（index.js:2591-2594）和面板编辑（index.js:1860-1868）都是「先 `writeState` 再 `stopWatcher/startWatcher`」，那条路径下 entry 是刚读的，不会回退；**只有 ack 这条「外部写」的路径会**。

**修法方向**：`persistEntry` 里对 `seen`/`cursor`/`lastReported` 取「盘上与新值的时间更大者」，而不是无脑覆盖。

---

### M3 `persistEntry` / `writeState` 的 `catch {}` 把「写盘失败」变成「写成功了」

**位置**：`lib/index.js:396-406`、`lib/index.js:205-209`

```js
205:     if (!existsSync(STATE_FILE + '.bak')) {
206:       try { writeFileSync(STATE_FILE + '.bak', text) } catch {}
207:     }
208:     return merged
209:   } catch { return state /* state is best-effort: a failed write must not break a turn */ }
```

**触发条件**：磁盘满、`STATE_DIR` 不可写（EACCES/EPERM）、目录被占（Windows 上杀毒/索引器锁 `.tmp` 或 `rename` 失败）。`writeState` 全部 swallow，`persistEntry` 再 swallow 一层。

**后果（这才是关键）**：`persistEntry` 的唯一调用点是 tick 的 `finally`（index.js:1483-1486），而**唤醒已经发出去了**（`wakeMerged` 在 1408 行的回调里才 `persistEntry`）。写盘一失败，`seen` / `wakeTimes` / `history` 全部没落盘，下一轮 `partitionItems` 重新把这些条目算成 fresh → **重复唤醒 + 唤醒预算被重复扣**，而 `lastError` 是「成功」的（因为异常在 merge 之后才进 catch）。这就是「错误被转成假成功」的教科书形态。

**怎么确认的**：把 `DSH_SUPERAGENT_STATE` 指到一个「父级是文件」的路径，调真实的 `writeState`（附录 B 脚本第 4 段）：

```
writeState 有抛异常吗 : 没有（调用方拿到返回值就以为写成功了）
返回值 watchers 键数   : 1
状态目录真的建出来了吗 : false
```

**修法方向**：`writeState` 返回 `{ok:false,error}`（或抛），`persistEntry` 至少把失败写进 `entry.lastError` 并在 `/state` 上暴露 `stateWriteFailed`。

---

### M4 `pruneWakeTimes` 只防了 `null`，没防「不是数组」——手写坏的 `wakeTimes` 会把 `/state` 整条打挂

**位置**：`lib/watch.js:413-416`

```js
413: export function pruneWakeTimes(times, now = Date.now()) {
414:   const floor = now - 60 * 60 * 1000
415:   return (times || []).map(Number).filter((t) => Number.isFinite(t) && t >= floor)
416: }
```

同文件里所有兄弟函数都做了 `Array.isArray` 兜底，只有它没有：

```js
301: export function pushAbsorbed(log, items, at, max = 20) {
302:   const list = Array.isArray(log) ? log.slice() : []
```

**触发条件**：`watchers.json` 里 `"wakeTimes": "abc"` 或 `"wakeTimes": {}`（手工编辑、旧版本写的、或用 `echo` 拼出来的）。`readState` 只归一 `normalizePaused` / `normalizeAckLabel`（index.js:128），不碰它。

**后果**：`(times || []).map` 对字符串/对象是 `undefined` → `TypeError`。两条路都炸：

1. `pollWithItems` 的 `entry.wakeTimes = pruneWakeTimes(entry.wakeTimes)`（index.js:1264）→ 被 tick 的 `catch` 接住（index.js:1478-1482）→ 进永久退避（30 分钟 → 2 小时，`RETRY_SLOW_CAP_MINUTES=120`）→ **这条守从此不再唤醒任何人，面板上只有一条错误**；
2. `/state` 的 `sessionWakesLastHour(list, focusSession)`（index.js:1659）和 `watch_status`（watch.js:1006-1043）→ **整个面板 500，所有守一起看不见**。

**怎么确认的**（附录 B 脚本第 3 段，真实输出）：

```
"abc"（字符串） → 抛了： TypeError: (times || []).map is not a function
{}（对象） → 抛了： TypeError: (times || []).map is not a function
sessionWakesLastHour → 抛了： TypeError: (times || []).map is not a function （/state 整条接口挂掉）
```

**修法方向**：`const list = Array.isArray(times) ? times : []`，与 `pushAbsorbed` / `pushHistory` / `pushEvent` 保持一致。

---

## 二、值得改

### W1 首轮的 `boot` 定时器没有纳入 `timers` —— 暂停/删除后仍会 tick 一次

```js
1488:     // unref：宿主本来不会退出，但测试进程不该被这个定时器吊住
1489:     timers.set(entry.id, setInterval(tick, every).unref?.())
1490:     // DSH_SUPERAGENT_NO_POLL=1 只登记不轮询（路由层单测用，避免真去请求 GitHub）
1491:     if (process.env.DSH_SUPERAGENT_NO_POLL === '1') return
1492:     // 首轮按确定性抖动错峰（0~5 秒），之后按 every 稳定推进
1493:     if (firstDelay > 0) {
1494:       const boot = setTimeout(() => { tick() }, firstDelay)
1495:       boot.unref?.()
1496:     } else {
1497:       tick()
1498:     }
```

`stopWatcher`（index.js:1503-1509）只 `clearInterval(timers.get(id))`，`boot` 不在 `timers` 里，**没有句柄可清**。触发：建守后 0–5 秒内暂停/删除（index.js:1768 只 `stopWatcher`）。`tick` 第 1467 行检查的是**闭包捕获的旧 entry**（暂停改的是 `readState()` 出来的另一个对象），`enabled` 仍是 `true` → 照样 `pollOnce` 打一次 GitHub；`pollWithItems` 在 1279-1283 会以盘上为准拦住唤醒，但 `lastPoll` 已经写回那条暂停的守。
影响有限（不复活、不真唤醒），所以不进「必须修」。

### W2 `enabled: "false"`（字符串）不会暂停 —— 到处都是 `=== false`

```js
1467:       if (entry.enabled === false) return
1841:           entry.enabled = body.enabled === undefined ? (entry.enabled !== false) : body.enabled !== false
```

实测（附录 B 脚本，`enabled` 是字符串/0/null 四种坏值）：

```
enabled:"false" + intervalSec:"abc"        会轮询=true  实际间隔=60s  面板显示 enabled=true
enabled:0 + intervalSec:0                  会轮询=true  实际间隔=60s  面板显示 enabled=true
enabled:"no" + intervalSec:-5              会轮询=true  实际间隔=30s  面板显示 enabled=true
enabled:null + intervalSec:null            会轮询=true  实际间隔=60s  面板显示 enabled=true
```

`intervalSec` 的坏值被 `Math.max(30, Number(x) || 60)` 安全归一了（这点是对的）；但 `enabled` 的 `"false"` 会被当成「开」，且面板跟着显示「开」。客户手改状态文件想关掉某个守，结果是它在跑。

### W3 `readState()` 把**任何**读错误当成「没有状态文件」

```js
118: function readState() {
119:   let raw
120:   try {
121:     raw = readFileSync(STATE_FILE, 'utf8')
122:   } catch {
123:     stateSource = 'new'
124:     return { watchers: {} }
125:   }
```

ENOENT 这么处理是对的；但 `EACCES` / `EBUSY`（Windows 上杀毒、索引器、另一进程正在写）也走这条。紧接着一次 `writeState` 会 `const disk = readState()`（index.js:177）拿到 `{watchers:{}}`，然后 `merged.watchers = { ...{} }` + 内存里的那几条 → **盘上其它守被静默清空**（`.bak` 有概率救回来，但 `readState` 优先读主文件，下次重启就按清空后的算）。建议：只有 `error.code === 'ENOENT'` 才当新状态，其余向上抛 / 标 `stateSource='unreadable'` 且拒绝写。

### W4 固定 `.tmp` 文件名 + 无跨进程锁

```js
191:     const text = JSON.stringify(merged, null, 1)
192:     // 原子写：写一半崩掉不该把全部 watcher 清空
193:     const tmp = STATE_FILE + '.tmp'
194:     writeFileSync(tmp, text)
```

`writeState` 是「读-改-写」，中间没有任何锁；`tmp` 路径是**固定的**，两个进程（两个 DSH 实例 / 宿主重载期间的新旧实例）同时写会写同一个文件：一个 rename 完另一个再 rename，或者 rename 到一半内容被另一个进程截断。单进程内因为 `writeFileSync` 是同步的所以安全，跨进程不安全。建议 `tmp` 带上 `process.pid`（`STATE_FILE + '.' + process.pid + '.tmp'`）。

### W5 `teardown` 清的是**全局共享**的 timers —— 旧实例晚到的 dispose 会掐死新实例

```js
100: const sharedTimers = (globalThis[TIMERS_KEY] ||= new Map())
101: const sharedInFlight = (globalThis[INFLIGHT_KEY] ||= new Set())
```

```js
2051:     const teardown = () => {
2052:       for (const dispose of routes) { try { dispose() } catch {} }
2053:       routes.length = 0
2054:       activeRoutes.length = 0
2055:       // 插件卸载/热重载后旧定时器不能继续跑：它们还持有已 dispose 的 ctx
2056:       for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
2057:       timers.clear()
2058:       try { clearInterval(sweepHandle) } catch {}
2059:     }
```

`timers` 是 `globalThis` 上跨模块实例共享的那一张表（index.js:98-101 的注释自己说了「宿主重载常常是重新 import 一份模块」）。`teardown` 遍历的是**这张共享表**，不区分句柄属于哪个实例。只要出现「新实例 `apply()` 已经跑完、旧实例的 `ctx.on('dispose')` 才到」，新实例刚 `startWatcher` 的定时器会被整张清掉，**所有守静默停止轮询**，直到重启 —— 而 `watch_doctor` 的「定时器可能丢了」（index.js:2429-2430）正是为这种现场写的告警。
这条我没能构造出确定的宿主重载时序，所以放「值得改」：请先确认 DSH 的重载顺序是「先 dispose 再 apply」，确认了就可以降级。

### W6 手动「立刻轮询」先回 202，再把异常吞掉

```js
1754:               if (inFlight.has(id)) return json(res, 409, { error: 'already polling', id })
1755:               const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000
1756:               inFlight.add(id)
1757:               pollOnce(ctx, entry, every)
1758:                 .catch(() => {})
1759:                 .finally(() => { inFlight.delete(id); persistEntry(entry) })
1760:               return json(res, 202, { ok: true, action, id, polling: true })
```

`pollOnce` 里没被内部 catch 的异常（比如 M4 的 TypeError、`prepareIsolation` 之外的意外）走 `.catch(() => {})`：**不写 `lastError`、不退避、面板看到的是 `ok: true`**。这条路径恰好也是 M4 的放大器。

### W7 `partitionItems` 对非数组入参抛 `TypeError`（纯函数契约不一致）

```js
35:   for (const item of items ?? []) {
```

`items ?? []` 只挡 `null`/`undefined`。实测传 `{0:{number:1}}` → `TypeError: (items ?? []) is not iterable`。**生产不可达**（所有调用点传的都是真数组），和 `pruneWakeTimes` 是同一类防御缺口，一起修更省事。

---

## 三、确认没问题

以下是我按怀疑点逐个查过、**确认当前实现是对的**的地方（附证据行号，省得下一轮重查）：

| 怀疑 | 结论 | 证据 |
|---|---|---|
| 上一轮已修的 `lastReopened` / `lastStates` 是否又漏了 | 没漏，二者都在白名单里 | watch.js:568；`test/watch.test.mjs:1480-1482` 钉着 |
| 同一个守会不会两轮并跑（定时器重入） | 不会。`inFlight` 是 `globalThis` 上的 `Set`，定时器与 HTTP「立刻」共用同一把闸 | index.js:100-101、1471-1472、1754-1756 |
| 多个守 / 多个模块实例会不会各自开一份闸 | 不会。`sharedInFlight` 用 `Symbol.for` 挂在 `globalThis`，跨模块实例共享（上一轮 probe-c 的「同一条被唤醒 3 次」已修） | index.js:95-101 |
| 重复 `startWatcher` 会不会叠出两个 interval | 不会。入口 `if (timers.has(entry.id)) return` 早退，三个调用点全部先 `stopWatcher` | index.js:1459、2593-2594、1864-1867 |
| `stopWatcher` 存进去的句柄是不是 `undefined`（`.unref?.()` 的返回值） | 不是。Node 的 `timeout.unref()` 返回 Timeout 本身，实测 `t.unref() === t` 为 `true` | index.js:1489；实测见附录 B |
| 「暂停」会不会被收尾的写回改回运行中 | 不会。`persistEntry` 只合并轮询结果字段，`enabled`/`filters`/`intervalSec` 以盘上为准 | watch.js:559-581、test/watch.test.mjs:355-360 |
| 暂停后旧错误会不会一直挂着（`normalizePaused` 那个事故） | 已在 `readState` 归一，且 `applyWatcherAction('resume')` 会清 `lastError`（`applyWatcherAction` 在 watch.js） | index.js:128、161-170；watch.js:450-456 |
| 删除后会不会被迟到的写回复活 | 不会。`persistEntry` 有 `if (!stored) return`，删除还落墓碑（7 天） | index.js:400-402、1764-1766、183-189 |
| `intervalSec` 的手写坏值（`"abc"` / `0` / 负数 / `null`） | 安全降级到 60s / 30s，不会产生 0ms 的忙循环 | 实测见 W2；`Math.max(30, Number(x) \|\| 60)` @ index.js:1460 |
| `nextAt` 手写成 `"abc"` | `Date.now() < NaN` 为 `false` → 退避被跳过，但**不会崩**（安全降级） | index.js:1469；实测 `false` |
| `seen` 被手写成字符串 | 会在 `pruneSeen()` 里被修成 `{}`（`Date.parse('a')` 非有限值被过滤），之后行为正常 | index.js:1182、watch.js:474-484 |
| `filters` 被手写成字符串 | `{...DEFAULT_FILTERS, ...'abc'}` 仍是完整默认值，不抛 | watch.js:265；实测返回 `null`（放行） |
| 冷却期吸收 / 仅观察 / 会话上限 / 每小时上限这几条早退分支会不会丢条目 | 不会。它们**刻意不动** `seen`/`cursor`（注释与实现一致），只有真正唤醒成功才 `advanceSeen` | index.js:1255-1273、1366-1409 |
| `catch {}` 里哪些是正当的 | 观测类与「不影响主流程」类：`noteEvent`(419)、`probeAccess`(1434/1455)、`fetchLastComments`(945/987)、`teardown` 里的 dispose(2052/2056) —— 它们不改变控制流，也不把失败伪装成成功 | 逐个读过 |
| `mergeWakeTexts` 的合并窗口定时器 | 3 秒、`unref()` 过、回调里有 `try/catch` 逐个隔离；窗口结束即 `wakeBuffers.delete`，不会无限累积 | index.js:636-662 |
| `sweepHandle`（5 秒一次） | 有 `unref()`，且受 `DSH_SUPERAGENT_TRIGGER=1` 开关保护（默认跑空函数，无 I/O） | index.js:2082-2098 |

**这一节的口径**：上表每一条都是「我按怀疑点去找，找到了反证」的。它们和「必须修」不冲突 —— `watch.js` 的纯判定层（`decideWake` / `partitionItems` / `filterReason` / `batchFresh` / `advanceSeen` / `recordReported`）本身逻辑自洽、无并发面、不吞错误；本次 4 条「必须修」全部落在**白名单契约**（M1/M2/M4）与**写盘错误路径**（M3）上，不在判定逻辑里。

---

## 附录 A：门禁真实输出

命令（仓库根目录）：

```bash
cd "/d/主工作区/projects/dsh-session-superagent"
DSH_SUPERAGENT_OFFLINE=1 node --test 2>&1 | tail -5
```

原样输出（收尾那次；两次跑都是 `fail 0`，`duration_ms` 在 2.3 s ~ 12.2 s 之间波动 —— 对比度门禁会起无头浏览器）：

```
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 12195.3747
```

`tail -5` 上面那几行（同一轮）：

```
ℹ tests 331
ℹ suites 0
ℹ pass 331
ℹ fail 0
```

管道退出码 `PIPE_EXIT=0`。

> 注意：**331 条全绿不代表白名单完整**。现有用例只钉了 `lastReopened`/`lastStates` 两个字段（M1 文里给了行号），M1 的另外 13 个字段没有任何用例覆盖。

## 附录 B：复现脚本（已跑过，跑完即删，不在 `git status` 里）

放在仓库外（`/tmp`）执行，不写仓库任何文件：

```js
// /tmp/watch-audit-proof.mjs
import { pathToFileURL } from 'node:url'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = 'D:/主工作区/projects/dsh-session-superagent'
const watch = await import(pathToFileURL(ROOT + '/lib/watch.js').href)

// 证据 1：白名单漏字段
const stored = { id: 'o/r#s1', repo: 'o/r', intervalSec: 60, enabled: true, seen: { 1: '2026-01-01T00:00:00.000Z' } }
const polled = {
  ...stored,
  etag: 'W/"abc123"', needsReauth: true, lastErrorAt: '2026-11-05T05:00:00.000Z',
  deferReason: 'cap-session', silentWakes: 3, prevWakeAt: '2026-11-05T04:59:00.000Z',
  dailyWakes: { '2026-11-05': 2 }, absorbedLog: [{ at: 'x', number: '7', title: 'x' }],
  filterCounts: { '草稿 PR': 2 }, repoAccess: { push: false },
  sessionMissingSince: '2026-11-05T04:40:00.000Z', minIntervalSec: 60,
  lastCleanupAt: 1762300000000, lastPoll: '2026-11-05T05:00:00.000Z',
}
const merged = watch.mergePollResult(stored, polled)
console.log('落盘时被丢掉的字段 :', Object.keys(polled).filter((k) => !(k in merged)).join(', '))

// 证据 2：ack 水位被并发 tick 回退
const diskAfterAck = { id: 'o/r#s1', seen: { 42: '2026-11-05T05:00:00.000Z' }, cursor: '2026-11-05T05:00:00.000Z',
  lastAcked: { numbers: [42], label: '主理鱼:已处理', at: '2026-11-05T05:00:00.000Z' } }
const tickSnapshot = { seen: { 42: '2026-11-05T04:59:00.000Z' }, cursor: '2026-11-05T04:59:00.000Z' }
const after = watch.mergePollResult(diskAfterAck, tickSnapshot)
console.log('水位后退了？', Date.parse(after.seen[42]) < Date.parse(diskAfterAck.seen[42]))
console.log('下一轮 fresh :', watch.partitionItems([{ number: 42, updated_at: '2026-11-05T04:59:30.000Z' }], { seen: after.seen }, { cooldownMs: 0 }).fresh.map((i) => i.number))

// 证据 3：wakeTimes 坏值
for (const bad of ['abc', {}]) { try { watch.pruneWakeTimes(bad) } catch (e) { console.log('抛了：', e.constructor.name + ': ' + e.message) } }
try { watch.sessionWakesLastHour([{ sessionId: 's', wakeTimes: {} }], 's') } catch (e) { console.log('sessionWakesLastHour 抛了：', e.message) }

// 证据 4：writeState 静默失败
const notADir = join(tmpdir(), 'watch-audit-not-a-dir-' + Date.now())
writeFileSync(notADir, 'x')
process.env.DSH_SUPERAGENT_STATE = join(notADir, 'state')
const idx = await import(pathToFileURL(ROOT + '/lib/index.js').href)
idx.__test.writeState({ watchers: { 'o/r#s1': { enabled: true } } })   // 不抛
console.log('状态目录建出来了吗 :', existsSync(join(notADir, 'state')))  // false
rmSync(notADir, { force: true })
```

```bash
$ cd /tmp && node watch-audit-proof.mjs
# 输出见 M1 / M2 / M3 / M4 各节引用，与本次审计记录一致
$ rm -f /tmp/watch-audit-proof.mjs /tmp/watch-audit-input.mjs
```

## 附录 C：本次审计的只读边界

- 新增文件：仅 `docs/报告-watch并发审计.md`（本文件）。
- 临时脚本写在 `/tmp`（`watch-audit-proof.mjs`、`watch-audit-input.mjs`），已 `rm` 掉；仓库内没有留下任何临时文件。
- 未改代码、未 commit、未 publish、未回滚任何别人写的东西。

**行外发现（都不是我改的，我也没有动它们）**：审计期间有**另一个会话正在同一个工作树里做 0.9.194 发版**。我开工时（05:34:50）`git status --porcelain` 是空的，收尾时（05:37）多出这些：

| 路径 | 变化 | 时间 |
|---|---|---|
| `lib/index.js` | 只改第 45 行 `SERVER_VERSION` 0.9.193→0.9.194 | 05:37:08 |
| `package.json` / `client.js` / `README.md` | 版本号同步（`package.json` 的 `files` 里还少了 `lib/gitee.js`） | 05:37:08 |
| `CHANGELOG.md` | 新增 `[0.9.194]` 一段 | 05:37:08 |
| `docs/规则对照表.md` | 新增「对比度与可访问性（0.9.193 复核）」一节 | 05:35:03 |
| `用途：改文案或改协议时，照这张表逐条核对` | **0 字节**的误建文件（看起来是那次发版的 `>` 重定向写错了目标，同一时刻 `CHANGELOG.md` 里对应的行内代码也正好空了） | 05:37:07 |

如果这些不是你预期的改动，请自己确认后再处理 —— 按「只读」约定我一个字节都没碰。（那条 0 字节的误建文件已经被那个会话删掉了。）

**另外**：那个会话在 `05:38:04` 提交了 `3790b5a`（0.9.194 发版），它的 `git add -A` 把**本报告也一起扫进了这个提交**。我这边没有执行任何 `git add`/`commit`/`push`；你看到的 `git status` 里那一条 ` M docs/报告-watch并发审计.md`，是我在它提交**之后**又补的两处修正（附录 A 的收尾跑数、这一节的提交说明），工作树版本才是最终版。
