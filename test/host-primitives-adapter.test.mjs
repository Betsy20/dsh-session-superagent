import test from 'node:test'
import assert from 'node:assert/strict'

import { createHostUi, dismissToast } from '../ui-host-primitives.js'

const ELEMENT = Symbol.for('react.element')

function harness(overrides = {}) {
  const stateUpdates = []
  const effects = []
  const React = {
    createElement(type, props, ...children) {
      const { key, ref, ...rest } = props || {}
      const node = {
        $$typeof: ELEMENT,
        type,
        props: { ...rest, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) },
      }
      if (key !== undefined) node.key = key
      if (ref !== undefined) node.ref = ref
      return node
    },
    cloneElement(element, config, ...children) {
      const { key = element.key, ref = element.ref, ...rest } = config || {}
      const props = { ...element.props, ...rest }
      if (children.length > 0) {
        props.children = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false)
      }
      const node = { $$typeof: ELEMENT, type: element.type, props }
      if (key !== undefined) node.key = key
      if (ref !== undefined) node.ref = ref
      return node
    },
    isValidElement(value) {
      return Boolean(value && value.$$typeof === ELEMENT)
    },
    useState(initial) {
      return [initial, (next) => stateUpdates.push(next)]
    },
    useRef(initial) {
      return { current: initial }
    },
    useCallback(callback) {
      return callback
    },
    useEffect(create, deps) {
      effects.push({ create, deps })
    },
  }
  const primitives = {
    Modal: function HostModal() {},
    Toast: function HostToast() {},
    Tooltip: function HostTooltip() {},
    IconWarningOutlineMedium: function WarningIcon() {},
    IconQuestionOutlineMedium: function QuestionIcon() {},
    IconInfoOutlineMedium: function InfoIcon() {},
    ...overrides,
  }
  return { React, primitives, stateUpdates, effects, ui: createHostUi({ React, primitives }) }
}

function persistentTooltipHarness() {
  const context = harness()
  const refs = []
  const states = []
  let refCursor = 0
  let stateCursor = 0
  context.React.useState = (initial) => {
    const index = stateCursor++
    if (!states[index]) states[index] = { value: initial }
    return [states[index].value, (next) => {
      context.stateUpdates.push(next)
      states[index].value = typeof next === 'function' ? next(states[index].value) : next
    }]
  }
  context.React.useRef = (initial) => {
    const index = refCursor++
    if (!refs[index]) refs[index] = { current: initial }
    return refs[index]
  }
  context.renderTooltip = (props) => {
    refCursor = 0
    stateCursor = 0
    return context.ui.Tooltip(props)
  }
  return context
}

function fakeFocusable(document) {
  const descendants = new Set()
  return {
    isConnected: true,
    focusCalls: [],
    contains(candidate) {
      return candidate === this || descendants.has(candidate)
    },
    addDescendant(node) {
      descendants.add(node)
    },
    focus(options) {
      this.focusCalls.push(options)
      document.activeElement = this
    },
  }
}

function withFakeDom(run) {
  const registrations = []
  const removals = []
  const fakeWindow = {
    addEventListener(...args) { registrations.push(args) },
    removeEventListener(...args) { removals.push(args) },
  }
  const fakeDocument = { activeElement: null }
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: fakeWindow })
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: fakeDocument })
    return run({ fakeWindow, fakeDocument, registrations, removals })
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  }
}

test('Modal：open=false 返回 null；打开时只透传到 DSH Modal 并补中文 closeLabel', () => {
  const { React, primitives, ui } = harness()
  const onClose = () => {}
  const footer = React.createElement('button', null, '确定')
  const child = React.createElement('p', null, '正文')
  const props = { open: false, title: '标题', description: '说明', footer, onClose, className: 'dt-wide', children: child }
  assert.equal(ui.Modal(props), null)

  const node = ui.Modal({ ...props, open: true })
  assert.equal(node.type, primitives.Modal)
  assert.equal(node.props.open, true)
  assert.equal(node.props.title, '标题')
  assert.equal(node.props.description, '说明')
  assert.equal(node.props.footer, footer)
  assert.equal(node.props.onClose, onClose)
  assert.equal(node.props.className, 'dt-wide')
  assert.equal(node.props.closeLabel, '关闭')
  assert.deepEqual(node.props.children, [child])
})

