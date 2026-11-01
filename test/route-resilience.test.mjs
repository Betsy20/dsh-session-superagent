// 真机事故（2026-11-02 19:38）：宿主热重载时旧实例的路由还没 dispose，
// 新实例注册第一条就抛 `webserver: duplicate exact route "/session-superagent/state"`，
// 原来整个 try 一起崩 —— 六条路由全没了，面板变成一片空白。
//
// 现在每条路由单独容错：重复的那条记进 state.server.failed，其余照常注册。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = mkdtempSync(join(tmpdir(), 'superagent-routes-resilience-'))
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const { apply } = await import('../lib/index.js')

test('某条路由注册失败（重复路由）时，其余路由仍然可用', () => {
  const registered = []
  const ctx = {
    tools: { register() {} },
    webServer: {
      register(options) {
        // 模拟宿主：第三条（client-error）已经存在 -> 抛重复路由
        if (options.path === '/session-superagent/client-error') {
          throw new Error('webserver: duplicate exact route "' + options.path + '"')
        }
        registered.push(options.path)
        return () => {}
      },
    },
    agents: { get: () => null, currentInitiator: () => null },
    get: () => null,
    on() {},
    effect: (fn) => fn(),
  }
  apply(ctx)

  assert.equal(registered.length, 5, '六条里应该成功 5 条')
  assert.ok(!registered.includes('/session-superagent/client-error'))
  assert.ok(registered.includes('/session-superagent/state'), '面板读数据的那条必须在')

  const state = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  assert.ok(state.server, '应该记录一次挂载结果')
  assert.equal(state.server.routes, 5)
  assert.match(String((state.server.failed || []).join(' ')), /duplicate exact route/, '失败原因要留下来')

  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('卸载时会真的把路由 unregister（否则重载后就是重复路由）', () => {
  const unregistered = []
  const cleanups = []
  const disposeListeners = []
  const ctx = {
    tools: { register() {} },
    webServer: {
      register(options) {
        return () => unregistered.push(options.path)
      },
    },
    agents: { get: () => null, currentInitiator: () => null },
    get: () => null,
    on(event, cb) { if (event === 'dispose') disposeListeners.push(cb) },
    // 记录 effect 的清理函数（cordis 在作用域销毁时会调用它）
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  apply(ctx)

  assert.ok(cleanups.length > 0, '应该通过 ctx.effect 挂了清理函数')
  assert.ok(disposeListeners.length > 0, '也应该挂 dispose 监听')

  for (const cleanup of cleanups) cleanup()
  assert.equal(unregistered.length, 6, '六条路由都应该被 unregister')

  // dispose 监听也要能安全重复调用（宿主可能两条路都走）
  for (const listener of disposeListeners) listener()
  assert.equal(unregistered.length, 6, '重复卸载不应该重复 unregister')
  rmSync(STATE_DIR, { recursive: true, force: true })
})
