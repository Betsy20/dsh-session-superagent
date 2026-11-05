import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import { deskQueue, walk, watcher } from './fixtures/panel-harness.mjs'

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
const UNKNOWN_HINT = '请求结果未知，请先重新检查 installed/running，再手动确认'
const UNKNOWN_RECEIPT = Object.freeze({
  installedVersion: '未知',
  runningVersion: '未知',
  needsReload: null,
  resultUnknown: true,
})

function response(body, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) }
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
  // 只在定向测试显式要求时暴露真实 Btn；生产文件与分支逻辑不变，仅追加一个测试捕获点。
  const source = options.captureBtn
    ? SOURCE.replace('    const UpdateButton = hostButton || Btn', '    window.__BtnForTest = Btn\n    const UpdateButton = hostButton || Btn')
    : SOURCE
  if (options.captureBtn) assert.notEqual(source, SOURCE, '必须捕获真实 Btn，不能测试手写复制品')
  vm.runInContext(source, sandbox)
  assert.ok(mod, 'client.js 必须调用 __ModuleLoader__.load')

  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const { key, ref, ...rest } = props || {}
      const node = {
        type,
        props: { ...rest, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) },
      }
      if (key !== undefined) node.key = key
      if (ref !== undefined) node.ref = ref
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
    Btn: sandbox.window.__BtnForTest,
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

