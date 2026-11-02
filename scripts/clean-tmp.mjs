// 清理测试留下的临时目录（只删我们自己的前缀）。
// 用法：node scripts/clean-tmp.mjs [--dry]
import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 前缀来自各个脚本的 mkdtemp 命名；漏一个就会在 tmpdir 里越攒越多
const PREFIX = /^(superagent-|zhuli-|preflight-)/
const dry = process.argv.includes('--dry')
const root = tmpdir()
const names = readdirSync(root).filter((name) => PREFIX.test(name))

let removed = 0
let bytes = 0
for (const name of names) {
  const full = join(root, name)
  try {
    if (!statSync(full).isDirectory()) continue
    if (!dry) rmSync(full, { recursive: true, force: true })
    removed += 1
  } catch { /* 被占用就跳过 */ }
}

console.log((dry ? '（演练，不删）' : '') + '清理 ' + removed + ' 个临时目录：' + root)
if (dry) for (const name of names.slice(0, 5)) console.log('  ' + name)
