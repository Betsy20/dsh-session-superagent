// 唤醒记账必须发生在「真正发送之后」。
//
// 背景：0.9.3 引入合并窗口时，记账（wakeTimes / seen 水位 / 历史）是在**入队**时做的。
// 于是"会话正忙被拒"的情况会：计了次、推进了 seen —— 那几条既不会重试，又白占名额。
// 本用例锁住：被拒时回调拿到 ok:false，成功时拿到 ok:true。
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

process.env.DSH_SUPERAGENT_STATE = mkdtempSync(join(tmpdir(), 'zhuli-acct-'))
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_WAKE_WINDOW_MS = '5'

const { __test, apply } = await import('../lib/index.js')

function makeCtx(agent) {
  return {
    tools: { register: () => {} },
    webServer: { register: () => () => {} },
    agents: { currentInitiator: () => ({ id: 's1' }), get: () => agent },
    get: () => null,
    effect: (fn) => fn(),
    inject: () => {},
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('会话忙：回调必须是 ok:false（这样调用方才不会计次、不会推进水位）', async () => {
  const busy = { status: 'running', followup: () => { throw new Error('不该被调用') } }
  apply(makeCtx(busy))
  let settled = null
  __test.wakeMerged(makeCtx(busy), 's1', '测试消息', (result) => { settled = result })
  await wait(60)
  assert.ok(settled, '回调必须被调用（否则记账永远不会发生）')
  assert.equal(settled.ok, false, '会话忙时不能算作已唤醒：' + JSON.stringify(settled))
  assert.match(String(settled.reason), /busy|running|idle/i)
})

test('会话 idle：回调 ok:true，且 followup 真的被调到一次', async () => {
  const sent = []
  const idle = { status: 'idle', followup: (msg) => sent.push(msg) }
  apply(makeCtx(idle))
  let settled = null
  __test.wakeMerged(makeCtx(idle), 's1', '第一条', (r) => { settled = r })
  __test.wakeMerged(makeCtx(idle), 's1', '第二条', (r) => { settled = r })
  await wait(60)
  assert.ok(settled && settled.ok === true, '应成功：' + JSON.stringify(settled))
  assert.equal(sent.length, 1, '同一窗口内两条应合并成一次发送')
  assert.ok(String(sent[0].content[0].text).includes('第一条'), '内容不能丢')
  assert.ok(String(sent[0].content[0].text).includes('第二条'), '内容不能丢')
})
