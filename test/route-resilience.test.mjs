// 真机事故（2026-11-02 19:38）：宿主热重载时旧实例的路由还没 dispose，
// 新实例注册第一条就抛 `webserver: duplicate exact route "/session-superagent/state"`，
// 原来整个 try 一起崩 —— 六条路由全没了，面板变成一片空白。
//
// 现在每条路由单独容错：重复的那条记进 state.server.failed，其余照常注册。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tempDir } from './fixtures/tmpdir.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
// 审核 T30：这些用例会改 process.env.DSH_SUPERAGENT_STATE 却从不还原 ——
import assert from 'node:assert/strict'

const STATE_DIR = tempDir('superagent-routes-resilience-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
// 审核 T30：本文件会改 process.env.DSH_SUPERAGENT_STATE —— 每个用例结束后还原，
// 否则同一个进程里后跑的用例会拿到前一个的目录（isolation=none 下实测 10 红）。
const __envBaseline = { ...process.env }
test.afterEach?.(() => {
  for (const key of Object.keys(process.env)) { if (!(key in __envBaseline)) delete process.env[key] }
  Object.assign(process.env, __envBaseline)
})
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const { apply } = await import('../lib/index.js')

test('某条路由重复时，整组换一个带序号的前缀重放（面板据此换前缀）', () => {
  const registered = []
  const ctx = {
    tools: { register() {} },
    webServer: {
      register(options) {
        // 模拟宿主：默认前缀下的 client-error 已经被旧实例占了
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

  const firstPass = registered.filter((p) => p.startsWith('/session-superagent/') && !p.includes('/r'))
  const replay = registered.filter((p) => /\/session-superagent\/r\d+\//.test(p))
  assert.ok(firstPass.length >= 1, '第一遍至少注册了前面几条')
  assert.equal(replay.length, 13, '撞车后整组 9 条换新前缀重放')
  assert.ok(replay.every((p) => p.includes('/r2/')), '前缀应该带序号')
  assert.ok(replay.some((p) => p.endsWith('/state')), '新前缀下 /state 必须可用')

  const state = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  assert.equal(state.server.failed.length, 0, '重放成功后不该再有失败')
  assert.match(String(state.server.base || ''), /\/r\d+$/, 'state 里要记下当前前缀')

  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('同一个模块被 apply 两次时，会先摘掉上一次的路由（接管，而不是并存）', () => {
  const unregistered = []
  const made = []
  const ctx = {
    tools: { register() {} },
    webServer: { register(options) { made.push(options.path); return () => unregistered.push(options.path) } },
    agents: { get: () => null, currentInitiator: () => null },
    get: () => null,
    on() {},
    effect: (fn) => fn(),
  }
  apply(ctx)
  assert.equal(made.length, 13)
  apply(ctx)                      // 模拟宿主重载：同一个模块再来一次
  assert.equal(unregistered.length, 13, '第二次 apply 应该先把第一批摘掉')
  assert.equal(made.length, 26, '然后重新注册一份')
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
  assert.equal(unregistered.length, 13, '九条路由都应该被 unregister')

  // dispose 监听也要能安全重复调用（宿主可能两条路都走）
  for (const listener of disposeListeners) listener()
  assert.equal(unregistered.length, 13, '重复卸载不应该重复 unregister')
  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('离线模式：设了 DSH_SUPERAGENT_OFFLINE 就不再真的调用 gh', async () => {
  const before = process.env.DSH_SUPERAGENT_OFFLINE
  process.env.DSH_SUPERAGENT_OFFLINE = '1'
  try {
    const { isOfflineMode } = await import('../lib/gh-format.js')
    // 审核 T23：以前这里只测了两个**跟离线无关**的纯函数（删掉离线短路照样绿）。
    // 现在离线判定本身是纯函数，真值表可以直接断言 —— 包括「0 / false 不该算离线」这个坑。
    assert.equal(isOfflineMode({ DSH_SUPERAGENT_OFFLINE: "1" }), true)
    assert.equal(isOfflineMode({ DSH_SUPERAGENT_OFFLINE: "true" }), true)
    assert.equal(isOfflineMode({ DSH_SUPERAGENT_OFFLINE: " ON " }), true, "大小写与空格都要认")
    assert.equal(isOfflineMode({ DSH_SUPERAGENT_OFFLINE: "0" }), false, "0 不是离线")
    assert.equal(isOfflineMode({ DSH_SUPERAGENT_OFFLINE: "false" }), false, "false 不是离线")
    assert.equal(isOfflineMode({}), false, "没设不是离线")
  } finally {
    if (before === undefined) delete process.env.DSH_SUPERAGENT_OFFLINE
    else process.env.DSH_SUPERAGENT_OFFLINE = before
  }
})