test('Toast：key=item.id、holdMs=3000，success 不覆盖宿主内建勾，onDone 只回传 id', () => {
  const { ui } = harness()
  const done = []
  const node = ui.Toast({ item: { id: 'notice-1', text: '已保存', tone: 'success' }, onDone: (...args) => done.push(args) })
  assert.equal(node.key, 'notice-1')
  assert.equal(node.props.key, undefined, '真 React 的 key 不应留在 props 中')
  assert.equal(node.props.text, '已保存')
  assert.equal(node.props.tone, 'success')
  assert.equal(node.props.holdMs, 3000)
  assert.equal(node.props.icon, undefined)
  node.props.onDone('不应透传的事件参数')
  assert.deepEqual(done, [['notice-1']])
})

test('Toast：error 显式使用宿主 warning icon；空 item 不渲染', () => {
  const { primitives, ui } = harness()
  const node = ui.Toast({ item: { id: 7, text: '失败', tone: 'error' }, onDone() {} })
  assert.equal(node.key, 7)
  assert.equal(node.props.icon.type, primitives.IconWarningOutlineMedium)
  assert.equal(ui.Toast({ item: null, onDone() {} }), null)
})

test('Tooltip：label 与定位参数透传，自定义 children 只补合并 ref，原 props 与 ref 不回归', () => {
  const { React, primitives, ui } = harness()
  const originalRef = { current: null }
  const onMouseEnter = () => {}
  const onFocus = () => {}
  const onClick = () => {}
  const trigger = React.createElement('button', {
    ref: originalRef, type: 'button', className: 'custom', onMouseEnter, onFocus, onClick,
  }, '帮助')
  const originalTriggerProps = { ...trigger.props }
  const node = ui.Tooltip({ text: '说明', icon: React.createElement(primitives.IconInfoOutlineMedium), warn: true, children: trigger })
  assert.equal(node.type, primitives.Tooltip)
  assert.equal(node.props.label, '说明')
  assert.equal(node.props.side, 'top')
  assert.equal(node.props.portal, true)
  assert.equal(node.props.openOnClick, true)
  assert.equal(node.props.gap, 8)

  const adapted = node.props.children[0]
  assert.notStrictEqual(adapted, trigger, '适配层需要 cloneElement 注入 ref')
  assert.equal(adapted.type, 'button')
  assert.deepEqual(trigger.props, originalTriggerProps, 'cloneElement 不得修改原 element')
  assert.equal(adapted.props.type, 'button')
  assert.equal(adapted.props.className, 'custom')
  assert.strictEqual(adapted.props.onMouseEnter, onMouseEnter)
  assert.strictEqual(adapted.props.onFocus, onFocus)
  assert.strictEqual(adapted.props.onClick, onClick)
  assert.deepEqual(adapted.props.children, ['帮助'])
  assert.equal(typeof adapted.ref, 'function')
  const domNode = {}
  adapted.ref(domNode)
  assert.strictEqual(originalRef.current, domNode)
  adapted.ref(null)
  assert.strictEqual(originalRef.current, null)
})

test('Tooltip：缺省 trigger 保留 InfoTip 的 button 与 warn 样式，图标来自宿主', () => {
  const { primitives, ui } = harness()
  const node = ui.Tooltip({ text: '风险说明', warn: true })
  const trigger = node.props.children[0]
  assert.equal(trigger.type, 'button')
  assert.equal(trigger.props.type, 'button')
  assert.equal(trigger.props.className, 'dt-info dt-info-warn')
  assert.equal(trigger.props['aria-label'], '风险说明')
  assert.equal(trigger.props.children[0].type, primitives.IconQuestionOutlineMedium)
})

