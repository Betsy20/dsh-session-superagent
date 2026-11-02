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

// hook 槽顺序必须与 client.js 里 ZhuliPanel 的 useState 顺序完全一致：
// snap, tab, notice, form, token, goalDraft, goalTouched, [], editing, draft, search,
// glossary, update, checking, settingsSection
const blankForm = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
const deskHooks = ({ tab = 'overview', notice = null, glossary = false, update = null, settingsSection = 'source' } = {}) => [
  snapshot, tab, notice, blankForm, '', '', false, [], null, {}, '', glossary, update, false, settingsSection, null,
]

const scenarios = [
  { name: '总览', hooks: deskHooks({}) },
  { name: '判定', hooks: deskHooks({ tab: 'judge' }) },
  { name: '触发', hooks: deskHooks({ tab: 'trigger' }) },
  { name: '设置（来源）', hooks: deskHooks({ tab: 'settings' }) },
  { name: '设置（版本与更新）', hooks: deskHooks({ tab: 'settings', settingsSection: 'update', update: { current: '0.8.45', latest: '0.9.0', hasUpdate: true, command: 'dsh plugin add dsh-session-superagent@0.9.0' } }) },
  { name: '有新版本横幅', hooks: deskHooks({ update: { current: '0.8.45', latest: '0.9.0', hasUpdate: true } }) },
  { name: 'Toast（保存成功）', hooks: deskHooks({ notice: { id: 't1', text: '已保存：MYCF711/dsh-session-superagent', tone: 'info' } }) },
  { name: 'Toast（错误）', hooks: deskHooks({ notice: { id: 't2', text: '保存失败：gh: Not Found (HTTP 404)', tone: 'error' } }) },
  { name: '术语表', hooks: deskHooks({ glossary: true }) },
]

const sections = scenarios.map((scenario) => {
  hookQueue = scenario.hooks
  hookIndex = 0
  const tree = Desk({ sessionId: 'preview-session' })
  return '<h2 class="preview-title">' + scenario.name + '</h2>\n<div class="preview-frame">' + render(tree) + '</div>'
}).join('\n')

