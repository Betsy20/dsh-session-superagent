import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { deskQueue, walk } from './fixtures/panel-harness.mjs'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const HOST = Object.freeze({
  Modal: 'dsh-host-modal',
  Toast: 'dsh-host-toast',
  Button: 'dsh-host-button',
  IconWarningOutlineMedium: 'dsh-host-warning-icon',
})
const UPDATE = Object.freeze({
  current: '0.9.270',
  latest: '0.9.271',
  hasUpdate: true,
  command: 'dsh plugin --profile <你的 profile> add dsh-session-superagent@0.9.271',
})
const RECEIPT = Object.freeze({
  installedVersion: '0.9.271',
  runningVersion: '0.9.270',
  needsReload: true,
})

function response(body, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(body) }
}

// 执行真实 UMD，同时注入可辨识的宿主原语；state setter 会记录并保存最新值。
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
        const resolved = typeof next === 'function' ? next(hooks.queue[index]) : next
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
      value: () => assert.equal(hooks.queue.length, hooks.index, 'useState 队列必须按位置完整对齐'),
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

function snapshot() {
  return {
    loading: false,
    error: null,
    body: {
      sessionGoal: null,
      sessionTitle: 'update UI',
      credentials: { token: 'configured', sshKeyPath: 'none', ghConfigDir: 'none', giteeToken: 'none' },
      gh: { ok: true, version: '2.0' },
      defaults: {},
      watchers: [],
    },
  }
}

function updateQueue() {
  // 本测试只依赖任务开始时的 22 个根槽；updateResult 是被测 client 自己追加的第 23 槽。
  // 不切分公共 fixture，避免其它任务向共享队列追加占位后改变这里 open/busy 的位置。
  const queue = deskQueue(snapshot(), null, {}, 'settings', '', false, UPDATE).slice(0, 22)
  queue[7] = null
  queue[14] = 'update'
  return queue
}

function deskOf(client) {
  return client.registrations.find((item) => item.opts.id === 'session-superagent-desk')
}

function nodesOf(client, queue) {
  return walk(client.render(deskOf(client), queue))
}

function nodeText(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  return nodeText(node.props?.children || [])
}

function textOf(nodes) {
  return nodes.filter((node) => node.type === '#text').map((node) => node.text).join(' | ')
}

function one(items, message) {
  assert.equal(items.length, 1, message + '；实际 ' + items.length)
  return items[0]
}

function control(nodes, label) {
  return one(nodes.filter((node) => (node.type === 'button' || node.type === HOST.Button) && nodeText(node) === label),
    '找不到唯一按钮「' + label + '」')
}

function hostModal(nodes) {
  return one(nodes.filter((node) => node.type === HOST.Modal), '缺唯一 DSH Modal')
}

function localModal(nodes) {
  return one(nodes.filter((node) => node.type === 'div'
    && String(node.props?.className || '').split(/\s+/).includes('dt-modal')), '缺唯一本地 Modal')
}

function hasClass(node, name) {
  return String(node.props?.className || '').split(/\s+/).includes(name)
}

function postsOf(calls) {
  return calls.filter(([, init]) => init?.method === 'POST')
}

function hookIndexes(base) {
  return { result: base.length, open: base.length + 1, busy: base.length + 2 }
}

