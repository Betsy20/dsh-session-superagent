// T40 W9/W10/W11 独立验收：只走真实工具 / HTTP 入口，不改生产实现。
// 所有状态都落在临时目录；Gitee 请求全部由本地假 fetch 应答。
import assert from 'node:assert/strict'
import test from 'node:test'

import { assertTempStateDir, tempDir } from './fixtures/tmpdir.mjs'

const ENV_KEYS = ['DSH_SUPERAGENT_STATE', 'DSH_SUPERAGENT_NO_POLL']
const snapshotEnv = () => Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const restoreEnv = (snapshot) => {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key]
    else process.env[key] = snapshot[key]
  }
}

// import 之前先指向临时目录，杜绝任何装载期写入真实 ~/.dsh 的可能。
const processEnv = snapshotEnv()
const processFetch = globalThis.fetch
process.env.DSH_SUPERAGENT_STATE = tempDir('zhuli-entry-parity-import-')
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const mod = await import('../lib/index.js')
const tools = []
const routes = new Map()
const sessionId = 'session-entry-parity-final'
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agents: { currentInitiator: () => ({ id: sessionId }), get: () => null },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
  inject: () => {},
}
mod.apply(ctx)

const start = tools.find((tool) => tool.name === 'watch_start')
const stop = tools.find((tool) => tool.name === 'watch_stop')
const trace = tools.find((tool) => tool.name === 'watch_trace')
const traceRoute = routes.get('/session-superagent/trace')
assert.ok(start && stop && trace && traceRoute, '验收所需的工具与 trace 路由都已注册')

test.after(() => {
  globalThis.fetch = processFetch
  restoreEnv(processEnv)
})

function useTempState(prefix, noPoll) {
  const previous = snapshotEnv()
  process.env.DSH_SUPERAGENT_STATE = tempDir(prefix)
  process.env.DSH_SUPERAGENT_NO_POLL = noPoll
  assertTempStateDir(prefix)
  return () => restoreEnv(previous)
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { if (chunk !== undefined) this.chunks.push(String(chunk)) },
    json() { return JSON.parse(this.chunks.join('')) },
  }
}

