// 把字段稳定性清单渲染成对外文档：契约要出现在客户看得见的地方，
// 不能只躺在 test/fixtures 里。
//
// 用法：
//   node scripts/render-contract.mjs           # 打印
//   node scripts/render-contract.mjs --write   # 写入 docs/json-契约.md
//   node scripts/render-contract.mjs --check   # 与文件比对（不一致退出码 1）
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'contract-stability.json'), 'utf8'))
const target = join(root, 'docs', 'json-契约.md')

const LEVEL = { stable: '稳定', experimental: '实验' }

function render() {
  const lines = []
  lines.push('# JSON 契约（由 `scripts/render-contract.mjs` 生成，不要手改）')
  lines.push('')
  lines.push('所有工具都支持 `format: \'json\'`，返回带 `schemaVersion` 的对象（当前 `1`）。')
  lines.push('')
  lines.push('**稳定性**：`稳定` = 不会无故改名或删除；`实验` = 可能变化，请容忍缺失。')
  lines.push('')
  for (const [tool, groups] of Object.entries(manifest)) {
    if (tool.startsWith('_')) continue
    lines.push('## ' + tool)
    lines.push('')
    for (const [group, fields] of Object.entries(groups)) {
      const where = group === 'root' ? '顶层' : (group === 'watcher' ? '`watchers[]` 每条' : (group === 'check' ? '`checks[]` 每条' : (group === 'result' ? '`results[]` 每条' : '`' + group + '`')))
      lines.push('**' + where + '**')
      lines.push('')
      lines.push('| 字段 | 稳定性 |')
      lines.push('|---|---|')
      for (const [field, level] of Object.entries(fields)) {
        lines.push('| `' + field + '` | ' + (LEVEL[level] || level) + ' |')
      }
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('')
  lines.push('新增字段必须登记在 `test/fixtures/contract-stability.json`，否则 `node --test` 会红；')
  lines.push('这份文档由清单生成，跑 `node scripts/render-contract.mjs --write` 刷新。')
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10)
}

const text = render()
const mode = process.argv[2] || ''
if (mode === '--write') {
  writeFileSync(target, text)
  console.log('已写入 docs/json-契约.md（' + text.split(String.fromCharCode(10)).length + ' 行）')
} else if (mode === '--check') {
  const saved = existsSync(target) ? readFileSync(target, 'utf8') : ''
  if (saved === text) {
    console.log('PASS 契约文档与清单一致（' + text.split(String.fromCharCode(10)).length + ' 行）')
  } else {
    console.log('FAIL docs/json-契约.md 与清单不一致 —— 跑 node scripts/render-contract.mjs --write')
    process.exitCode = 1
  }
} else {
  console.log(text)
}