// 兜底 token：**必须用真名**（旧版这里写的是 --dsw-alias-border-default / success-500 / accent-primary，
// 宿主机上根本没有这些名字，所以预览一直是"没上色"的假象）。浅色/深色两套，供离线看布局用。
const LIGHT = `--dsw-alias-label-primary:#1f2328;-webkit-...`
const lightTokens = `
  --dsw-alias-label-primary:#1f2328; --dsw-alias-label-primary-foreground:#ffffff;
  --dsw-alias-label-secondary:#59636e; --dsw-alias-label-tertiary:#6e7781;
  --dsw-alias-label-caption:#818b98; --dsw-alias-label-dimmed:#a8b1bb;
  --dsw-alias-bg-base:#ffffff; --dsw-alias-bg-layer-1:#ffffff; --dsw-alias-bg-layer-2:#f6f8fa;
  --dsw-alias-bg-layer-3:#eef1f4; --dsw-alias-bg-module-platform:#f6f8fa; --dsw-alias-bg-mask-1:rgba(31,35,40,.35);
  --dsw-alias-border-l2:#e6eaef; --dsw-alias-border-l3:#d8dee4; --dsw-alias-border-l4:#c6cdd5;
  --dsw-alias-brand-primary:#0969da; --dsw-alias-link:#0969da;
  --dsw-alias-state-success-primary:#1a7f37; --dsw-alias-state-warn-primary:#9a6700;
  --dsw-alias-state-error-primary:#cf222e; --dsw-alias-state-business-primary:#0969da;
  --dsw-alias-state-idle-primary:#8c959f;
  --dsw-alias-button-primary-fill:#1f883d; --dsw-alias-button-primary-hover:#1a7f37;
  --dsw-alias-button-ghost-active-fill:#eef1f4; --dsw-alias-button-ghost-active-border:#d8dee4;
  --dsw-alias-interactive-bg-hover:#f3f4f6; --dsw-alias-interactive-bg-active:#eceff2;
  --dsw-alias-toast-bg:#24292f; --dsw-alias-tooltip-bg:#24292f;
  --dsw-elevation-soft:0 1px 3px rgba(31,35,40,.08); --dsw-elevation-prominent:0 8px 24px rgba(31,35,40,.14);
  --dsw-shadow-lv3:0 8px 24px rgba(31,35,40,.14); --dsw-static-neutral-bluish-00:#ffffff;
`
const darkTokens = `
  --dsw-alias-label-primary:#e6edf3; --dsw-alias-label-primary-foreground:#0d1117;
  --dsw-alias-label-secondary:#a9b4bf; --dsw-alias-label-tertiary:#8b949e;
  --dsw-alias-label-caption:#7d8590; --dsw-alias-label-dimmed:#6e7681;
  --dsw-alias-bg-base:#0d1117; --dsw-alias-bg-layer-1:#141a21; --dsw-alias-bg-layer-2:#161b22;
  --dsw-alias-bg-layer-3:#1c232c; --dsw-alias-bg-module-platform:#161b22; --dsw-alias-bg-mask-1:rgba(1,4,9,.6);
  --dsw-alias-border-l2:#21262d; --dsw-alias-border-l3:#30363d; --dsw-alias-border-l4:#3d444d;
  --dsw-alias-brand-primary:#4493f8; --dsw-alias-link:#4493f8;
  --dsw-alias-state-success-primary:#3fb950; --dsw-alias-state-warn-primary:#d29922;
  --dsw-alias-state-error-primary:#f85149; --dsw-alias-state-business-primary:#4493f8;
  --dsw-alias-state-idle-primary:#6e7681;
  --dsw-alias-button-primary-fill:#238636; --dsw-alias-button-primary-hover:#2ea043;
  --dsw-alias-button-ghost-active-fill:#21262d; --dsw-alias-button-ghost-active-border:#30363d;
  --dsw-alias-interactive-bg-hover:#1c2128; --dsw-alias-interactive-bg-active:#22272e;
  --dsw-alias-toast-bg:#30363d; --dsw-alias-tooltip-bg:#30363d;
  --dsw-elevation-soft:0 1px 3px rgba(1,4,9,.4); --dsw-elevation-prominent:0 8px 24px rgba(1,4,9,.6);
  --dsw-shadow-lv3:0 8px 24px rgba(1,4,9,.6); --dsw-static-neutral-bluish-00:#ffffff;
`

// 两套主题各出一份：左边浅色、右边深色，方便一眼看出「只在某个主题下才错」的地方。
const sectionsForTheme = scenarios.map((scenario) => {
  hookQueue = scenario.hooks
  hookIndex = 0
  const tree = Desk({ sessionId: 'preview-session' })
  return '<h2 class="preview-title">' + scenario.name + '</h2>' + '<div class="preview-frame">' + render(tree) + '</div>'
}).join('')

const themeBlock = (label, tokens) => '<section>'
  + '<h1 class="theme-name">' + label + '</h1>'
  + '<div class="themed" style="' + tokens.split(String.fromCharCode(10)).join(' ') + '">'
  + sectionsForTheme
  + '</div></section>'

const html = '<!doctype html><meta charset="utf-8"><title>主理鱼面板预览（浅色 / 深色）</title>'
  + '<style>'
  + 'body{font:14px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;background:#eef1f4;margin:0;padding:24px;color:#1f2328}'
  + '.theme-name{font-size:18px;margin:28px 0 4px}'
  + '.preview-title{margin:20px 0 8px;font-size:15px;opacity:.7;color:inherit}'
  + '.preview-frame{width:900px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l3);'
  + 'border-radius:12px;min-height:120px;max-height:820px;overflow:auto;color:var(--dsw-alias-label-primary)}'
  + '.dt-page{height:auto!important;max-height:none!important}'
  + PORTED_CSS
  + '</style>'
  + '<div style="font:13px/1.5 system-ui;opacity:.75">主理鱼面板静态预览 —— 真实 client.js 渲染的 DOM + 移植的官方 CSS。'
  + '兜底色值只是近似（真机以宿主注入的 --dsw-alias-* 为准），这里用来发现「某个主题下颜色写死或漏 token」。</div>'
  + themeBlock('浅色主题', lightTokens)
  + themeBlock('深色主题', darkTokens)

writeFileSync(OUT, html)
console.log('已写出：' + OUT)
console.log('字节：' + html.length)
