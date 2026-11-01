// 把「主理鱼」面板渲染成静态 HTML，用于在真浏览器里看布局（不需要宿主、不需要 React）。
//
// 为什么：client.js 是给宿主用的模块（`window.__ModuleLoader__.load` + `require('react')`），
// 组件树用 h() 构造。这里提供一个极简的假 React，把组件渲染成虚拟节点树，
// 再序列化成 HTML，并内联移植来的官方 CSS —— 于是可以在浏览器里真实地看布局。
//
// 用法： node scripts/render-preview.mjs [输出文件]
//   node scripts/render-preview.mjs preview-panel.html
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.argv[2] || join(ROOT, 'preview-panel.html')

// ── 假 React：只需要 createElement/useState/useEffect/useCallback/useRef/memo/Fragment ──
let hookQueue = []
let hookIndex = 0
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) } }
  },
  memo: (fn) => fn,
  useState(init) {
    const value = hookIndex < hookQueue.length ? hookQueue[hookIndex] : (typeof init === 'function' ? init() : init)
    hookIndex += 1
    return [value, () => {}]
  },
  useEffect() {},
  useCallback: (fn) => fn,
  useRef: (value) => ({ current: value }),
}

// 假宿主：只收集注册，不真的挂任何东西
const registrations = []
const sandbox = {
  window: {
    __ModuleLoader__: { load: (mod) => registrations.push(mod) },
    innerWidth: 1280, innerHeight: 900,
    addEventListener() {}, removeEventListener() {},
  },
  document: {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
    addEventListener() {}, removeEventListener() {},
  },
  fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }),
  setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  console,
}
vm.createContext(sandbox)
vm.runInContext(readFileSync(join(ROOT, 'client.js'), 'utf8'), sandbox)

const mod = registrations[0]
if (!mod) throw new Error('client.js 没有注册任何模块')
const slots = new Map()
const ctx = {
  slots: {
    inject: (_name, fn) => fn(),
    register: (opts, Component) => { slots.set(opts.id, Component); return () => {} },
  },
  effect: (fn) => fn(),
}
mod.factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}).apply(ctx)

const Desk = slots.get('session-superagent-desk')
if (!Desk) throw new Error('没有注册 session-superagent-desk，已注册：' + [...slots.keys()].join(','))

// ── 样本快照：覆盖各种状态（正常/暂停/异常/仅观察/隔离/退避/过滤记录/历史）──
const now = Date.now()
const iso = (ms) => new Date(now - ms).toISOString()
const snapshot = {
  loading: false, error: null,
  body: {
    sessionTitle: 'README 收尾与发布',
    sessionGoal: null,
    gh: { ok: true, version: 'gh version 2.101.0' },
    credentials: { token: 'configured', sshKeyPath: 'none' },
    watchers: [
      {
        id: 'MYCF711/dsh-session-superagent#s1', repo: 'MYCF711/dsh-session-superagent', sessionId: 's1',
        intervalSec: 60, enabled: true, observe: false, title: 'README 收尾与发布', note: '把 0.8.x 的文档补齐',
        lastPoll: iso(15000), lastWake: iso(300000), lastWakeCount: 3, lastAbsorbed: 1,
        filters: { labels: ['ai-fix'], ignoreLabels: [], skipBots: true, skipDrafts: true, skipClosed: true, onlyAssigned: false, assignee: null },
        activeHours: '09:00-23:00', isolated: true, workdir: 'E:/temp/iso', lastWorktree: 'E:/temp/iso/.dsh-zhuli/a-b',
        history: [
          { at: iso(300000), numbers: [12], ok: true, reason: null },
          { at: iso(600000), numbers: [11], ok: false, reason: 'observe' },
        ],
        filteredLog: [{ number: 7, title: '机器人提的依赖升级', reason: '机器人', at: iso(120000) }],
      },
      {
        id: 'MYCF711/dsh-GOkifu-compact#s2', repo: 'MYCF711/dsh-GOkifu-compact', sessionId: 's2',
        intervalSec: 120, enabled: false, observe: true, title: '联调会话',
        lastPoll: iso(900000), lastDeferred: '仅观察：本轮本会唤醒 2 条（#4 #3）',
        filters: { labels: [], ignoreLabels: [], skipBots: true, skipDrafts: true, skipClosed: true, onlyAssigned: false, assignee: null },
        history: [], filteredLog: [],
      },
      {
        id: 'a/b#s3', repo: 'someone/broken-repo', sessionId: 's3', intervalSec: 30, enabled: true,
        title: '出错示例', lastPoll: iso(5000), lastError: 'gh: Not Found (HTTP 404)（仓库不存在或没权限：检查 owner/name）',
        consecutiveFailures: 2, nextAt: new Date(now + 180000).toISOString(),
        filters: { labels: [], ignoreLabels: [], skipBots: true, skipDrafts: true, skipClosed: true, onlyAssigned: false, assignee: null },
        history: [], filteredLog: [],
      },
    ],
  },
}

