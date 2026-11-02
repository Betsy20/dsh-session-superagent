// 临时目录收口：测试不许自己建 mkdtemp（要统一走 test/fixtures/tmpdir.mjs，退出时自动清理）。
// 抽成独立脚本：preflight 与注入验证共用，省掉跑整套 preflight 的时间。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(ROOT, 'test')
const helper = join(testDir, 'fixtures', 'tmpdir.mjs')

const bad = []
for (const name of readdirSync(testDir)) {
  if (!name.endsWith('.test.mjs')) continue
  const text = readFileSync(join(testDir, name), 'utf8')
  if (text.includes('mkdtempSync(join(tmpdir()')) bad.push(name)
}

if (bad.length === 0 && existsSync(helper)) {
  console.log('PASS 临时目录收口  全部走 tempDir()，退出时自动清理')
} else {
  console.log('FAIL 临时目录收口  ' + (bad.length > 0 ? '这些测试还在自己建临时目录：' + bad.join(', ') : '缺少 test/fixtures/tmpdir.mjs'))
  process.exitCode = 1
}
