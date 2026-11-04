// 临时测量脚本：把真实渲染后的 DOM 里每个文字元素的 color / 逐层 background-color 读出来，
// 按 WCAG 2.x 公式算对比度；同时扫「写死的颜色字面量」。用完删。
//
// 做法：把下面 measurePage 注入到 preview-light-*.html 的副本里，用 Edge --headless=new --dump-dom
// 跑一遍，从 <pre id="__contrast__"> 里取回 JSON。这样量到的是浏览器真实计算值（含 color-mix 解析结果）。
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const ROOT = process.cwd()

function measurePage() {
  const out = { file: document.title, tokens: {}, text: [], surfaces: [], borders: [], literals: [], chromeLiterals: [], sameColor: [] }

  const parse = (str) => {
    if (!str) return null
    const m = String(str).match(/^rgba?\(([^)]+)\)$/i)
    if (!m) return null
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  })
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const ratio = (a, b) => {
    const L1 = lum(a), L2 = lum(b)
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const rgba = (c) => (c.a >= 1 ? hex(c) : 'rgba(' + [c.r, c.g, c.b].map(Math.round).join(',') + ',' + Math.round(c.a * 1000) / 1000 + ')')

  // 逐层向上取背景：遇到不透明层停；最底下按画布白（浏览器默认画布色）
  const effBg = (el) => {
    const layers = []
    let node = el
    while (node && node.nodeType === 1) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      if (c && c.a >= 1) break
      node = node.parentElement
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 }
    for (let i = layers.length - 1; i >= 0; i -= 1) acc = over(layers[i], acc)
    return { color: acc, stack: layers.map(rgba) }
  }
  const effOpacity = (el) => {
    let o = 1
    let node = el
    while (node && node.nodeType === 1) {
      const v = parseFloat(getComputedStyle(node).opacity)
      if (!Number.isNaN(v)) o *= v
      node = node.parentElement
    }
    return Math.round(o * 1000) / 1000
  }

  const frame = document.querySelector('.preview-frame')
  if (!frame) { return { error: 'no .preview-frame' } }
  const themed = frame.closest('.themed')

  // ── 1. 浅色 token 实际值（证明这套是浅色）──
  const names = ['--dsw-alias-label-primary', '--dsw-alias-label-primary-foreground', '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-module-platform', '--dsw-alias-bg-mask-1',
    '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-border-l4',
    '--dsw-alias-brand-primary', '--dsw-alias-link',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary',
    '--dsw-alias-state-business-primary', '--dsw-alias-state-idle-primary',
    '--dsw-alias-button-primary-fill', '--dsw-alias-button-ghost-active-fill', '--dsw-alias-interactive-bg-hover',
    '--dsw-alias-interactive-bg-active', '--dsw-alias-toast-bg', '--dsw-alias-tooltip-bg', '--dsw-static-neutral-bluish-00']
  const themedStyle = getComputedStyle(themed)
  for (const n of names) out.tokens[n] = themedStyle.getPropertyValue(n).trim()

  const shortSel = (el) => {
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    let s = el.tagName.toLowerCase()
    if (cls.length) s += '.' + cls.join('.')
    const attrs = ['data-tone', 'data-state', 'aria-current', 'aria-selected', 'aria-checked', 'disabled', 'data-stage']
    for (const a of attrs) if (el.hasAttribute(a)) s += '[' + a + (el.getAttribute(a) === '' ? '' : '="' + el.getAttribute(a) + '"') + ']'
    return s
  }

  // ── 2. 文字元素：直接文本节点（含 input 的 placeholder/value）──
  const all = [frame, ...frame.querySelectorAll('*')]
  for (const el of all) {
    let text = ''
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent
    text = text.replace(/\s+/g, ' ').trim()
    if (!text && el.tagName === 'INPUT') text = '[input ' + (el.getAttribute('placeholder') || '') + ']'
    if (!text) continue
    const cs = getComputedStyle(el)
    const color = parse(cs.color)
    if (!color) continue
    const bg = effBg(el)
    const op = effOpacity(el)
    const fgEffective = over({ ...color, a: Math.min(1, color.a * op) }, bg.color)
    const r = ratio(fgEffective, bg.color)
    const fontSize = parseFloat(cs.fontSize)
    const fontWeight = parseInt(cs.fontWeight, 10) || 400
    const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700)
    out.text.push({
      sel: shortSel(el), text: text.slice(0, 28), color: rgba(color), fg: hex(fgEffective),
      bg: hex(bg.color), stack: bg.stack, ratio: Math.round(r * 100) / 100,
      fontSize, fontWeight, opacity: op, large, need: large ? 3 : 4.5,
      pass: r >= (large ? 3 : 4.5),
    })
  }

  // ── 3. 非文字面：有底色的元素，和它的父层算「表面」对比（UI 组件 3:1 用）──
  for (const el of all) {
    const cs = getComputedStyle(el)
    const own = parse(cs.backgroundColor)
    if (!own || own.a <= 0) continue
    let text = ''
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent
    if (text.trim()) continue
    const ownBg = effBg(el)
    const parentBg = el.parentElement ? effBg(el.parentElement).color : { r: 255, g: 255, b: 255, a: 1 }
    const r = ratio(ownBg.color, parentBg)
    out.surfaces.push({ sel: shortSel(el), fill: rgba(own), bg: hex(parentBg), ratio: Math.round(r * 100) / 100, size: Math.round(el.getBoundingClientRect().width) + 'x' + Math.round(el.getBoundingClientRect().height) })
  }

  // ── 4. 边框（UI 组件对比度，WCAG 1.4.11 3:1）──
  for (const el of all) {
    const cs = getComputedStyle(el)
    for (const side of ['Top', 'Bottom']) {
      const w = parseFloat(cs['border' + side + 'Width'])
      const st = cs['border' + side + 'Style']
      const c = parse(cs['border' + side + 'Color'])
      if (!(w > 0) || st === 'none' || !c) continue
      const bgOuter = el.parentElement ? effBg(el.parentElement).color : { r: 255, g: 255, b: 255, a: 1 }
      const fg = over(c, effBg(el).color)
      out.borders.push({ sel: shortSel(el), side: side.toLowerCase(), color: rgba(c), bg: hex(bgOuter), ratio: Math.round(ratio(fg, bgOuter) * 100) / 100, width: w })
    }
  }

  // ── 5. 写死的颜色字面量 ──
  const litRe = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/g
  const hasLit = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/ // 不带 g：.test() 带 g 会记 lastIndex，结果飘
  const isPanel = (el) => !!(el.closest('.dt-page') || el.closest('.sa-dock-panel') || el.closest('.preview-frame'))
  for (const el of [themed, ...themed.querySelectorAll('[style]')]) {
    const style = el.getAttribute('style') || ''
    if (!style.trim()) continue
    const hits = [...style.matchAll(litRe)].map((m) => m[0])
    if (!hits.length) continue
    const entry = { where: (el.getAttribute('class') || el.tagName), hits: [...new Set(hits)].slice(0, 40), count: hits.length }
    if (el === themed) out.tokenLayer = entry
    else if (isPanel(el)) out.literals.push(entry)
    else out.chromeLiterals.push(entry)
  }
  const walkRules = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && rule.cssRules.length) { walkRules(rule.cssRules); continue }
      const text = rule.cssText || ''
      if (!rule.selectorText || !hasLit.test(text)) continue
      let matched = 0
      try { matched = document.querySelectorAll(rule.selectorText).length } catch { matched = 0 }
      if (!matched) continue
      const hits = [...text.matchAll(litRe)].map((m) => m[0])
      const entry = { selector: rule.selectorText, declarations: text.slice(rule.selectorText.length + 1).trim().slice(0, 200), hits: [...new Set(hits)] }
      const panelSel = /\.(dt|sa)-/.test(rule.selectorText) && !/^\.preview/.test(rule.selectorText)
      if (panelSel) out.literals.push(entry)
      else out.chromeLiterals.push(entry)
    }
  }
  for (const sheet of document.styleSheets) { try { walkRules(sheet.cssRules) } catch { /* cross-origin */ } }

  // ── 6. 和背景同色（≈1）的元素，单独列出来 ──
  out.sameColor = out.text.filter((t) => t.ratio < 1.12).sort((a, b) => a.ratio - b.ratio)
  out.text.sort((a, b) => a.ratio - b.ratio)
  out.surfaces.sort((a, b) => a.ratio - b.ratio)
  return out
}

const files = process.argv.slice(2)
const results = []
for (const f of files) {
  const src = readFileSync(join(ROOT, f), 'utf8')
  const injected = src
    + '\n<pre id="__contrast__" style="display:none">'
    + '<scr' + 'ipt>window.addEventListener("load", function(){var d=' + measurePage.toString() + '();document.getElementById("__contrast__").textContent=JSON.stringify(d);});</scr' + 'ipt>'
    + '</pre>'
  const tmp = join(ROOT, f.replace(/\.html$/, '.measure.html'))
  writeFileSync(tmp, injected)
  const dom = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--virtual-time-budget=4000', '--window-size=1000,1000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const m = dom.match(/<pre id="__contrast__"[^>]*>([\s\S]*?)<\/pre>/)
  if (!m) { console.error('NO DATA for ' + f); continue }
  const json = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  results.push({ file: f, data: JSON.parse(json) })
}
console.log(JSON.stringify(results, null, 1))
