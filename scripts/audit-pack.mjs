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
import { acquireGate } from './gate-lock.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// **先拿锁再跑 npm pack**：反过来的话，别人正在改 package.json 时读到的是半成品，
// 锁等再久也不会重跑 —— 于是假红（文件早还原了，检查还报缺文件）。审核 M1 实测过。
let releaseGate = () => {}
try {
  releaseGate = acquireGate('mutate', { timeoutMs: 180000 })
} catch (error) {
  // 只读检查不该因为「别人正在跑门禁」而变红：明确说跳过，并给出是谁占着
  if (error && error.code === 'GATE_BUSY') {
    // 审核 M6：以前 exit 0 → preflight 的 record(..., res.status === 0) 记成 PASS，
    // 「全部通过（N 项检查）」里含一项**根本没跑**的检查。独立退出码 3 = 跳过（不是通过）。
    console.log('SKIP npm pack 内容  另一个门禁正在跑（pid ' + (error.owner && error.owner.pid) + '），本次跳过')
    process.exit(3)
  }
  throw error
}
process.on('exit', () => { try { releaseGate() } catch { /* 尽力而为 */ } })

const res = process.platform === 'win32'
  ? spawnSync('cmd.exe', ['/c', 'npm', 'pack', '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
  : spawnSync('npm', ['pack', '--dry-run'], { cwd: ROOT, encoding: 'utf8' })
const out = String(res.stdout || '') + String(res.stderr || '')
const files = (out.match(/total files:\s+(\d+)/) || [])[1]
// 之前写成固定字符串 'npm notice test/'，而实际每行是 `npm notice 2.7kB test/x.mjs`
// —— 尺寸前缀一插进来，这条检查就永远匹配不到（等于没检查）。
// 必需文件：装了但缺任何一个，插件要么不挂载、要么面板空白
const REQUIRED = [
  'lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/gitee.js', 'lib/redact.js', 'lib/body.js',
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
