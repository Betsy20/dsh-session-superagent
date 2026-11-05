import assert from 'node:assert/strict'
import test from 'node:test'
import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-trace-structured-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
assertTempStateDir('trace-structured.test.mjs')

const tools = []
const routes = new Map()
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
  agents: { get: () => null, currentInitiator: () => ({ id: 'session-trace' }) },
  get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
}
const mod = await import('../lib/index.js?trace-structured=' + Date.now())
mod.apply(ctx)

const state = mod.__test.readState()
state.watchers['a/b#session-trace'] = {
  id: 'a/b#session-trace', repo: 'a/b', provider: 'github', sessionId: 'session-trace', enabled: false,
  seen: { 42: '2026-11-05T10:00:00Z' },
  lastReported: { 42: '2026-11-05T10:00:30Z' },
  filteredLog: [{ number: 42, at: '2026-11-05T10:01:00Z', reason: '机器人' }],
  absorbedLog: [{ number: 42, at: '2026-11-05T10:02:00Z' }],
  history: [{ at: '2026-11-05T10:03:00Z', numbers: [42], ok: true }],
}
mod.__test.writeState(state)

async function httpTrace(number) {
  const res = {
    statusCode: 200, chunks: [], headers: {},
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
  }
  await routes.get('/session-superagent/trace').handler({
    method: 'GET', url: '/session-superagent/trace?repo=a%2Fb&number=' + number, headers: {},
  }, res)
  return JSON.parse(res.chunks.join(''))
}

test('/trace 同时返回结构化 traces 与旧文本，文本和工具逐字一致', async () => {
  const body = await httpTrace(42)
  assert.equal(body.ok, true)
  assert.equal(body.traces.length, 1)
  assert.equal(body.traces[0].number, '42')
  assert.equal(body.traces[0].filtered[0].reason, '机器人')
  assert.equal(body.traces[0].absorbed.length, 1)
  const toolText = String(await tools.find((tool) => tool.name === 'watch_trace').execute({ repo: 'a/b', number: 42 }))
  assert.equal(body.text, toolText)
})

test('无痕迹时 traces 为空数组，文本仍与工具一致', async () => {
  const body = await httpTrace(999)
  assert.deepEqual(body.traces, [])
  const toolText = String(await tools.find((tool) => tool.name === 'watch_trace').execute({ repo: 'a/b', number: 999 }))
  assert.equal(body.text, toolText)
})
