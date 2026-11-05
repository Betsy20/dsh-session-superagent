import test from 'node:test'
import assert from 'node:assert/strict'

import { createOrbitPopover } from '../ui-orbit-popover.js'

const ELEMENT = Symbol.for('react.element')
const PORTAL = Symbol.for('react.portal')

function sameDeps(left, right) {
  return Boolean(left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index])))
}

function fakeDocument() {
  const registrations = []
  const removals = []
  const document = {
    addEventListener(...args) { registrations.push(args) },
    removeEventListener(...args) { removals.push(args) },
  }
  document.body = { nodeName: 'BODY', ownerDocument: document }
  return { document, body: document.body, registrations, removals }
}

function harness({ position = { left: 32, top: 48 }, skipCreate = false } = {}) {
  const slots = []
  const anchorCalls = []
  const dismissCalls = []
  let cursor = 0
  let hookLog = []
  let effects = []

  function slot(kind, create) {
    const index = cursor
    cursor += 1
    if (!slots[index]) slots[index] = { kind, value: create() }
    assert.equal(slots[index].kind, kind, `hook #${index} 的顺序/类型必须稳定`)
    hookLog.push(kind)
    return slots[index]
  }

  function recordEffect(kind, create, deps) {
    const current = slot(kind, () => ({}))
    effects.push({ create, deps, hookIndex: cursor - 1, slot: current })
  }

  const React = {
    createElement(type, props, ...children) {
      const { key, ref, ...rest } = props || {}
      if (children.length === 1) rest.children = children[0]
      else if (children.length > 1) rest.children = children
      const node = { $$typeof: ELEMENT, type, props: rest, ref: ref ?? null }
      if (key !== undefined) node.key = key
      return node
    },
    createPortal(children, containerInfo) {
      return { $$typeof: PORTAL, children, containerInfo, implementation: null, key: null }
    },
    useRef(initial) {
      return slot('ref', () => ({ current: initial })).value
    },
    useCallback(callback, deps) {
      const current = slot('callback', () => ({ callback, deps }))
      if (!sameDeps(current.value.deps, deps)) current.value = { callback, deps }
      return current.value.callback
    },
    useEffect(create, deps) { recordEffect('effect', create, deps) },
    useLayoutEffect(create, deps) { recordEffect('layout-effect', create, deps) },
  }

  function HostMenuSurface() {}
  function HostTooltip() {}
  const primitives = {
    MenuSurface: HostMenuSurface,
    Tooltip: HostTooltip,
    useAnchoredPosition(options) {
      anchorCalls.push(options)
      hookLog.push('primitive-anchor')
      React.useLayoutEffect(() => undefined, [options.open])
      return options.open && position !== null ? position : null
    },
    useDismissOnOutsidePointer(...args) {
      dismissCalls.push(args)
      hookLog.push('primitive-dismiss')
      React.useEffect(() => undefined, args)
    },
  }

  function render(callback) {
    cursor = 0
    hookLog = []
    effects = []
    const value = callback()
    return { value, hookLog: [...hookLog], effects: [...effects] }
  }

  const result = {
    React,
    primitives,
    anchorCalls,
    dismissCalls,
    render,
    slots,
  }
  if (!skipCreate) result.ui = createOrbitPopover({ React, primitives })
  return result
}

function focusable(name) {
  const calls = []
  return {
    name,
    isConnected: true,
    calls,
    focus(...args) { calls.push(args) },
  }
}

function surfaceOf(portal) {
  assert.equal(portal.$$typeof, PORTAL)
  return portal.children
}

function flatten(node, output = []) {
  if (node === null || node === undefined || typeof node !== 'object') return output
  output.push(node)
  const children = node.$$typeof === PORTAL ? node.children : node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) flatten(child, output)
  return output
}

