import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-delivery-comment-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
assertTempStateDir('delivery-comment.test.mjs')

const tools = []
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: { register: () => () => {} },
  agents: { get: () => null, currentInitiator: () => ({ id: 'session-delivery' }) },
  get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
}
const mod = await import('../lib/index.js?delivery=' + Date.now())
mod.apply(ctx)
const start = tools.find((tool) => tool.name === 'watch_start')
const ack = tools.find((tool) => tool.name === 'watch_ack')

async function withFakeGitee(run) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase()
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null })
    const payload = method === 'GET' && String(url).includes('/labels')
      ? [{ name: '主理鱼-已处理' }]
      : { ok: true }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  try { return await run(calls) } finally { globalThis.fetch = original }
}

test('comment:true 把 note 回写到 Gitee issue，并保存本地 ack 记录', async () => {
  await start.execute({ repo: 'gitee:acme/delivery' })
  const result = await withFakeGitee(async (calls) => {
    const out = JSON.parse(await ack.execute({ repo: 'acme/delivery', number: 7, note: '已修，见 #57', comment: true, format: 'json' }))
    const comment = calls.find((call) => call.method === 'POST' && call.url.includes('/issues/7/comments'))
    assert.ok(comment, '必须真的 POST 评论：' + calls.map((call) => call.method + ' ' + call.url).join('\n'))
    assert.deepEqual(comment.body, { body: '已修，见 #57' })
    return out
  })
  assert.equal(result.ok, true)
  assert.equal(result.commented, true)
  const state = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  const entry = state.watchers['gitee:acme/delivery#session-delivery']
  assert.equal(entry.acked['7'].note, '已修，见 #57')
})

test('kind:pull 回写到 Gitee pulls 端点；默认 comment=false 不发评论', async () => {
  await withFakeGitee(async (calls) => {
    await ack.execute({ repo: 'acme/delivery', number: 8, note: '已处理', comment: true, kind: 'pull' })
    assert.ok(calls.some((call) => call.method === 'POST' && call.url.includes('/pulls/8/comments')), 'PR 必须走 pulls 端点')
  })
  await withFakeGitee(async (calls) => {
    await ack.execute({ repo: 'acme/delivery', number: 9, note: '只本地记录' })
    assert.ok(!calls.some((call) => call.url.includes('/comments')), '默认不允许发评论')
  })
})

test('comment:true 缺 note 时，在打标签或建标签之前就拒绝', async () => {
  await withFakeGitee(async (calls) => {
    const out = String(await ack.execute({ repo: 'acme/delivery', number: 10, comment: true }))
    assert.match(out, /需要同时提供 note/)
    assert.equal(calls.length, 0, '参数错误时不能发生任何外部写操作或标签探测')
  })
})
