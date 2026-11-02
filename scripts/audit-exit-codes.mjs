// 全库扫一遍：打印了 FAIL，却没设置失败退出码？
//
// 这是第三类"装死"（见 KB found-problem-but-exit-zero.md）：
// 检查逻辑对、输出也对，只有退出码是 0 —— 任何只看退出码的调用方都会被骗。
//
// 用法：node scripts/audit-exit-codes.mjs
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['scripts', 'test']

const bad = []
for (const dir of DIRS) {
  const full = join(ROOT, dir)
  let names = []
  try { names = readdirSync(full) } catch { continue }
  for (const name of names) {
    if (!name.endsWith('.mjs')) continue
    const text = readFileSync(join(full, name), 'utf8')
    const printsFail = /console\.(log|error)\(\s*['"`]FAIL/.test(text) || /['"`]FAIL /.test(text)
    if (!printsFail) continue
    const setsExit = /process\.exitCode\s*=\s*1/.test(text) || /process\.exit\(1\)/.test(text) || /process\.exitCode\s*=\s*truthy/.test(text)
    // 测试文件靠断言失败，不靠退出码
    if (dir === 'test') continue
    if (!setsExit) bad.push(dir + '/' + name)
  }
}

if (bad.length === 0) {
  console.log('PASS 退出码一致  打印 FAIL 的脚本都会返回非 0')
} else {
  console.log('FAIL 这些脚本打印了 FAIL 却不返回失败：')
  for (const item of bad) console.log('  ' + item)
  process.exitCode = 1
}
