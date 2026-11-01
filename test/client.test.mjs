/**
 * 客户端渲染冒烟测试：不用浏览器，用假 React 跑真实 client.js。
 *
 * 覆盖三件在 0.3.1 之前踩过的事：
 *   1. 组件真的被注册进槽位（不是"代码在、注册没跑"）；
 *   2. 无值守时不占位（dock 行里不留死图标）；
 *   3. 卫星数 = 值守数（上限 6），错误态进详情面板。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 把 client.js 装进一个最小浏览器沙箱，返回它注册的槽位条目。 */
function loadClient() {
  let mod = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load(m) { mod = m } },
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
    fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }),
    setInterval: () => 0,
    clearInterval: () => {},
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox)
  assert.ok(mod, '模块没有调用 __ModuleLoader__.load')

  const hooks = { queue: [], index: 0 }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return {
        type,
        props: { ...(props || {}), children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) },
      }
    },
    memo: (fn) => fn,
    useState(init) {
      const value = hooks.index < hooks.queue.length ? hooks.queue[hooks.index] : (typeof init === 'function' ? init() : init)
      hooks.index += 1
      return [value, () => {}]
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
    throw new Error('unexpected require: ' + name)
  }).apply(ctx)

  const render = (registration, queue) => {
    hooks.queue = queue
    hooks.index = 0
    return registration.Component({})
  }
  return { id: mod.id, registrations, render }
}

/** 展开函数组件，收集整棵树（文本节点记为 #text）。 */
function walk(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ type: '#text', text: String(node) })
    return out
  }
  if (typeof node !== 'object') return out
  if (typeof node.type === 'function') return walk(node.type(node.props || {}), out)
  out.push(node)
  for (const child of node.props?.children || []) walk(child, out)
  return out
}

const watcher = (repo, extra = {}) => ({
  repo,
  sessionId: 'session-' + repo,
  intervalSec: 30,
  enabled: true,
  cursor: null,
  lastPoll: '2026-11-01T13:00:00.000Z',
  lastWake: null,
  lastError: null,
  title: '会话 ' + repo,
  goal: null,
  ...extra,
})

test('client.js 注册值守台与 composer dock 上的轨道环', () => {
  const { id, registrations } = loadClient()
  assert.equal(id, 'dsh-session-superagent')
  const names = registrations.map((r) => r.opts.name + '#' + r.opts.id)
  assert.ok(names.includes('conversation.view#session-superagent-desk'), names.join(','))
  assert.ok(names.includes('conversation.composer.dock#session-superagent-orbit'), names.join(','))
  // 0.3.2 起不再挂会话头部
  assert.ok(!names.some((n) => n.includes('header.actions')), '头部徽章应已移除')
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  assert.equal(orbit.opts.order, 2, 'order 要让轨道环排在 activity/usage 之后')
})

test('没有值守时整个条目返回 null，不占位', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  assert.equal(render(orbit, [[]]), null)
})

test('卫星数跟随值守数，超过 6 个截断', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const circlesOf = (list) => walk(render(orbit, [list])).filter((n) => n.type === 'circle').length
  assert.equal(circlesOf([watcher('a/b')]), 2, '环 + 1 颗卫星')
  assert.equal(circlesOf(['a/b', 'c/d', 'e/f'].map((r) => watcher(r))), 4, '环 + 3 颗卫星')
  assert.equal(circlesOf(['a/b', 'c/d', 'e/f', 'g/h', 'i/j', 'k/l', 'm/n'].map((r) => watcher(r))), 7, '最多 6 颗')
})

test('值守中才转，暂停/异常不转也不丢', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const spinOf = (list) => walk(render(orbit, [list])).find((n) => n.type === 'g')
  assert.equal(spinOf([watcher('a/b', { enabled: false })]).props.className, undefined)
  assert.equal(spinOf([watcher('a/b', { lastError: 'boom' })]).props.className, undefined)
  assert.equal(spinOf([watcher('a/b')]).props.className, 'sa-sat-spin')
})

test('点击展开的面板逐条列出仓库 / 会话 / 间隔 / 轮询 / 状态', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b'), watcher('c/d', { lastError: 'HttpError: 401 bad credentials' })]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const panel = nodes.find((n) => n.props && n.props.role === 'dialog')
  assert.ok(panel, '面板没有渲染')
  assert.equal(panel.props.style.position, 'fixed')
  assert.equal(panel.props.style.width, 344)
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  for (const needle of ['会话级 superagent', '1/2 运行中', 'a/b', 'c/d', '值守中', '异常', '每 30s', '401 bad credentials']) {
    assert.ok(text.includes(needle), '面板缺少「' + needle + '」：' + text.slice(0, 200))
  }
})
