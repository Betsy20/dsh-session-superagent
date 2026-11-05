import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const MENU_SURFACE = 'dsh-menu-surface'
const PORTAL = Symbol('react.portal')
const FRAGMENT = Symbol('react.fragment')

function response(body, ok = true, status = 200) {
  return { ok, status, headers: { get: () => null }, text: async () => JSON.stringify(body) }
}

function watcher(repo = 'a/b', extra = {}) {
  return {
    id: repo + '#s1', repo, sessionId: 'session-s1', title: '集成会话', intervalSec: 30,
    enabled: true, lastError: null, goal: null, ...extra,
  }
}

function sameDeps(left, right) {
  return Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
}

function eventTarget() {
  const listeners = []
  const registrations = []
  const removals = []
  return {
    listeners,
    registrations,
    removals,
    addEventListener(type, callback, capture) {
      registrations.push([type, callback, capture])
      listeners.push({ type, callback, capture })
    },
    removeEventListener(type, callback, capture) {
      removals.push([type, callback, capture])
      const index = listeners.findIndex((item) => item.type === type && item.callback === callback && item.capture === capture)
      if (index >= 0) listeners.splice(index, 1)
    },
    dispatch(type, event) {
      for (const item of [...listeners]) if (item.type === type) item.callback(event)
    },
  }
}

function focusable(name) {
  const calls = []
  return {
    name,
    isConnected: true,
    calls,
    focus() { calls.push([]) },
    contains() { return false },
    getBoundingClientRect() { return { left: 704, top: 860, width: 32, height: 20 } },
  }
}

function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function one(items, message) {
  assert.equal(items.length, 1, message + '；实际 ' + items.length)
  return items[0]
}

function button(nodes, label) {
  return one(nodes.filter((node) => node.type === 'button' && textOf(node) === label), '找不到唯一按钮「' + label + '」')
}

function hasClass(node, name) {
  return String(node.props?.className || '').split(/\s+/).includes(name)
}

function localModals(nodes) {
  return nodes.filter((node) => node.type === 'div' && hasClass(node, 'dt-modal'))
}

