import test from 'node:test'
import assert from 'node:assert/strict'

import { createHostUi, dismissToast } from '../ui-host-primitives.js'

const ELEMENT = Symbol.for('react.element')

function harness(overrides = {}) {
  const stateUpdates = []
  const React = {
    createElement(type, props, ...children) {
      const { key, ...rest } = props || {}
      const node = {
        $$typeof: ELEMENT,
        type,
        props: { ...rest, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) },
      }
      if (key !== undefined) node.key = key
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
  return { React, primitives, stateUpdates, ui: createHostUi({ React, primitives }) }
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

test('Tooltip：label 与定位参数透传，自定义 children 保持同一个 React element', () => {
  const { React, primitives, ui } = harness()
  const trigger = React.createElement('button', { type: 'button', className: 'custom' }, '帮助')
  const node = ui.Tooltip({ text: '说明', icon: React.createElement(primitives.IconInfoOutlineMedium), warn: true, children: trigger })
  assert.equal(node.type, primitives.Tooltip)
  assert.equal(node.props.label, '说明')
  assert.equal(node.props.side, 'top')
  assert.equal(node.props.portal, true)
  assert.equal(node.props.openOnClick, true)
  assert.equal(node.props.gap, 8)
  assert.deepEqual(node.props.children, [trigger])
  assert.equal(node.props.children[0], trigger)
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
