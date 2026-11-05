// T55 只读探针：不改生产代码；Node 中跑真实 client.js，静态 HTML 仅在内存捕获。
// 运行：node test/edit-interaction-probe.mjs
// 浏览器复验时可 import { captureStaticPreview }，把返回 HTML 写入空白页（不写磁盘）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { readFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { deskQueue, loadClient, watcher } from './fixtures/panel-harness.mjs'

const SESSION_ID = 'session-a/b'
const EDIT_ID = 'a/b#' + SESSION_ID

function materialize(node) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return { type: '#text', text: String(node), props: {}, children: [] }
  if (Array.isArray(node)) return { type: 'fragment', props: {}, children: node.map(materialize).filter(Boolean) }
  if (typeof node !== 'object') return null
  if (typeof node.type === 'function') return materialize(node.type(node.props || {}))
  return {
    type: node.type,
    props: node.props || {},
    children: (node.props?.children || []).map(materialize).filter(Boolean),
  }
}

function all(node, predicate, out = []) {
  if (!node) return out
  if (predicate(node)) out.push(node)
  for (const child of node.children || []) all(child, predicate, out)
  return out
}

function one(node, predicate, message) {
  const found = all(node, predicate)
  assert.equal(found.length, 1, message + '；实际 ' + found.length)
  return found[0]
}

function text(node) {
  if (!node || node.type === '#text') return node?.text || ''
  return (node.children || []).map(text).join('')
}

function hasClass(node, name) {
  return String(node.props?.className || '').split(/\s+/).includes(name)
}

function applyCalls(queue, calls) {
  const next = [...queue]
  for (const call of calls) next[call.index] = call.next
  return next
}

function fieldInput(tree, label) {
  const field = one(tree, (node) => hasClass(node, 'dt-field')
    && all(node, (child) => child.type === 'label' && text(child) === label).length === 1,
  '找不到字段 ' + label)
  const labelNode = one(field, (node) => node.type === 'label', '字段缺 label ' + label)
  return one(field, (node) => node.type === 'input' && node.props.id === labelNode.props.htmlFor,
    'label 未关联 input ' + label)
}

