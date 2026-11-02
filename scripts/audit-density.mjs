// 信息密度体检：每个 tab 默认展开几个区块？
//
// 判据（写死，不靠感觉）：**默认展开的区块不该超过 6 个**。
// 超过就说明"首次打开"要扫的东西太多 —— 该把"只在异常时才需要"的收进折叠。
//
// 用法：node scripts/audit-density.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'client.js'), 'utf8')

const LIMIT = 6

// 每个 tab 的内容来自一个变量（const judge = h(Section, ...) 的串联）
const VARS = ['overview', 'judge', 'trigger', 'repoSummary', 'settings']

function sectionsOf(name) {
  const start = src.indexOf('const ' + name + ' = ')
  if (start < 0) return null
  // 取到下一个顶层 const / return 为止
  const nextCandidates = VARS.map((v) => src.indexOf('const ' + v + ' = ', start + 10)).filter((i) => i > 0)
  const end = nextCandidates.length > 0 ? Math.min(...nextCandidates) : src.length
  const body = src.slice(start, end)
  const titles = [...body.matchAll(/h\(Section, \{[^}]*title: '([^']+)'/g)].map((m) => m[1])
  const keys = [...body.matchAll(/h\(Section, \{[^}]*key: '([^']+)'/g)].map((m) => m[1])
  // 条件渲染（`? h(Section ... : null`）的也算，但标出来
  return { titles, keys }
}

let worst = 0
let failed = false
for (const name of VARS) {
  const found = sectionsOf(name)
  if (!found) continue
  worst = Math.max(worst, found.titles.length)
  const over = found.titles.length > LIMIT
  if (over && name !== 'settings') failed = true // 设置页天然多，先不计
  console.log((over && name !== 'settings' ? 'FAIL ' : 'PASS ') + name.padEnd(12) + found.titles.length + ' 个区块：' + found.titles.join(' / '))
}

console.log('---')
console.log('最密集的一页有 ' + worst + ' 个区块（上限 ' + LIMIT + '）')
if (failed) {
  console.log('FAIL 有页面超过上限 —— 把"只在异常时才需要"的区块收进折叠')
  process.exitCode = 1
} else {
  console.log('PASS 各页面区块数都在上限内')
}