function nodesOf(client, queue, props = {}) {
  return walk(client.render(deskOf(client), queue, props))
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

function controls(nodes, label) {
  return nodes.filter((node) => (node.type === 'button' || node.type === HOST.Button) && nodeText(node) === label)
}

function control(nodes, label) {
  return one(controls(nodes, label), '找不到唯一按钮「' + label + '」')
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

test('Btn primary：直接委托 DSH Button，type/ref/key 与业务 props 原样保留，其它 variant 不迁移', () => {
  const client = loadClient({ primitives: HOST, captureBtn: true })
  assert.equal(typeof client.Btn, 'function')
  const onClick = () => {}
  const ref = { current: null }
  const icon = { type: 'svg', props: { children: [] } }
  const node = client.Btn({
    variant: 'primary', size: 'sm', icon, children: '保存 goal',
    className: 'dt-btn-busy dt-danger', type: 'submit', ref, key: 'goal-save',
    disabled: true, 'aria-label': '保存 goal', 'aria-busy': 'true', onClick,
  })
  assert.equal(node.type, HOST.Button)
  assert.equal(node.props.variant, 'primary')
  assert.equal(node.props.size, 'sm')
  assert.equal(node.props.type, 'submit', '显式 type=submit 必须覆盖默认 button')
  assert.strictEqual(node.ref, ref, 'DSH forwardRef 的 ref 必须留在 element.ref')
  assert.equal(node.key, 'goal-save')
  assert.equal(node.props.key, undefined, 'key 不能被改写进 props')
  assert.strictEqual(node.props.icon, icon)
  assert.strictEqual(node.props.onClick, onClick)
  assert.equal(node.props.disabled, true)
  assert.equal(node.props['aria-label'], '保存 goal')
  assert.equal(node.props['aria-busy'], 'true')
  assert.equal(node.props.className, 'dt-btn-busy dt-danger')
  assert.ok(!hasClass(node, 'dt-btn') && !hasClass(node, 'dt-btn-primary'), '宿主路径不得重新引入旧 primary CSS')
  assert.deepEqual(node.props.children, ['保存 goal'], 'icon 交给宿主，不能复刻旧 span 结构')
  assert.equal(client.Btn({ variant: 'primary', children: '保存' }).props.type, 'button')

  const ghost = client.Btn({ variant: 'ghost', size: 'sm', icon, children: '取消', className: 'business' })
  assert.equal(ghost.type, 'button')
  assert.equal(ghost.props.type, 'button')
  assert.ok(hasClass(ghost, 'dt-btn') && hasClass(ghost, 'dt-btn-ghost') && hasClass(ghost, 'dt-btn-sm'))
  assert.ok(hasClass(ghost, 'business'))
  assert.equal(ghost.props.children[0].props.className, 'dt-btn-icon')
})

test('Btn primary：老宿主缺 Button 或整个 primitives 时完整回退旧 DOM 与 props', () => {
  for (const primitives of [undefined, {}]) {
    const client = loadClient({ primitives, captureBtn: true })
    const onClick = () => {}
    const ref = { current: null }
    const icon = { type: 'svg', props: { children: [] } }
    const node = client.Btn({
      variant: 'primary', size: 'sm', icon, children: '确认删除',
      className: 'dt-btn-busy dt-danger', type: 'submit', ref, key: 'delete-confirm',
      disabled: true, 'aria-label': '确认删除', 'aria-busy': 'true', onClick,
    })
    assert.equal(node.type, 'button')
    assert.equal(node.props.type, 'submit')
    assert.strictEqual(node.ref, ref)
    assert.equal(node.key, 'delete-confirm')
    assert.equal(node.props.key, undefined)
    assert.strictEqual(node.props.onClick, onClick)
    assert.equal(node.props.disabled, true)
    assert.equal(node.props['aria-label'], '确认删除')
    assert.equal(node.props['aria-busy'], 'true')
    for (const name of ['dt-btn', 'dt-btn-primary', 'dt-btn-sm', 'dt-btn-busy', 'dt-danger']) {
      assert.ok(hasClass(node, name), 'fallback 缺 class：' + name)
    }
    assert.equal(node.props.children[0].props.className, 'dt-btn-icon')
    assert.strictEqual(node.props.children[0].props.children[0], icon)
    assert.equal(node.props.children[1], '确认删除')
  }
})

test('现有 8 个直接 Btn primary 场景全部委托；SaveBar 的 ghost 仍保持旧 Btn', () => {
  const client = loadClient({ primitives: HOST })
  const empty = snapshot()
  let delegated = 0
  const primary = (label, queue, props = {}) => {
    const nodes = nodesOf(client, queue, props)
    const node = control(nodes, label)
    assert.equal(node.type, HOST.Button, label + ' 必须委托 DSH Button')
    assert.equal(node.props.variant, 'primary')
    assert.ok(!hasClass(node, 'dt-btn') && !hasClass(node, 'dt-btn-primary'), label + ' 不得带旧 primary CSS')
    delegated += 1
    return node
  }

  const onboarding = primary('去添加第一条', deskQueue(empty))
  assert.equal(onboarding.props.type, 'button')
  assert.equal(onboarding.props.size, 'md')
  assert.ok(onboarding.props.icon)
  assert.equal(typeof onboarding.props.onClick, 'function')

  const judgeEmpty = primary('去添加第一条', deskQueue(empty, null, {}, 'judge'))
  assert.equal(judgeEmpty.props.size, 'sm')

  const blankCreate = primary('添加到当前会话', deskQueue(empty, null, {}, 'trigger'), { sessionId: 's1' })
  assert.equal(blankCreate.props.type, 'submit')
  assert.equal(blankCreate.props.disabled, true)
  assert.equal(blankCreate.props['aria-label'], '添加到当前会话')
  assert.ok(blankCreate.props.icon)

  const dirty = deskQueue(empty, null, {}, 'trigger')
  dirty[3] = { ...dirty[3], repo: 'acme/widgets' }
  const save = primary('添加到当前会话', dirty, { sessionId: 's1' })
  assert.equal(save.props.type, 'submit')
  assert.equal(save.props.size, 'sm')
  assert.equal(save.props.disabled, false)
  const discard = control(nodesOf(client, dirty, { sessionId: 's1' }), '放弃')
  assert.equal(discard.type, 'button', '非 primary 必须保留旧 Btn')
  assert.ok(hasClass(discard, 'dt-btn') && hasClass(discard, 'dt-btn-ghost'))

  const creds = deskQueue(empty, null, {}, 'settings')
  creds[14] = 'creds'
  const saveCredentials = primary('保存凭证', creds)
  assert.equal(saveCredentials.props.type, 'button')
  assert.equal(typeof saveCredentials.props.onClick, 'function')

  const goal = deskQueue(empty, null, {}, 'settings')
  goal[14] = 'goal'
  const saveGoal = primary('保存 goal', goal, { sessionId: 's1' })
  assert.equal(saveGoal.props.disabled, false)
  assert.equal(typeof saveGoal.props.onClick, 'function')

  const failed = deskQueue({ ...empty, error: 'Failed to fetch' })
  assert.equal(typeof primary('重试', failed).props.onClick, 'function')

  const rules = snapshot()
  rules.body.watchers = [watcher('a/b', { silentWakes: 3 })]
  const rulesQueue = deskQueue(rules)
  rulesQueue[11] = 'rules:a/b'
  const copyRules = primary('复制这段规则', rulesQueue)
  assert.equal(copyRules.props.size, 'sm')
  assert.equal(typeof copyRules.props.onClick, 'function')
  assert.equal(delegated, 8, '必须真实渲染并验收 8 个直接 primary 场景')
})

test('共享删除确认 primary 委托后仍透传 danger/busy/disabled/aria，取消保持旧 ghost', () => {
  const client = loadClient({ primitives: HOST })
  const state = snapshot()
  state.body.watchers = [watcher('a/b', { id: 'a/b#s1' })]
  const base = deskQueue(state)
  const opened = nodesOf(client, [...base, true, false])
  const footer = walk(hostModal(opened).props.footer)
  const cancel = control(footer, '取消')
  assert.equal(cancel.type, 'button')
  assert.ok(hasClass(cancel, 'dt-btn-ghost'))
  const confirm = control(footer, '确认删除')
  assert.equal(confirm.type, HOST.Button)
  assert.equal(confirm.props.type, 'button')
  assert.equal(confirm.props.size, 'md')
  assert.equal(confirm.props.disabled, false)
  assert.equal(confirm.props['aria-label'], '确认删除')
  assert.equal(confirm.props['aria-busy'], undefined)
  assert.equal(typeof confirm.props.onClick, 'function')
  assert.ok(hasClass(confirm, 'dt-danger'))
  assert.ok(!hasClass(confirm, 'dt-btn-busy'))

  const busyFooter = walk(hostModal(nodesOf(client, [...base, true, true])).props.footer)
  const busy = control(busyFooter, '确认删除')
  assert.equal(busy.type, HOST.Button)
  assert.equal(busy.props.disabled, true)
  assert.equal(busy.props['aria-busy'], 'true')
  assert.ok(hasClass(busy, 'dt-danger') && hasClass(busy, 'dt-btn-busy'))
})

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

test('deferred POST 忙碌时取消/onClose/连点均不关闭或重发；成功后只关闭一次并展示回执', async () => {
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
  const openedModal = hostModal(opened)
  const openedFooter = walk(openedModal.props.footer)
  const confirm = control(openedFooter, '确认安装')
  const pendingCancel = control(openedFooter, '取消')

  client.resetStateCalls()
  const first = confirm.props.onClick()
  assert.equal(await confirm.props.onClick(), false, '第二次连点必须被同步 busyRef 挡住')
  assert.equal(pendingCancel.props.onClick(), false, '取消处理器必须被同一个同步 busyRef 挡住')
  assert.equal(openedModal.props.onClose(), false, '遮罩/Escape/关闭共用的 onClose 必须被 guard')
  assert.equal(postsOf(calls).length, 1)
  assert.equal(postsOf(calls)[0][0], '/session-superagent/update')
  assert.deepEqual(JSON.parse(postsOf(calls)[0][1].body), { version: '0.9.271' })
  assert.ok(client.stateCalls().some((call) => call.index === hooks.busy && call.next === true))
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0, 'POST 未完成前不能刷新')

  const busyTree = nodesOf(client, [...base, null, true, true])
  const busyModal = hostModal(busyTree)
  const busyFooter = walk(busyModal.props.footer)
  const cancel = control(busyFooter, '取消')
  const busy = control(busyFooter, '确认安装')
  assert.equal(cancel.props.disabled, true, '安装忙碌时取消按钮必须 disabled')
  assert.equal(busy.props.disabled, true)
  assert.equal(busy.props['aria-busy'], 'true')
  assert.ok(hasClass(busy, 'dt-btn-busy'))
  assert.ok(textOf(busyTree).includes('安装进行中，完成后才能关闭'), 'Modal 必须持续显示 busy 提示；实际：' + textOf(busyTree))
  assert.equal(cancel.props.onClick(), false, 'busy 渲染中的取消仍受 guard')
  assert.equal(busyModal.props.onClose(), false, 'busy 渲染中的 onClose 仍受 guard')
  assert.equal(postsOf(calls).length, 1)
  assert.equal(client.stateCalls().some((call) => call.index === hooks.open && call.next === false), false,
    'POST pending 时任何 dismiss 路径都不能关闭 Modal')

  release()
  assert.equal(await first, true)
  assert.equal(postsOf(calls).length, 1)
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 1)
  assert.equal(client.stateCalls().filter((call) => call.index === hooks.open && call.next === false).length, 1,
    '成功必须绕过 busy guard，且只关闭一次')
  assert.ok(client.stateCalls().some((call) => call.index === hooks.busy && call.next === false))
  const receiptCall = one(client.stateCalls().filter((call) => call.index === hooks.result), '缺安装回执 state')
  assert.deepEqual({ ...receiptCall.next }, RECEIPT)

  const finalQueue = updateQueue()
  finalQueue[12] = { ...UPDATE, hasUpdate: false }
  const finalText = textOf(nodesOf(client, [...finalQueue, RECEIPT]))
  for (const expected of ['已安装，等待重载', 'installedVersion', '0.9.271', 'runningVersion', '0.9.270']) {
    assert.ok(finalText.includes(expected), '成功回执缺：' + expected)
  }
})

