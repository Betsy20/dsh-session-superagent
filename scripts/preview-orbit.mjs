// 用【真实的 client.js】渲染出 SVG，再拼成 standalone 预览页 —— 预览与线上同一份代码
import { readFileSync, writeFileSync } from 'node:fs'
import vm from 'node:vm'

const SRC = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let mod = null
const sandbox = {
  window: {
    __ModuleLoader__: { load(m) { mod = m } },
    innerWidth: 1440, innerHeight: 900,
    addEventListener() {}, removeEventListener() {},
  },
  document: {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild() {} },
    addEventListener() {}, removeEventListener() {},
  },
  fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }),
  setInterval: () => 0, clearInterval: () => {},
  console,
}
vm.createContext(sandbox)
vm.runInContext(SRC, sandbox)

let queue = [], index = 0
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) } }
  },
  memo: (fn) => fn,
  useState(init) {
    const v = index < queue.length ? queue[index] : (typeof init === 'function' ? init() : init)
    index += 1
    return [v, () => {}]
  },
  useEffect() {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
}
const regs = []
mod.factory((n) => { if (n === 'react') return React; throw new Error(n) }).apply({
  effect: (fn) => fn(),
  slots: { inject: (_n, fn) => fn(), register: (o, C) => { regs.push({ o, C }); return () => {} } },
})
const orbit = regs.find((r) => r.o.id === 'session-superagent-orbit')

const render = (watchers) => { queue = [watchers]; index = 0; return orbit.C({}) }

function renderNode(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') return renderNode(node.type(node.props || {}))
  const attrs = []
  for (const [k, v] of Object.entries(node.props || {})) {
    if (k === 'children' || v === null || v === undefined || v === false) continue
    if (k === 'key' || k === 'ref') continue
    if (k === 'style') {
      const css = Object.entries(v).map(([sk, sv]) => sk.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) + ':' + sv).join(';')
      attrs.push(`style="${css}"`)
      continue
    }
    const KEEP = new Set(['viewBox', 'attributeName', 'attributeType', 'repeatCount', 'repeatDur', 'preserveAspectRatio', 'gradientUnits', 'patternUnits', 'spreadMethod', 'startOffset', 'markerWidth', 'markerHeight', 'refX', 'refY', 'baseFrequency', 'numOctaves', 'stdDeviation', 'textLength', 'lengthAdjust'])
    const name = KEEP.has(k) ? k : k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    attrs.push(`${name}="${String(v).replace(/"/g, '&quot;')}"`)
  }
  const kids = (node.props?.children || []).map(renderNode).join('')
  return `<${node.type}${attrs.length ? ' ' + attrs.join(' ') : ''}>${kids}</${node.type}>`
}

const svgOf = (watchers) => {
  const tree = render(watchers)
  if (!tree) return ''
  // 找到 svg 节点（button 的唯一子元素）
  const find = (n) => {
    if (!n || typeof n !== 'object') return null
    if (typeof n.type === 'function') return find(n.type(n.props || {}))
    if (n.type === 'svg') return n
    for (const c of n.props?.children || []) { const hit = find(c); if (hit) return hit }
    return null
  }
  return renderNode(find(tree))
}

const w = (repo, extra = {}) => ({ repo, sessionId: 'session-' + repo, intervalSec: 30, enabled: true, lastPoll: null, lastWake: null, lastError: null, title: repo, ...extra })
const cases = [
  ['0 个 · 空态（灰环占位，无卫星）', []],
  ['1 个 · 值守中', [w('MYCF711/dsh-GOkifu-compact')]],
  ['3 个 · 全部值守中', [w('a/b'), w('c/d'), w('e/f')]],
  ['3 个 · 混合（绿=值守中 / 琥珀=已暂停 / 红=轮询失败）', [w('a/b'), w('c/d', { enabled: false }), w('e/f', { lastError: 'boom' })]],
  ['2 个 · 全部已暂停', [w('a/b', { enabled: false }), w('c/d', { enabled: false })]],
  ['6 个 · 上限', [w('a/b'), w('c/d'), w('e/f'), w('g/h'), w('i/j'), w('k/l')]],
]

const rows = cases.map(([label, list]) => {
  const svg = svgOf(list)
  return `<tr><td class="lb">${label}</td>
      <td class="big">${svg}</td>
      <td class="real">${svg}</td></tr>`
}).join('\n')

const OUT = process.argv[2] || 'E:/Documents/deepseek-harness/default-workspace/orbit-preview.html'
writeFileSync(OUT, `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>轨道环预览 · dsh-session-superagent</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; padding:28px 34px; background:#1b1b1f; color:#e6e6e6;
         font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif }
  h1 { font-size:15px; font-weight:600; margin:0 0 4px }
  p.sub { margin:0 0 22px; opacity:.55 }
  table { border-collapse:collapse }
  td { padding:10px 22px 10px 0; vertical-align:middle; border-bottom:1px solid #ffffff14 }
  td.lb { opacity:.8; white-space:nowrap; padding-right:34px }
  td.big svg { width:44px; height:44px }   /* 放大看形状 */
  td.real svg { width:16px; height:16px }  /* 线上就是这个大小 */
  th { text-align:left; font-weight:500; opacity:.45; font-size:12px; padding-bottom:6px }
  .note { margin-top:22px; opacity:.5; font-size:12px }
  code { background:#ffffff12; padding:1px 5px; border-radius:4px }
</style></head>
<body>
  <h1>轨道环 · 真实组件渲染预览</h1>
  <p class="sub">这份 HTML 由 <code>client.js</code> 本身渲染生成（不是另画一份），所以线上长什么样这里就是什么样。</p>
  <table>
    <tr><th>状态</th><th>放大 44px</th><th>实际 16px</th></tr>
    ${rows}
  </table>
  <div class="note">
    值守中 = 卫星沿环公转（6s/圈）＋ 环本身呼吸（2.6s）；已暂停 = 虚线环、不转；轮询失败 = 红点呼吸（1.6s）。<br>
    已验证动画走 SVG 自带的 SMIL，不依赖外部样式表 —— 上一版引用了不存在的 <code>.sa-sat-spin</code> 规则，所以是死的。
  </div>
</body></html>
`, 'utf8')
console.log('wrote', OUT)
console.log('SMIL in preview:', (readFileSync(OUT, 'utf8').match(/animateTransform/g) || []).length, 'animateTransform tags')
