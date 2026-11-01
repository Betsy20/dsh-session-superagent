// 宿主重载常常是「重新 import 一份模块」（模块级变量全新），但进程只有一个。
// 所以路由 disposer 必须挂在 globalThis 上，否则新实例摘不掉旧实例的路由 ——
// 真机现场（2026-11-02 20:0x）：面板建的 watcher 第一轮就报
//   cannot get required service "agents" in inactive context
// 就是旧实例的 ctx 已 dispose 却还在处理 HTTP 请求。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = mkdtempSync(join(tmpdir(), 'superagent-cross-instance-'))
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
  assert.equal(firstRegistered.length, 6, '第一个实例注册 6 条')

  // 关键：query 不同 -> 模块重新求值 -> 模块级变量全新，但 globalThis 是同一个
  const second = await import('../lib/index.js?instance=2')
  second.apply(makeCtx(secondRegistered))

  const disposed = firstRegistered.filter((x) => String(x).startsWith('disposed:'))
  assert.equal(disposed.length, 6, '第二个实例必须先把第一个实例的 6 条摘掉')
  assert.equal(secondRegistered.filter((x) => !String(x).startsWith('disposed:')).length, 6)

  rmSync(STATE_DIR, { recursive: true, force: true })
})
