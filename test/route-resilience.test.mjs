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
