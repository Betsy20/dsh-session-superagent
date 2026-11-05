import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_ACK_LABEL } from '../lib/watch.js'
import { DEFAULT_ACK_LABEL_GITEE } from '../lib/gitee.js'
import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-doctor-routes-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
process.env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
assertTempStateDir('doctor-routes.test.mjs')

const tools = []
const routes = new Map()
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agents: { get: () => null, currentInitiator: () => ({ id: 'session-doctor-routes' }) },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
}

const mod = await import('../lib/index.js?doctor-routes=' + Date.now())
mod.apply(ctx)
const doctor = tools.find((tool) => tool.name === 'watch_doctor')

async function withServer(server, run) {
  const state = mod.__test.readState()
  state.server = server
  mod.__test.writeState(state)
  return run()
}

test('部分挂载失败使用真实 routes+failed 总数，不写死 /6', async () => {
  await withServer({ routes: 4, failed: ['duplicate /state'] }, async () => {
    const text = String(await doctor.execute({}))
    assert.match(text, /4\/5 成功/)
    assert.doesNotMatch(text, /\/6/)
  })
})

test('无失败时也报告记录中的真实路由数', async () => {
  await withServer({ routes: 7, failed: [] }, async () => {
    const text = String(await doctor.execute({}))
    assert.match(text, /面板接口挂载：7 条，无失败/)
    assert.doesNotMatch(text, /\/6/)
  })
})

test('旧版本没有 routes 数据时降级为未知，不编造数量', async () => {
  await withServer({ failed: ['legacy duplicate'] }, async () => {
    const text = String(await doctor.execute({}))
    assert.match(text, /面板接口部分失败（成功\/总数未知）/)
    assert.doesNotMatch(text, /\/6/)
  })

  await withServer({ failed: [] }, async () => {
    const text = String(await doctor.execute({}))
    assert.match(text, /路由数未知/)
    assert.doesNotMatch(text, /\/6/)
  })
})

test('/state watcher 投影带 ackLabel，缺失时按 provider 给默认标签', async () => {
  const state = mod.__test.readState()
  state.watchers = {
    'acme/custom#session-doctor-routes': {
      id: 'acme/custom#session-doctor-routes',
      repo: 'acme/custom',
      provider: 'github',
      sessionId: 'session-doctor-routes',
      intervalSec: 60,
      enabled: false,
      ackLabel: 'team:done',
    },
    'acme/default#session-doctor-routes': {
      id: 'acme/default#session-doctor-routes',
      repo: 'acme/default',
      provider: 'github',
      sessionId: 'session-doctor-routes',
      intervalSec: 60,
      enabled: false,
    },
    'gitee:acme/default#session-doctor-routes': {
      id: 'gitee:acme/default#session-doctor-routes',
      repo: 'acme/default',
      provider: 'gitee',
      sessionId: 'session-doctor-routes',
      intervalSec: 60,
      enabled: false,
    },
  }
  mod.__test.writeState(state)

  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
  }
  await routes.get('/session-superagent/state').handler({
    method: 'GET',
    url: '/session-superagent/state',
    headers: {},
  }, res)

  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.chunks.join(''))
  const custom = body.watchers.find((watcher) => watcher.id === 'acme/custom#session-doctor-routes')
  const githubDefault = body.watchers.find((watcher) => watcher.id === 'acme/default#session-doctor-routes')
  const giteeDefault = body.watchers.find((watcher) => watcher.id === 'gitee:acme/default#session-doctor-routes')
  assert.equal(custom.ackLabel, 'team:done')
  assert.equal(githubDefault.ackLabel, DEFAULT_ACK_LABEL)
  assert.equal(giteeDefault.ackLabel, DEFAULT_ACK_LABEL_GITEE)
})
