import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { deskQueue, walk, watcher } from './fixtures/panel-harness.mjs'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
// 用字符串边界保留宿主元素；共享 walk 会展开函数组件，空函数假原语会被展开成 null。
const HOST = Object.freeze({
  Modal: 'dsh-host-modal',
  Toast: 'dsh-host-toast',
  IconWarningOutlineMedium: 'dsh-host-warning-icon',
})

function response(body, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(body) }
}

/**
 * 与 panel-harness 一样执行真实 UMD factory，但允许注入 factory require 的宿主原语。
 * setter 按调用时的最新槽位求值，专门覆盖“旧 Toast onDone 不清新 Toast”。
 */
function loadClient(options = {}) {
  let mod = null
  const timers = []
  const stateCalls = []
  const hooks = { queue: [], index: 0 }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { mod = value } },
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    navigator: { clipboard: { writeText: options.writeText || (async () => {}) } },
    fetch: options.fetch || (async () => response({ watchers: [] })),
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: (fn, ms) => {
      const id = timers.length + 1
      timers.push({ id, fn, ms })
      return id
    },
    clearTimeout: (id) => {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    queueMicrotask: (fn) => fn(),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.ok(mod, 'client.js 必须调用 __ModuleLoader__.load')

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const { key, ...rest } = props || {}
      const node = {
        type,
        props: { ...rest, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) },
      }
      if (key !== undefined) node.key = key
      return node
    },
    isValidElement: (value) => Boolean(value && typeof value === 'object' && 'type' in value),
    memo: (fn) => fn,
    useState(initial) {
      const index = hooks.index
      const value = index < hooks.queue.length
        ? hooks.queue[index]
        : (typeof initial === 'function' ? initial() : initial)
      hooks.queue[index] = value
      hooks.index += 1
      const setter = (next) => {
        const current = hooks.queue[index]
        const resolved = typeof next === 'function' ? next(current) : next
        hooks.queue[index] = resolved
        stateCalls.push({ index, next: resolved })
      }
      return [value, setter]
    },
    useEffect() {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }

  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register(opts, Component) {
        registrations.push({ opts, Component })
        return () => {}
      },
    },
  }
  mod.factory((name) => {
    if (name === 'react') return React
    if (name === PRIMITIVES_MODULE) {
      if (options.primitives === undefined) throw new Error('MODULE_NOT_FOUND: ' + name)
      return options.primitives
    }
    throw new Error('unexpected require: ' + name)
  }).apply(ctx)

  const render = (registration, queue, props = {}) => {
    hooks.queue = [...(queue || [])]
    hooks.index = 0
    const tree = registration.Component(props)
    Object.defineProperty(tree, '__panelVerify', {
      enumerable: false,
      value: () => {
        assert.equal(hooks.queue.length, hooks.index,
          registration.opts.id + ' 的 useState 队列必须按位置完整对齐')
      },
    })
    return tree
  }
  return {
    registrations,
    render,
    timers,
    stateCalls: () => stateCalls,
    resetStateCalls: () => { stateCalls.length = 0 },
  }
}

function stateWith(list = [watcher('a/b', { id: 'a/b#s1' })]) {
  return {
    loading: false,
    error: null,
    body: {
      sessionGoal: null,
      sessionTitle: 'L84 host primitives',
      credentials: { token: 'configured', sshKeyPath: 'none', ghConfigDir: 'none', giteeToken: 'none' },
      gh: { ok: true, version: '2.0' },
      defaults: {},
      watchers: list,
    },
  }
}

function mainQueue(snapshot, { tab = 'overview', update = null, item = null } = {}) {
  const queue = deskQueue(snapshot, null, {}, tab, '', false, update)
  queue[7] = item
  return queue
}

function deskOf(client) {
  return client.registrations.find((item) => item.opts.id === 'session-superagent-desk')
}

function orbitOf(client) {
  return client.registrations.find((item) => item.opts.id === 'session-superagent-orbit')
}

function nodeText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  return nodeText(node.props?.children || [])
}

