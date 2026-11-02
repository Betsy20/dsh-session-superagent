// README 里写死的数字/说法，和代码里的常量对不对得上？
//
// 为什么需要：README 是客户第一份契约，但改常量时没人会想起它。
// 这里只查"能从代码里读出来"的那几条，查不了的（体验类描述）不硬凑。
//
// 用法：node scripts/verify-readme-claims.mjs
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const indexSource = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')
const watchSource = readFileSync(join(ROOT, 'lib', 'watch.js'), 'utf8')

const failures = []
const checks = []

function expect(label, ok, detail) {
  checks.push({ label, ok, detail })
  if (!ok) failures.push(label + '：' + detail)
}

// ① 轮询范围 30–3600
const clamp = (indexSource.match(/Math\.max\((\d+), Math\.min\((\d+), Math\.round\(args\.intervalSec\)\)\)/) || [])
expect('轮询范围', clamp[1] === '30' && clamp[2] === '3600' && readme.includes('30–3600'),
  '代码 ' + (clamp[1] || '?') + '–' + (clamp[2] || '?') + ' / README ' + (readme.includes('30–3600') ? '30–3600' : '没写'))

// ② 冷却期 3 分钟
const cooldown = Number((indexSource.match(/const DEFAULT_COOLDOWN_MS = ([\d_]+)/) || [])[1]?.replace(/_/g, '') || NaN)
expect('冷却期', cooldown === 180000 && readme.includes('冷却期 **3 分钟**'),
  '代码 ' + (cooldown / 60000) + ' 分钟 / README ' + (readme.includes('冷却期 **3 分钟**') ? '3 分钟' : '没写'))

// ③ 会话上限 12 次/小时
const sessionCap = Number((indexSource.match(/const DEFAULT_SESSION_WAKES = (\d+)/) || [])[1] || NaN)
expect('会话上限', sessionCap === 12 && readme.includes('12 次/小时'), '代码 ' + sessionCap + ' / README ' + (readme.includes('12 次/小时') ? '12' : '没写'))

// ④ 单守上限 6 次/小时
const perWatcher = Number((watchSource.match(/maxWakesPerHour\s*=\s*(\d+)/) || [])[1] || NaN)
expect('单守上限', (perWatcher === 6 || indexSource.includes('maxWakesPerHour ?? 6')) && readme.includes('6 次/小时'),
  '代码 ' + (perWatcher || '??6') + ' / README ' + (readme.includes('6 次/小时') ? '6' : '没写'))

// ⑤ 隔离区默认 5 个 / 3 天
expect('隔离区默认', indexSource.includes('maxIsolated: w.maxIsolated ?? 5') && indexSource.includes('isolateKeepDays: w.isolateKeepDays ?? 3')
  && readme.includes('最多** 5 个**') || readme.includes('最多 5 个'),
  '代码 5 个/3 天 / README ' + (readme.includes('5 个') ? '有' : '没写'))

// ⑥ 状态文件路径
expect('状态路径', readme.includes('.dsh/state/session-superagent/watchers.json') && indexSource.includes("'watchers.json'"),
  'README / 代码 路径一致性')

// ⑦ README 提到的脚本都真实存在
const mentioned = [...readme.matchAll(/node (scripts\/[\w.-]+\.mjs)/g)].map((m) => m[1])
const missingScripts = [...new Set(mentioned)].filter((rel) => {
  try { readFileSync(join(ROOT, rel)); return false } catch { return true }
})
expect('README 里的脚本', missingScripts.length === 0, missingScripts.length ? '不存在：' + missingScripts.join(', ') : mentioned.length + ' 个都存在')

// ⑧ README 提到的工具都真的注册
const toolNames = []
const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-readme-'))
process.env.DSH_SUPERAGENT_STATE = stateDir
process.env.DSH_SUPERAGENT_NO_POLL = '1'
const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href + '?claims=' + Date.now())
mod.apply({
  tools: { register: (tool) => toolNames.push(tool.name) },
  webServer: { register: () => () => {} },
  agents: { get: () => null, currentInitiator: () => null },
  get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
})
const advertised = [...new Set([...readme.matchAll(/`(watch_[a-z]+|repo_here|github)`/g)].map((m) => m[1]))]
const notRegistered = advertised.filter((name) => !toolNames.includes(name))
expect('README 里的工具', notRegistered.length === 0, notRegistered.length ? '没注册：' + notRegistered.join(', ') : advertised.length + ' 个都在')

rmSync(stateDir, { recursive: true, force: true })
console.log('README 声明 ' + checks.length + ' 组 / 对照代码')
console.log('---')
for (const item of checks) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.label.padEnd(12) + item.detail)
console.log('---')
if (failures.length > 0) {
  console.log('FAIL ' + failures.length + ' 项对不上：')
  for (const item of failures) console.log('  ' + item)
  process.exitCode = 1
} else {
  console.log('PASS README 的说法与代码一致（' + checks.length + ' 组）')
}
