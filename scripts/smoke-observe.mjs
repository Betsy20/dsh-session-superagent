// 进程内冒烟：不启动宿主、不碰真实状态目录，验证主理鱼的核心链路。
//
// 两个场景（都真的读 GitHub 只读 API，隔离场景还会真的建 git worktree）：
//   A 只观察 + 严格过滤：不唤醒、过滤记录落盘、原因可读、空轮询清掉过期状态
//   B 真唤醒 + 隔离执行：followup 被调用一次、消息含【主理鱼】/编号/本条目主理目标、
//     隔离 worktree 真的建在 .dsh-zhuli/ 下
//
// 用法： node scripts/smoke-observe.mjs [owner/repo]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO = process.argv[2] || 'MYCF711/dsh-GOkifu-compact'

// 先确认 gh 可用且已登录：没登录时应当「明确跳过」，而不是把网络/凭证问题混报成逻辑失败。
try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'pipe' })
} catch {
  console.log('SKIP   gh 未登录或不可用（先跑 gh auth login），本次冒烟无法进行')
  process.exit(0)
}
const realSetInterval = globalThis.setInterval
const realSetTimeout = globalThis.setTimeout
const realClearInterval = globalThis.clearInterval

let failures = 0
const report = (name, ok, extra = '') => {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''))
  if (!ok) failures += 1
}

/** 造一个宿主替身：捕获路由、定时器、以及 followup 消息。 */
async function boot({ tag }) {
  const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-smoke-' + tag + '-'))
  process.env.DSH_SUPERAGENT_STATE = stateDir
  globalThis.setInterval = () => ({ unref() {} })
  globalThis.clearInterval = () => {}

  // 每个场景重新加载模块，避免 STATE_DIR 在上一个场景里被算死
  const mod = await import('../lib/index.js?smoke=' + tag)
  const routes = new Map()
  const followups = []
  const agent = { status: 'idle', followup: (message) => followups.push(message) }
  const ctx = {
    tools: { register() {} },
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    agents: { get: (id) => (id === 'smoke-session' ? agent : undefined) },
    get: () => null,
    on() {},
    effect: (fn) => fn(),
  }
  mod.apply(ctx)

  const call = (path, { method = 'GET', body } = {}) => {
    const route = routes.get(path)
    if (!route) throw new Error('route missing: ' + path)
    return new Promise((resolve) => {
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
      }
      let status = 200
      const res = {
        set statusCode(value) { status = value },
        get statusCode() { return status },
        setHeader() {},
        end(text) { resolve({ status, text: text || '' }) },
      }
      route.handler(req, res)
    })
  }

  return { stateDir, call, followups }
}

const readState = (stateDir) => JSON.parse(readFileSync(join(stateDir, 'watchers.json'), 'utf8'))

// ── 场景 A：只观察 + 严格过滤 ────────────────────────────────────────────────
console.log('== 场景 A：只观察 + 标签白名单过滤（不该唤醒任何东西）==')
{
  const host = await boot({ tag: 'a' })
  await host.call('/session-superagent/watch', {
    method: 'POST',
    body: {
      repo: REPO,
      sessionId: 'smoke-session',
      intervalSec: 3600,
      observe: true,
      // 白名单标签必然不存在 → 全部被过滤
      filters: { labels: ['ai-fix'], skipClosed: false, skipBots: false, skipDrafts: false },
    },
  })
  // startWatcher 会立刻跑一轮 tick（异步），等它跑完
  await new Promise((resolve) => realSetTimeout(resolve, 7000))

  const entry = Object.values(readState(host.stateDir).watchers)[0]
  const projected = JSON.parse((await host.call('/session-superagent/state')).text).watchers[0] || {}
  report('观模式仍未唤醒', host.followups.length === 0, 'followups=' + host.followups.length)
  report('filteredLog 已落盘', (entry.filteredLog || []).length > 0, '条数=' + (entry.filteredLog || []).length)
  report('过滤原因可读', (entry.filteredLog || []).every((e) => typeof e.reason === 'string' && e.reason.length > 0))
  report('/state 能读到过滤记录', (projected.filteredLog || []).length > 0)
  report('空轮询清掉了过期的 lastDeferred', !projected.lastDeferred)
  rmSync(host.stateDir, { recursive: true, force: true })
}

// ── 场景 B：真唤醒 + 隔离执行 ────────────────────────────────────────────────
console.log('')
console.log('== 场景 B：真唤醒 + 隔离 worktree（消息要能直接用）==')
{
  const workdir = mkdtempSync(join(tmpdir(), 'zhuli-repo-'))
  const git = (...args) => execFileSync('git', ['-C', workdir, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('-c', 'user.name=smoke', '-c', 'user.email=smoke@test', 'commit', '-q', '--allow-empty', '-m', 'init')

  const host = await boot({ tag: 'b' })
  await host.call('/session-superagent/watch', {
    method: 'POST',
    body: {
      repo: REPO,
      sessionId: 'smoke-session',
      intervalSec: 3600,
      isolated: true,
      workdir,
      goal: '把 widget 的 issue 都处理完',
      filters: { skipClosed: false, skipBots: false, skipDrafts: false },
    },
  })
  await new Promise((resolve) => realSetTimeout(resolve, 9000))

  const entry = Object.values(readState(host.stateDir).watchers)[0]
  const first = host.followups[0]
  const text = (first && first.content && first.content[0] && first.content[0].text) || ''

  report('唤醒了一次', host.followups.length === 1, 'followups=' + host.followups.length)
  report('消息带【主理鱼】抬头', text.includes('【主理鱼】'), text.slice(0, 24).replace(/\n/g, ' '))
  report('消息带条目编号', /#\d+/.test(text))
  report('消息带本条目主理目标', text.includes('本条目主理目标：把 widget 的 issue 都处理完'))
  report('消息带隔离路径', /\.dsh-zhuli/.test(text))
  report('worktree 真的建了', !!(entry.lastWorktree && existsSync(entry.lastWorktree)), String(entry.lastWorktree || ''))
  report('.dsh-zhuli 下正好一个副本', (() => {
    try { return readdirSync(join(workdir, '.dsh-zhuli')).length === 1 } catch { return false }
  })())

  console.log('  消息预览：')
  for (const line of text.split(String.fromCharCode(10))) console.log('    ' + line.slice(0, 100))

  // 清理：worktree + 分支 + 临时仓库
  try {
    if (entry.lastWorktree) git('worktree', 'remove', '--force', entry.lastWorktree)
    for (const line of execFileSync('git', ['-C', workdir, 'branch', '--list', 'zhuli/*'], { encoding: 'utf8' }).split(String.fromCharCode(10))) {
      const name = line.replace('*', '').trim()
      if (name) git('branch', '-D', name)
    }
  } catch {}
  rmSync(host.stateDir, { recursive: true, force: true })
  rmSync(workdir, { recursive: true, force: true })
}

globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval
console.log('')
console.log(failures === 0 ? '全部通过' : failures + ' 项失败')
if (failures > 0) process.exit(1)