test('Tooltip scroll-close：焦点在 trigger 时 key 递增并重聚焦，ref/cleanup 对称且原 props 不回归', () => {
  const { React, primitives, stateUpdates, effects, renderTooltip } = persistentTooltipHarness()
  const onMouseEnter = () => {}
  const onFocus = () => {}
  const onClick = () => {}
  const originalRef = { current: null }
  const trigger = React.createElement('button', {
    ref: originalRef, type: 'button', className: 'custom', onMouseEnter, onFocus, onClick,
  }, '帮助')
  const originalTriggerProps = { ...trigger.props }
  const originalProps = { text: '说明', warn: true, children: trigger }
  const first = renderTooltip(originalProps)
  const firstTrigger = first.props.children[0]
  assert.equal(first.key, 0)
  assert.equal(first.props.disabled, false, '普通 hover/focus/click 必须保持官方 Tooltip 可用')
  assert.equal(effects.length, 2)
  assert.deepEqual(effects[0].deps, [])
  assert.deepEqual(effects[1].deps, [0])

  withFakeDom(({ fakeDocument, registrations, removals }) => {
    const oldTrigger = fakeFocusable(fakeDocument)
    const newTrigger = fakeFocusable(fakeDocument)
    assert.equal(typeof firstTrigger.ref, 'function')
    firstTrigger.ref(oldTrigger)
    assert.strictEqual(originalRef.current, oldTrigger)

    const cleanup = effects[0].create()
    assert.equal(effects[1].create(), undefined, '首次挂载没有待恢复焦点')
    assert.deepEqual(oldTrigger.focusCalls, [])
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].length, 3)
    const [eventName, listener, capture] = registrations[0]
    assert.equal(eventName, 'scroll')
    assert.equal(typeof listener, 'function')
    assert.equal(capture, true)

    fakeDocument.activeElement = oldTrigger
    const scrollEvent = { type: 'scroll', target: { id: 'nested-scroller' } }
    assert.equal(listener(scrollEvent), undefined)
    assert.equal(typeof stateUpdates[0], 'function')
    assert.equal(stateUpdates[0](4), 5, '必须函数式递增，不能把 scroll event 当作新 key')
    assert.equal(stateUpdates[1], true, '回焦 remount 帧必须暂时禁用官方 focus 打开')

    const remounted = renderTooltip(originalProps)
    const remountedTrigger = remounted.props.children[0]
    assert.equal(first.key, 0)
    assert.equal(remounted.key, 1)
    assert.equal(remounted.props.disabled, true, 'disabled 必须覆盖程序化 focus 的同步分派')
    assert.equal(remounted.type, primitives.Tooltip)
    assert.equal(remounted.props.label, '说明')
    assert.equal(remounted.props.side, 'top')
    assert.equal(remounted.props.portal, true)
    assert.equal(remounted.props.openOnClick, true)
    assert.equal(remounted.props.gap, 8)
    assert.deepEqual(effects[3].deps, [1])
    assert.deepEqual(trigger.props, originalTriggerProps)
    assert.strictEqual(remountedTrigger.props.onMouseEnter, onMouseEnter)
    assert.strictEqual(remountedTrigger.props.onFocus, onFocus)
    assert.strictEqual(remountedTrigger.props.onClick, onClick)
    assert.equal(registrations.length, 1, '假 effect 只执行首轮；deps=[] 已另行记录')

    // 模拟 keyed HostTooltip 的 commit：旧 ref 对称清空，新 ref 先于 passive effect 附着。
    firstTrigger.ref(null)
    assert.strictEqual(originalRef.current, null)
    remountedTrigger.ref(newTrigger)
    assert.strictEqual(originalRef.current, newTrigger)
    assert.equal(effects[3].create(), undefined)
    assert.deepEqual(newTrigger.focusCalls, [{ preventScroll: true }])
    assert.strictEqual(fakeDocument.activeElement, newTrigger)
    assert.equal(stateUpdates.at(-1), false, 'focus 返回后必须立即恢复官方 hover/focus/click')

    const settled = renderTooltip(originalProps)
    assert.equal(settled.key, 1, '恢复 disabled=false 不得再次 remount 或清掉焦点')
    assert.equal(settled.props.disabled, false)
    assert.strictEqual(fakeDocument.activeElement, newTrigger)

    assert.equal(typeof cleanup, 'function')
    cleanup()
    assert.equal(removals.length, 1)
    assert.equal(removals[0].length, 3)
    assert.equal(removals[0][0], 'scroll')
    assert.strictEqual(removals[0][1], listener)
    assert.equal(removals[0][2], true)
    remountedTrigger.ref(null)
    assert.strictEqual(originalRef.current, null)
  })
})