test('W9：Gitee 新建真跑体检，JSON warnings 与 entry.repoAccess 同时落地', async () => {
  const restore = useTempState('zhuli-entry-parity-gitee-', '0')
  const originalFetch = globalThis.fetch
  const requested = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requested.push(url)
    const pathname = new URL(url).pathname
    // mapGiteeRepoAccess 明确把 has_issues:false 映射为 hasIssues:false；
    // repoStructureNote 因此产生“关闭了 Issues”警告。permissions 使用 Gitee 的真实嵌套形状。
    const data = pathname === '/api/v5/repos/acme/demo'
      ? {
          full_name: 'acme/demo',
          has_issues: false,
          private: false,
          fork: false,
          permissions: { admin: false, push: false, pull: true },
        }
      : pathname === '/api/v5/user'
        ? { login: 'offline-acceptance' }
        : []
    return { ok: true, status: 200, text: async () => JSON.stringify(data) }
  }

  try {
    let raw
    try {
      raw = await start.execute({ repo: 'gitee:acme/demo', format: 'json' })
    } finally {
      // NO_POLL=0 会安装真实 timer；无论断言是否成功都先停掉它。
      await stop.execute({ repo: 'gitee:acme/demo', format: 'json' })
    }

    const result = JSON.parse(raw)
    assert.equal(result.ok, true)
    assert.equal(result.repo, 'acme/demo')
    assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0, 'JSON 顶层要有体检 warnings')
    assert.ok(result.warnings.some((warning) => warning.includes('acme/demo 关闭了 Issues')), JSON.stringify(result.warnings))
    assert.deepEqual(result.repos[0].warnings, result.warnings, '每个仓库的 warnings 与汇总口径一致')
    assert.ok(requested.includes('https://gitee.com/api/v5/repos/acme/demo'), 'precheck 必须真的请求仓库端点')

    const id = 'gitee:acme/demo#' + sessionId
    const entry = mod.__test.readState().watchers[id]
    assert.ok(entry, '新建 watcher 已落盘')
    assert.ok(entry.repoAccess && typeof entry.repoAccess === 'object', '体检结果写入 entry.repoAccess')
    assert.equal(entry.repoAccess.repo, 'acme/demo')
    assert.equal(entry.repoAccess.hasIssues, false)
    assert.equal(entry.repoAccess.push, false)
    assert.ok(entry.repoAccess.checkedAt, '体检时间也必须保留')
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('W10：isolated=true 且未给 workdir 时，工具入口兜底 process.cwd()', async () => {
  const restore = useTempState('zhuli-entry-parity-isolated-', '1')
  try {
    let raw
    try {
      raw = await start.execute({ repo: 'acme/iso', isolated: true })
    } finally {
      await stop.execute({ repo: 'acme/iso' })
    }
    assert.match(String(raw), /^watching acme\/iso /)

    const id = 'acme/iso#' + sessionId
    const entry = mod.__test.readState().watchers[id]
    assert.ok(entry, '隔离 watcher 已落盘')
    assert.equal(entry.isolated, true)
    assert.equal(entry.workdir, process.cwd())
  } finally {
    restore()
  }
})

test('W11：工具与 HTTP 的正常、异常/吸收及无痕迹文本逐字一致', async () => {
  const restore = useTempState('zhuli-entry-parity-trace-', '1')
  const repo = 'acme/trace'
  const id = repo + '#' + sessionId
  try {
    mod.__test.writeState({
      watchers: {
        [id]: {
          id,
          repo,
          provider: 'github',
          sessionId,
          enabled: false,
          seen: {
            42: '2026-11-05T08:00:00.000Z',
            43: '2026-11-05T08:01:00.000Z',
          },
          lastReported: {
            42: '2026-11-05T08:02:00.000Z',
            43: '2026-11-05T08:03:00.000Z',
          },
          filteredLog: [
            { number: '42', at: '2026-11-05T08:04:00.000Z', reason: '作者不在白名单', title: '异常样例' },
          ],
          absorbedLog: [
            { number: '42', at: '2026-11-05T08:05:00.000Z', title: '异常样例' },
          ],
          history: [
            { numbers: [42], at: '2026-11-05T08:06:00.000Z', ok: false, reason: 'agent busy' },
            { numbers: [43], at: '2026-11-05T08:07:00.000Z', ok: true },
          ],
        },
      },
    })

    const parity = async (number) => {
      const toolText = String(await trace.execute({ repo, number }))
      const query = new URLSearchParams({ repo, number: String(number) })
      const res = makeRes()
      await traceRoute.handler({ method: 'GET', url: '/session-superagent/trace?' + query, headers: {} }, res)
      assert.equal(res.statusCode, 200)
      const body = res.json()
      assert.equal(body.ok, true)
      assert.equal(body.text, toolText, 'HTTP body.text 必须与工具文本逐字一致（#' + number + '）')
      return toolText
    }

    const abnormal = await parity(42)
    assert.match(abnormal, /水位 seen：2026-11-05T08:00:00\.000Z/)
    assert.match(abnormal, /上次上报：2026-11-05T08:02:00\.000Z/)
    assert.match(abnormal, /被过滤（作者不在白名单）/)
    assert.match(abnormal, /被冷却期吸收：2026-11-05T08:05:00\.000Z/)
    assert.match(abnormal, /唤醒尝试：2026-11-05T08:06:00\.000Z　失败（agent busy）/)

    const normal = await parity(43)
    assert.match(normal, /最近一次唤醒：2026-11-05T08:07:00\.000Z（成功）/)
    assert.doesNotMatch(normal, /水位 seen：/, 'quiet=true 的正常分支也必须走同一个 formatter')

    const noTrace = await parity(999)
    assert.equal(noTrace, '#999 在 acme/trace 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。')
  } finally {
    restore()
  }
})
