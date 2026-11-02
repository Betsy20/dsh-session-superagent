// 生成 docs/preflight-modes.md：两种模式差在哪、跳过什么、风险是什么。
//
// 清单来自 scripts/preflight-modes.mjs（preflight 自己也读它），所以文档不会和实际行为漂开。
//
// 用法：
//   node scripts/render-preflight-modes.mjs          # 打印
//   node scripts/render-preflight-modes.mjs --write  # 写文件
//   node scripts/render-preflight-modes.mjs --check  # 与文件比对
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAST_SKIPS } from './preflight-modes.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'preflight-modes.md')

const lines = [
  '# preflight 的两种模式',
  '',
  '> 这份文档由 `scripts/render-preflight-modes.mjs` 生成，清单来自 `scripts/preflight-modes.mjs`。',
  '> 手改会被 `preflight` 的「模式差异文档」检查发现。',
  '',
  '| 模式 | 用途 | 约耗时 |',
  '|---|---|---|',
  '| 全量 `node scripts/preflight.mjs` | 提交前 / 发布前 | 约 30 秒 |',
  '| 快速 `node scripts/preflight.mjs --fast` | 边改边跑 | 约 12 秒 |',
  '',
  '## `--fast` 会跳过什么',
  '',
  '| 跳过的检查 | 为什么跳过 | 跳过后的风险 |',
  '|---|---|---|',
  ...FAST_SKIPS.map((item) => '| ' + item.name + ' | ' + item.why + ' | ' + item.risk + ' |'),
  '',
  '## 什么时候必须跑全量',
  '',
  '- 提交前（`--fast` 全绿**不代表**可以提交）',
  '- 改了任何 `scripts/*` 检查脚本之后（注入验证要重新确认它们真的会红）',
  '- 发布前一版（`npm publish` 之前）',
  '',
]

const body = lines.join('\n')
if (process.argv.includes('--write')) {
  writeFileSync(OUT, body)
  console.log('已写入 docs/preflight-modes.md（' + FAST_SKIPS.length + ' 项差异）')
} else if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(OUT, 'utf8') } catch {}
  if (current !== body) {
    console.log('FAIL 模式差异文档与清单不一致 —— 跑 node scripts/render-preflight-modes.mjs --write')
    process.exitCode = 1
  } else {
    console.log('PASS 模式差异文档与清单一致（' + FAST_SKIPS.length + ' 项）')
  }
} else {
  console.log(body)
}