function one(items, message) {
  assert.equal(items.length, 1, message + '；实际 ' + items.length)
  return items[0]
}

function button(nodes, label) {
  return one(nodes.filter((node) => node.type === 'button' && nodeText(node) === label), '找不到唯一按钮「' + label + '」')
}

function hostModal(nodes) {
  return one(nodes.filter((node) => node.type === HOST.Modal), '主面板必须有唯一 DSH Modal')
}

function localModals(nodes) {
  return nodes.filter((node) => node.type === 'div'
    && String(node.props?.className || '').split(/\s+/).includes('dt-modal'))
}

function hasClass(node, name) {
  return String(node.props?.className || '').split(/\s+/).includes(name)
}

function writesOf(calls) {
  return calls.filter(([, init]) => init?.method === 'POST')
}

const anchor = { x: 720, y: 860 }

test('可选探测：require 缺失或 exports 不全不阻断加载，主面板保留本地 Modal', () => {
  for (const primitives of [undefined, {}]) {
    const client = loadClient({ primitives })
    assert.equal(client.registrations.length, 2)
    const base = mainQueue(stateWith())
    const nodes = walk(client.render(deskOf(client), [...base, true, false]))
    assert.equal(localModals(nodes).length, 1)
    assert.equal(nodes.filter((node) => node.type === HOST.Modal).length, 0)
  }
})

test('主面板 ConfirmButton：DSH Modal props 完整，打开/取消/onClose 均不发写请求', () => {
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (...args) => { calls.push(args); return response({ watchers: [] }) },
  })
  const base = mainQueue(stateWith())
  const openHook = base.length
  const closed = walk(client.render(deskOf(client), [...base, false, false]))
  const trigger = one(closed.filter((node) => node.type === 'button' && node.props['aria-label'] === '删除'), '缺删除触发器')
  trigger.props.onClick()
  assert.ok(client.stateCalls().some((call) => call.index === openHook && call.next === true))
  assert.equal(writesOf(calls).length, 0)

  const nodes = walk(client.render(deskOf(client), [...base, true, false]))
  const modal = hostModal(nodes)
  assert.equal(localModals(nodes).length, 0)
  assert.equal(modal.props.open, true)
  assert.equal(modal.props.title, '确认删除')
  assert.ok(modal.props.description.includes('删除'))
  assert.equal(modal.props.closeLabel, '关闭')
  assert.equal(typeof modal.props.onClose, 'function')
  assert.ok(modal.props.footer)

  const footer = walk(modal.props.footer)
  client.resetStateCalls()
  button(footer, '取消').props.onClick()
  modal.props.onClose()
  assert.equal(client.stateCalls().filter((call) => call.index === openHook && call.next === false).length, 2)
  assert.equal(writesOf(calls).length, 0)
})

test('主面板术语表也走 DSH Modal，不混用本地 dt-modal shell', () => {
  const client = loadClient({ primitives: HOST })
  const base = mainQueue(stateWith())
  base[11] = true
  const nodes = walk(client.render(deskOf(client), base))
  const modal = hostModal(nodes)
  assert.equal(modal.props.title, '主理鱼术语表')
  assert.equal(modal.props.closeLabel, '关闭')
  assert.equal(localModals(nodes).length, 0)
})

test('主面板确认：busyRef 防重入，成功才关闭，busy props 不回归', async () => {
  const calls = []
  let release
  const client = loadClient({
    primitives: HOST,
    fetch: (url, init) => {
      calls.push([url, init])
      if (init?.method === 'POST') {
        return new Promise((resolve) => { release = () => resolve(response({ ok: true })) })
      }
      return Promise.resolve(response({ watchers: [] }))
    },
  })
  const base = mainQueue(stateWith())
  const openHook = base.length
  const busyHook = openHook + 1
  const opened = walk(client.render(deskOf(client), [...base, true, false]))
  const confirm = button(walk(hostModal(opened).props.footer), '确认删除')

  client.resetStateCalls()
  const first = confirm.props.onClick()
  assert.equal(await confirm.props.onClick(), false, '第二次连点必须被同步 busyRef 挡住')
  assert.equal(writesOf(calls).length, 1)
  release()
  assert.equal(await first, true)
  assert.ok(client.stateCalls().some((call) => call.index === busyHook && call.next === true))
  assert.ok(client.stateCalls().some((call) => call.index === busyHook && call.next === false))
  assert.ok(client.stateCalls().some((call) => call.index === openHook && call.next === false))

  const busyNodes = walk(client.render(deskOf(client), [...base, true, true]))
  const busy = button(walk(hostModal(busyNodes).props.footer), '确认删除')
  assert.equal(busy.props.disabled, true)
  assert.equal(busy.props['aria-busy'], 'true')
  assert.ok(hasClass(busy, 'dt-btn-busy'))
})

