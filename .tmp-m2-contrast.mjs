import { readFileSync, writeFileSync } from 'node:fs'

const p = 'scripts/preflight.mjs'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const NL = crlf ? '\r\n' : '\n'
let s = raw

// M2（T28）：res.status === 2（没有浏览器）时先 record(..., true) 记成 PASS，
// 然后 if/else 结束后**又无条件** record 一次 → 同名两行 PASS，且「没量」被当成「达标」。
// 对比度回归在 CI 里永远绿。
const from = [
  '  if (res.status === 2) {',
  "    record('对比度体检', true, '跳过：本机没有可用的浏览器（CI 环境正常现象）')",
  "  } else if (!light || !dark) bad.push('量不到数据（渲染/浏览器失败）')",
  '  else {',
].join(NL)

if (!s.includes(from)) {
  console.error('M2 锚点缺失')
  process.exit(1)
}

const to = [
  '  // 审核 T28 M2：以前这里先 record 一次 PASS，末尾又无条件 record 一次 → 同名两行 PASS，',
  '  // 而且「没量」被记成「达标」，对比度回归在 CI 里永远绿。',
  '  // 现在用第三种状态 skip：不进「全部通过」，也不谎报达标。',
  '  const skipped = res.status === 2',
  "  if (skipped) {",
  "    record('对比度体检', 'skip', '没量：本机没有可用的浏览器（CI 环境正常现象，但不算通过）')",
  "  } else if (!light || !dark) bad.push('量不到数据（渲染/浏览器失败）')",
  '  else {',
].join(NL)

s = s.replace(from, to)

// 末尾那次 record 只在没跳过时执行
const fromTail = "  record('对比度体检', bad.length === 0, bad.length ? bad[0] : (light && dark ? '浅色 ' + light.groups + ' / 深色 ' + dark.groups + ' 组（不高于基线）' : '无数据'))"
if (!s.includes(fromTail)) {
  console.error('M2 尾部锚点缺失')
  process.exit(1)
}
s = s.replace(fromTail, [
  '  if (!skipped) {',
  fromTail.replace(/^  /, '    '),
  '  }',
].join(NL))

writeFileSync(p, s)
console.log('M2 已修（跳过不再记成 PASS，也不再重复 record）')
