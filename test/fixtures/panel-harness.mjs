// 面板渲染桩：不用浏览器，用假 React 跑真实 client.js。
//
// 为什么抽成模块：测试与「面板文案快照」脚本都要用它 —— 两份实现必然漂移。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const SOURCE = readFileSync(fileURLToPath(new URL('../../client.js', import.meta.url)), 'utf8')

/**
 * 把 client.js 装进一个最小浏览器沙箱，返回它注册的槽位条目。
 *
 * options.fetch：替换沙箱里的 fetch，用来复现「服务端回 304 / 报错」这类分支。
 * 不传时保持老行为（永远 200 + `{}`），已有用例不受影响。
 */
export function loadClient(options = {}) {
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
    fetch: options.fetch || (() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') })),
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

  // props 可以传：面板有些文案取决于宿主给的 sessionId（"添加到当前会话" vs "先打开一个会话"）
  const render = (registration, queue, props = {}) => {
    hooks.queue = queue
    hooks.index = 0
    return registration.Component(props)
  }
  // 改视口宽度：窄屏相关的断言要靠它，别让测试自己去碰沙箱内部
  const setViewport = (width) => { sandbox.window.innerWidth = width }
  return { id: mod.id, registrations, render, setViewport }
}

/** 展开函数组件，收集整棵树（文本节点记为 #text）。 */
export function walk(node, out = []) {
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


/** 主理鱼面板的 useState 队列：snap / tab / notice / form / token / goalDraft / goalTouched / toast / editing / draft */
export const deskForm = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
export const deskQueue = (snapshot, editing = null, draft = {}, tab = 'overview', search = '', glossary = false, update = null) =>
  // 末尾依次是：update / checking（0.8.38 版本检查）、settingsSection / reasonFilter / badgeFilter、
  // 以及 0.9.15 追加的 problemsOnly —— 顺序必须跟组件里的 useState 一致（测试桩按位置取值）
  // 末尾依次是：update / checking、settingsSection / reasonFilter / badgeFilter、problemsOnly，
  // 以及 0.9.157 追加的 stateFilter（统计条筛选）—— 顺序必须跟组件里的 useState 一致
  [snapshot, tab, null, deskForm, '', '', false, [], editing, draft, search, glossary, update, false, 'source', null, null, false, null]

export const watcher = (repo, extra = {}) => ({
  repo,
  sessionId: 'session-' + repo,
  intervalSec: 30,
  enabled: true,
  cursor: null,
  // 2026-11-04 修：定值 '2026-11-01T13:00:00.000Z' 会被 client.js 渲染成「轮询 N 小时前」，
  // 快照于是每过一小时漂一格（和 render-panel-copy.mjs 里 lastWake 是同一个坑）。
  // 固定成「相对生成时刻 68 小时前」，输出恒定。
  lastPoll: new Date(Date.now() - 68 * 3600 * 1000).toISOString(),
  lastWake: null,
  lastError: null,
  title: '会话 ' + repo,
  goal: null,
  ...extra,
})

