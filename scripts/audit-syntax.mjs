// 语法体检：把工作树里的每个源文件过一遍 node --check。
// 抽成独立脚本：注入验证（把它改坏再跑）不必再跑整套 preflight。
//
// 用法：node scripts/audit-syntax.mjs
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// 审核 T25：以前清单写死 6 个文件 —— 新增 `lib/xxx.js` 语法坏掉也 PASS。
// 改成**扫描**所有源文件：lib/*.js、client.js，以及 scripts/*.mjs（门禁自己也会坏）。
const FILES = [
  'client.js',
  ...readdirSync(join(ROOT, 'lib')).filter((n) => n.endsWith('.js')).map((n) => 'lib/' + n),
  ...readdirSync(join(ROOT, 'scripts')).filter((n) => n.endsWith('.mjs')).map((n) => 'scripts/' + n),
]

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
