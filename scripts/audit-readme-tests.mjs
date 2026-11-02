// README 里写的「N 项单测」和实际用例数对得上吗？
//
// 用例数由调用方传进来（preflight 刚跑完 node --test，它知道真实数字）——
// 这样这条检查本身是零成本的；单独跑时才自己去数。
//
// 用法：node scripts/audit-readme-tests.mjs [实际用例数]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const claimed = (readme.match(/(\d+)\s*项单测/) || [])[1] || null

let actual = process.argv[2]
if (!actual) {
  const out = execFileSync('node', ['--test'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  actual = (out.match(/^ℹ tests (\d+)/m) || out.match(/# tests (\d+)/) || [])[1]
}

if (!claimed) {
  console.log('FAIL README 单测数  README 没写单测数')
  process.exitCode = 1
} else if (claimed !== String(actual)) {
  console.log('FAIL README 单测数  README 写 ' + claimed + '，实际 ' + actual + '（改 README）')
  process.exitCode = 1
} else {
  console.log('PASS README 单测数  README 写 ' + claimed + '，实际 ' + actual)
}
