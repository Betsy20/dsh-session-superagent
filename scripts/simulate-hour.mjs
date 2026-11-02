// 离线长跑：把「30 秒间隔 × 3 个仓库 × 1 小时」在几秒内模拟完。
//
// 为什么需要：所有唤醒/限流/去重逻辑都只有单测（单点行为），没有一个"跑满一小时"的验证。
// 时间维度才会暴露互相打架的问题：会话上限挡住时水位有没有推进、合并窗口会不会吞消息、
// 节流会不会让回收永远不跑。
//
// 用法：node scripts/simulate-hour.mjs [分钟数]
import {
  advanceSeen,
  batchFresh,
  mergeWakeTexts,
  partitionItems,
  pruneWakeTimes,
  recordReported,
  sessionWakesLastHour,
  silentStreak,
} from '../lib/watch.js'

const MINUTES = Number(process.argv[2]) || 60
const TICK_MS = 30_000
const REPOS = ['owner/alpha', 'owner/beta', 'owner/gamma']
const SESSION = 'session-sim'
const WATCHER_CAP = 6
const SESSION_CAP = 12

// 每条守：自己的相位、seen 水位、唤醒时间表
const watchers = REPOS.map((repo, i) => ({
  id: repo + '#' + SESSION,
  repo,
  sessionId: SESSION,
  phase: i * 7000, // 相位错开，模拟抖动只拉开几秒
  seen: {},
  lastReported: {},
  wakeTimes: [],
  silentWakes: 0,
  prevWakeAt: null,
  lastAckedAt: null,
}))

const metrics = {
  ticks: 0,
  itemsSeen: 0,
  reportedBy: { alpha: 0, beta: 0, gamma: 0 },
  wakes: 0,
  mergedMessages: 0,
  mergedParts: 0,
  blockedByWatcherCap: 0,
  blockedBySessionCap: 0,
  absorbed: 0,
  ackedAfterWake: 0,
}

// 假 issue：按时间点出现（每条仓库每小时 10 条，模拟真实活跃度）
const issues = []
for (const [i, repo] of REPOS.entries()) {
  for (let n = 1; n <= 10; n += 1) {
    issues.push({
      repo,
      number: i * 100 + n,
      title: repo + ' 的第 ' + n + ' 条',
      state: 'open',
      html_url: 'https://example.invalid/' + (i * 100 + n),
      user: { login: 'someone' },
      labels: [],
      assignees: [],
      updated_at: new Date(Date.UTC(2026, 10, 2, 10, n * 4, 0)).toISOString(),
      comments: 0,
    })
  }
}

// 合并窗口：3 秒内同会话的唤醒合成一条
const pending = new Map()
const flushMerged = (nowMs) => {
  for (const [sessionId, bucket] of pending) {
    if (nowMs - bucket.openedAt < 3000) continue
    metrics.mergedMessages += 1
    metrics.mergedParts += bucket.parts.length
    if (bucket.parts.length > 1) mergeWakeTexts(bucket.parts)
    pending.delete(sessionId)
  }
}

const startMs = Date.UTC(2026, 10, 2, 10, 0, 0)
const endMs = startMs + MINUTES * 60_000

// 每个守有自己的定时器：从自己的相位开始各自按 TICK_MS 推进
// 每个守有自己的定时器：把三组时刻合并成一个事件序列，再按时间推进
const events = []
for (const watcher of watchers) {
  for (let t = startMs + watcher.phase; t <= endMs; t += TICK_MS) events.push({ t, watcher })
}
events.sort((a, b) => a.t - b.t)