test('成功回执覆盖真实 GET hasUpdate:true：等待重载且不再提示重复安装，不冒充已运行新版', async () => {
  // 真实服务端仍以 runningVersion 比较 latest；安装副本已到 latest 时 GET 仍会返回 hasUpdate:true。
  const refreshed = { ...UPDATE, hasUpdate: true }
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
  assert.equal(client.stateCalls().some((call) => call.index === hooks.result && call.next === null), false,
    '安装后的强制刷新必须保留刚写入的回执')
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
  const finalNodes = nodesOf(client, [...finalQueue, RECEIPT])
  const finalText = textOf(finalNodes)
  for (const expected of ['已安装，等待重载', 'installedVersion', '0.9.271', 'runningVersion', '0.9.270', 'needsReload', 'true · 需要重载才生效']) {
    assert.ok(finalText.includes(expected), '成功 Section 缺：' + expected)
  }
  assert.equal(controls(finalNodes, '安装更新').length, 0, '已安装 latest 且等待重载时必须隐藏重复安装按钮')
  assert.ok(control(finalNodes, '复制命令'), '手动命令回退不应随安装按钮一起隐藏')
  assert.ok(!finalText.includes('已运行新版'), 'runningVersion 未变时不能宣称已运行新版')

  const installedOverview = updateQueue()
  installedOverview[1] = 'overview'
  installedOverview[12] = refreshed
  const overviewNodes = nodesOf(client, [...installedOverview, RECEIPT])
  assert.equal(controls(overviewNodes, '去更新').length, 0, '等待重载时顶部不再给重复安装入口')
  assert.ok(!textOf(overviewNodes).includes('有新版本'), '等待重载时顶部不再误报有新版本')

  const noReload = { ...RECEIPT, runningVersion: '0.9.271', needsReload: false }
  const noReloadQueue = updateQueue()
  noReloadQueue[12] = refreshed
  const noReloadText = textOf(nodesOf(client, [...noReloadQueue, noReload]))
  assert.ok(noReloadText.includes('false · 当前无需重载'))
  assert.ok(noReloadText.includes('runningVersion') && noReloadText.includes('0.9.271'))
  assert.ok(!noReloadText.includes('已运行新版'), '界面不凭版本相等额外推断运行状态')
})

