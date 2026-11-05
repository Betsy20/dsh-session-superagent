import assert from 'node:assert/strict'
import test from 'node:test'
import { tempDir } from './fixtures/tmpdir.mjs'

process.env.DSH_SUPERAGENT_STATE = tempDir('zhuli-wake-queue-')
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_WAKE_WINDOW_MS = '5'
process.env.DSH_SUPERAGENT_WAKE_QUEUE_RETRY_MS = '1000'

const { __test, apply } = await import('../lib/index.js')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeCtx(agent) {
  return {
    tools: { register: () => {} },
    webServer: { register: () => () => {} },
    agents: { currentInitiator: () => ({ id: 's1' }), get: () => agent },
    get: () => null,
    effect: (fn) => fn(),
    inject: () => {},
    on() {},
  }
}

test.afterEach(() => __test.clearWakeQueues())

test('忙时进入 FIFO，空闲后按顺序送达；送达前回调不是成功', async () => {
  const sent = []
  const agent = { status: 'running', followup: (msg) => sent.push(msg.content[0].text) }
  const ctx = makeCtx(agent)
  apply(ctx)
  const first = []
  const second = []
  __test.wakeMerged(ctx, 's1', '第一条', (r) => first.push(r), 'k1')
  await wait(25)
  __test.wakeMerged(ctx, 's1', '第二条', (r) => second.push(r), 'k2')
  await wait(25)

  assert.equal(sent.length, 0, '忙时不能真正调用 followup')
  assert.equal(__test.wakeQueueCount('s1', ctx), 2)
  assert.equal(first[0].ok, false, '入队不等于已送达')
  assert.equal(first[0].queued, true)
  assert.match(first[0].reason, /busy/)

  agent.status = 'idle'
  __test.flushWakeQueue(ctx, 's1')
  assert.deepEqual(sent, ['第一条'])
  assert.equal(__test.wakeQueueCount('s1', ctx), 1)
  __test.flushWakeQueue(ctx, 's1')
  assert.deepEqual(sent, ['第一条', '第二条'], '必须保持 FIFO 顺序')
  assert.equal(__test.wakeQueueCount('s1', ctx), 0)
  assert.equal(first[1].ok, true, '真正发送后才回调成功')
  assert.equal(second[1].ok, true)
})

test('同一事件重复轮询只排一次，不同事件不会互相吞掉', async () => {
  const agent = { status: 'running', followup: () => { throw new Error('不该发送') } }
  const ctx = makeCtx(agent)
  __test.wakeMerged(ctx, 's1', '同一事件', () => {}, 'same-key')
  await wait(25)
  __test.wakeMerged(ctx, 's1', '同一事件', () => {}, 'same-key')
  await wait(25)
  assert.equal(__test.wakeQueueCount('s1', ctx), 1, '相同 queueKey 不能重复排队')
  __test.wakeMerged(ctx, 's1', '另一个事件', () => {}, 'other-key')
  await wait(25)
  assert.equal(__test.wakeQueueCount('s1', ctx), 2)
})

test('新实例不会误送旧实例的队列', async () => {
  const sent = []
  const oldCtx = makeCtx({ status: 'running', followup: () => {} })
  __test.wakeMerged(oldCtx, 's1', '旧实例消息', () => {}, 'old')
  await wait(25)
  const newCtx = makeCtx({ status: 'idle', followup: (msg) => sent.push(msg.content[0].text) })
  __test.wakeMerged(newCtx, 's1', '新实例消息', () => {}, 'new')
  await wait(25)
  assert.deepEqual(sent, ['新实例消息'], '新实例只发自己的消息')
  assert.equal(__test.wakeQueueCount('s1', oldCtx), 1, '旧实例队列保持独立')
  assert.equal(__test.wakeQueueCount('s1', newCtx), 0)
})