/** 用真实标题 onClick 展开，再输入并用新 /state 快照模拟轮询。 */
export function runHarnessProbe() {
  const item = watcher('a/b', {
    id: EDIT_ID,
    sessionId: SESSION_ID,
    intervalSec: 30,
    note: '原始目标',
    goal: { objective: '原始目标' },
    filters: { labels: ['bug'], ignoreLabels: [], onlyAssigned: false, allowAuthors: [] },
  })
  const snap = {
    loading: false,
    error: null,
    body: {
      credentials: {},
      gh: { ok: true },
      defaults: {},
      watchers: [item],
    },
  }
  const client = loadClient()
  const desk = client.registrations.find((entry) => entry.opts.id === 'session-superagent-desk')
  assert.ok(desk, '找不到主面板')
  const render = (queue) => {
    const raw = client.render(desk, queue, { sessionId: SESSION_ID })
    const tree = materialize(raw)
    if (typeof raw.__panelVerify === 'function') raw.__panelVerify()
    return tree
  }

  let queue = deskQueue(snap)
  const closed = render(queue)
  const opener = one(closed, (node) => node.type === 'button' && hasClass(node, 'dt-open') && text(node) === 'a/b',
    '找不到仓库标题按钮')
  assert.equal(opener.props['aria-expanded'], false)
  client.resetStateCalls()
  opener.props.onClick()
  queue = applyCalls(queue, client.stateCalls())
  assert.equal(queue[8], EDIT_ID, '标题 onClick 未打开目标编辑器')

  const opened = render(queue)
  const form = one(opened, (node) => node.type === 'form' && node.props['data-mode'] === 'edit', '展开后缺编辑 form')
  const goal = fieldInput(form, '目标/规则')
  assert.equal(goal.props.value, '原始目标')
  assert.notEqual(goal.props.disabled, true, '静态 input 不得 disabled')
  assert.notEqual(goal.props.readOnly, true, '静态 input 不得 readOnly')
  assert.notEqual(one(form, (node) => node.type === 'fieldset', '编辑 form 缺 fieldset').props.disabled, true,
    '非保存态 fieldset 不得 disabled')
  assert.equal(goal.props.inert, undefined, 'input 不得 inert')
  assert.equal(typeof goal.props.onChange, 'function', '受控 input 缺 onChange')
  assert.equal(goal.props.onInput, undefined, '生产控件没有另一套 onInput 状态链')

  const ticket = one(opened, (node) => node.type === 'li' && hasClass(node, 'dt-ticket')
    && all(node, (child) => child === form).length === 1, '编辑 form 必须位于原 ticket 内')
  const titleInTicket = one(ticket, (node) => node.type === 'button' && hasClass(node, 'dt-open'), 'ticket 缺标题按钮')
  assert.equal(titleInTicket.props['aria-expanded'], true)
  assert.equal(ticket.props.onClick, undefined, 'ticket 自身没有 onClick')
  assert.equal(form.props.onClick, undefined, 'form 自身没有 onClick')
  const fieldset = one(form, (node) => node.type === 'fieldset', '缺 fieldset')
  assert.equal(fieldset.props.onClick, undefined, 'fieldset 自身没有 onClick')

  client.resetStateCalls()
  goal.props.onChange({ target: { value: '轮询不应覆盖的草稿' } })
  queue = applyCalls(queue, client.stateCalls())
  assert.equal(queue[9].goal, '轮询不应覆盖的草稿', 'onChange 未更新 draft')

  // 保留 editing/draft，仅替换 snap：这是 load() 在真实 React 中所做的状态更新。
  queue = [...queue]
  queue[0] = {
    ...snap,
    body: {
      ...snap.body,
      watchers: [{ ...item, lastPoll: new Date().toISOString(), title: '轮询后的新标题' }],
    },
  }
  const polled = render(queue)
  const polledGoal = fieldInput(polled, '目标/规则')
  assert.equal(polledGoal.props.value, '轮询不应覆盖的草稿', '轮询 snap 更新覆盖了 draft')
  assert.notEqual(polledGoal.props.disabled, true, '轮询后 input 意外 disabled')
  assert.equal(one(polled, (node) => node.type === 'button' && hasClass(node, 'dt-open'), '轮询后缺标题按钮')
    .props['aria-expanded'], true, '轮询后 editor 被收起')

  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const marker = 'const PORTED_CSS = "'
  const start = source.indexOf(marker) + marker.length
  let end = start
  while (end < source.length && source[end] !== '"') end += source[end] === '\\' ? 2 : 1
  const css = JSON.parse('"' + source.slice(start, end) + '"')
  assert.match(css, /\.dt-row\s*\{[^}]*position:\s*relative/, '行容器不是定位包含块，探针前提改变')
  assert.match(css, /\.dt-open::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/, '标题伪元素不再铺满定位包含块')
  const stackingProtection = /\.dt-ticket-body(?:\s*>\s*|\s+)\.dt-form\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*[1-9]/.test(css)

  // 静态预览没有 React 事件；在 harness 中补齐“命中标题后会收起”的这一环。
  const polledTitle = one(polled, (node) => node.type === 'button' && hasClass(node, 'dt-open'), '轮询后缺标题按钮')
  client.resetStateCalls()
  polledTitle.props.onClick()
  const closedAgain = applyCalls(queue, client.stateCalls())
  assert.equal(closedAgain[8], null, '展开状态点击标题应收起编辑器')

  return {
    editId: EDIT_ID,
    inputId: goal.props.id,
    draftAfterPoll: polledGoal.props.value,
    inputDisabled: polledGoal.props.disabled === true,
    inputReadOnly: polledGoal.props.readOnly === true,
    ticketHasOnClick: typeof ticket.props.onClick === 'function',
    formHasOnClick: typeof form.props.onClick === 'function',
    overlay: {
      containingBlock: 'li.dt-row[position:relative]',
      pseudo: 'button.dt-open::after[position:absolute;inset:0]',
      editorInsideSameTicket: true,
      editorHasStackingProtection: stackingProtection,
    },
    titleClickClosesEditor: closedAgain[8] === null,
  }
}

/**
 * 复用现有 scripts/render-preview.mjs，只拦截它的最后一次 writeFileSync。
 * 预览脚本、client.js 与 CSS 都按当前工作树执行，但不落 preview-panel.html。
 */
export async function captureStaticPreview() {
  const originalArgv = process.argv
  const originalWrite = fs.writeFileSync
  let html = ''
  try {
    process.argv = [originalArgv[0] || 'node', originalArgv[1] || 'edit-interaction-probe', '--only=行内编辑']
    fs.writeFileSync = (_path, content) => { html = String(content) }
    syncBuiltinESMExports()
    await import('../scripts/render-preview.mjs?edit-interaction-probe=' + Date.now())
  } finally {
    fs.writeFileSync = originalWrite
    syncBuiltinESMExports()
    process.argv = originalArgv
  }
  assert.ok(html.includes('行内编辑'), '静态预览没有行内编辑场景')
  assert.ok(html.includes('.dt-open::after'), '静态预览没有当前 PORTED_CSS')
  return html
}

const invokedDirectly = process.argv[1] && /edit-interaction-probe\.mjs$/i.test(process.argv[1])
if (invokedDirectly) {
  const result = runHarnessProbe()
  const html = await captureStaticPreview()
  console.log(JSON.stringify({ ...result, staticPreviewBytes: html.length, staticPreviewWrite: 'memory-only' }, null, 2))
}
