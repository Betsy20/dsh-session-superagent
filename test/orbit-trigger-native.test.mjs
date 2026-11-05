import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
const FRAGMENT = Symbol('react.fragment')

function response(body) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }
}

function row() {
  return {
    id: 'a/b#s1', repo: 'a/b', sessionId: 'session-abcdefgh', title: '集成会话',
    intervalSec: 30, enabled: true, lastError: null,
  }
}

function loadOrbit({ host = false } = {}) {
  let mod = null
  const registrations = []
  const document = {
    hidden: false,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  document.body = { nodeName: 'BODY', ownerDocument: document }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { mod = value } },
      innerWidth: 1440,
      innerHeight: 900,
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      removeEventListener() {},
    },
    document,
    fetch: async () => response({ watchers: [] }),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    queueMicrotask: (fn) => fn(),
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.ok(mod, 'client.js 必须注册 UMD 模块')

  const hooks = []
  let cursor = 0
  function slot(kind, create) {
    const index = cursor
    cursor += 1
    if (!hooks[index]) hooks[index] = { kind, ...create() }
    assert.equal(hooks[index].kind, kind, `hook #${index} 类型必须稳定`)
    return { index, value: hooks[index] }
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
      return { type: 'dsh-portal', props: { children: [children] }, containerInfo, ref: null }
    },
    useState(initial) {
      const { value } = slot('state', () => ({ value: typeof initial === 'function' ? initial() : initial }))
      if (!value.setter) {
        value.setter = (next) => {
          value.value = typeof next === 'function' ? next(value.value) : next
        }
      }
      return [value.value, value.setter]
    },
    useRef(initial) {
      return slot('ref', () => ({ value: { current: initial } })).value.value
    },
    useCallback(callback) {
      slot('callback', () => ({}))
      return callback
    },
    useEffect() {
      slot('effect', () => ({}))
    },
  }

  const primitives = host ? {
    MenuSurface: 'dsh-menu-surface',
    useAnchoredPosition: ({ open }) => (open ? { left: 32, top: 48 } : null),
    useDismissOnOutsidePointer() {},
  } : undefined
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
      if (!host) throw new Error('MODULE_NOT_FOUND: ' + name)
      return primitives
    }
    if (name === 'react-dom') {
      if (!host) throw new Error('MODULE_NOT_FOUND: ' + name)
      return { createPortal: React.createPortal }
    }
    throw new Error('unexpected require: ' + name)
  }).apply(ctx)

  const orbit = registrations.find((item) => item.opts.id === 'session-superagent-orbit')
  assert.ok(orbit, '缺 StatusOrbit 注册')
  return {
    orbit,
    render() {
      cursor = 0
      return orbit.Component({})
    },
    setState(index, value) {
      if (!hooks[index]) hooks[index] = { kind: 'state', value }
      assert.equal(hooks[index].kind, 'state')
      hooks[index].value = value
    },
    state(index) {
      return hooks[index]?.value
    },
  }
}

function one(items, message) {
  assert.equal(items.length, 1, `${message}；实际 ${items.length}`)
  return items[0]
}

function triggerOf(tree) {
  const matches = []
  function visit(node) {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== 'object') return
    if (node.type === 'button' && String(node.props?.className || '').split(/\s+/).includes('sa-orbit-trigger')) {
      matches.push(node)
    }
    visit(node.props?.children)
  }
  visit(tree)
  return one(matches, '缺唯一 StatusOrbit 触发按钮')
}

function classes(node) {
  return String(node.props?.className || '').split(/\s+/).filter(Boolean)
}

function markOf(trigger) {
  return one(trigger.props.children.filter((child) => child?.type?.name === 'OrbitMark'), '触发按钮必须直接保留 OrbitMark')
}

function declarations(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'))
  assert.ok(match, '缺 CSS 规则：' + selector)
  return Object.fromEntries(match[1].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const colon = part.indexOf(':')
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()]
  }))
}

