// 工具描述里的"承诺"必须在对账表里有一行。
//
// 为什么：工具描述是 agent 读的契约（"Idempotent per (repo, session)"）
// 与客户读的文档是两套文本，最容易一边改了另一边没改。
//
// 判据：描述里出现承诺类措辞（幂等 / 只读 / 永不 / 默认值 / 自动），
// `docs/规则对照表.md` 里就必须出现对应关键词。
//
// 用法：node scripts/audit-promises.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const matrix = readFileSync(join(ROOT, 'docs', '规则对照表.md'), 'utf8')

// 描述里出现的承诺 → 对账表里必须出现的关键词
const PROMISES = [
  { test: /Idempotent/i, key: '幂等', why: '重复调用是更新而不是新建' },
  { test: /Read-only/i, key: '只读', why: '不改任何状态' },
  { test: /never wake|will never/i, key: '不再叫醒', why: 'ack 过的不再叫醒' },
  { test: /never returned/i, key: '不回显', why: '凭证永不回显' },
  { test: /Default interval/i, key: '默认间隔', why: '默认间隔 60 秒' },
]

// 收集描述文本（每段 name/description 配对）
const descriptions = []
const re = /name: '([a-z_]+)',\s*\n\s*description:\s*\n?\s*'([\s\S]*?)',\s*\n/g
let match
while ((match = re.exec(src))) descriptions.push({ tool: match[1], text: match[2].replace(/\s+/g, ' ') })

const found = []
for (const item of descriptions) {
  for (const promise of PROMISES) {
    if (promise.test.test(item.text)) found.push({ tool: item.tool, ...promise })
  }
}

// 双向：描述里有的必须进表；表里承诺的也必须在描述里还写着（否则表在描述一个已不存在的行为）
const inDescription = new Set(found.map((item) => item.key))
const missing = PROMISES.filter((promise) => matrix.includes(promise.key) && !inDescription.has(promise.key))
const notInMatrix = found.filter((item) => !matrix.includes(item.key))
const uniqFound = new Map()
for (const item of found) uniqFound.set(item.key, item)

console.log('工具描述 ' + descriptions.length + ' 条 / 检出承诺 ' + found.length + ' 处（' + uniqFound.size + ' 种）')
console.log('---')
for (const [key, item] of uniqFound) {
  const ok = matrix.includes(key)
  console.log((ok ? 'PASS ' : 'FAIL ') + key + '（' + item.why + '）—— 出现在 ' + item.tool)
}
console.log('---')
if (notInMatrix.length > 0) {
  console.log('FAIL 对账表缺 ' + notInMatrix.length + ' 条承诺：' + [...new Set(notInMatrix.map((m) => m.key))].join(', '))
  process.exitCode = 1
} else if (missing.length > 0) {
  // 表里在承诺，但工具描述里已经没有这句 —— 说明行为可能被悄悄删掉了
  console.log('FAIL 表里承诺了但描述里找不到：' + missing.map((m) => m.key).join(', '))
  process.exitCode = 1
} else {
  console.log('PASS 每条承诺都在 docs/规则对照表.md 里有对应行')
}