test('主面板确认失败保持打开，重要错误仍同时写 Section notice 与 error Toast', async () => {
  const client = loadClient({
    primitives: HOST,
    fetch: async (url, init) => init?.method === 'POST'
      ? response({ error: '冲突' }, false, 409)
      : response(stateWith().body),
  })
  const base = mainQueue(stateWith())
  const openHook = base.length
  const opened = walk(client.render(deskOf(client), [...base, true, false]))
  const confirm = button(walk(hostModal(opened).props.footer), '确认删除')
  client.resetStateCalls()
  assert.equal(await confirm.props.onClick(), false)
  assert.ok(!client.stateCalls().some((call) => call.index === openHook && call.next === false))
  assert.ok(client.stateCalls().some((call) => call.index === 2 && call.next?.text === '冲突'))
  assert.ok(client.stateCalls().some((call) => call.index === 7 && call.next?.tone === 'error'))

  const visibleBase = mainQueue(stateWith(), { item: { id: 2, text: '冲突', tone: 'error' } })
  visibleBase[2] = { ok: false, text: '冲突' }
  const visible = walk(client.render(deskOf(client), visibleBase))
  const sectionError = one(visible.filter((node) => node.type === 'div'
    && hasClass(node, 'dt-banner') && hasClass(node, 'dt-danger') && nodeText(node).includes('冲突')), '缺 Section 错误')
  assert.ok(sectionError)
})

test('卫星环删除确认即使 DSH 可用也保留本地 Modal，确认仍只发一次 delete', async () => {
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (...args) => { calls.push(args); return response({ watchers: [] }) },
  })
  const list = stateWith().body.watchers
  const nodes = walk(client.render(orbitOf(client), [list, null, true, anchor, true, false]))
  assert.equal(nodes.filter((node) => node.type === HOST.Modal).length, 0)
  const modal = one(localModals(nodes), 'orbit 必须保留本地 Modal')
  assert.equal(modal.props.role, 'dialog')
  assert.ok(nodes.some((node) => node.props?.className === 'dt-modal-mask'))
  assert.equal(await button(nodes, '确认删除').props.onClick(), true)
  assert.equal(writesOf(calls).length, 1)
  assert.deepEqual(JSON.parse(writesOf(calls)[0][1].body), { action: 'delete', id: 'a/b#s1' })
})

test('DSH Toast：key/holdMs/tone 正确，error 显式官方 warning icon，success 保留内建勾', () => {
  const client = loadClient({ primitives: HOST })
  const successItem = { id: 'ok-1', text: '已保存', tone: 'success' }
  const successNodes = walk(client.render(deskOf(client), mainQueue(stateWith(), { item: successItem })))
  const success = one(successNodes.filter((node) => node.type === HOST.Toast), '缺 success Toast')
  assert.equal(success.key, 'ok-1')
  assert.equal(success.props.key, undefined, '真 React key 不应留在 props')
  assert.equal(success.props.text, '已保存')
  assert.equal(success.props.tone, 'success')
  assert.equal(success.props.holdMs, 3000)
  assert.equal(success.props.icon, undefined)
  assert.equal(successNodes.filter((node) => hasClass(node, 'dt-toast')).length, 0)

  const errorItem = { id: 'err-2', text: '保存失败', tone: 'error' }
  const errorNodes = walk(client.render(deskOf(client), mainQueue(stateWith(), { item: errorItem })))
  const error = one(errorNodes.filter((node) => node.type === HOST.Toast), '缺 error Toast')
  assert.equal(error.key, 'err-2')
  assert.equal(error.props.holdMs, 3000)
  assert.equal(error.props.icon.type, HOST.IconWarningOutlineMedium)
})

