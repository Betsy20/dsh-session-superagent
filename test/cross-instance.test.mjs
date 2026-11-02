// 宿主重载常常是「重新 import 一份模块」（模块级变量全新），但进程只有一个。
// 所以路由 disposer 必须挂在 globalThis 上，否则新实例摘不掉旧实例的路由 ——
// 真机现场（2026-11-02 20:0x）：面板建的 watcher 第一轮就报
//   cannot get required service "agents" in inactive context
// 就是旧实例的 ctx 已 dispose 却还在处理 HTTP 请求。
import { mkdtempSync, rmSync } from 'node:fs'
import { tempDir } from './fixtures/tmpdir.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = tempDir('superagent-cross-instance-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'

function makeCtx(registered) {
  return {
    tools: { register() {} },
    webServer: {
      register(options) {
        registered.push(options.path)
        return () => registered.push('disposed:' + options.path)
      },
    },
    agents: { get: () => null, currentInitiator: () => null },
    get: () => null,
    on() {},
    effect: (fn) => fn(),
  }
}

test('重新 import 出来的第二个实例，会摘掉第一个实例注册的路由', async () => {
  const firstRegistered = []
  const secondRegistered = []

  const first = await import('../lib/index.js?instance=1')
  first.apply(makeCtx(firstRegistered))
  assert.equal(firstRegistered.length, 9, '第一个实例注册 9 条')

  // 关键：query 不同 -> 模块重新求值 -> 模块级变量全新，但 globalThis 是同一个
  const second = await import('../lib/index.js?instance=2')
  second.apply(makeCtx(secondRegistered))

  const disposed = firstRegistered.filter((x) => String(x).startsWith('disposed:'))
  assert.equal(disposed.length, 9, '第二个实例必须先把第一个实例的 9 条摘掉')
  assert.equal(secondRegistered.filter((x) => !String(x).startsWith('disposed:')).length, 9)

  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('上下文已释放时，POST /watch 直接拒绝（不要造一条注定跑不起来的守）', async () => {
  const routes = new Map()
  const stale = await import('../lib/index.js?instance=stale')
  stale.apply({
    tools: { register() {} },
    webServer: { register(route) { routes.set(route.path, route); return () => {} } },
    // 关键：读 agents 就抛，get('agents') 也取不到 —— 模拟「ctx 已 dispose」
    get agents() { throw new Error('cannot get required service "agents" in inactive context') },
    get: () => undefined,
    on() {},
    effect: (fn) => fn(),
  })

  const route = routes.get('/session-superagent/watch')
  const payload = JSON.stringify({ repo: 'o/stale', sessionId: 's', intervalSec: 60 })
  const result = await new Promise((resolve) => {
    const req = {
      method: 'POST', url: '/session-superagent/watch', headers: { 'content-type': 'application/json' },
      on(event, handler) {
        if (event === 'data') handler(Buffer.from(payload))
        if (event === 'end') handler()
        return req
      },
    }
    let status = 200
    const res = {
      set statusCode(value) { status = value }, get statusCode() { return status },
      setHeader() {}, end(text) { resolve({ status, text: text || '' }) },
    }
    route.handler(req, res)
  })

  assert.equal(result.status, 503, '应该拒绝，而不是静默创建')
  assert.match(result.text, /重载 DSH/, '要告诉用户怎么办')
  rmSync(STATE_DIR, { recursive: true, force: true })
})