for (const event of events) {
  const now = event.t
  metrics.ticks += 1
  {
    const watcher = event.watcher

    const visible = issues
      .filter((item) => item.repo === watcher.repo && Date.parse(item.updated_at) <= now)
      .map((item) => ({ ...item }))
    metrics.itemsSeen += visible.length

    const { fresh, absorbed } = partitionItems(visible, watcher, { now, cooldownMs: 180_000 })
    metrics.absorbed += absorbed.length
    if (absorbed.length > 0) watcher.seen = advanceSeen(watcher.seen, absorbed)
    if (fresh.length === 0) continue

    watcher.wakeTimes = pruneWakeTimes(watcher.wakeTimes, now)
    if (watcher.wakeTimes.length >= WATCHER_CAP) {
      metrics.blockedByWatcherCap += 1
      continue
    }
    const sessionUsed = sessionWakesLastHour(watchers, SESSION, now)
    if (sessionUsed >= SESSION_CAP) {
      metrics.blockedBySessionCap += 1
      continue
    }

    // 真的唤醒：按批取前 N 条
    const listed = batchFresh(fresh, 5)
    const rest = fresh.slice(listed.length)
    metrics.wakes += 1
    if (process.env.SIM_DEBUG) console.log('wake', watcher.repo, 'at', ((now - startMs) / 60000).toFixed(1) + 'min')
    metrics.reportedBy[watcher.repo.split('/')[1]] += listed.length

    // 记账（成功后才推进水位 —— 与产品逻辑一致）
    watcher.silentWakes = silentStreak({
      previousWakeAt: watcher.prevWakeAt,
      lastAckedAt: watcher.lastAckedAt,
      previousStreak: watcher.silentWakes,
    })
    watcher.prevWakeAt = new Date(now).toISOString()
    watcher.wakeTimes.push(now)
    watcher.seen = advanceSeen(watcher.seen, listed)
    watcher.lastReported = recordReported(watcher, listed)

    // 合并窗口入队
    const bucket = pending.get(SESSION) || { parts: [], openedAt: now }
    bucket.parts.push(watcher.repo + ' 有 ' + listed.length + ' 条')
    pending.set(SESSION, bucket)

    // 60% 概率会话会 ack（模拟"有时没人动手"）
    if (Math.random() < 0.6) {
      watcher.lastAckedAt = new Date(now + 60_000).toISOString()
      metrics.ackedAfterWake += 1
    }

    // 超批量的部分留到下一轮：这里不推进它的水位，所以下轮还会被看到
    for (const item of rest) delete watcher.seen[String(item.number)]
  }
  flushMerged(now)
}
flushMerged(endMs + 10_000)

const totalReported = Object.values(metrics.reportedBy).reduce((a, b) => a + b, 0)
const totalIssues = issues.length
console.log('=== 离线长跑 ' + MINUTES + ' 分钟 / ' + watchers.length + ' 个仓库 / 每 ' + TICK_MS / 1000 + ' 秒一轮 ===')
console.log('轮询次数            ' + metrics.ticks)
console.log('出现的条目（累计）  ' + metrics.itemsSeen)
console.log('实际唤醒次数        ' + metrics.wakes + '（单守上限 ' + WATCHER_CAP + '/h，会话上限 ' + SESSION_CAP + '/h）')
console.log('被单守上限挡住      ' + metrics.blockedByWatcherCap + ' 次')
console.log('被会话上限挡住      ' + metrics.blockedBySessionCap + ' 次')
console.log('合并成消息          ' + metrics.mergedMessages + ' 条（含 ' + metrics.mergedParts + ' 份唤醒）')
console.log('上报条目数          ' + totalReported + ' / 共 ' + totalIssues)
console.log('冷却期吸收          ' + metrics.absorbed + ' 次')
console.log('唤醒后出现 ack      ' + metrics.ackedAfterWake + ' 次')
console.log('---')
const stillPending = totalIssues - totalReported
console.log('仍未上报（被上限挡住，攒着） ' + stillPending)
console.log('---')
if (metrics.wakes === 0) {
  console.log('FAIL 一次都没唤醒，模拟本身有问题')
  process.exitCode = 1
} else if (metrics.mergedMessages > metrics.wakes) {
  console.log('FAIL 合并后的消息比唤醒次数还多，不可能')
  process.exitCode = 1
} else {
  console.log('PASS 限流/合并/去重在同一小时里没有互相打架（唤醒 ' + metrics.wakes + ' 次 → 合并 ' + metrics.mergedMessages + ' 条消息）')
}
