// 知识库 ←→ 代码 的反向连接体检（审核 T34）。
//
// 为什么需要：182 条知识库是产品的「宪法」，但 T34 把条目名当标识符反查发现 ——
//   生产代码 `lib/` + `client.js` 只引用了 **3 条**，`client.js` 是 **0 条**。
//   一个 bug 能烂 160 多个版本，土壤就是这里：规则写在知识库里，代码里没有任何东西指着它。
//
// 判据（不追求全覆盖，只守住「行为类」）：
//   ① 每个 `// KB: xxx.md` 指到的文件必须真实存在（防止改名后悬空）；
//   ② 代码里出现的 KB 引用数不能倒退（基线见 BASELINE）；
//   ③ 「判定与优先级」「通知与消息设计」两个板块至少各有 1 条被代码引用。
//
// 用法：node scripts/audit-kb-links.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KB = join(ROOT, 'docs', 'kb')

// 引用数基线：只许涨，不许跌（跌了说明有人把注释删了）
const BASELINE = 19

// 这两个板块是 T34 反查出来的 0 引用区，必须先长出来
const MUST_COVER = ['priority-configurable.md', 'assignment-signal.md', 'filter-explainability.md', 'triage-signal-table.md', 'error-must-have-next-step.md', 'windows-secrets-perms.md', 'token-scopes.md']

const SOURCES = ['client.js', ...readdirSync(join(ROOT, 'lib')).filter((n) => n.endsWith('.js')).map((n) => join('lib', n))]

const refs = []
for (const rel of SOURCES) {
  const text = readFileSync(join(ROOT, rel), 'utf8')
  for (const m of text.matchAll(/\/\/\s*KB:\s*([\w.-]+\.md)/g)) refs.push({ rel, name: m[1] })
}

const names = new Set(refs.map((r) => r.name))
const missing = [...names].filter((name) => !existsSync(join(KB, name)))
const uncovered = MUST_COVER.filter((name) => !names.has(name))

console.log('代码里的 KB 引用：' + refs.length + ' 处，涉及 ' + names.size + ' 条')
console.log('文件：' + [...new Set(refs.map((r) => r.rel))].join('、'))
console.log('---')

let bad = 0
if (missing.length > 0) {
  console.log('FAIL 引用了不存在的知识库条目（改名后没跟着改）：')
  for (const name of missing) console.log('  ' + name + ' ← ' + refs.filter((r) => r.name === name).map((r) => r.rel).join(', '))
  bad += 1
} else {
  console.log('PASS 每个引用都指到真实条目')
}

if (refs.length < BASELINE) {
  console.log('FAIL 引用数倒退：现在 ' + refs.length + ' 处 < 基线 ' + BASELINE + ' 处（有人删了注释？）')
  bad += 1
} else {
  console.log('PASS 引用数不倒退（' + refs.length + ' ≥ 基线 ' + BASELINE + '）')
}

if (uncovered.length > 0) {
  console.log('FAIL 这些「行为类」条目还没被代码引用：' + uncovered.join(', '))
  bad += 1
} else {
  console.log('PASS 关键行为类条目都有代码引用（' + MUST_COVER.length + ' 条）')
}

if (bad > 0) process.exitCode = 1
