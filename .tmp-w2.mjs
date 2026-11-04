import { readFileSync, writeFileSync } from 'node:fs'

// W2：`enabled` 是 JSON 里的值，手改成 "false" / 0 时 `=== false` 全都判不出来。
// 统一走一个 isEnabled()，语义：只有明确的「假」才算暂停，缺省 = 启用。
const helper = `/**
 * 这条守是不是启用着。
 *
 * \`watchers.json\` 是**人也会手改**的文件（真机踩过：\`enabled: "false"\` 字符串让守照常轮询）。
 * 所以不能只判 \`=== false\`：字符串 "false"、数字 0、"0" 都算暂停，缺省才算启用。
 */
function isEnabled(entry) {
  if (!entry) return false
  const value = entry.enabled
  if (value === undefined || value === null) return true
  if (value === false || value === 0) return false
  const text = String(value).trim().toLowerCase()
  return !(text === 'false' || text === '0' || text === 'no' || text === 'off')
}
`

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let s = raw

if (!s.includes('function isEnabled(entry)')) {
  const anchor = 'function normalizePaused(entry) {'
  if (!s.includes(anchor)) {
    console.error('W2 锚点缺失')
    process.exit(1)
  }
  s = s.replace(anchor, helper.replace(/\n/g, crlf ? '\r\n' : '\n') + (crlf ? '\r\n' : '\n') + anchor)
}

// 逐处替换（保持最小改动，只换判断表达式）
const pairs = [
  ['  if (!entry || entry.enabled !== false) return entry', '  if (!entry || isEnabled(entry)) return entry'],
  ['  if (!liveEntry || liveEntry.enabled === false) {', '  if (!liveEntry || !isEnabled(liveEntry)) {'],
  ['      if (entry.enabled === false) return', '      if (!isEnabled(entry)) return'],
  ['            enabled: w.enabled !== false,', '            enabled: isEnabled(w),'],
  ["              if (entry.enabled === false) return json(res, 409, { error: 'watcher is paused' })", "              if (!isEnabled(entry)) return json(res, 409, { error: 'watcher is paused' })"],
  ['            if (result.deleted || result.enabled === false) stopWatcher(id)', '            if (result.deleted || !isEnabled(result)) stopWatcher(id)'],
  ['            if (result.enabled === true) startWatcher(state.watchers[id])', '            if (isEnabled(result)) startWatcher(state.watchers[id])'],
  ['          entry.enabled = body.enabled === undefined ? (entry.enabled !== false) : body.enabled !== false', '          entry.enabled = body.enabled === undefined ? isEnabled(entry) : isEnabled({ enabled: body.enabled })'],
  ["              + ' | ' + (entry.enabled === false ? '已暂停' : '启用')", "              + ' | ' + (isEnabled(entry) ? '启用' : '已暂停')"],
  ['        if (entry.enabled !== false && entry.lastPoll) {', '        if (isEnabled(entry) && entry.lastPoll) {'],
  ["        lines.push(`INFO ${entry.enabled === false ? '已暂停' : '运行中'} · 上次轮询 ${entry.lastPoll || '无'} · ${last}`)", "        lines.push(`INFO ${isEnabled(entry) ? '运行中' : '已暂停'} · 上次轮询 ${entry.lastPoll || '无'} · ${last}`)"],
]

let changed = 0
for (const [from, to] of pairs) {
  if (!s.includes(from)) {
    console.error('W2 锚点缺失：' + from.slice(0, 60))
    process.exit(1)
  }
  s = s.split(from).join(to)
  changed += 1
}

writeFileSync(p, s)
console.log('W2 改完，替换 ' + changed + ' 处')
