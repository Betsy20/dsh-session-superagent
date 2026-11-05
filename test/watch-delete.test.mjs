import assert from 'node:assert/strict'
import test from 'node:test'

import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-watch-delete-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
assertTempStateDir('watch-delete.test.mjs')

const tools = []
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: { register: () => () => {} },
  agents: { get: () => null, currentInitiator: () => ({ id: 'session-delete' }) },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
}

const mod = await import('../lib/index.js?watch-delete=' + Date.now())
mod.apply(ctx)
const start = tools.find((tool) => tool.name === 'watch_start')
const stop = tools.find((tool) => tool.name === 'watch_stop')
const entry = (id) => mod.__test.readState().watchers[id]

test('默认 stop 只暂停并保留条目，文本与 JSON 返回形状不变', async () => {
  assert.equal(stop.parameters.properties.delete.type, 'boolean')

  await start.execute({ repo: 'acme/pause' })
  const text = String(await stop.execute({ repo: 'acme/pause' }))
  assert.equal(text, 'stopped acme/pause#session-delete')
  assert.equal(entry('acme/pause#session-delete').enabled, false)
  assert.equal(mod.__test.readState().deleted?.['acme/pause#session-delete'], undefined)

  await start.execute({ repo: 'acme/pause-json' })
  const json = JSON.parse(await stop.execute({ repo: 'acme/pause-json', format: 'json' }))
  assert.deepEqual(json, {
    schemaVersion: 1,
    ok: true,
    id: 'acme/pause-json#session-delete',
    repo: 'acme/pause-json',
  })
  assert.equal(entry('acme/pause-json#session-delete').enabled, false)
  assert.equal(mod.__test.readState().deleted?.['acme/pause-json#session-delete'], undefined)
})

test('delete:true 文本明确 deleted:true，真删条目并写 ISO 墓碑', async () => {
  const id = 'acme/remove#session-delete'
  await start.execute({ repo: 'acme/remove' })
  const text = String(await stop.execute({ repo: 'acme/remove', delete: true }))
  assert.match(text, /deleted:true/)
  const state = mod.__test.readState()
  assert.equal(state.watchers[id], undefined)
  assert.equal(typeof state.deleted[id], 'string')
  assert.equal(new Date(state.deleted[id]).toISOString(), state.deleted[id])
})

test('delete:true 的 JSON 明确 deleted:true，同仓库随后可重新 watch_start', async () => {
  const id = 'acme/rebirth#session-delete'
  await start.execute({ repo: 'acme/rebirth' })
  const deleted = JSON.parse(await stop.execute({ repo: 'acme/rebirth', delete: true, format: 'json' }))
  assert.equal(deleted.ok, true)
  assert.equal(deleted.deleted, true)
  assert.equal(mod.__test.readState().watchers[id], undefined)

  const restarted = JSON.parse(await start.execute({ repo: 'acme/rebirth', format: 'json' }))
  assert.equal(restarted.ok, true)
  assert.equal(restarted.updated, false, '删除后重建应当是新守，而不是更新残留条目')
  assert.equal(entry(id).enabled, true)
  assert.equal(mod.__test.readState().deleted?.[id], undefined, '显式重建要解除该 id 的墓碑')
})

test('gitee: 前缀候选删除只影响当前 session，不误删同 repo 的其他 session', async () => {
  const id = 'gitee:acme/shared#session-delete'
  const peerId = 'gitee:acme/shared#session-other'
  await start.execute({ repo: 'gitee:acme/shared' })
  const state = mod.__test.readState()
  state.watchers[peerId] = {
    ...state.watchers[id],
    id: peerId,
    sessionId: 'session-other',
    enabled: true,
  }
  mod.__test.writeState(state)

  const result = JSON.parse(await stop.execute({ repo: 'acme/shared', delete: true, format: 'json' }))
  assert.equal(result.id, id)
  assert.equal(result.deleted, true)
  const after = mod.__test.readState()
  assert.equal(after.watchers[id], undefined)
  assert.equal(after.watchers[peerId].sessionId, 'session-other')
  assert.equal(after.watchers[peerId].enabled, true)
  assert.equal(after.deleted[peerId], undefined)
})
