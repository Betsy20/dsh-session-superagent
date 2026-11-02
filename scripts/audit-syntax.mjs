// 语法体检：把工作树里的每个源文件过一遍 node --check。
// 抽成独立脚本：注入验证（把它改坏再跑）不必再跑整套 preflight。
//
// 用法：node scripts/audit-syntax.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['client.js', 'lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'lib/body.js']

const bad = []
for (const file of FILES) {
  try {
    execFileSync('node', ['--check', file], { cwd: ROOT, stdio: 'ignore' })
  } catch {
    bad.push(file)
  }
}

if (bad.length === 0) {
  console.log('PASS 语法 node --check  ' + FILES.length + ' 个文件')
} else {
  console.log('FAIL 语法 node --check  失败：' + bad.join(', '))
  process.exitCode = 1
}
