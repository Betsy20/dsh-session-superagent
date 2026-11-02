// 生成 docs/回归清单.md：最容易退化的五项 + 每项的"改坏会红"验证。
//
// 清单来自 scripts/regression-list.mjs（regression-cases.mjs 也读它）。
//
// 用法：--write / --check / 无参数打印
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './regression-list.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', '回归清单.md')

const lines = [
  '# 回归清单：最容易退化的五项',
  '',
  '> 由 `scripts/render-regression-doc.mjs` 生成，清单来自 `scripts/regression-list.mjs`。',
  '> 每一项都配了"把它改坏，检查必须红"的反向用例（`node scripts/regression-cases.mjs`）。',
  '',
  '| # | 会退化成什么 | 反向用例怎么造 | 对应的知识库 |',
  '|---|---|---|---|',
  ...CASES.map((item, index) => '| ' + (index + 1) + ' | ' + item.what + ' | ' + item.name + ' | [`' + item.kb + '`](kb/' + item.kb + ') |'),
  '',
  '## 怎么跑',
  '',
  '```bash',
  'node scripts/regression-cases.mjs   # 5/5 通过才算没退化',
  '```',
  '',
  '已接进 `preflight`（「反向用例」一项）：任何一项"改坏不会红"，门禁整体就红。',
  '',
]

const body = lines.join('\n')
if (process.argv.includes('--write')) {
  writeFileSync(OUT, body)
  console.log('已写入 docs/回归清单.md（' + CASES.length + ' 项）')
} else if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(OUT, 'utf8') } catch {}
  if (current !== body) {
    console.log('FAIL 回归清单与用例清单不一致 —— 跑 node scripts/render-regression-doc.mjs --write')
    process.exitCode = 1
  } else {
    console.log('PASS 回归清单与用例一致（' + CASES.length + ' 项）')
  }
} else {
  console.log(body)
}