function loadClient(options = {}) {
  let mod = null
  const slots = []
  const stateCalls = []
  const anchorCalls = []
  const dismissCalls = []
  const portals = []
  const timers = []
  const fetchCalls = []
  const document = Object.assign(eventTarget(), {
    hidden: false,
    activeElement: null,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
  })
  document.body = { nodeName: 'BODY', ownerDocument: document }
  const window = Object.assign(eventTarget(), {
    __ModuleLoader__: { load(value) { mod = value } },
    innerWidth: 1440,
    innerHeight: 900,
    matchMedia: () => ({ matches: false }),
  })
  const sandbox = {
    window,
    document,
    fetch: options.fetch || (async (...args) => {
      fetchCalls.push(args)
      return response({ watchers: [] })
    }),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout(fn, ms) {
      const timer = { id: timers.length + 1, fn, ms }
      timers.push(timer)
      return timer.id
    },
    clearTimeout(id) {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    queueMicrotask: (fn) => fn(),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.ok(mod, 'client.js 必须注册 UMD 模块')

  let cursor = 0
  let hookLog = []
  let pendingEffects = []
  const activeEffects = new Map()
  function slot(kind, create) {
    const index = cursor
    cursor += 1
    if (!slots[index]) slots[index] = { kind, ...create() }
    assert.equal(slots[index].kind, kind, `hook #${index} 的类型必须稳定`)
    hookLog.push(kind)
    return { index, value: slots[index] }
  }

  const React = {
    Fragment: FRAGMENT,
    createElement(type, props, ...children) {
      const { key, ref, ...rest } = props || {}
      const node = {
        type,
        props: { ...rest, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) },
        ref: ref ?? null,
      }
      if (key !== undefined) node.key = key
      return node
    },
    isValidElement: (value) => Boolean(value && typeof value === 'object' && 'type' in value),
    createPortal(children, containerInfo) {
      const portal = { type: PORTAL, props: { children: [children] }, children, containerInfo, ref: null }
      portals.push(portal)
      return portal
    },
    useState(initial) {
      const { index, value } = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial }))
      const setter = (next) => {
        const resolved = typeof next === 'function' ? next(value.value) : next
        value.value = resolved
        stateCalls.push({ index, next: resolved })
      }
      return [value.value, setter]
    },
    useRef(initial) {
      return slot('ref', () => ({ value: { current: initial } })).value.value
    },
    useCallback(callback, deps) {
      const { value } = slot('callback', () => ({ callback, deps }))
      if (!sameDeps(value.deps, deps)) {
        value.callback = callback
        value.deps = deps
      }
      return value.callback
    },
    useEffect(create, deps) {
      const { index } = slot('effect', () => ({}))
      pendingEffects.push({ index, create, deps })
    },
  }

  function useAnchoredPosition(anchorOptions) {
    anchorCalls.push(anchorOptions)
    React.useEffect(() => {
      if (!anchorOptions.open) return undefined
      const onResize = () => {}
      const onScroll = () => {}
      window.addEventListener('resize', onResize)
      window.addEventListener('scroll', onScroll, true)
      return () => {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('scroll', onScroll, true)
      }
    }, [anchorOptions.open])
    if (!anchorOptions.open) return null
    return Object.hasOwn(options, 'position') ? options.position : { left: 32, top: 48 }
  }

  function useDismissOnOutsidePointer(panelRef, active, close, anchorRef) {
    dismissCalls.push([panelRef, active, close, anchorRef])
    React.useEffect(() => {
      if (!active) return undefined
      const onPointer = () => close(false)
      document.addEventListener('pointerdown', onPointer)
      return () => document.removeEventListener('pointerdown', onPointer)
    }, [active, close, panelRef, anchorRef])
  }

  const defaultPrimitives = {
    MenuSurface: MENU_SURFACE,
    useAnchoredPosition,
    useDismissOnOutsidePointer,
  }
  const primitives = Object.hasOwn(options, 'primitives') ? options.primitives : defaultPrimitives
  const reactDom = Object.hasOwn(options, 'reactDom') ? options.reactDom : { createPortal: React.createPortal }
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
      if (primitives === undefined) throw new Error('MODULE_NOT_FOUND: ' + name)
      return primitives
    }
    if (name === 'react-dom') {
      if (reactDom === undefined) throw new Error('MODULE_NOT_FOUND: ' + name)
      return reactDom
    }
    throw new Error('unexpected require: ' + name)
  }).apply(ctx)

  function expand(node, out = []) {
    if (node === null || node === undefined || typeof node === 'boolean') return out
    if (typeof node === 'string' || typeof node === 'number') {
      out.push({ type: '#text', text: String(node) })
      return out
    }
    if (Array.isArray(node)) {
      for (const child of node) expand(child, out)
      return out
    }
    if (typeof node !== 'object') return out
    if (typeof node.type === 'function') return expand(node.type(node.props || {}), out)
    out.push(node)
    expand(node.props?.children, out)
    return out
  }

  const orbit = registrations.find((item) => item.opts.id === 'session-superagent-orbit')
  function render() {
    cursor = 0
    hookLog = []
    pendingEffects = []
    const tree = orbit.Component({})
    return { tree, nodes: expand(tree), hookLog: [...hookLog], effects: [...pendingEffects] }
  }

  function commitEffects() {
    const next = new Map()
    for (const effect of pendingEffects) {
      const previous = activeEffects.get(effect.index)
      if (previous && sameDeps(previous.deps, effect.deps)) {
        next.set(effect.index, previous)
        continue
      }
      if (previous && typeof previous.cleanup === 'function') previous.cleanup()
      const cleanup = effect.create()
      next.set(effect.index, { ...effect, cleanup })
    }
    for (const [index, previous] of activeEffects) {
      if (!next.has(index) && typeof previous.cleanup === 'function') previous.cleanup()
    }
    activeEffects.clear()
    for (const [index, effect] of next) activeEffects.set(index, effect)
  }

  const stateIndexes = { watchers: 0, orbitError: 1, open: 2, anchor: 3 }
  function setState(index, value) {
    if (!slots[index]) slots[index] = { kind: 'state', value }
    assert.equal(slots[index].kind, 'state')
    slots[index].value = value
  }
  function renderOrbit(state = {}) {
    for (const [key, value] of Object.entries(state)) {
      if (key in stateIndexes) setState(stateIndexes[key], value)
    }
    return render()
  }

  return {
    document,
    window,
    timers,
    anchorCalls,
    dismissCalls,
    portals,
    stateCalls,
    slots,
    renderOrbit,
    commitEffects,
    setState,
    setPosition(value) { options.position = value },
    resetStateCalls: () => { stateCalls.length = 0 },
    fetchCalls,
  }
}

function attach(node, name) {
  const dom = focusable(name)
  assert.ok(node.ref, name + ' 必须有 ref')
  node.ref.current = dom
  return dom
}

