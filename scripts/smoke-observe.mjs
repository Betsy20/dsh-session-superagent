// 进程内冒烟：不启动宿主、不碰真实状态目录，验证「只观察 + 过滤记录」这条链路。
//
// 背景：0.8.13 修了两个只有真机才暴露的 bug（filteredLog 没落盘、空轮询不清 lastDeferred）。
// 这两个修复在线上要等重载才生效，所以这里用一个独立进程 + 独立状态目录 + 捕获 setInterval
// 的方式跑一遍真实代码路径（会真的读 GitHub 只读 API）。
//
// 用法： node scripts/smoke-observe.mjs [owner/repo]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const repo = process.argv[2] || 'MYCF711/dsh-GOkifu-compact'
const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-smoke-'))
process.env.DSH_SUPERAGENT_STATE = stateDir

// 捕获定时器回调，稍后手动驱动一轮（不要让真定时器跑）
const ticks = []
const realSetInterval = globalThis.setInterval
const realSetTimeout = globalThis.setTimeout
globalThis.setInterval = (fn, ms) => { ticks.push({ fn, ms }); return { unref() {} } }
globalThis.clearInterval = () => {}

const { apply } = await import('../lib/index.js')

const routes = new Map()
const followups = []
const agent = {
  status: 'idle',
  followup(message) { followups.push(message) },
}
const ctx = {
  tools: { register() {} },
  webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
  agents: { get: (id) => (id === 'smoke-session' ? agent : undefined) },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
}
apply(ctx)

function call(path, { method = 'GET', body } = {}) {
  const route = routes.get(path)
  if (!route) throw new Error('route missing: ' + path)
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = {
      method,
      url: path,
      headers: { 'content-type': 'application/json' },
      on(event, handler) {
        if (event === 'data') handler(Buffer.from(payload))
        if (event === 'end') handler()
        return req
      },
      onEnd: null,
    }
    const chunks = []
    let statusCode = 200
    const res = {
      set statusCode(value) { statusCode = value },
      get statusCode() { return statusCode },
      setHeader() {},
      end(text) { resolve({ statusCode, text: text || '' }) },
    }
    try { route.handler(req, res) } catch (error) { reject(error) }
  })
}

const created = await call('/session-superagent/watch', {
  method: 'POST',
  body: {
    repo,
    sessionId: 'smoke-session',
    intervalSec: 3600,
    observe: true,
    // 造一个必然过滤掉所有的条件：白名单标签不存在
    filters: { labels: ['ai-fix'], skipClosed: false, skipBots: false, skipDrafts: false },
  },
})
console.log('create:', created.statusCode, created.text.slice(0, 120))

// startWatcher 会立刻跑一次 tick（异步，不 await），所以这里等它跑完
// （真实 gh 请求通常 1-3 秒；给足余量）。注意 apply() 里还有一个 5 秒 sweep 定时器，
// 不要拿 ticks[0] 当 watcher 的 tick。
console.log('捕获到的定时器: ' + ticks.map((t) => t.ms + 'ms').join(', '))
await new Promise((resolve) => realSetTimeout(resolve, 7000))

const state = JSON.parse(readFileSync(join(stateDir, 'watchers.json'), 'utf8'))
const entry = Object.values(state.watchers)[0]
const watcher = (await call('/session-superagent/state')).text
const projected = JSON.parse(watcher).watchers[0] || {}

console.log('调试 entry:', JSON.stringify({
  lastPoll: entry.lastPoll, lastError: entry.lastError, lastDeferred: entry.lastDeferred,
  filteredLogLen: (entry.filteredLog || []).length, seenKeys: Object.keys(entry.seen || {}).length,
}, null, 0))

const checks = [
  ['观模式仍未唤醒', followups.length === 0],
  ['filteredLog 已落盘', Array.isArray(entry.filteredLog) && entry.filteredLog.length > 0],
  ['过滤原因可读', (entry.filteredLog || []).every((e) => typeof e.reason === 'string' && e.reason.length > 0)],
  ['/state 能读到过滤记录', Array.isArray(projected.filteredLog) && projected.filteredLog.length > 0],
  ['空轮询清掉了过期的 lastDeferred', !projected.lastDeferred],
]

let failed = 0
for (const [name, ok] of checks) {
  console.log((ok ? 'OK   ' : 'FAIL ') + name)
  if (!ok) failed += 1
}
console.log('---')
console.log('过滤原因样例:', JSON.stringify((entry.filteredLog || []).slice(0, 3), null, 0))
console.log('唤醒次数:', followups.length, '/ 本轮本会唤醒:', projected.lastDeferred || '(无)')

globalThis.setInterval = realSetInterval
rmSync(stateDir, { recursive: true, force: true })
if (failed > 0) process.exit(1)