test('notify(text,tone) 调用面不变：连续通知只替换单个 item，DSH 路径没有自有 timer', async () => {
  const clipboard = []
  const client = loadClient({
    primitives: HOST,
    writeText: async (text) => { clipboard.push(text) },
  })
  const update = { current: '0.9.266', latest: '0.9.267', hasUpdate: true, command: 'dsh plugin add demo' }
  const base = mainQueue(stateWith(), { tab: 'settings', update })
  base[14] = 'update'
  const nodes = walk(client.render(deskOf(client), base))
  const copy = button(nodes, '复制命令')
  await copy.props.onClick()
  await copy.props.onClick()
  assert.deepEqual(clipboard, [update.command, update.command])
  const notices = client.stateCalls().filter((call) => call.index === 7)
  assert.deepEqual(notices.map((call) => ({ ...call.next })), [
    { id: 1, text: '升级命令已复制', tone: 'info' },
    { id: 2, text: '升级命令已复制', tone: 'info' },
  ])
  assert.equal(client.timers.length, 0, 'DSH onDone 路径不得创建第二套 Toast timer')

  const latest = walk(client.render(deskOf(client), mainQueue(stateWith(), { item: notices[1].next })))
  assert.equal(one(latest.filter((node) => node.type === HOST.Toast), '只显示最新通知').key, 2)
})

test('Toast onDone(id) id guard：旧完成回调保留新通知，当前完成回调才清空', () => {
  const client = loadClient({ primitives: HOST })
  const oldItem = { id: 'old', text: '旧通知', tone: 'info' }
  const oldNodes = walk(client.render(deskOf(client), mainQueue(stateWith(), { item: oldItem })))
  const oldDone = one(oldNodes.filter((node) => node.type === HOST.Toast), '缺旧 Toast').props.onDone

  const newItem = { id: 'new', text: '新通知', tone: 'info' }
  const newNodes = walk(client.render(deskOf(client), mainQueue(stateWith(), { item: newItem })))
  const newDone = one(newNodes.filter((node) => node.type === HOST.Toast), '缺新 Toast').props.onDone
  client.resetStateCalls()
  oldDone('宿主不会传参数，也不应影响 id guard')
  assert.strictEqual(client.stateCalls()[0].next, newItem, '旧 onDone 不得清掉新 item')
  newDone()
  assert.equal(client.stateCalls()[1].next, null)
})

test('fallback Toast：保留 role=status/polite 与自有 4000ms timer，新通知取消旧 timer', async () => {
  const client = loadClient({ writeText: async () => {} })
  const update = { current: '0.9.266', latest: '0.9.267', hasUpdate: true, command: 'demo' }
  const base = mainQueue(stateWith(), { tab: 'settings', update })
  base[14] = 'update'
  const nodes = walk(client.render(deskOf(client), base))
  const copy = button(nodes, '复制命令')
  await copy.props.onClick()
  assert.equal(client.timers.length, 1)
  assert.equal(client.timers[0].ms, 4000)
  await copy.props.onClick()
  assert.equal(client.timers.length, 1, '第二条通知必须取消第一条 timer')
  client.timers[0].fn()
  assert.equal(client.stateCalls().filter((call) => call.index === 7).at(-1).next, null)

  const item = { id: 'local', text: '失败', tone: 'error' }
  const fallback = walk(client.render(deskOf(client), mainQueue(stateWith(), { item })))
  const toast = one(fallback.filter((node) => hasClass(node, 'dt-toast')), 'fallback 缺本地 Toast')
  assert.equal(toast.props.role, 'status')
  assert.equal(toast.props['aria-live'], 'polite')
  assert.ok(hasClass(toast, 'dt-danger'))
  assert.equal(fallback.filter((node) => node.type === HOST.Toast).length, 0)
})