for (const host of [false, true]) {
  const path = host ? 'DSH' : 'fallback'

  test(`${path}：无 inline style，保留最左槽位、官方/derived class、aria/title 与 OrbitMark`, () => {
    const client = loadOrbit({ host })
    assert.equal(client.orbit.opts.slot || client.orbit.opts.name, 'conversation.composer.dock')
    assert.equal(client.orbit.opts.order, -10, '必须仍在 activity/usage 左侧')
    client.setState(0, [row()])
    const trigger = triggerOf(client.render())
    assert.equal(trigger.type, 'button')
    assert.equal(trigger.props.type, 'button')
    assert.equal(Object.hasOwn(trigger.props, 'style'), false, '触发按钮不得再有 style prop')
    assert.deepEqual(classes(trigger), ['dt-btn', 'dt-btn-ghost', 'sa-orbit-trigger'])
    assert.equal(trigger.props['aria-label'], '会话级 superagent：1 运行中（共 1 条）')
    assert.equal(trigger.props['aria-expanded'], 'false')
    assert.equal(trigger.props.title, 'a/b · 集成会话 · abcdefgh · 主理中')
    assert.equal(typeof trigger.props.onClick, 'function')
    assert.ok(trigger.ref, '锚点 ref 必须保留')
    const mark = markOf(trigger)
    assert.strictEqual(mark.props.watchers, client.state(0))
    const svg = mark.type(mark.props)
    assert.equal(svg.type, 'svg')
    assert.equal(svg.props.viewBox, '0 0 16 16')
    assert.equal(svg.props['aria-hidden'], 'true')
  })

  test(`${path}：onClick 真实切换 open，aria-expanded 与 class/token 状态同步`, () => {
    const client = loadOrbit({ host })
    client.setState(0, [row()])
    const closed = triggerOf(client.render())
    const label = closed.props['aria-label']
    const title = closed.props.title
    closed.props.onClick()
    assert.equal(client.state(2), true)
    const opened = triggerOf(client.render())
    assert.equal(opened.props['aria-expanded'], 'true')
    assert.equal(opened.props['aria-label'], label)
    assert.equal(opened.props.title, title)
    assert.equal(Object.hasOwn(opened.props, 'style'), false)
    assert.deepEqual(classes(opened), ['dt-btn', 'dt-btn-ghost', 'sa-orbit-trigger'])
    markOf(opened)
    opened.props.onClick()
    assert.equal(client.state(2), false)
    assert.equal(triggerOf(client.render()).props['aria-expanded'], 'false')
  })

  test(`${path}：初始读取弱化走 is-loading class，加载后清除且不禁止点击`, () => {
    const client = loadOrbit({ host })
    const loading = triggerOf(client.render())
    assert.ok(classes(loading).includes('is-loading'))
    assert.equal(loading.props.disabled, undefined, '保持原有初始读取也可打开的行为')
    assert.equal(loading.props['aria-label'], '还没有主理鱼')
    assert.equal(loading.props.title, '还没有主理鱼 —— 在「主理鱼」页加一条')
    assert.equal(Object.hasOwn(loading.props, 'style'), false)
    loading.props.onClick()
    assert.equal(client.state(2), true)
    client.setState(0, [])
    const loaded = triggerOf(client.render())
    assert.equal(classes(loaded).includes('is-loading'), false)
    assert.equal(loaded.props['aria-expanded'], 'true')
    assert.equal(loaded.props['aria-label'], '还没有主理鱼')
    markOf(loaded)
  })
}

test('触发器 CSS 保留原几何，背景只用官方 token，加载透明度对齐官方 disabled', () => {
  const portedMatch = SOURCE.match(/const PORTED_CSS = "([\s\S]*?)";/)
  assert.ok(portedMatch, '缺 PORTED_CSS')
  const ported = JSON.parse('"' + portedMatch[1] + '"')
  const dock = SOURCE.match(/const DOCK_CSS = `([\s\S]*?)`/)[1]
  const base = declarations(dock, ".dt-btn.sa-orbit-trigger")
  assert.deepEqual(base, {
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    height: '20px',
    'min-width': '20px',
    padding: '0 2px',
    margin: '0 2px',
    border: '0',
    'border-radius': '6px',
    background: 'transparent',
    cursor: 'pointer',
    color: 'inherit',
    font: 'inherit',
    opacity: '1',
  })
  const hover = declarations(dock, '.dt-btn.sa-orbit-trigger:hover')
  assert.equal(hover.background, 'var(--dsw-alias-interactive-bg-hover)')
  const active = declarations(dock, ".dt-btn.sa-orbit-trigger:active, .dt-btn.sa-orbit-trigger[aria-expanded='true']")
  assert.equal(active.background, 'var(--dsw-alias-interactive-bg-active)')
  assert.equal(declarations(dock, '.dt-btn.sa-orbit-trigger.is-loading').opacity, '0.4')
  assert.equal(declarations(ported, '.dt-btn:disabled').opacity, '0.4', '加载弱化必须有官方 disabled 档位依据')
  assert.match(declarations(ported, '.dt-btn:focus-visible').outline, /var\(--dsw-alias-brand-primary\)/)
  for (const token of ['--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-active', '--dsw-alias-brand-primary']) {
    assert.ok(ported.includes(token), '官方 CSS 未登记 token：' + token)
  }
  const triggerCss = dock.slice(0, dock.indexOf('/* 弹层：'))
  assert.doesNotMatch(triggerCss, /rgba?\(|#[0-9a-fA-F]{3,8}\b/, '触发器不得写死 rgba/hex 背景或颜色')
})
