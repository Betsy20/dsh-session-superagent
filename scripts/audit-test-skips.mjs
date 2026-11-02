// 跳过必须是"可见的"：`{ skip: true }` 只会输出 skip，不说明为什么；
// 要求写成 `{ skip: <条件> ? '<原因>' : false }`，这样 TAP/控制台里能看到原因。
//
// 另外扫一遍"测试体内提前 return"——那是更隐蔽的跳过（用例显示通过，其实一行断言都没跑）。
//
// 用法：node scripts/audit-test-skips.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(ROOT, 'test')
const files = readdirSync(testDir).filter((name) => name.endsWith('.test.mjs'))

const silentSkips = []
const earlyReturns = []

for (const name of files) {
  const text = readFileSync(join(testDir, name), 'utf8')
  const lines = text.split(String.fromCharCode(10))
  lines.forEach((line, index) => {
    // 跳过选项：必须带原因字符串
    const skipMatch = line.match(/\{\s*skip:\s*(.+?)\s*\}/)
    if (skipMatch) {
      const value = skipMatch[1]
      // 原因必须是三元里的字符串：`? '原因' : false`；条件里出现的引号不算
      const hasReason = /\?\s*['"`]/.test(value)
      if (!hasReason) silentSkips.push({ file: name, line: index + 1, value })
    }
    // 测试体里出现裸 `return` 且同一行没有断言 —— 悄悄跳过
    if (/^\s{2,}if \([^)]*\) return\s*$/.test(line)) earlyReturns.push({ file: name, line: index + 1, text: line.trim() })
  })
}

console.log('扫描 ' + files.length + ' 个测试文件')
console.log('---')
if (silentSkips.length > 0) {
  console.log('FAIL 这些 skip 没写原因（输出里只会看到 skip，不知道为什么）：')
  for (const item of silentSkips) console.log('  ' + item.file + ':' + item.line + '  skip: ' + item.value)
} else {
  console.log('PASS 所有 skip 都带原因')
}
if (earlyReturns.length > 0) {
  console.log('WARN 这些用例体内有提前 return（可能是静默跳过，人工确认）：')
  for (const item of earlyReturns) console.log('  ' + item.file + ':' + item.line + '  ' + item.text)
} else {
  console.log('PASS 没有用例体内提前 return')
}

if (silentSkips.length > 0) process.exitCode = 1
