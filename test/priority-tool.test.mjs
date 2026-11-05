import assert from 'node:assert/strict'
import test from 'node:test'

import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-priority-tool-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
assertTempStateDir('priority-tool.test.mjs')

const tools = []
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: { register: () => () => {} },
  agents: { get: () => null, currentInitiator: () => ({ id: 'session-priority' }) },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
}

const mod = await import('../lib/index.js?priority-tool=' + Date.now())
mod.apply(ctx)
const start = tools.find((tool) => tool.name === 'watch_start')
const priorityOf = (repo) => mod.__test.readState().watchers[repo + '#session-priority'].priority

test('priority schema 是 object，缺省五键为三项 true、unassigned/stale false', async () => {
  const schema = start.parameters.properties.priority
  assert.equal(schema.type, 'object')
  for (const key of ['reopened', 'comments', 'labels', 'unassigned', 'stale']) {
    assert.match(schema.description, new RegExp(key))
  }

  await start.execute({ repo: 'acme/defaults' })
  assert.deepEqual(priorityOf('acme/defaults'), {
    reopened: true,
    comments: true,
    labels: true,
    unassigned: false,
    stale: false,
  })
})

test('部分 priority 键可更新，再次部分更新不会重置其他已有设置', async () => {
  await start.execute({
    repo: 'acme/partial',
    priority: { reopened: false, stale: true },
  })
  assert.deepEqual(priorityOf('acme/partial'), {
    reopened: false,
    comments: true,
    labels: true,
    unassigned: false,
    stale: true,
  })

  await start.execute({
    repo: 'acme/partial',
    priority: { comments: false, unassigned: true },
  })
  assert.deepEqual(priorityOf('acme/partial'), {
    reopened: false,
    comments: false,
    labels: true,
    unassigned: true,
    stale: true,
  })
})

test('再次只改 labels 过滤且不带 priority 时，已有 priority 原样保留', async () => {
  const configured = {
    reopened: false,
    comments: false,
    labels: false,
    unassigned: true,
    stale: true,
  }
  await start.execute({ repo: 'acme/labels', labels: ['bug'], priority: configured })
  assert.deepEqual(priorityOf('acme/labels'), configured)

  await start.execute({ repo: 'acme/labels', labels: ['p0'] })
  const entry = mod.__test.readState().watchers['acme/labels#session-priority']
  assert.deepEqual(entry.filters.labels, ['p0'])
  assert.deepEqual(entry.priority, configured)
})
