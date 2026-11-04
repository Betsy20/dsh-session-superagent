import { readFileSync, writeFileSync } from 'node:fs'

// ── M1：白名单还漏 13 个字段 ──
const p = 'lib/watch.js'
let s = readFileSync(p, 'utf8')

const oldList = `  // lastReopened / lastStates 是「这一轮判出重新打开」的产物：漏了它们，
  // /state 永远回 null，面板上的 ⚠ 与 problems 也永远不出现（对 GitHub 同样成立）。
  'lastReopened', 'lastStates',
]`

if (!s.includes(oldList)) {
  console.error('M1 锚点缺失')
  process.exit(1)
}

const newList = `  // lastReopened / lastStates 是「这一轮判出重新打开」的产物：漏了它们，
  // /state 永远回 null，面板上的 ⚠ 与 problems 也永远不出现（对 GitHub 同样成立）。
  'lastReopened', 'lastStates',
  // 审核（0.9.194）又数出 13 个：**都是轮询结果，却全被写盘丢掉**。
  // 最关键的是 etag —— 丢了它，条件请求永远带不上，每轮都在全量拉；
  // 其次是 needsReauth / lastErrorAt —— doctor 的「凭证失效」分支永远不会触发。
  // 教训：白名单是**手维护的**，新增字段时必须同时加进来，否则「算出来了但没存」。
  'etag', 'needsReauth', 'lastErrorAt', 'deferReason', 'silentWakes', 'prevWakeAt',
  'dailyWakes', 'absorbedLog', 'filterCounts', 'repoAccess', 'sessionMissingSince',
  'minIntervalSec', 'lastCleanupAt',
]`

s = s.replace(oldList, newList)

// ── M4：pruneWakeTimes 只防 null，不防非数组 ──
const oldPrune = `export function pruneWakeTimes(times, now = Date.now()) {
  const floor = now - 60 * 60 * 1000
  return (times || []).map(Number).filter((t) => Number.isFinite(t) && t >= floor)
}`
if (!s.includes(oldPrune)) {
  console.error('M4 锚点缺失')
  process.exit(1)
}
const newPrune = `export function pruneWakeTimes(times, now = Date.now()) {
  const floor = now - 60 * 60 * 1000
  // 手写坏的值（"abc" / {} / 0）以前会让这里抛 TypeError：①该守被 tick 的 catch 抓走进永久退避，
  // ②/state 整条 500（面板全灭）。非数组一律当空处理 —— 坏数据的代价不该是「整个面板挂掉」。
  const list = Array.isArray(times) ? times : []
  return list.map(Number).filter((t) => Number.isFinite(t) && t >= floor)
}`

s = s.replace(oldPrune, newPrune)
writeFileSync(p, s)
console.log('M1 + M4 改完')
