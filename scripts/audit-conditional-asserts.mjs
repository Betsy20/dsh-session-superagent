// 扫"条件断言"：`if (...) { assert... }` 会在前提不满足时静默跳过 —— 等于永远通过。
//
// 这不可能完全自动判定（有些 if 只是分支，两边都有断言），所以脚本只**列出来**，
// 由人逐条判断：前提是否该被 assert 出来。
//
// 用法：node scripts/audit-conditional-asserts.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'test')
const files = readdirSync(testDir).filter((name) => name.endsWith('.test.mjs'))

const findings = []

for (const name of files) {
  const lines = readFileSync(join(testDir, name), 'utf8').split(String.fromCharCode(10))
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    // 三种形态都抓：`if (…) {` 多行、`if (…) assert…` 单行、`if (…)` 换行后无花括号断言
    const braced = /^\s*if \([^)]*\)\s*\{\s*$/.test(line)
    const inlineAssert = /^\s*if \([^)]*\)\s*\{?\s*assert\./.test(line)
    const dangling = /^\s*if \([^)]*\)\s*$/.test(line)
    if (!braced && !inlineAssert && !dangling) continue
    if (inlineAssert) {
      findings.push({ file: name, line: i + 1, condition: line.trim().slice(0, 90), firstAssert: line.trim().slice(0, 90), hasElse: false })
      continue
    }
    const window = lines.slice(i + 1, i + 13)
    const assertLine = window.findIndex((text) => /\bassert\./.test(text))
    if (assertLine < 0) continue
    // 有 else 分支且 else 里也有 assert 的，属于正常两分支，跳过
    const blockText = window.slice(0, 10).join(String.fromCharCode(10))
    findings.push({
      file: name,
      line: i + 1,
      condition: line.trim().slice(0, 90),
      firstAssert: window[assertLine].trim().slice(0, 90),
      hasElse: /\belse\b/.test(blockText),
    })
  }
}

console.log('扫描 ' + files.length + ' 个测试文件')
console.log('疑似条件断言 ' + findings.length + ' 处：')
console.log('---')
for (const item of findings) {
  console.log((item.hasElse ? '（有 else，多半正常）' : '（需人工判断）') + ' ' + item.file + ':' + item.line)
  console.log('  条件：' + item.condition)
  console.log('  断言：' + item.firstAssert)
}
