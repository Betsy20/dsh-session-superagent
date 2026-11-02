// JSON 输出字段的稳定性清单：新增字段必须登记，否则这里红。
//
// 为什么需要：有了 schemaVersion 还不够 —— 消费方要知道"哪个字段可以依赖"。
// 这份清单是**唯一口径**：stable 表示不会无故改名/删除；experimental 表示可能变。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'contract-stability.json'), 'utf8'))

async function loadTools() {
  const tools = []
  const dir = mkdtempSync(join(tmpdir(), 'zhuli-stab-'))
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-stab' }) },
    get: () => null, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?stab=' + Date.now())
  mod.apply(ctx)
  return tools
}

const sameSet = (actual, expected) => {
  const a = [...new Set(actual)].sort()
  const b = [...new Set(expected)].sort()
  return a.length === b.length && a.every((item, index) => item === b[index])
}

test('结构化输出的每个字段都在稳定性清单里（新增字段必须登记）', async () => {
  const tools = await loadTools()
  const byName = (name) => tools.find((tool) => tool.name === name)

  await byName('watch_start').execute({ repo: 'o/stab', format: 'json' })
  // 造一条"有痕迹"的条目，让 watch_trace 真的返回 results[]（否则这段断言永远被跳过）
  const mod0 = await import('../lib/index.js')
  const st = mod0.__test.readState()
  const key = Object.keys(st.watchers)[0]
  st.watchers[key].seen = { 1: new Date().toISOString() }
  st.watchers[key].lastReported = { 1: new Date().toISOString() }
  st.watchers[key].filteredLog = [{ at: new Date().toISOString(), number: 2, title: 'x', reason: '已关闭' }]
  st.watchers[key].history = [{ at: new Date().toISOString(), numbers: [1], ok: true, reason: null }]
  mod0.__test.writeState(st)
  const status = JSON.parse(await byName('watch_status').execute({ format: 'json' }))
  const doctor = JSON.parse(await byName('watch_doctor').execute({ format: 'json' }))
  const trace = JSON.parse(await byName('watch_trace').execute({ number: 1, format: 'json' }))
  const start = JSON.parse(await byName('watch_start').execute({ repo: 'o/stab', format: 'json' }))
  const stop = JSON.parse(await byName('watch_stop').execute({ repo: 'o/stab', format: 'json' }))
  const ack = JSON.parse(await byName('watch_ack').execute({ repo: 'o/stab', number: 1, format: 'json' }))

  assert.ok(sameSet(Object.keys(status), Object.keys(manifest.watch_status.root)), 'watch_status 根字段变了：' + Object.keys(status).join(','))
  assert.ok(sameSet(Object.keys(status.watchers[0]), Object.keys(manifest.watch_status.watcher)), 'watcher 字段变了：' + Object.keys(status.watchers[0]).join(','))
  assert.ok(sameSet(Object.keys(status.session), Object.keys(manifest.watch_status.session)), 'session 字段变了：' + Object.keys(status.session).join(','))
  assert.ok(sameSet(Object.keys(doctor), Object.keys(manifest.watch_doctor.root)), 'watch_doctor 根字段变了')
  assert.ok(sameSet(Object.keys(doctor.checks[0]), Object.keys(manifest.watch_doctor.check)), 'check 字段变了')
  assert.ok(sameSet(Object.keys(trace), Object.keys(manifest.watch_trace.root)), 'watch_trace 根字段变了')
  // results[] 里每条的字段也要被登记（这是消费方真正解析的部分）
  assert.ok(Array.isArray(trace.results) && trace.results.length > 0,
    '这条断言需要非空 results —— 上面已造过痕迹，为空说明 trace 的筛选逻辑变了：' + JSON.stringify(trace).slice(0, 160))
  assert.ok(sameSet(Object.keys(trace.results[0]), Object.keys(manifest.watch_trace.result)),
    'results[] 字段变了：' + Object.keys(trace.results[0]).join(','))
  assert.ok(sameSet(Object.keys(start), Object.keys(manifest.watch_start.root)), 'watch_start 根字段变了：' + Object.keys(start).join(','))
  assert.ok(sameSet(Object.keys(stop), Object.keys(manifest.watch_stop.root)), 'watch_stop 根字段变了')
  // ack 会真的调 gh；调用失败时字段是 {schemaVersion, ok, error} —— 两种情况都允许
  const ackKeys = Object.keys(ack)
  const ackOk = ack.ok === true
  assert.ok(
    ackOk
      ? sameSet(ackKeys, Object.keys(manifest.watch_ack.root))
      : (sameSet(ackKeys, ['schemaVersion', 'ok', 'error']) || sameSet(ackKeys, ['schemaVersion', 'ok', 'repo', 'acked', 'failed'])),
    'watch_ack 字段异常：' + ackKeys.join(','),
  )
})

test('清单里不能有已经不存在的字段（避免清单自己腐烂）', async () => {
  const tools = await loadTools()
  const byName = (name) => tools.find((tool) => tool.name === name)
  const status = JSON.parse(await byName('watch_status').execute({ format: 'json' }))
  // 空状态时 watchers 为空：先用结构清单校验根与 session
  assert.ok(sameSet(Object.keys(status), Object.keys(manifest.watch_status.root)))
  const declared = Object.entries(manifest.watch_status.watcher).filter(([, level]) => level === 'stable').length
  assert.ok(declared > 0, '至少要有一个 stable 字段')
  for (const [, level] of Object.entries(manifest.watch_status.watcher)) {
    assert.ok(level === 'stable' || level === 'experimental', '级别只能是 stable / experimental')
  }
})
