// 术语表 ↔ 面板用词双向对照：
//   ① 术语表里哪些词在面板文案里根本没出现（可能是死词，或面板已经不用这个说法）；
//   ② 面板里出现了哪些"看起来是术语"的词，但术语表没解释（客户会卡住）。
//
// 只报告，不判定 —— 双向对齐是判断活，脚本负责"不漏"。
//
// 用法：node scripts/audit-glossary.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientSource = readFileSync(join(ROOT, 'client.js'), 'utf8')

// ① 抽术语表（Modal 里的 KeyValues rows）
const glossaryBlock = clientSource.slice(
  clientSource.indexOf("title: '主理鱼术语表'"),
  clientSource.indexOf("]) })))", clientSource.indexOf("title: '主理鱼术语表'")),
)
const terms = [...glossaryBlock.matchAll(/\['([^']+)',\s*'([^']*)'\]/g)].map((m) => ({ term: m[1], meaning: m[2] }))

// ② 面板文案（直接跑快照脚本拿当前文本，避免读旧文件）
let copy = ''
try {
  copy = execFileSync('node', ['scripts/render-panel-copy.mjs'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
} catch {
  copy = readFileSync(join(ROOT, 'docs', '面板文案.md'), 'utf8')
}
const copyText = copy.split(String.fromCharCode(10)).filter((line) => line.startsWith('- ')).join(String.fromCharCode(10))

// ③ 面板里可能"需要解释"的词（固定词表，避免主观）
const TECHNICAL = ['上限', '限流', '轮询', '唤醒', '隔离', '副本', '过滤', '时段', '凭证', 'ack', 'goal', '盯办', '冷却', '水位', '去重', '幂等', '游标']

const deadTerms = terms.filter((t) => !copyText.includes(t.term))
const explained = new Set(terms.map((t) => t.term))
// "副本" 被 "临时副本" 覆盖、"上限" 被条目名覆盖，都算已解释（双向包含即算命中）
const isExplained = (word) => [...explained].some((term) => term.includes(word) || word.includes(term))
const unexplained = TECHNICAL.filter((word) => copyText.includes(word) && !isExplained(word))

console.log('术语表 ' + terms.length + ' 条 / 面板文案 ' + copyText.split(String.fromCharCode(10)).length + ' 行')
console.log('---')
if (deadTerms.length > 0) {
  console.log('术语表里但面板没出现（可能是死词，或面板换了说法）：')
  for (const t of deadTerms) console.log('  ' + t.term + ' —— ' + t.meaning.slice(0, 40))
} else {
  console.log('PASS 术语表的每个词都在面板里出现过')
}
console.log('---')
if (unexplained.length > 0) {
  console.log('面板在用但术语表没解释（客户可能卡住）：')
  for (const word of unexplained) console.log('  ' + word)
} else {
  console.log('PASS 面板里的技术词都有解释')
}
