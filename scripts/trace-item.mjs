// 追溯单条条目：这条 issue 到底经历了什么？
//
// 用法：
//   node scripts/trace-item.mjs <number>              # 读当前状态文件
//   node scripts/trace-item.mjs <number> --demo       # 不看状态文件，用内置样例演示
//   node scripts/trace-item.mjs <number> --state <path>
//
// 状态文件默认位置与插件一致（$DSH_SUPERAGENT_STATE，或 ~/.dsh/state/session-superagent）。
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { itemTrace } from '../lib/watch.js'

const args = process.argv.slice(2)
const number = args.find((a) => !a.startsWith('--') && !a.endsWith('.json'))
const demo = args.includes('--demo')
const stateFlag = args.indexOf('--state')
const explicitState = stateFlag >= 0 ? args[stateFlag + 1] : null

if (!number) {
  console.log('用法：node scripts/trace-item.mjs <issue 编号> [--demo] [--state <watchers.json>]')
  process.exit(2)
}

const DEMO = {
  repo: 'acme/widgets',
  seen: { 42: '2026-11-02T09:55:00.000Z', 43: '2026-11-02T09:40:00.000Z' },
  lastReported: { 42: '2026-11-02T09:55:00.000Z' },
  filteredLog: [{ at: '2026-11-02T09:30:00.000Z', number: 51, title: '已关闭的历史 issue', reason: '已关闭' }],
  history: [
    { at: '2026-11-02T09:55:00.000Z', numbers: [42, 43], ok: true, reason: null },
    { at: '2026-11-02T09:41:00.000Z', numbers: [43], ok: false, reason: 'agent busy (running)' },
  ],
}

function statePath() {
  if (explicitState) return explicitState
  const dir = process.env.DSH_SUPERAGENT_STATE || join(homedir(), '.dsh', 'state', 'session-superagent')
  return join(dir, 'watchers.json')
}

let watchers = []
if (demo) {
  watchers = [DEMO]
  console.log('（演示模式：用内置样例状态，不读真实文件）')
} else {
  const file = statePath()
  if (!existsSync(file)) {
    console.log('没有找到状态文件：' + file)
    console.log('提示：可以用 --demo 看演示，或用 --state <path> 指定文件。')
    process.exit(1)
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  watchers = Object.values(raw.watchers || {})
  console.log('读取状态文件：' + file + '（' + watchers.length + ' 条守）')
}

let found = 0
for (const watcher of watchers) {
  const trace = itemTrace(watcher, number)
  if (!trace) continue
  const touches = trace.seen || trace.reported || trace.filtered.length || trace.wakes.length
  if (!touches) continue
  found += 1
  console.log('')
  console.log('=== #' + trace.number + ' @ ' + (trace.repo || '?') + ' ===')
  console.log('结论：' + trace.verdict)
  if (trace.seen) console.log('水位（seen）：' + trace.seen + '（≥ 这个时间点的更新才会再叫醒）')
  if (trace.reported) console.log('上报时间（lastReported）：' + trace.reported)
  for (const item of trace.filtered) console.log('被过滤：' + item.at + '　' + item.reason + '　' + String(item.title || '').slice(0, 40))
  for (const item of trace.wakes) console.log('唤醒尝试：' + item.at + '　' + (item.ok ? '成功' : '失败（' + (item.reason || '未知') + '）'))
}

if (found === 0) {
  console.log('')
  console.log('#' + number + ' 在所有守里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。')
  process.exitCode = 1
}