function ringOf(nodes) {
  return one(nodes.filter((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined), '缺圆环按钮')
}

test('可选探测缺任一能力都完整保留旧 StatusOrbit 定位、极大 z-index 与本地确认', () => {
  const full = {
    MenuSurface: MENU_SURFACE,
    useAnchoredPosition() {},
    useDismissOnOutsidePointer() {},
  }
  const cases = [
    { primitives: undefined },
    { primitives: full, reactDom: undefined },
    { primitives: full, reactDom: {} },
    { primitives: { ...full, MenuSurface: undefined } },
    { primitives: { ...full, useAnchoredPosition: undefined } },
    { primitives: { ...full, useDismissOnOutsidePointer: undefined } },
  ]
  for (const options of cases) {
    const client = loadClient(options)
    const { nodes } = client.renderOrbit({ watchers: [watcher()], open: true, anchor: { x: 720, y: 860 } })
    const panel = one(nodes.filter((node) => node.props?.role === 'dialog'), 'fallback 缺旧 dialog')
    assert.equal(panel.type, 'div')
    assert.equal(panel.props.style.left, 536)
    assert.equal(panel.props.style.bottom, 48)
    assert.equal(panel.props.style.width, 368)
    assert.equal(panel.props.style.zIndex, 2147483000)
    assert.equal(nodes.some((node) => node.type === PORTAL), false)
    assert.equal(client.anchorCalls.length, 0)
    assert.equal(button(nodes, '删除').type, 'button')
  }
})

test('DSH 主 surface portal 到 body，top/end/8/8，保留 rows/错误/动作且不传 center/flip/背板/旧 z-index', () => {
  const client = loadClient()
  const row = watcher('a/b', { lastError: 'poll failed' })
  const { nodes } = client.renderOrbit({ watchers: [row], orbitError: '写操作失败', open: true })
  const portal = one(nodes.filter((node) => node.type === PORTAL), 'DSH 缺唯一 portal')
  const surface = one(nodes.filter((node) => node.type === MENU_SURFACE), 'DSH 缺 MenuSurface')
  assert.strictEqual(portal.containerInfo, client.document.body)
  assert.strictEqual(portal.children, surface)
  assert.equal(surface.props.role, 'dialog')
  assert.equal(surface.props.tabIndex, -1)
  assert.equal(surface.props['aria-modal'], undefined)
  assert.equal(surface.props.className, 'dt-card sa-dock-panel')
  assert.deepEqual({ ...surface.props.style }, {
    position: 'fixed', left: 32, top: 48, width: 368, zIndex: 1100, visibility: 'visible',
  })
  assert.equal(surface.props.style.bottom, undefined)
  assert.notEqual(surface.props.style.zIndex, 2147483000)
  const anchored = one(client.anchorCalls, '缺定位调用')
  assert.deepEqual({ ...anchored }, {
    open: true,
    anchorRef: ringOf(nodes).ref,
    panelRef: surface.ref,
    side: 'top',
    align: 'end',
    gap: 8,
    margin: 8,
  })
  assert.equal('center' in anchored, false)
  assert.equal('flip' in anchored, false)
  const text = nodes.filter((node) => node.type === '#text').map((node) => node.text).join(' ')
  for (const expected of ['a/b', '集成会话', '每 30s', 'poll failed', '操作失败：写操作失败', '详细状态与凭证']) {
    assert.ok(text.includes(expected), 'DSH 弹层缺少：' + expected)
  }
  for (const label of ['立刻', '暂停', '删除']) assert.ok(button(nodes, label))
  assert.ok(nodes.some((node) => node.type === 'svg' && node.props.viewBox === '0 0 16 16'), '缺 OrbitMark')
  assert.equal(nodes.some((node) => hasClass(node, 'dt-modal-mask')), false, 'orbit 不得增加背板')
})

test('DSH 空态业务宽度 252、常规 368，关闭时仍调用定位与外点 hooks', () => {
  const client = loadClient()
  const empty = client.renderOrbit({ watchers: [], open: true })
  assert.equal(one(empty.nodes.filter((node) => node.type === MENU_SURFACE), '空态缺 surface').props.style.width, 252)
  const closed = client.renderOrbit({ open: false })
  assert.equal(closed.nodes.some((node) => node.type === PORTAL), false)
  assert.deepEqual(client.anchorCalls.map((call) => call.open), [true, false])
  assert.deepEqual(client.dismissCalls.map((call) => call[1]), [true, false])
  assert.deepEqual(closed.hookLog, empty.hookLog, 'open/close 不得改变 hook 顺序')

  client.setState(0, [watcher()])
  client.setState(2, true)
  const normal = client.renderOrbit()
  assert.equal(one(normal.nodes.filter((node) => node.type === MENU_SURFACE), '常规缺 surface').props.style.width, 368)
  assert.deepEqual(normal.hookLog, empty.hookLog)
})

test('DSH position null→visible 才聚焦一次，后续 position 更新不重复抢焦点', () => {
  const client = loadClient({ position: null })
  const hidden = client.renderOrbit({ watchers: [], open: true })
  const ring = attach(ringOf(hidden.nodes), 'orbit-ring')
  const panel = attach(one(hidden.nodes.filter((node) => node.type === MENU_SURFACE), '缺隐藏 surface'), 'dialog')
  assert.equal(one(hidden.nodes.filter((node) => node.type === MENU_SURFACE), '缺隐藏 surface').props.style.visibility, 'hidden')
  client.commitEffects()
  assert.equal(panel.calls.length, 0, '隐藏首帧不得聚焦')

  client.setPosition({ left: 32, top: 48 })
  const visible = client.renderOrbit()
  assert.equal(one(visible.nodes.filter((node) => node.type === MENU_SURFACE), '缺可见 surface').props.style.visibility, 'visible')
  client.commitEffects()
  assert.equal(panel.calls.length, 1, '定位可见后必须补做初始聚焦')

  client.setPosition({ left: 96, top: 112 })
  client.renderOrbit()
  client.commitEffects()
  assert.equal(panel.calls.length, 1, '后续定位更新不得重复聚焦')
  assert.equal(ring.calls.length, 0, '定位更新清理不得抢回圆环')
})

test('DSH 外点关闭对称清理监听且不回焦圆环，外部按钮保留焦点', () => {
  const client = loadClient()
  const opened = client.renderOrbit({ watchers: [watcher()], open: true })
  const ring = attach(ringOf(opened.nodes), 'orbit-ring')
  const panel = attach(one(opened.nodes.filter((node) => node.type === MENU_SURFACE), '缺 surface'), 'dialog')
  client.commitEffects()
  assert.equal(panel.calls.length, 1, '打开后初始焦点必须在 dialog')
  for (const type of ['resize', 'scroll', 'pointerdown', 'keydown']) {
    const target = type === 'resize' || type === 'scroll' ? client.window : client.document
    assert.equal(target.listeners.some((item) => item.type === type), true, '打开时缺监听 ' + type)
  }
  assert.equal(client.document.registrations.some(([type, , capture]) => type === 'mousedown' && capture === true), false)

  const outside = focusable('outside-button')
  client.dismissCalls.at(-1)[2](false)
  outside.focus()
  assert.equal(client.stateCalls.at(-1).next, false)
  const closed = client.renderOrbit()
  assert.deepEqual(closed.hookLog, opened.hookLog)
  client.commitEffects()
  for (const type of ['resize', 'scroll', 'pointerdown', 'keydown']) {
    const target = type === 'resize' || type === 'scroll' ? client.window : client.document
    assert.equal(target.listeners.some((item) => item.type === type), false, '关闭后仍残留 ' + type)
    assert.equal(target.removals.some(([name]) => name === type), true, '缺移除记录 ' + type)
  }
  assert.equal(outside.calls.length, 1)
  assert.equal(ring.calls.length, 0, '外点关闭清理不得从外部按钮抢回圆环')
})

test('DSH Escape prevent/stop 后关闭，初始焦点到 dialog，清理归还圆环', () => {
  const client = loadClient()
  const opened = client.renderOrbit({ watchers: [], open: true })
  const ring = attach(ringOf(opened.nodes), 'orbit-ring')
  const panel = attach(one(opened.nodes.filter((node) => node.type === MENU_SURFACE), '缺 surface'), 'dialog')
  client.commitEffects()
  assert.equal(panel.calls.length, 1)
  let prevented = 0
  let stopped = 0
  client.document.dispatch('keydown', {
    key: 'Escape', repeat: false,
    preventDefault() { prevented += 1 },
    stopPropagation() { stopped += 1 },
  })
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.equal(client.stateCalls.at(-1).next, false)
  const closed = client.renderOrbit()
  assert.deepEqual(closed.hookLog, opened.hookLog)
  client.commitEffects()
  assert.equal(ring.calls.length, 1)
  assert.equal(client.document.listeners.some((item) => item.type === 'keydown'), false)
})

test('DSH 删除先关 orbit 再开 Modal；confirm 清理不抢 Modal 焦点，取消才显式回圆环', () => {
  const client = loadClient()
  const row = watcher()
  const opened = client.renderOrbit({ watchers: [row], open: true })
  const ring = attach(ringOf(opened.nodes), 'orbit-ring')
  attach(one(opened.nodes.filter((node) => node.type === MENU_SURFACE), '缺 surface'), 'dialog')
  client.commitEffects()
  const deletedButton = focusable('unmounted-delete-button')
  client.document.activeElement = deletedButton
  client.resetStateCalls()

  button(opened.nodes, '删除').props.onClick()
  assert.deepEqual(client.stateCalls.slice(0, 2).map((call) => call.index), [2, 3])
  assert.equal(client.stateCalls[0].next, false, '必须先关闭 orbit')
  assert.strictEqual(client.stateCalls[1].next, row, '再选中待删 watcher 以打开确认')

  const confirming = client.renderOrbit()
  const modalCancel = focusable('modal-cancel')
  modalCancel.focus()
  client.document.activeElement = modalCancel
  // 对齐真实 Chromium 证据：Modal 初始焦点已经到来，Orbit cleanup 随后才执行。
  client.commitEffects()
  assert.equal(modalCancel.calls.length, 1)
  assert.equal(ring.calls.length, 0, 'Orbit confirm 清理不得覆盖 Modal 初始焦点')
  assert.equal(confirming.nodes.some((node) => node.type === PORTAL || node.type === MENU_SURFACE), false, '确认期间 orbit 不得盖住 Modal')
  const modal = one(localModals(confirming.nodes), '缺 modalContext=orbit 的本地确认 Modal')
  assert.equal(modal.props['aria-modal'], 'true')
  assert.ok(confirming.nodes.some((node) => hasClass(node, 'dt-modal-mask')))
  button(confirming.nodes, '取消').props.onClick()
  assert.equal(ring.calls.at(-1).length, 0)
  assert.equal(deletedButton.calls.length, 0, '不得回焦已卸载的删除按钮')

  const cancelled = client.renderOrbit()
  client.commitEffects()
  assert.equal(localModals(cancelled.nodes).length, 0)
  assert.equal(ring.calls.length, 1, '取消只能由 onConfirmClose 显式回焦圆环一次')
})

test('DSH 删除完成只发一次 delete，确认关闭后焦点仍回圆环而非已卸载按钮', async () => {
  const calls = []
  const client = loadClient({
    fetch: async (...args) => {
      calls.push(args)
      return response({ watchers: [] })
    },
  })
  const row = watcher()
  const opened = client.renderOrbit({ watchers: [row], open: true })
  const ring = attach(ringOf(opened.nodes), 'orbit-ring')
  attach(one(opened.nodes.filter((node) => node.type === MENU_SURFACE), '缺 surface'), 'dialog')
  client.commitEffects()
  const deletedButton = focusable('unmounted-delete-button')
  client.document.activeElement = deletedButton
  button(opened.nodes, '删除').props.onClick()
  const confirming = client.renderOrbit()
  const modalCancel = focusable('modal-cancel')
  modalCancel.focus()
  client.document.activeElement = modalCancel
  client.commitEffects()
  assert.equal(localModals(confirming.nodes).length, 1)
  assert.equal(ring.calls.length, 0, 'confirm 清理不得抢 Modal 初始焦点')

  assert.equal(await button(confirming.nodes, '确认删除').props.onClick(), true)
  const writes = calls.filter(([, init]) => init?.method === 'POST')
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0][1].body), { action: 'delete', id: 'a/b#s1' })
  assert.equal(deletedButton.calls.length, 0)
  assert.equal(ring.calls.length, 1, '完成后只能由 onConfirmClose 显式回焦圆环一次')
  const done = client.renderOrbit()
  client.commitEffects()
  assert.equal(localModals(done.nodes).length, 0)
  assert.equal(done.nodes.some((node) => node.type === PORTAL), false)
})

test('DSH 窄视口 width=368 缩到视口减 16，不产生左溢出', () => {
  const client = loadClient()
  client.window.innerWidth = 320
  const opened = client.renderOrbit({ watchers: [watcher()], open: true })
  const surface = one(opened.nodes.filter((node) => node.type === MENU_SURFACE), '缺窄屏 surface')
  assert.equal(surface.props.style.width, 304)
})