test('未安装、其它安装版本或 needsReload=false 时仍按 GET 显示安装按钮与顶部提示', () => {
  const client = loadClient({ primitives: HOST })
  const scenarios = [
    ['未安装', null],
    ['其它安装版本', { ...RECEIPT, installedVersion: '0.9.270' }],
    ['无需重载', { ...RECEIPT, needsReload: false }],
  ]
  for (const [name, receipt] of scenarios) {
    const settings = nodesOf(client, [...updateQueue(), receipt])
    assert.ok(control(settings, '安装更新'), name + '：不能隐藏安装按钮')
    assert.ok(!textOf(settings).includes('已安装，等待重载'), name + '：不能冒充等待重载')

    const overviewQueue = updateQueue()
    overviewQueue[1] = 'overview'
    const overview = nodesOf(client, [...overviewQueue, receipt])
    assert.ok(control(overview, '去更新'), name + '：不能隐藏顶部入口')
    assert.ok(textOf(overview).includes('有新版本 0.9.271'), name + '：顶部仍按 GET 提示')
  }
})

test('手动重新检查清掉旧安装回执；顶部入口直接叫「去更新」', async () => {
  const client = loadClient({
    primitives: HOST,
    fetch: async () => response(UPDATE),
  })
  const base = updateQueue()
  const resultIndex = hookIndexes(base).result
  base[resultIndex] = RECEIPT
  const nodes = nodesOf(client, base)
  client.resetStateCalls()
  await control(nodes, '重新检查').props.onClick()
  assert.ok(client.stateCalls().some((call) => call.index === resultIndex && call.next === null),
    '手动检查必须清掉旧回执，不能遮住新的 hasUpdate 状态')

  const overview = updateQueue()
  overview[1] = 'overview'
  const banner = control(nodesOf(client, overview), '去更新')
  banner.props.onClick()
  assert.ok(client.stateCalls().some((call) => call.index === 14 && call.next === 'update'))
  assert.ok(client.stateCalls().some((call) => call.index === 1 && call.next === 'settings'))
})

