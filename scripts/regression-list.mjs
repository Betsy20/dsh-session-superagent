// 最容易退化的五项 —— 每一项都配一个"改坏它，检查必须红"的反向用例。
//
// 这份清单同时被：
//   scripts/regression-cases.mjs    —— 真跑一遍（preflight 第 35 项）
//   scripts/render-regression-doc.mjs —— 生成 docs/回归清单.md
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CASES = [
  {
    name: 'README 数字漂移',
    kb: 'readme-numbers-come-from-code.md',
    what: 'README 写死的单测数/冷却期等与代码不一致',
    fault: (root) => {
      const path = join(root, 'README.md')
      const original = readFileSync(path, 'utf8')
      // 用 README 里现有的数字当"真实值"（它和实际用例数是否一致，由 preflight 另一条检查守）
      const claimed = (original.match(/(\d+)\s*项单测/) || [])[1]
      writeFileSync(path, original.replace(/(\d+)\s*项单测/, '9999 项单测'))
      return {
        restore: () => writeFileSync(path, original),
        check: ['scripts/audit-readme-tests.mjs', claimed || '0'],
      }
    },
  },
  {
    name: '整句文案重复',
    kb: 'recurring-theme-means-missing-check.md',
    what: '同一句中文在源码里出现两次（改一处忘另一处）',
    fault: (root) => {
      const path = join(root, 'client.js')
      const original = readFileSync(path, 'utf8')
      const dup = '这是一个足够长的重复文案用来验证检查确实会红'
      const q = String.fromCharCode(39)
      const nl = String.fromCharCode(10)
      // 拼出两行完全相同的字面量（带引号！第一版忘了引号，拼出来的 JS 本身就不合法）
      const injected = nl + 'const ZZ_DUP = ' + q + dup + q + nl + 'const ZZ_DUP2 = ' + q + dup + q + nl
      writeFileSync(path, original + injected)
      return () => writeFileSync(path, original)
    },
    check: ['scripts/audit-duplicate-copy.mjs'],
  },
  {
    name: '打包缺必需文件',
    kb: 'pack-check-both-directions.md',
    what: '运行必需的文件没进 npm 包（装上但不工作）',
    fault: (root) => {
      const path = join(root, 'package.json')
      const original = readFileSync(path, 'utf8')
      const data = JSON.parse(original)
      data.files = ['lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE', 'client.js']
      writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
      return () => writeFileSync(path, original)
    },
    check: ['scripts/audit-pack.mjs'],
  },
  {
    name: '模式差异文档漂移',
    kb: 'cheap-mode-needs-a-contract.md',
    what: '改了「--fast 跳过什么」的清单但没重新生成文档',
    fault: (root) => {
      const path = join(root, 'docs', 'preflight-modes.md')
      const original = readFileSync(path, 'utf8')
      writeFileSync(path, original + '\n手工加一行：这条说明文档被手改了\n')
      return () => writeFileSync(path, original)
    },
    check: ['scripts/render-preflight-modes.mjs', '--check'],
  },
  {
    name: '计数加不上总数',
    kb: 'counters-must-partition.md',
    what: '面板顶部「主理中/已暂停/异常/时段外」加起来不等于总数',
    fault: (root) => {
      const path = join(root, 'client.js')
      const original = readFileSync(path, 'utf8')
      // 把异步的 dormant 计数写死为 0 —— 和 0.9.104 修之前一模一样的病
      writeFileSync(path, original.replace('const dormant = byState.dormant', 'const dormant = 0'))
      return () => writeFileSync(path, original)
    },
    check: ['--test', '--test-name-pattern=顶部四个计数必须加得上总数', 'test/client.test.mjs'],
  },
]
