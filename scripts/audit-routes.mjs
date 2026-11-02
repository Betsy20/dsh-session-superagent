// 路由面体检：apply 之后必须正好 9 条路由，且路径集合符合期望。
//
// 抽成独立脚本的原因：注入验证要频繁跑它（改一条路由路径看它红不红），
// 跑整套 preflight 太慢。
//
// 用法：node scripts/audit-routes.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPECTED = ['state', 'client-note', 'client-error', 'watch', 'credentials', 'diagnose', 'update', 'goal', 'trace']

const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-routes-audit-'))
process.env.DSH_SUPERAGENT_STATE = stateDir
process.env.DSH_SUPERAGENT_NO_POLL = '1'

let count = 0
const paths = []
let failure = ''
try {
  // Windows 上绝对路径必须转成 file:// URL，否则 ESM loader 会报 protocol 'd:'
  const mod = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href + '?audit=' + Date.now())
  mod.apply({
    tools: { register() {} },
    webServer: { register: (r) => { count += 1; paths.push(r.path); return () => {} } },
    agents: { get: () => null, currentInitiator: () => null },
    get: () => null, on() {}, effect: (fn) => fn(),
  })
} catch (error) {
  failure = 'apply 抛错：' + String((error && error.message) || error)
} finally {
  rmSync(stateDir, { recursive: true, force: true })
}

const names = paths.map((p) => p.split('/').pop())
const missing = EXPECTED.filter((name) => !names.includes(name))
const extra = names.filter((name) => !EXPECTED.includes(name))

if (!failure && count === 9 && missing.length === 0 && extra.length === 0) {
  console.log('PASS 路由面（9 条）  ' + names.join(' '))
} else {
  const why = failure || (count !== 9 ? '数量 ' + count + '（期望 9）' : '缺 ' + missing.join(',') + ' 多 ' + extra.join(','))
  console.log('FAIL 路由面（9 条）  ' + why)
  process.exitCode = 1
}
