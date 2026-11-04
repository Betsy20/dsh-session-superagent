import { readFileSync, writeFileSync } from 'node:fs'

const p = 'scripts/preflight.mjs'
let s = readFileSync(p, 'utf8')

// ① record() 支持 'skip'：跳过**不是通过**，单独打印，也不进「全部通过」
const fromRecord = `const record = (name, ok, detail = '', ms = null) => {
  const now = Date.now()
  if (ms === null) ms = now - lastMark
  lastMark = now
  rows.push({ name, ok, detail, ms })
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(34) + detail + (ms === null ? '' : '  (' + (ms / 1000).toFixed(1) + 's)'))
}`
if (!s.includes(fromRecord)) {
  console.error('record 锚点缺失')
  process.exit(1)
}
const toRecord = `const record = (name, ok, detail = '', ms = null) => {
  const now = Date.now()
  if (ms === null) ms = now - lastMark
  lastMark = now
  // 审核 M6：'skip' 是第三种状态 —— 这项**没跑**（比如另一个门禁占着锁）。
  // 以前调用方传 exit 0 就被记成 PASS，汇总里含一项没跑的检查，是假绿。
  rows.push({ name, ok, detail, ms })
  const tag = ok === 'skip' ? 'SKIP ' : ok ? 'PASS ' : 'FAIL '
  console.log(tag + name.padEnd(34) + detail + (ms === null ? '' : '  (' + (ms / 1000).toFixed(1) + 's)'))
}`
s = s.replace(fromRecord, toRecord)

// ② 汇总里把跳过单独说
const fromSummary = "console.log(failures.length === 0 ? `全部通过（${rows.length} 项检查）` : `${failures.length} 项失败`)"
if (!s.includes(fromSummary)) {
  console.error('summary 锚点缺失')
  process.exit(1)
}
const toSummary = [
  "const skipped = rows.filter((row) => row.ok === 'skip')",
  'console.log(',
  '  failures.length > 0',
  '    ? `${failures.length} 项失败`',
  "    : skipped.length > 0",
  "      ? `通过 ${rows.length - skipped.length} 项，跳过 ${skipped.length} 项（跳过的没跑，不算通过）`",
  '      : `全部通过（${rows.length} 项检查）`,',
  ')',
].join('\n')
s = s.replace(fromSummary, toSummary)

writeFileSync(p, s)
console.log('preflight 支持 SKIP 状态')
