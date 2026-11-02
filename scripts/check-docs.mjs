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

if (problems.length > 0 || orphans.length > 0) process.exitCode = 1