test('缺宿主 portal、hook 或 DSH 原语时显式报不可用，不创建第三套弹层', () => {
  const { React, primitives } = harness({ skipCreate: true })
  const { createPortal, ...reactWithoutPortal } = React
  assert.throws(
    () => createOrbitPopover({ React: reactWithoutPortal, primitives }),
    /React\.createPortal.*react-dom/,
  )
  for (const hook of ['useRef', 'useCallback', 'useEffect']) {
    assert.throws(
      () => createOrbitPopover({ React: { ...React, [hook]: undefined }, primitives }),
      new RegExp(`React\\.${hook}`),
    )
  }
  for (const name of ['useAnchoredPosition', 'useDismissOnOutsidePointer', 'MenuSurface']) {
    assert.throws(
      () => createOrbitPopover({ React, primitives: { ...primitives, [name]: undefined } }),
      new RegExp(`DSH primitives\\.${name} 不可用`),
    )
  }
  assert.ok(createPortal, '假宿主 portal 本身应存在')
})

test('定位固定 top/end/8/8，主 MenuSurface portal 到指定 target，并写 fixed left/top/width/zIndex', () => {
  const fakeDom = fakeDocument()
  const { ui, primitives, anchorCalls } = harness()
  const anchorRef = { current: focusable('orbit') }
  const child = { $$typeof: ELEMENT, type: 'rows', props: {}, ref: null }
  const portal = ui.OrbitPopover({
    open: true,
    anchorRef,
    orbitRef: anchorRef,
    onClose() {},
    width: 368,
    zIndex: 1234,
    portalTarget: fakeDom.body,
    className: 'dt-card sa-dock-panel',
    ariaLabel: '主理鱼',
    style: { padding: 12, position: 'absolute', left: 999, top: 999, width: 1, zIndex: 1 },
    children: child,
  })
  const surface = surfaceOf(portal)
  assert.strictEqual(portal.containerInfo, fakeDom.body)
  assert.strictEqual(surface.type, primitives.MenuSurface)
  assert.equal(surface.props.role, 'dialog')
  assert.equal(surface.props['aria-label'], '主理鱼')
  assert.equal(surface.props['aria-modal'], undefined)
  assert.equal(surface.props.tabIndex, -1)
  assert.equal(surface.props.className, 'dt-card sa-dock-panel')
  assert.deepEqual(surface.props.style, {
    padding: 12,
    position: 'fixed',
    left: 32,
    top: 48,
    width: 368,
    zIndex: 1234,
    visibility: 'visible',
  })
  assert.strictEqual(surface.props.children, child)
  assert.equal(anchorCalls.length, 1)
  assert.deepEqual(anchorCalls[0], {
    open: true,
    anchorRef,
    panelRef: surface.ref,
    side: 'top',
    align: 'end',
    gap: 8,
    margin: 8,
  })
  assert.equal('center' in anchorCalls[0], false)
  assert.equal('flip' in anchorCalls[0], false)
})

test('open false/true/false 的 hook 顺序完全一致，关闭时不渲染但仍调用两个宿主 hooks', () => {
  const fakeDom = fakeDocument()
  const { ui, render, anchorCalls, dismissCalls } = harness()
  const anchorRef = { current: focusable('orbit') }
  const base = {
    anchorRef,
    onClose() {},
    width: 252,
    portalTarget: fakeDom.body,
  }
  const closed = render(() => ui.OrbitPopover({ ...base, open: false }))
  const opened = render(() => ui.OrbitPopover({ ...base, open: true }))
  const closedAgain = render(() => ui.OrbitPopover({ ...base, open: false }))
  assert.equal(closed.value, null)
  assert.equal(closedAgain.value, null)
  assert.deepEqual(closed.hookLog, opened.hookLog)
  assert.deepEqual(closed.hookLog, closedAgain.hookLog)
  assert.deepEqual(anchorCalls.map((call) => call.open), [false, true, false])
  assert.deepEqual(dismissCalls.map((call) => call[1]), [false, true, false])
  assert.equal(closed.effects.length, opened.effects.length)
  assert.equal(closed.effects.at(-1).create(), undefined, '关闭时本地 effect 不注册交互')
  assert.equal(fakeDom.registrations.length, 0)
})

