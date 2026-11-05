import test from 'node:test'
import assert from 'node:assert/strict'
import { deskQueue, loadClient, walk, watcher } from './fixtures/panel-harness.mjs'

function snapshot(extra = {}) {
  return {
    loading: false, error: null,
    body: {
      credentials: {}, gh: { ok: true }, defaults: {},
      watchers: [watcher('a/b')], ...extra,
    },
  }
}

test('删除只开 Modal：取消不发请求，确认才发 delete', async () => {
  const calls = []
  const snap = snapshot()
  const { registrations, render, stateCalls } = loadClient({
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: String(init.method || 'GET'), body: init.body || '' })
      const text = String(url).includes('/state') ? JSON.stringify(snap.body) : '{}'
      return { ok: true, status: 200, text: async () => text }
    },
  })
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const base = deskQueue(snap)
  const closed = walk(render(desk, base))
  const trigger = closed.find((n) => n.type === 'button' && n.props['aria-label'] === '删除')
  assert.ok(trigger, '删除触发按钮必须存在')
  await trigger.props.onClick()
  assert.ok(!calls.some((call) => call.method === 'POST'), '打开确认框不能发写请求')

  const openQueue = [...base, true, false]
  const modalNodes = walk(render(desk, openQueue))
  const dialog = modalNodes.find((n) => n.props && n.props.role === 'dialog')
  assert.ok(dialog, '点击后应渲染 Modal dialog')
  const cancel = modalNodes.find((n) => n.type === 'button' && String((n.props.children || []).join('')) === '取消')
  assert.ok(cancel, '必须有取消按钮')
  await cancel.props.onClick()
  assert.ok(!calls.some((call) => call.method === 'POST'), '取消不能发写请求')
  assert.ok(stateCalls().some((call) => call.next === false), '取消必须关闭弹层')

  const confirm = modalNodes.find((n) => n.type === 'button' && String((n.props.children || []).join('')) === '确认删除')
  assert.ok(confirm, '必须有确认删除按钮')
  await confirm.props.onClick()
  assert.ok(calls.some((call) => call.method === 'POST' && call.body.includes('"action":"delete"')), '只有确认才发 delete：' + JSON.stringify(calls))
})

test('判定日志使用 DecisionLine：每天一组 ul.dt-list，每条 li.dt-ticket', () => {
  const snap = snapshot({
    watchers: [watcher('a/b', {
      history: [
        { at: '2026-11-05T10:00:00Z', ok: true, numbers: [42] },
        { at: '2026-11-04T10:00:00Z', ok: false, reason: 'ratelimit', numbers: [] },
      ],
    })],
  })
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const nodes = walk(render(desk, deskQueue(snap, null, {}, 'judge')))
  assert.ok(nodes.some((n) => n.type === 'ul' && n.props.className === 'dt-list'), '判定日志必须使用 ul.dt-list')
  assert.equal(nodes.filter((n) => n.type === 'li' && n.props.className === 'dt-row dt-link dt-ticket').length, 2)
  assert.equal(nodes.filter((n) => n.type === 'li' && n.props.className === 'dt-timeline-day').length, 0, '日期标题不能混作事件 li')
  assert.ok(nodes.some((n) => n.type === 'time' && n.props.dateTime === '2026-11-05T10:00:00Z'), '时间必须是 time[dateTime]')
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' | ')
  assert.ok(text.includes('#42') && text.includes('ratelimit'), '编号与原因必须可见')
})
