#!/usr/bin/env node
// 文档链接体检：45+ 篇文档互相引用，链接写错了没人会发现 —— 直到客户点不开。
//
// 只查「仓库内的相对链接」（不查 http(s)，那需要网络且会误报）。
// 用法：node scripts/check-docs.mjs [--verbose]
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'tmp', 'dist'])

/** 收集仓库里的 markdown。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

const files = walk(ROOT)
const problems = []
const seenTargets = new Set()

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  // [文字](目标) —— 目标里允许有中文与括号（我们的文件名有中文）
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let match
  while ((match = re.exec(text)) !== null) {
    const raw = match[1].trim()
    if (!raw || raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('mailto:') || raw.startsWith('#')) continue
    const target = raw.split('#')[0]
    if (!target) continue
    const decoded = decodeURI(target)
    const full = normalize(resolve(dirname(file), decoded))
    seenTargets.add(full)
    if (!existsSync(full)) {
      problems.push({ file: relative(ROOT, file), link: raw })
    }
  }
}

// 反向检查：docs/kb/ 下每篇是否至少被索引进 docs/kb/README.md（孤儿文档没人会看到）
const kbDir = join(ROOT, 'docs', 'kb')
const index = readFileSync(join(kbDir, 'README.md'), 'utf8')
const orphans = readdirSync(kbDir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .filter((name) => !index.includes(name))

// 板块自检：索引顶部的「板块 → 篇数」必须和各板块下实际列出的条数一致，
// 否则重构索引时很容易出现"表头写 11 篇、下面只列 9 篇"。
const sectionCounts = [...index.matchAll(/^## (.+)$/gm)].map((m) => m[1])
const declared = [...index.matchAll(/^\| ([^|]+) \| (\d+) \| [^|]*\|$/gm)]
  .filter((m) => !m[1].includes('板块'))
  .map((m) => ({ name: m[1].trim(), n: Number(m[2]) }))
const countMismatch = []
for (const item of declared) {
  const heading = index.indexOf('## ' + item.name)
  if (heading < 0) {
    countMismatch.push(item.name + '（索引里没有这个板块）')
    continue
  }
  const next = index.indexOf(String.fromCharCode(10) + '## ', heading + 3)
  const body = index.slice(heading, next < 0 ? index.length : next)
  const listed = (body.match(/^\| \[/gm) || []).length
  if (listed !== item.n) countMismatch.push(item.name + '：声明 ' + item.n + ' 篇，实际列出 ' + listed + ' 篇')
}

const verbose = process.argv.includes('--verbose')
console.log(`扫描 ${files.length} 篇 Markdown，${seenTargets.size} 个内部链接目标`)

if (verbose) {
  for (const file of files) console.log('  ' + relative(ROOT, file))
}

if (problems.length > 0) {
  console.log(`FAIL ${problems.length} 个链接指向不存在的文件：`)
  for (const p of problems) console.log(`  ${p.file} → ${p.link}`)
} else {
  console.log('PASS 所有内部链接都能解析')
}

if (orphans.length > 0) {
  console.log(`FAIL ${orphans.length} 篇知识库文档没被索引（客户看不到）：`)
  for (const name of orphans) console.log('  docs/kb/' + name)
} else {
  console.log('PASS 知识库文档全部被索引')
}


if (countMismatch.length > 0) {
  console.log(`FAIL 索引板块篇数对不上（${countMismatch.length} 处）：`)
  for (const item of countMismatch) console.log('  ' + item)
} else {
  console.log('PASS 索引板块篇数与实际条目一致')
}

// ④ 阅读路径：一百多篇的索引要有一条「第一次读」的入口，否则新人无从下手
const entry = readFileSync(join(kbDir, 'README.md'), 'utf8')
const pathStart = entry.indexOf('**第一次读')
const pathEnd = pathStart >= 0 ? entry.indexOf('其余按板块检索') : -1
const pathBlock = pathStart >= 0 && pathEnd > pathStart ? entry.slice(pathStart, pathEnd) : ''
const pathLinks = [...pathBlock.matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1])
const pathMissing = pathLinks.filter((link) => !existsSync(join(kbDir, link)))
if (pathLinks.length < 3) {
  console.log('FAIL 知识库索引缺「第一次读」的阅读路径（至少 3 篇）')
} else if (pathMissing.length > 0) {
  console.log('FAIL 阅读路径里这些文件不存在：' + pathMissing.join(', '))
} else {
  console.log('PASS 索引有「第一次读」路径（' + pathLinks.length + ' 篇，文件都存在）')
}

const pathBad = pathLinks.length < 3 || pathMissing.length > 0
if (problems.length > 0 || orphans.length > 0 || countMismatch.length > 0 || pathBad) process.exitCode = 1