test('stable close 跨 onClose 重渲染保持 identity，外点 close(false) 映射 reason 并使用最新回调', () => {
  const fakeDom = fakeDocument()
  const { ui, render, dismissCalls } = harness()
  const anchorRef = { current: focusable('orbit') }
  const first = []
  const second = []
  const props = {
    open: true,
    anchorRef,
    width: 368,
    portalTarget: fakeDom.body,
    onClose: (detail) => first.push(detail),
  }
  render(() => ui.OrbitPopover(props))
  const stableClose = dismissCalls[0][2]
  render(() => ui.OrbitPopover({ ...props, onClose: (detail) => second.push(detail) }))
  assert.strictEqual(dismissCalls[1][2], stableClose)
  assert.strictEqual(dismissCalls[1][0], dismissCalls[0][0], 'panelRef 必须稳定')
  assert.strictEqual(dismissCalls[1][3], anchorRef)
  assert.equal(dismissCalls[1][1], true)
  stableClose(false)
  assert.deepEqual(first, [])
  assert.deepEqual(second, [{ reason: 'outside-pointer' }])
})

test('本地 effect 初始聚焦 surface，Escape prevent/stop 并关闭，cleanup 对称解绑且焦点回圆环', () => {
  const fakeDom = fakeDocument()
  const { ui, render } = harness()
  const ring = focusable('orbit-ring')
  const panel = focusable('dialog')
  const anchorRef = { current: ring }
  const closed = []
  const rendered = render(() => ui.OrbitPopover({
    open: true,
    anchorRef,
    orbitRef: anchorRef,
    onClose: (detail) => closed.push(detail),
    width: 368,
    portalTarget: fakeDom.body,
  }))
  const surface = surfaceOf(rendered.value)
  surface.ref.current = panel
  const cleanup = rendered.effects.at(-1).create()
  assert.equal(panel.calls.length, 1, 'effect mount 后应初始聚焦 dialog')
  assert.equal(fakeDom.registrations.length, 1)
  const [eventName, listener, capture] = fakeDom.registrations[0]
  assert.equal(eventName, 'keydown')
  assert.equal(capture, true)

  listener({ key: 'Escape', repeat: true })
  assert.deepEqual(closed, [], 'repeat Escape 不重复请求关闭')
  let prevented = 0
  let stopped = 0
  listener({
    key: 'Escape',
    repeat: false,
    preventDefault() { prevented += 1 },
    stopPropagation() { stopped += 1 },
  })
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.deepEqual(closed, [{ reason: 'escape' }])

  cleanup()
  assert.deepEqual(fakeDom.removals, [[eventName, listener, true]])
  assert.equal(ring.calls.length, 1, '关闭清理必须回焦圆环')
  assert.equal(panel.calls.length, 1, 'cleanup 不得回焦旧 surface')
})

test('首帧 position=null 只隐藏 surface，不自行 flip、center 或发明备用坐标', () => {
  const fakeDom = fakeDocument()
  const { ui, anchorCalls } = harness({ position: null })
  const anchorRef = { current: focusable('orbit') }
  const portal = ui.OrbitPopover({
    open: true,
    anchorRef,
    onClose() {},
    width: 252,
    portalTarget: fakeDom.body,
  })
  const style = surfaceOf(portal).props.style
  assert.equal(style.left, 0)
  assert.equal(style.top, 0)
  assert.equal(style.visibility, 'hidden')
  assert.equal(style.width, 252)
  assert.equal(anchorCalls[0].side, 'top')
  assert.equal(anchorCalls[0].align, 'end')
  assert.deepEqual(Object.keys(anchorCalls[0]).sort(), ['align', 'anchorRef', 'gap', 'margin', 'open', 'panelRef', 'side'].sort())
})

test('默认 portal target 是 document.body；适配树没有 Tooltip、Modal 背板或第二个 portal', () => {
  const fakeDom = fakeDocument()
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: fakeDom.document })
    const { ui, primitives } = harness()
    const anchorRef = { current: focusable('orbit') }
    const portal = ui.OrbitPopover({
      open: true,
      anchorRef,
      onClose() {},
      width: 368,
      children: { $$typeof: ELEMENT, type: 'div', props: { className: 'sa-dock-rows' }, ref: null },
    })
    assert.strictEqual(portal.containerInfo, fakeDom.body)
    const nodes = flatten(portal)
    assert.equal(nodes.filter((node) => node.$$typeof === PORTAL).length, 1)
    assert.equal(nodes.some((node) => node.type === primitives.Tooltip), false)
    assert.equal(nodes.some((node) => String(node.props?.className || '').includes('dt-modal-mask')), false)
    assert.equal(nodes.some((node) => node.props?.role === 'presentation'), false)
    assert.equal(surfaceOf(portal).props.zIndex, undefined)
    assert.equal(surfaceOf(portal).props.style.zIndex, 1100)
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  }
})

