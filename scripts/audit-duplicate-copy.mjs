// 同一句中文文案在源码里出现两次 —— 多半是复制粘贴，改一处忘另一处。
//
// 背景：CHANGELOG 232 条里，"重复"相关的修复出现 22 次（最高频主题）。
// 与其第 23 次打补丁，不如让工具把它们找出来。
//
// 只报 >= 16 个汉字的整句（短词、类名、路径会天然重复，报了也是噪音）。
//
// 用法：node scripts/audit-duplicate-copy.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['client.js', 'lib/index.js', 'lib/watch.js', 'lib/gh-format.js']
const MIN_LEN = 16

const quote = String.fromCharCode(39)
const pattern = new RegExp(quote + '([^' + quote + String.fromCharCode(10) + ']{' + MIN_LEN + ',160})' + quote, 'g')
const cjk = /[一-龥]/

const findings = []
for (const file of FILES) {
  const src = readFileSync(join(ROOT, file), 'utf8')
  const counts = new Map()
  for (const match of src.matchAll(pattern)) {
    const text = match[1]
    if (!cjk.test(text)) continue
    counts.set(text, (counts.get(text) || 0) + 1)
  }
  for (const [text, n] of counts) {
    if (n >= 2) findings.push({ file, text, n })
  }
}

console.log('扫描 ' + FILES.length + ' 个文件，整句（≥' + MIN_LEN + ' 汉字）重复 ' + findings.length + ' 处')
if (findings.length > 0) {
  for (const item of findings) console.log('  x' + item.n + '  ' + item.file + '  ' + item.text.slice(0, 50))
  console.log('---')
  console.log('FAIL 同一句文案出现两次 —— 抽成常量，或确认后改一处')
  // 之前这里是 INFO 且 exit 0：结果"改坏也不会红"，回归用例当场抓到了这个假通过
  process.exitCode = 1
} else {
  console.log('PASS 没有重复的整句文案')
}