test('hasUpdate 显示官方 primary 安装按钮；点击只确认，复制命令仍是真实 fallback', async () => {
  const calls = []
  const clipboard = []
  const client = loadClient({
    primitives: HOST,
    writeText: async (text) => { clipboard.push(text) },
    fetch: async (...args) => { calls.push(args); return response({}) },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const closed = nodesOf(client, base)
  const trigger = control(closed, '安装更新')
  assert.equal(trigger.type, HOST.Button)
  assert.equal(trigger.props.variant, 'primary')
  assert.equal(trigger.props.size, 'sm')
  assert.equal(trigger.props['aria-haspopup'], 'dialog')
  assert.ok(textOf(closed).includes(UPDATE.command), '命令文本必须保留')
  assert.equal(closed.filter((node) => node.type === HOST.Modal).length, 0)

  client.resetStateCalls()
  trigger.props.onClick()
  assert.ok(client.stateCalls().some((call) => call.index === hooks.open && call.next === true))
  assert.equal(postsOf(calls).length, 0, '打开确认框不能发 POST')

  const opened = nodesOf(client, [...base, null, true, false])
  const modal = hostModal(opened)
  assert.equal(modal.props.open, true)
  assert.equal(modal.props.title, '安装更新')
  for (const expected of ['0.9.270', '0.9.271', '修改安装副本', '需要重载宿主才生效', '不会自动重启']) {
    assert.ok(modal.props.description.includes(expected), '确认说明缺：' + expected)
  }
  const footer = walk(modal.props.footer)
  control(footer, '取消').props.onClick()
  modal.props.onClose()
  assert.equal(postsOf(calls).length, 0, '取消与 onClose 都不能发 POST')

  await control(closed, '复制命令').props.onClick()
  assert.deepEqual(clipboard, [UPDATE.command])
  assert.equal(postsOf(calls).length, 0, '复制命令不能冒充安装')
})

test('确认才 POST 指定版本；busyRef 挡住连点，整轮只安装一次并强制刷新', async () => {
  const calls = []
  let release
  const client = loadClient({
    primitives: HOST,
    fetch: (url, init) => {
      calls.push([url, init])
      if (init?.method === 'POST') {
        return new Promise((resolve) => { release = () => resolve(response({ ok: true, ...RECEIPT })) })
      }
      return Promise.resolve(response({ ...UPDATE, hasUpdate: false }))
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  const confirm = control(walk(hostModal(opened).props.footer), '确认安装')

  client.resetStateCalls()
  const first = confirm.props.onClick()
  assert.equal(await confirm.props.onClick(), false, '第二次连点必须被同步 busyRef 挡住')
  assert.equal(postsOf(calls).length, 1)
  assert.equal(postsOf(calls)[0][0], '/session-superagent/update')
  assert.deepEqual(JSON.parse(postsOf(calls)[0][1].body), { version: '0.9.271' })
  assert.ok(client.stateCalls().some((call) => call.index === hooks.busy && call.next === true))
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0, 'POST 未完成前不能刷新')

  const busyTree = nodesOf(client, [...base, null, true, true])
  const busy = control(walk(hostModal(busyTree).props.footer), '确认安装')
  assert.equal(busy.props.disabled, true)
  assert.equal(busy.props['aria-busy'], 'true')
  assert.ok(hasClass(busy, 'dt-btn-busy'))

  release()
  assert.equal(await first, true)
  assert.equal(postsOf(calls).length, 1)
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 1)
  assert.ok(client.stateCalls().some((call) => call.index === hooks.open && call.next === false), '成功才关闭 Modal')
  assert.ok(client.stateCalls().some((call) => call.index === hooks.busy && call.next === false))
})

test('成功显示 installed/running/needsReload 与 GET 新状态，不把安装回执写成已运行新版', async () => {
  const refreshed = { ...UPDATE, hasUpdate: false }
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (url, init) => {
      calls.push([url, init])
      return init?.method === 'POST' ? response({ ok: true, ...RECEIPT }) : response(refreshed)
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  client.resetStateCalls()
  assert.equal(await control(walk(hostModal(opened).props.footer), '确认安装').props.onClick(), true)

  const receiptCall = one(client.stateCalls().filter((call) => call.index === hooks.result), '缺安装回执 state')
  assert.deepEqual({ ...receiptCall.next }, RECEIPT)
  const updateCall = client.stateCalls().filter((call) => call.index === 12).at(-1)
  assert.deepEqual({ ...updateCall.next }, refreshed)
  const toastCall = client.stateCalls().filter((call) => call.index === 7 && call.next?.tone === 'success').at(-1)
  assert.ok(toastCall, '成功必须进入 Toast')
  assert.ok(toastCall.next.text.includes('installedVersion 0.9.271'))
  assert.ok(toastCall.next.text.includes('runningVersion 0.9.270'))
  assert.ok(toastCall.next.text.includes('需要重载才生效'))
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 1)
  const actionCalls = calls.filter(([url]) => !url.startsWith('/session-superagent/client-note'))
  assert.ok(actionCalls.every(([url]) => url.startsWith('/session-superagent/update')), '除加载探针外不得调用重启或其它执行接口：' + actionCalls.map(([url]) => url).join(', '))

  const finalQueue = updateQueue()
  finalQueue[12] = refreshed
  const finalText = textOf(nodesOf(client, [...finalQueue, RECEIPT]))
  for (const expected of ['installedVersion', '0.9.271', 'runningVersion', '0.9.270', 'needsReload', 'true · 需要重载才生效']) {
    assert.ok(finalText.includes(expected), '成功 Section 缺：' + expected)
  }
  assert.ok(!finalText.includes('已运行新版'), 'runningVersion 未变时不能宣称已运行新版')

  const noReload = { ...RECEIPT, runningVersion: '0.9.271', needsReload: false }
  const noReloadQueue = updateQueue()
  noReloadQueue[12] = refreshed
  const noReloadText = textOf(nodesOf(client, [...noReloadQueue, noReload]))
  assert.ok(noReloadText.includes('false · 当前无需重载'))
  assert.ok(noReloadText.includes('runningVersion') && noReloadText.includes('0.9.271'))
  assert.ok(!noReloadText.includes('已运行新版'), '界面不凭版本相等额外推断运行状态')
})

test('失败保留当前版本与命令回退，Modal 不假装成功，错误进入 Section 与 Toast', async () => {
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (url, init) => {
      calls.push([url, init])
      return init?.method === 'POST' ? response({ error: '磁盘只读' }, false, 500) : response(UPDATE)
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  client.resetStateCalls()
  assert.equal(await control(walk(hostModal(opened).props.footer), '确认安装').props.onClick(), false)
  assert.equal(postsOf(calls).length, 1)
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0, '失败不能伪装成功后刷新')
  assert.equal(client.stateCalls().filter((call) => call.index === 12).length, 0, '失败不能覆盖当前 update')
  assert.equal(client.stateCalls().filter((call) => call.index === hooks.result).length, 0, '失败不能写安装回执')
  assert.ok(!client.stateCalls().some((call) => call.index === hooks.open && call.next === false), '失败保持确认层')

  const errorText = '安装更新失败：磁盘只读'
  assert.ok(client.stateCalls().some((call) => call.index === 2 && call.next?.text === errorText), '缺 Section notice')
  assert.ok(client.stateCalls().some((call) => call.index === 7 && call.next?.text === errorText && call.next?.tone === 'error'), '缺 error Toast')

  const visibleQueue = updateQueue()
  visibleQueue[2] = { ok: false, text: errorText }
  visibleQueue[7] = { id: 1, text: errorText, tone: 'error' }
  const visible = nodesOf(client, [...visibleQueue, null, true, false])
  const text = textOf(visible)
  assert.ok(text.includes('0.9.270') && text.includes(UPDATE.command), '失败后当前版本或命令回退丢失')
  assert.ok(text.includes(errorText), 'Section 必须留住错误')
  assert.ok(control(visible, '复制命令'))
  assert.equal(hostModal(visible).props.open, true)
  assert.equal(one(visible.filter((node) => node.type === HOST.Toast), '缺可见宿主 Toast').props.text, errorText)
  assert.ok(!text.includes('已运行新版'))
})

test('老宿主缺 Button/Modal/Toast 时保留完整本地 fallback，确认仍执行同一 POST', async () => {
  for (const primitives of [undefined, {}]) {
    const calls = []
    const client = loadClient({
      primitives,
      fetch: async (url, init) => {
        calls.push([url, init])
        return init?.method === 'POST' ? response({ ok: true, ...RECEIPT }) : response({ ...UPDATE, hasUpdate: false })
      },
    })
    const base = updateQueue()
    const closed = nodesOf(client, base)
    const trigger = control(closed, '安装更新')
    assert.equal(trigger.type, 'button')
    assert.ok(hasClass(trigger, 'dt-btn-primary'))
    assert.ok(control(closed, '复制命令'))
    assert.equal(closed.filter((node) => node.type === HOST.Button || node.type === HOST.Modal).length, 0)

    trigger.props.onClick()
    const opened = nodesOf(client, [...base, null, true, false])
    const modal = localModal(opened)
    assert.equal(modal.props.role, 'dialog')
    assert.ok(textOf(opened).includes('修改安装副本'))
    assert.equal(await control(opened, '确认安装').props.onClick(), true)
    assert.equal(postsOf(calls).length, 1)
    assert.deepEqual(JSON.parse(postsOf(calls)[0][1].body), { version: '0.9.271' })
    assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 1)
    assert.ok(client.stateCalls().some((call) => call.index === 7 && call.next?.tone === 'success'))
    assert.equal(opened.filter((node) => node.type === HOST.Button || node.type === HOST.Modal || node.type === HOST.Toast).length, 0)
  }
})