test('更新 POST 首个 fetch reject 只发一次：不 discoverBase，保留 update/命令并显示结果未知', async () => {
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (url, init) => {
      calls.push([url, init])
      if (init?.method === 'POST') throw new Error('响应丢失')
      return response(UPDATE)
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  client.resetStateCalls()
  assert.equal(await control(walk(hostModal(opened).props.footer), '确认安装').props.onClick(), false)
  assert.equal(postsOf(calls).length, 1, 'fetch rejection 不能自动重放更新 POST')
  assert.equal(calls.filter(([url]) => url.endsWith('/state')).length, 0, '更新 POST 失败不能触发 discoverBase')
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0, '结果未知不能伪装成功后刷新')
  assert.equal(client.stateCalls().filter((call) => call.index === 12).length, 0, '失败必须保留当前 update')
  const resultCall = one(client.stateCalls().filter((call) => call.index === hooks.result), '缺结果未知回执')
  assert.deepEqual({ ...resultCall.next }, UNKNOWN_RECEIPT)

  const errorText = '安装更新' + UNKNOWN_HINT + '：响应丢失'
  assert.ok(client.stateCalls().some((call) => call.index === 2 && call.next?.text === errorText), '缺未知结果 Section notice')
  assert.ok(client.stateCalls().some((call) => call.index === 7 && call.next?.text === errorText && call.next?.tone === 'error'), '缺未知结果 Toast')
  assert.ok(!client.stateCalls().some((call) => call.index === hooks.open && call.next === false), '结果未知保持确认层')

  const visibleQueue = updateQueue()
  visibleQueue[2] = { ok: false, text: errorText }
  visibleQueue[7] = { id: 1, text: errorText, tone: 'error' }
  const visible = nodesOf(client, [...visibleQueue, UNKNOWN_RECEIPT, true, false])
  const text = textOf(visible)
  assert.ok(text.includes('0.9.270') && text.includes(UPDATE.command), '结果未知后当前版本或命令回退丢失')
  assert.ok(text.includes(UNKNOWN_HINT), 'Section 必须持久显示重新检查 installed/running 的提示')
  assert.ok(text.includes('安装副本（installedVersion）') && text.includes('运行版本（runningVersion）'))
  assert.ok(!text.includes('安装完成') && !text.includes('未安装'), '结果未知不能写成安装完成或未安装')
  assert.ok(control(visible, '复制命令'))
  assert.equal(hostModal(visible).props.open, true)
})