test('Tooltip scroll-close：滚动前焦点在别处时不抢新 trigger 焦点', () => {
  const { React, effects, renderTooltip } = persistentTooltipHarness()
  const trigger = React.createElement('button', { type: 'button' }, '帮助')
  const first = renderTooltip({ text: '说明', children: trigger })
  const firstTrigger = first.props.children[0]

  withFakeDom(({ fakeDocument, registrations }) => {
    const oldTrigger = fakeFocusable(fakeDocument)
    const newTrigger = fakeFocusable(fakeDocument)
    const outside = fakeFocusable(fakeDocument)
    firstTrigger.ref(oldTrigger)
    const cleanup = effects[0].create()
    effects[1].create()
    const listener = registrations[0][1]
    fakeDocument.activeElement = outside
    listener({ type: 'scroll' })

    const remounted = renderTooltip({ text: '说明', children: trigger })
    const remountedTrigger = remounted.props.children[0]
    assert.equal(remounted.key, 1)
    firstTrigger.ref(null)
    remountedTrigger.ref(newTrigger)
    effects[3].create()
    assert.deepEqual(newTrigger.focusCalls, [])
    assert.strictEqual(fakeDocument.activeElement, outside)
    cleanup()
  })
})

test('Tooltip scroll-close：焦点在 trigger 内部时也归还给新 trigger', () => {
  const { React, effects, renderTooltip } = persistentTooltipHarness()
  const trigger = React.createElement('button', { type: 'button' }, React.createElement('span', null, '帮助'))
  const first = renderTooltip({ text: '说明', children: trigger })
  const firstTrigger = first.props.children[0]

  withFakeDom(({ fakeDocument, registrations }) => {
    const oldTrigger = fakeFocusable(fakeDocument)
    const newTrigger = fakeFocusable(fakeDocument)
    const descendant = { id: 'inside-trigger' }
    oldTrigger.addDescendant(descendant)
    firstTrigger.ref(oldTrigger)
    const cleanup = effects[0].create()
    effects[1].create()
    const listener = registrations[0][1]
    fakeDocument.activeElement = descendant
    listener({ type: 'scroll' })

    const remounted = renderTooltip({ text: '说明', children: trigger })
    const remountedTrigger = remounted.props.children[0]
    firstTrigger.ref(null)
    remountedTrigger.ref(newTrigger)
    effects[3].create()
    assert.deepEqual(newTrigger.focusCalls, [{ preventScroll: true }])
    assert.strictEqual(fakeDocument.activeElement, newTrigger)
    cleanup()
  })
})

test('Tooltip：children 拒绝字符串、数组和 null，缺原语时显式报错而不自绘替代 Tooltip', () => {
  const { React, ui } = harness()
  const trigger = React.createElement('button', null, '帮助')
  for (const children of ['文字', [trigger], null]) {
    assert.throws(() => ui.Tooltip({ text: '说明', children }), /单个 React element/)
  }

  const missing = harness({ Tooltip: undefined })
  assert.throws(
    () => missing.ui.Tooltip({ text: '说明', children: trigger }),
    /DSH primitives\.Tooltip 不可用/,
  )
})

test('Tooltip：缺 React.cloneElement 时给出可读错误，不在渲染深处崩溃', () => {
  const { React, ui } = harness()
  delete React.cloneElement
  const trigger = React.createElement('button', null, '帮助')
  assert.throws(() => ui.Tooltip({ text: '说明', children: trigger }), /React\.cloneElement/)
})

test('dismissToast：纯函数只在 id 完全相同时清空，旧回调保留新 item', () => {
  const current = { id: 'new', text: '新通知', tone: 'success' }
  assert.strictEqual(dismissToast(current, 'old'), current)
  assert.strictEqual(dismissToast(current, 'old'), current)
  assert.equal(dismissToast(current, 'new'), null)
  assert.equal(dismissToast(null, 'old'), null)
})

test('createToastState：notify 只替换当前项，dismiss 通过函数式更新执行 id guard，无自有 timer', () => {
  const { ui, stateUpdates } = harness()
  const state = ui.createToastState()
  assert.equal(state.item, null)
  assert.equal(state.notify('第一条', 'info'), 1)
  assert.equal(state.notify('第二条', 'error'), 2)
  assert.deepEqual(stateUpdates[0], { id: 1, text: '第一条', tone: 'info' })
  assert.deepEqual(stateUpdates[1], { id: 2, text: '第二条', tone: 'error' })

  state.dismiss(1)
  assert.equal(typeof stateUpdates[2], 'function')
  const newest = { id: 2, text: '第二条', tone: 'error' }
  assert.strictEqual(stateUpdates[2](newest), newest)
  assert.equal(stateUpdates[2]({ id: 1, text: '第一条', tone: 'info' }), null)
})