// ── 渲染：把元素树序列化成 HTML ───────────────────────────────────────────────
function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}
function styleToCss(style) {
  if (!style) return ''
  return Object.entries(style).map(([k, v]) => {
    const prop = k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    return prop + ':' + v
  }).join(';')
}
function attr(name, value) {
  if (value === undefined || value === null || value === false || value === true) {
    return value === true ? ' ' + name : ''
  }
  return ' ' + name + '="' + escapeHtml(value) + '"'
}
function render(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node !== 'object') return ''
  const { type, props = {} } = node
  if (typeof type === 'function') return render(type(props))
  if (type === React.Fragment) return (props.children || []).map(render).join('')
  const voidTags = new Set(['input', 'img', 'br', 'hr', 'meta', 'link'])
  const tag = String(type)
  const parts = []
  if (props.className) parts.push(attr('class', props.className))
  if (props.style) parts.push(attr('style', styleToCss(props.style)))
  for (const key of ['data-tone', 'data-state', 'data-open', 'role', 'title', 'aria-label', 'aria-selected', 'aria-pressed', 'aria-modal', 'type', 'placeholder', 'value', 'disabled']) {
    if (props[key] !== undefined && props[key] !== false) parts.push(attr(key, props[key]))
  }
  if (keyIsVoid(tag)) return '<' + tag + parts.join('') + '>'
  return '<' + tag + parts.join('') + '>' + (props.children || []).map(render).join('') + '</' + tag + '>'
}
function keyIsVoid(tag) {
  return ['input', 'img', 'br', 'hr', 'meta', 'link'].includes(tag)
}

// 取移植来的 CSS
const clientSrc = readFileSync(join(ROOT, 'client.js'), 'utf8')
const marker = 'const PORTED_CSS = "'
const head = clientSrc.indexOf(marker) + marker.length
let i = head
while (i < clientSrc.length && clientSrc[i] !== '"') i += clientSrc[i] === '\\' ? 2 : 1
const PORTED_CSS = JSON.parse('"' + clientSrc.slice(head, i) + '"')

const scenarios = [
  { name: '总览', hooks: [snapshot, 'overview', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, null, null, {}, '', false] },
  { name: '判定', hooks: [snapshot, 'judge', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, null, null, {}, '', false] },
  { name: '触发', hooks: [snapshot, 'trigger', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, null, null, {}, '', false] },
  { name: '设置', hooks: [snapshot, 'settings', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, null, null, {}, '', false] },
  { name: 'Toast（保存成功）', hooks: [snapshot, 'overview', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, { id: 't1', text: '已保存：MYCF711/dsh-session-superagent', tone: 'info' }, null, {}, '', false] },
  { name: 'Toast（错误）', hooks: [snapshot, 'overview', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, { id: 't2', text: '保存失败：gh: Not Found (HTTP 404)', tone: 'error' }, null, {}, '', false] },
  { name: '术语表', hooks: [snapshot, 'overview', null, { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }, '', '', false, null, null, {}, '', true] },
]

const sections = scenarios.map((scenario) => {
  hookQueue = scenario.hooks
  hookIndex = 0
  const tree = Desk({ sessionId: 'preview-session' })
  return '<h2 class="preview-title">' + scenario.name + '</h2>\n<div class="preview-frame">' + render(tree) + '</div>'
}).join('\n')

// 极简 token 兜底：宿主里这些由 --dsw-alias-* 提供，预览里给一组浅色近似值
const tokens = `:root{
  --dsw-alias-label-primary:#1f2328; --dsw-alias-label-secondary:#59636e; --dsw-alias-label-tertiary:#818b98;
  --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-layer-2:#f6f8fa; --dsw-alias-bg-layer-3:#eef1f4;
  --dsw-alias-border-default:#d8dee4; --dsw-alias-border-muted:#e6eaef;
  --dsw-alias-accent-primary:#0969da; --dsw-alias-success-500:#1a7f37; --dsw-alias-warning-500:#9a6700;
  --dsw-alias-error-500:#cf222e; --dsw-static-neutral-bluish-00:#ffffff;
  --dsw-shadow-lv3:0 8px 24px rgba(31,35,40,.12);
  /* tag / 状态点真正引用的 token（官方 CSS 用 --dsw-alias-state-*） */
  --dsw-alias-state-success-primary:#1a7f37; --dsw-alias-state-warn-primary:#9a6700;
  --dsw-alias-state-error-primary:#cf222e; --dsw-alias-state-info-primary:#0969da;
  --dsw-alias-toast-bg:#24292f;
}`

const html = `<!doctype html>
<meta charset="utf-8">
<title>主理鱼面板预览</title>
<style>
${tokens}
body{font:14px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;background:#eef1f4;margin:0;padding:24px;color:#1f2328}
.preview-title{margin:28px 0 8px;font-size:15px;color:#57606a}
.preview-frame{width:900px;background:#fff;border:1px solid #d8dee4;border-radius:12px;min-height:120px;max-height:820px;overflow:auto}
.dt-page{height:auto!important;max-height:none!important}
${PORTED_CSS}
</style>
<div style="font:13px/1.5 system-ui;color:#57606a">
  主理鱼面板静态预览 —— 真实 client.js 渲染出的 DOM + 移植的官方 CSS（宽度 900px，token 为浅色近似值）
</div>
${sections}
`
writeFileSync(OUT, html)
console.log('已写出：' + OUT)
console.log('字节：' + html.length)