test('更新 POST 404 只发一次：即使 discoverBase 可找到新前缀也不发第二次更新', async () => {
  const calls = []
  const client = loadClient({
    primitives: HOST,
    fetch: async (url, init) => {
      calls.push([url, init])
      if (init?.method === 'POST') {
        return calls.filter(([, options]) => options?.method === 'POST').length === 1
          ? response({ error: '旧前缀不存在' }, false, 404)
          : response({ ok: true, ...RECEIPT })
      }
      if (url.endsWith('/state')) {
        const base = url.slice(0, -'/state'.length)
        return response({ routeBase: base, serverVersion: base.endsWith('/r2') ? '0.9.273' : '0.0.0' })
      }
      return response(UPDATE)
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  client.resetStateCalls()
  assert.equal(await control(walk(hostModal(opened).props.footer), '确认安装').props.onClick(), false)
  assert.equal(postsOf(calls).length, 1, '404 不能经 discoverBase 自动重放更新 POST')
  assert.equal(calls.filter(([url]) => url.endsWith('/state')).length, 0, '更新 POST 404 不应触发 discoverBase')
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0)
  const resultCall = one(client.stateCalls().filter((call) => call.index === hooks.result), '404 缺结果未知回执')
  assert.deepEqual({ ...resultCall.next }, UNKNOWN_RECEIPT)
  const errorText = '安装更新' + UNKNOWN_HINT + '：旧前缀不存在'
  assert.ok(client.stateCalls().some((call) => call.index === 2 && call.next?.text === errorText))
  assert.ok(client.stateCalls().some((call) => call.index === 7 && call.next?.text === errorText && call.next?.tone === 'error'))
})

test('GET 的 fetch rejection 与 404 仍 discoverBase 后重试，更新 POST 特例不改变只读回归', async () => {
  for (const failure of ['reject', '404']) {
    const calls = []
    const client = loadClient({
      primitives: HOST,
      fetch: async (url, init) => {
        calls.push([url, init])
        if (url.endsWith('/update?refresh=1')) {
          const attempts = calls.filter(([seen]) => seen.endsWith('/update?refresh=1')).length
          if (attempts === 1) {
            if (failure === 'reject') throw new Error('GET 首次断网')
            return response({ error: '旧前缀不存在' }, false, 404)
          }
          return response(UPDATE)
        }
        if (url.endsWith('/state')) {
          const base = url.slice(0, -'/state'.length)
          return response({ routeBase: base, serverVersion: base.endsWith('/r2') ? '0.9.273' : '0.0.0' })
        }
        return response({})
      },
    })
    const nodes = nodesOf(client, updateQueue())
    assert.equal(await control(nodes, '重新检查').props.onClick(), true, failure + '：GET 应重试成功')
    const updateCalls = calls.filter(([url]) => url.endsWith('/update?refresh=1'))
    assert.equal(updateCalls.length, 2, failure + '：GET 必须原样重试一次')
    assert.equal(updateCalls[0][0], '/session-superagent/update?refresh=1')
    assert.equal(updateCalls[1][0], '/session-superagent/r2/update?refresh=1', failure + '：重试必须使用发现的新前缀；实际 ' + updateCalls.map(([url]) => url).join(', '))
    assert.equal(calls.filter(([url]) => url.endsWith('/state')).length, 8, failure + '：必须执行完整 discoverBase（默认前缀 + r2…r8）')
    assert.equal(postsOf(calls).length, 0)
    const updateCall = client.stateCalls().filter((call) => call.index === 12).at(-1)
    assert.deepEqual({ ...updateCall.next }, UPDATE)
  }
})

test('deferred POST 失败保留版本/命令与错误，busy 结束后取消和 onClose 恢复可关闭', async () => {
  const calls = []
  let release
  const client = loadClient({
    primitives: HOST,
    fetch: (url, init) => {
      calls.push([url, init])
      if (init?.method === 'POST') {
        return new Promise((resolve) => { release = () => resolve(response({ error: '磁盘只读' }, false, 500)) })
      }
      return Promise.resolve(response(UPDATE))
    },
  })
  const base = updateQueue()
  const hooks = hookIndexes(base)
  const opened = nodesOf(client, [...base, null, true, false])
  client.resetStateCalls()
  const pending = control(walk(hostModal(opened).props.footer), '确认安装').props.onClick()
  assert.equal(postsOf(calls).length, 1)
  assert.equal(client.stateCalls().some((call) => call.index === hooks.open && call.next === false), false,
    'deferred 失败完成前不能关闭')
  release()
  assert.equal(await pending, false)
  assert.equal(postsOf(calls).length, 1)
  assert.equal(calls.filter(([url]) => url.endsWith('/update?refresh=1')).length, 0, '失败不能伪装成功后刷新')
  assert.equal(client.stateCalls().filter((call) => call.index === 12).length, 0, '失败不能覆盖当前 update')
  assert.equal(client.stateCalls().filter((call) => call.index === hooks.result).length, 0, '失败不能写安装回执')
  assert.ok(!client.stateCalls().some((call) => call.index === hooks.open && call.next === false), '失败保持确认层')
  assert.ok(client.stateCalls().some((call) => call.index === hooks.busy && call.next === false), '失败后必须解除 busy')

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
  const visibleModal = hostModal(visible)
  assert.equal(visibleModal.props.open, true)
  assert.equal(one(visible.filter((node) => node.type === HOST.Toast), '缺可见宿主 Toast').props.text, errorText)
  assert.ok(!text.includes('已运行新版'))

  client.resetStateCalls()
  const cancel = control(walk(visibleModal.props.footer), '取消')
  assert.equal(cancel.props.disabled, false, '失败后取消必须恢复可用')
  assert.equal(cancel.props.onClick(), true)
  assert.equal(visibleModal.props.onClose(), true)
  assert.equal(client.stateCalls().filter((call) => call.index === hooks.open && call.next === false).length, 2,
    '失败后取消与 onClose 都必须能关闭')
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
