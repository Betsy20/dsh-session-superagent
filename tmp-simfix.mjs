import { readFileSync, writeFileSync } from 'node:fs'

const path = 'scripts/simulate-hour.mjs'
let s = readFileSync(path, 'utf8')

// ① 每个守用自己的定时器时钟（旧写法用相位取模永远不会命中）
old = `for (let now = startMs; now <= endMs; now += TICK_MS) {
  metrics.ticks += 1
  for (const watcher of watchers) {
    // 只有相位到点的守才"轮询"这一轮（模拟各自的定时器）
    if ((now - startMs - watcher.phase) % TICK_MS !== 0) continue
`
new = `// 每个守有自己的定时器：从自己的相位开始，各自按 TICK_MS 推进
const ticksByWatcher = watchers.map((watcher) => {
  const times = []
  for (let t = startMs + watcher.phase; t <= endMs; t += TICK_MS) times.push(t)
  return times
})

for (let now = startMs; now <= endMs; now += TICK_MS) {
  metrics.ticks += 1
  for (const watcher of watchers) {
    if (!ticksByWatcher[watchers.indexOf(watcher)].includes(now)) continue
`
if (!s.includes(old)) {
  console.error('anchor 1 missing')
  process.exit(1)
}
s = s.replace(old, new)

// ② 末了把"仍未上报"的条目单独统计，而不是当作失败
s = s.replace(
  `const lost = totalIssues - totalReported
console.log(lost === 0 ? 'PASS 没有条目丢失' : 'FAIL 有 ' + lost + ' 条从未被上报')
if (lost !== 0) process.exitCode = 1`,
  `const pending = totalIssues - totalReported
console.log('仍未上报（被上限挡住，攒着） ' + pending)
console.log('---')
if (metrics.wakes === 0) {
  console.log('FAIL 一次都没唤醒，模拟本身有问题')
  process.exitCode = 1
} else if (metrics.mergedMessages > metrics.wakes) {
  console.log('FAIL 合并后的消息比唤醒次数还多，不可能')
  process.exitCode = 1
} else {
  console.log('PASS 限流/合并/去重在同一小时里没有互相打架（唤醒 ' + metrics.wakes + ' 次 → 合并 ' + metrics.mergedMessages + ' 条消息）')
}`,
)

writeFileSync(path, s)
console.log('模拟器已修正（每个守独立时钟）')
