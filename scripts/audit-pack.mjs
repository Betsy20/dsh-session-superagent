// 打包内容体检：`npm pack --dry-run` 里不该出现的东西（测试、临时文件、node_modules、.tgz）。
//
// 抽成独立脚本的原因：preflight 要它、注入验证也要它 ——
// 之前注入验证为了跑这一项得跑整套 preflight（多花 30 秒），
// 而"注入验证要快"是它能不能被经常跑的前提。
//
// 用法：node scripts/audit-pack.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// npm 把 notice 写到 stderr，所以两路都要收（之前只读 stdout 拿到 undefined）
const res = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/c', 'npm', 'pack', '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
  : spawnSync('npm', ['pack', '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
const out = String(res.stdout || '') + String(res.stderr || '')

const files = (out.match(/total files:\s+(\d+)/) || [])[1]
// 之前写成固定字符串 'npm notice test/'，而实际每行是 `npm notice 2.7kB test/x.mjs`
// —— 尺寸前缀一插进来，这条检查就永远匹配不到（等于没检查）。
// 必需文件：装了但缺任何一个，插件要么不挂载、要么面板空白
const REQUIRED = [
  'lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'lib/body.js',
  'client.js', 'cordis.patch.yml', 'package.json', 'README.md', 'LICENSE',
]
// 从 npm notice 行里取文件名（最后一段），再逐条比对
const listed = out.split(String.fromCharCode(10))
  .filter((line) => line.startsWith('npm notice ') && /\s\S+$/.test(line))
  .map((line) => line.trim().split(/\s+/).pop())
const missingRequired = REQUIRED.filter((rel) => !listed.includes(rel))
const LEAK_PATTERNS = [
  ['test/', /npm notice .*\s(test\/)/],
  ['.tmp-', /npm notice .*\.tmp-/],
  ['preview-panel.html', /npm notice .*preview-panel\.html/],
  ['release/', /npm notice .*\s(release\/)/],
  ['node_modules/', /npm notice .*node_modules\//],
  ['.tgz', /npm notice \d+(\.\d+)?[kM]?B \S+\.tgz/],
]
const leaked = []
for (const [name, pattern] of LEAK_PATTERNS) {
  if (pattern.test(out)) leaked.push(name)
}

if (res.status === 0 && leaked.length === 0 && missingRequired.length === 0) {
  console.log('PASS npm pack 内容  ' + files + ' 个文件')
} else {
  console.log('FAIL npm pack 内容  ' + files + ' 个文件'
    + (leaked.length ? '（含：' + leaked.join(', ') + '）' : '')
    + (missingRequired.length ? '（缺：' + missingRequired.join(', ') + '）' : ''))
  process.exitCode = 1
}
