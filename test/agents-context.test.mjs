// 真机复验抓到的事故：定时器回调跑在「非活跃上下文」里，直接读 `ctx.agents` 会抛
//   cannot get required service "agents" in inactive context
// 于是轮询永远失败、且不进退避（每秒都在打 GitHub）。
// 修复后所有取法都走 agentsService()：优先 ctx.get('agents')（不抛），其次兜底。
//
// 这个用例用一个「读 ctx.agents 就抛」的宿主替身，验证插件仍能正常工作。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = mkdtempSync(join(tmpdir(), 'superagent-inactive-'))
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const { apply } = await import('../lib/index.js')

const tools = []
const agent = { id: 'session-inactive', status: 'idle', followup() {} }
const agentsService = { get: (id) => (id === agent.id ? agent : undefined), currentInitiator: () => agent }

const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: { register: () => () => {} },
  // 关键：直接读这个属性会抛（模拟 inactive context）
  get agents() {
    throw new Error('cannot get required service "agents" in inactive context')
  },
  get: (name) => (name === 'agents' ? agentsService : undefined),
  effect: (fn) => fn(),
  on() {},
}
apply(ctx)

test('宿主在 inactive context 里拒读 ctx.agents 时，插件仍然能用', async () => {
  // 直接读会抛——这是宿主的真实行为，确认替身是可信的
  assert.throws(() => ctx.agents, /inactive context/)

  const start = tools.find((t) => t.name === 'watch_start')
  const result = await start.execute({ repo: 'o/inactive', intervalSec: 60 })
  assert.match(String(result), /watching o\/inactive/)

  const raw = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  const entry = Object.values(raw.watchers).find((w) => w.repo === 'o/inactive')
  assert.ok(entry, 'watcher 应该被建出来')
  assert.equal(entry.sessionId, 'session-inactive', 'currentInitiator 也要能通过 ctx.get 取到')

  const status = tools.find((t) => t.name === 'watch_status')
  const text = await status.execute({})
  assert.match(String(text), /o\/inactive/, '状态查询也要正常')
  assert.doesNotMatch(String(text), /inactive context/, '不应该把宿主的上下文错误当成轮询错误')
})

test('cleanup', () => {
  rmSync(STATE_DIR, { recursive: true, force: true })
})
