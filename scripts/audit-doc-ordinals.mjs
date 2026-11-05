// 知识库与文档里的「preflight 第 N 项」是一种**必然腐烂**的引用：
// preflight 不打印序号，任何一次插入都会让后面全部错位（审核 T21 实测：20 处全部失效）。
//
// 判据：文档里不许再写「第 N 项」，改成写**检查名**（名字稳定、脚本里能搜到）。
// 用法：node scripts/audit-doc-ordinals.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 「第 12 项」「第12项」这类序号引用（但放过「第一步」这种流程描述）。 */
const ORDINAL = /第\s*\d+\s*项/g

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue
      walk(abs)
    } else if (name.endsWith('.md')) {
      files.push(abs)
    }
  }
}
walk(join(ROOT, 'docs'))
files.push(join(ROOT, 'README.md'), join(ROOT, 'UPDATING.md'), join(ROOT, 'MAINTENANCE.md'))

const hits = []
for (const abs of files) {
  // 报告类是历史快照：它们本来就该原样引用当时的序号，不该被这条规则管
  if (abs.split(/[\\/]/).pop().startsWith('报告-')) continue
  let text
  try { text = readFileSync(abs, 'utf8') } catch { continue }
  const lines = text.split(String.fromCharCode(10))
  lines.forEach((line, index) => {
    // 只查「引用 preflight 序号」的：报告类文件是历史快照（它们本来就该原样引用），跳过；
    // 「左栏第 2 项」这种描述 UI 位置的也不算。
    if (!/preflight/i.test(line)) return
    for (const match of line.matchAll(ORDINAL)) {
      hits.push({ file: relative(ROOT, abs).replace(/\\/g, '/'), line: index + 1, text: match[0], raw: line.trim().slice(0, 90) })
    }
  })
}

console.log('扫描 ' + files.length + ' 份 Markdown')
console.log('---')
if (hits.length === 0) {
  console.log('PASS 文档里没有「第 N 项」这类序号引用（名字才稳定，序号插入即错位）')
  process.exit(0)
}

console.log('FAIL 这些文档还在用「第 N 项」引用 preflight（序号会错位，请改成检查名）：')
for (const hit of hits) console.log('  ' + hit.file + ':' + hit.line + '  ' + hit.text + '  ← ' + hit.raw)
process.exit(1)