test('业务 width 必须来自调用方；无 portal target 时不退化为普通 surface', () => {
  const fakeDom = fakeDocument()
  const { ui } = harness()
  const anchorRef = { current: focusable('orbit') }
  for (const width of [undefined, 0, -1, Number.NaN, '368']) {
    assert.throws(
      () => ui.OrbitPopover({ open: true, anchorRef, onClose() {}, width, portalTarget: fakeDom.body }),
      /正数 width.*不推导业务宽度/,
    )
  }
  assert.throws(
    () => ui.OrbitPopover({ open: true, anchorRef, onClose() {}, width: 368, portalTarget: null }),
    /portal target 不可用/,
  )
})

test('删除确认默认先 onCloseOrbit({reason:confirm})，记录 orbit，并在确认关闭后只回焦圆环', () => {
  const { ui, render } = harness()
  const ring = focusable('orbit-ring')
  const deletedButton = focusable('deleted-button')
  const orbitRef = { current: ring }
  const closes = []
  const props = { orbitRef, onCloseOrbit: (detail) => closes.push(detail) }
  const first = render(() => ui.useOrbitConfirm(props))
  const requestConfirm = first.value.onRequestConfirm
  const onConfirmClose = first.value.onConfirmClose
  assert.equal(first.value.restoreFocus, null)

  requestConfirm({ watcherId: 'a/b#s1', opener: deletedButton })
  assert.deepEqual(closes, [{ reason: 'confirm' }])
  const during = render(() => ui.useOrbitConfirm(props))
  assert.equal(during.value.restoreFocus, 'orbit')
  assert.strictEqual(during.value.onRequestConfirm, requestConfirm)
  assert.strictEqual(during.value.onConfirmClose, onConfirmClose)

  assert.equal(during.value.onConfirmClose(), true)
  assert.equal(ring.calls.length, 1)
  assert.equal(deletedButton.calls.length, 0, '不得回焦已卸载的删除按钮/opener')
  const after = render(() => ui.useOrbitConfirm(props))
  assert.equal(after.value.restoreFocus, null)
  assert.equal(after.value.onConfirmClose(), false)
  assert.equal(ring.calls.length, 1)
})

test('自定义 onRequestConfirm 收到 restoreFocus=orbit，orbit 仍先关闭；轮询重渲染使用最新回调且 identity 稳定', () => {
  const { ui, render } = harness()
  const ring = focusable('orbit-ring')
  const orbitRef = { current: ring }
  const calls = []
  const oldProps = {
    orbitRef,
    onCloseOrbit: () => calls.push('old-close'),
    onRequestConfirm: () => calls.push('old-request'),
  }
  const initial = render(() => ui.useOrbitConfirm(oldProps))
  const latestProps = {
    orbitRef,
    onCloseOrbit: (detail) => calls.push(['close', detail]),
    onRequestConfirm: (detail) => { calls.push(['request', detail]); return 'opened' },
  }
  const latest = render(() => ui.useOrbitConfirm(latestProps))
  assert.strictEqual(latest.value.onRequestConfirm, initial.value.onRequestConfirm)
  assert.strictEqual(latest.value.onConfirmClose, initial.value.onConfirmClose)
  assert.equal(latest.value.onRequestConfirm({ watcherId: 'x/y#s2' }), 'opened')
  assert.deepEqual(calls, [
    ['close', { reason: 'confirm' }],
    ['request', { watcherId: 'x/y#s2', reason: 'confirm', restoreFocus: 'orbit' }],
  ])
  latest.value.onConfirmClose()
  assert.equal(ring.calls.length, 1)
})
