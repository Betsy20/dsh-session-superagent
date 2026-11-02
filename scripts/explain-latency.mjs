// 「它到底什么时候会叫醒我」——把延迟拆成看得见的几段。
//
// 客户最常问的就是这句。答案不是一个数字，而是几段相加：
//   轮询间隔 + 抖动 + （活跃时段门禁）+ （冷却期门禁）+ （每小时上限排队）
// 这个脚本用 lib/watch.js 的真实函数把这几段算出来，打印成相对时间表。
//
// 用法：node scripts/explain-latency.mjs [间隔秒数]
import {
  inActiveHours,
  jitterMs,
  msUntilActiveWindow,
  nextDelayMs,
  nextWaketimeAt,
  pruneWakeTimes,
} from '../lib/watch.js'

const intervalSec = Math.max(30, Number(process.argv[2]) || 60)
const every = intervalSec * 1000

const t0 = Date.UTC(2026, 10, 2, 2, 0, 0) // 北京时间 10:00
const fmt = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return (m > 0 ? m + ' 分 ' : '') + s + ' 秒'
}

const rows = []
let cumulative = 0
const add = (label, cost, note) => {
  cumulative += Math.max(0, cost)
  rows.push({ label, cost: Math.max(0, cost), cumulative, note })
}

console.log('场景：你 10:00:00 在仓库里提交了一个 issue；会话空闲；配置每 ' + intervalSec + ' 秒轮询。')
console.log('')

add('① 提交', 0, '客户动作，t = 0')

const phase = jitterMs('repo#session', Math.min(5000, every * 0.1))
// 提交时刻相对下一次轮询是随机的：最坏要等满一个周期，再加首轮抖动。
add('② 下一次轮询看到它', every + phase, '最多一个轮询周期（' + fmt(every) + '）+ 抖动 ' + Math.round(phase) + ' 毫秒（同一会话稳定，不随机）')

add('③ 冷却期门禁', 0, '只吸收「自己刚碰过的条目」；别人提交的不受影响，所以这一步通常是 0')

const hours = '09:00-23:00'
const hoursOpen = inActiveHours(hours, new Date(t0))
add('④ 活跃时段门禁', hoursOpen ? 0 : msUntilActiveWindow(hours, new Date(t0)),
  hoursOpen ? '当前在 ' + hours + ' 内，直接通过' : '不在 ' + hours + ' 内，要等开关门')

// 上限：假设这一小时已经用掉 cap 次（每 5 分钟一次，最近一次在 5 分钟前）
const cap = 6
const wakeTimes = Array.from({ length: cap }, (_, i) => t0 - (cap - i) * 5 * 60_000)
const freeAt = nextWaketimeAt(pruneWakeTimes(wakeTimes, t0), cap, t0)
add('⑤ 频率上限排队', Math.max(0, freeAt - t0), '假设这一小时已用完 ' + cap + ' 次；最早的名额要等它空出')

console.log('步骤                        本段耗时      累计        说明')
console.log('--------------------------  ------------  ----------  ------------------------------------------')
for (const row of rows) {
  console.log(row.label.padEnd(28) + fmt(row.cost).padEnd(14) + fmt(row.cumulative).padEnd(12) + row.note)
}
console.log('')
console.log('最常见：只有 ①② 两段 —— 最多一个轮询间隔 + 抖动，即约 ' + fmt(every + phase) + '。')
console.log('最坏（全占满，含上限排队）：约 ' + fmt(cumulative) + '。')
console.log('')
console.log('调参方向：')
console.log('  · 想更快发现 → 调小间隔；但会更快吃满每小时上限。')
console.log('  · 想少被打断 → 调小上限；代价是积压。')
console.log('  · 先看面板「按仓库」里的「本会话近一小时唤醒 N/12」，再决定调哪一头。')
console.log('')
const backoff = [1, 2, 3, 4].map((n) => fmt(nextDelayMs({ consecutiveFailures: n }, every)))
console.log('对照（别和延迟搞混）：连续失败时的**重试**间隔 ' + backoff.join(' → ') + '，成功后立刻复位到 ' + fmt(every) + '。')
