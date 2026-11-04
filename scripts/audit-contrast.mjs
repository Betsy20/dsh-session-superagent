#!/usr/bin/env node
// 对比度体检（可重复跑）—— 取代 0.9.187 那次「一次性核对」。
//
// 为什么要有这个脚本：`docs/报告-浅色主题核对.md` 的结论是用一个跑完就删的临时脚本量出来的，
// 换个样式就没人能重跑；对比度退化（浅色下又冒出一档 3.x 的灰字、某个胶囊底又被同色吃掉）
// 不会有任何东西报警。这里把同一套测量固化成一条命令，退出码能进 CI。
//
// 用法：
//   node scripts/audit-contrast.mjs                 # 浅色 + 深色，一张表（默认）
//   node scripts/audit-contrast.mjs --dark          # 只跑深色（render-preview 也带 --dark）
//   node scripts/audit-contrast.mjs --light         # 只跑浅色
//   node scripts/audit-contrast.mjs --json          # 结构化的机读结果（CI 用）
//   node scripts/audit-contrast.mjs --text=4.5 --large=3 --nontext=3   # 改阈值
//   node scripts/audit-contrast.mjs --only=总览      # 透传 render-preview 的场景过滤（调样式时省时间）
//   node scripts/audit-contrast.mjs --browser=/path/to/chrome          # 指定浏览器（也可用 DSH_AUDIT_BROWSER）
//
// 退出码：0 = 全部达标；1 = 有违规；2 = 环境或测量失败（没浏览器 / render-preview 报错 / 一个节点都没量到）
// 退出码 2 单独分出来的原因：那是「没量」不是「达标」，静默返回 0 会变成假绿灯。
//
// ── 判定口径（WCAG 2.1）──────────────────────────────────────────────
//   正文            ≥ 4.5:1   1.4.3
//   大字            ≥ 3:1     1.4.3；大字 = ≥24px（18pt）常规，或 ≥18.66px（14pt）且字重 ≥700
//   非文字（边框/控件状态面）≥ 3:1   1.4.11
//   豁免：禁用控件（1.4.3 明确豁免）—— 仍然量、仍然列，只把判定标成「豁免」，退化一样看得见。
//
// ── 上一轮踩过的两个坑（这个脚本必须绕开，别改回去）──────────────────
//   坑 ① `color-mix()` 在 getComputedStyle 里不是 rgba()。
//      `.dt-tag` 的底色是 `color-mix(in srgb, <token> 12%, transparent)`，浏览器算出来是
//      `color(srgb 0.603922 0.403922 0 / 0.12)`。用 `/^rgba?\(/` 那种正则解析会**解析失败**，
//      失败后被当成「透明」→ 背景算成纯白 → 比值虚高（琥珀胶囊算成 4.87，真实 4.17）。
//      正确做法：把颜色串交给 canvas 的 `fillStyle` 再由 `getImageData` 取回像素，
//      浏览器自己能解的都解（color()/oklab()/hsl()/关键字…），正则只当兜底。
//   坑 ② 解析与合成**必须用两块 canvas**。
//      解析一个颜色本身就要 fillRect；如果和「把背景一层层叠出来」共用同一块画布，
//      解析动作会把已经合成好的背景**覆盖成纯色**（当时琥珀底被算成 #966900，比值 1.00，
//      看着像「白底白字」的大新闻，其实是工装 bug）。
//      所以：`parseCanvas` 只负责「颜色串 → rgba」，`compCanvas` 只负责「一层层叠出真实背景」。
//
// 边界（别拿它当真机结论）：
//   - 渲染源是 `scripts/render-preview.mjs` 的**手写近似 token**，真机以宿主注入的 --dsw-alias-* 为准；
//     但「面板 CSS 与某档 token 组合出来的结果」「面板自己写死的颜色」这两类结论与宿主无关。
//   - 只量静态渲染，不量 :hover / :focus-visible / 动画中途。
//   - 不解析 box-shadow 的视觉强度，只用它的颜色算「有没有可见边界」。
//   - 背景有 background-image（渐变/图片）的元素跳过，因为算不出真实底色。

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HARNESS = join(ROOT, 'scripts', 'render-preview.mjs')

// ══════════════════════════════════════════════════════════════════════
// 一、纯函数区（Node 里可跑、可单测；浏览器里也复用同一份实现）
//
// 注意：下面这几个函数会被 .toString() 注入到页面里执行，所以：
//   - 必须是 `function` 声明（箭头函数 toString 出来不是合法语句）；
//   - 不能引用模块作用域的其它变量（除了彼此），否则页面里会 ReferenceError。
// ══════════════════════════════════════════════════════════════════════

export const DEFAULT_THRESHOLDS = Object.freeze({ text: 4.5, largeText: 3, nonText: 3 })

/** sRGB 分量（0..1）→ 线性光（WCAG 2.1 相对亮度公式的前半段）。 */
export function srgbChannelToLinear(value) {
  const v = value <= 0 ? 0 : value >= 1 ? 1 : value
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** WCAG 2.1 相对亮度：0.2126R + 0.7152G + 0.0722B（R/G/B 已线性化）。 */
export function relativeLuminance(color) {
  const r = srgbChannelToLinear(color.r / 255)
  const g = srgbChannelToLinear(color.g / 255)
  const b = srgbChannelToLinear(color.b / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 对比度：(L1 + 0.05) / (L2 + 0.05)，L1 是较亮的一方。黑白 = 21，同色 = 1。 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * 纯 JS 的 CSS 颜色解析（canvas 解析失败时的兜底，也是单测入口）。
 *
 * 支持的语法：`#rgb/#rgba/#rrggbb/#rrggbbaa`、`rgb()/rgba()`（旧逗号与新空格/斜杠两种）、
 * `color(srgb r g b / a)`（**就是 color-mix() 算完之后 getComputedStyle 返回的那个形状**）、
 * 以及几个颜色关键字。解析不了就返回 null —— 别猜，猜错会把比值算得很好看。
 */
export function parseColorString(input) {
  if (typeof input !== 'string') return null
  const raw = input.trim()
  if (!raw) return null

  const clamp = (v, max) => (v < 0 ? 0 : v > max ? max : v)
  const named = {
    transparent: [0, 0, 0, 0],
    white: [255, 255, 255, 1],
    black: [0, 0, 0, 1],
    red: [255, 0, 0, 1],
    green: [0, 128, 0, 1],
    blue: [0, 0, 255, 1],
    gray: [128, 128, 128, 1],
    grey: [128, 128, 128, 1],
  }
  const lower = raw.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(named, lower)) {
    const v = named[lower]
    return { r: v[0], g: v[1], b: v[2], a: v[3] }
  }

  if (lower[0] === '#') {
    const hex = lower.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return null
    if (hex.length === 3 || hex.length === 4) {
      const parts = hex.split('')
      return {
        r: parseInt(parts[0] + parts[0], 16),
        g: parseInt(parts[1] + parts[1], 16),
        b: parseInt(parts[2] + parts[2], 16),
        a: hex.length === 4 ? parseInt(parts[3] + parts[3], 16) / 255 : 1,
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      }
    }
    return null
  }

  // color(srgb r g b / a) —— 0..1 浮点，或百分数
  const colorFn = lower.match(/^color\(\s*srgb\s+([^)]+)\)$/)
  if (colorFn) {
    const [channelPart, alphaPart] = colorFn[1].split('/')
    const channels = channelPart.trim().split(/\s+/).filter(Boolean)
    if (channels.length < 3) return null
    const unit = (token) => (token.endsWith('%') ? parseFloat(token) / 100 : parseFloat(token))
    const values = channels.slice(0, 3).map(unit)
    const alpha = alphaPart === undefined ? 1 : unit(alphaPart.trim())
    if (values.some((v) => !Number.isFinite(v)) || !Number.isFinite(alpha)) return null
    return {
      r: Math.round(clamp(values[0], 1) * 255),
      g: Math.round(clamp(values[1], 1) * 255),
      b: Math.round(clamp(values[2], 1) * 255),
      a: clamp(alpha, 1),
    }
  }

  // rgb() / rgba()：兼容 `rgb(1, 2, 3)`、`rgb(1 2 3 / 50%)`、旧式 `rgba(1, 2, 3, 0.5)`
  const rgbFn = lower.match(/^rgba?\(([^)]+)\)$/)
  if (rgbFn) {
    const [channelPart, alphaPart] = rgbFn[1].split('/')
    const channels = channelPart.trim().split(/[\s,]+/).filter(Boolean)
    if (channels.length < 3) return null
    const channel = (token) => (token.endsWith('%') ? (parseFloat(token) * 255) / 100 : parseFloat(token))
    const alphaToken = alphaPart !== undefined ? alphaPart.trim() : channels[3]
    const alpha = alphaToken === undefined
      ? 1
      : (String(alphaToken).endsWith('%') ? parseFloat(alphaToken) / 100 : parseFloat(alphaToken))
    const values = channels.slice(0, 3).map(channel)
    if (values.some((v) => !Number.isFinite(v)) || !Number.isFinite(alpha)) return null
    return {
      r: Math.round(clamp(values[0], 255)),
      g: Math.round(clamp(values[1], 255)),
      b: Math.round(clamp(values[2], 255)),
      a: clamp(alpha, 1),
    }
  }

  return null
}

/** source-over 合成：把 top 叠在 bottom 上，返回「肉眼看到的那个颜色」。 */
export function alphaOver(bottom, top) {
  const ba = bottom.a === undefined ? 1 : bottom.a
  const ta = top.a === undefined ? 1 : top.a
  const out = ta + ba * (1 - ta)
  if (out <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (tv, bv) => Math.round((tv * ta + bv * ba * (1 - ta)) / out)
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: out }
}

/** 大字判定：≥24px 常规，或 ≥18.66px（14pt）且字重 ≥700。 */
export function isLargeText(fontSizePx, fontWeight) {
  const size = Number(fontSizePx)
  const weight = Number(fontWeight)
  if (!Number.isFinite(size) || size <= 0) return false
  if (size >= 24) return true
  return size >= 18.66 && Number.isFinite(weight) && weight >= 700
}

/** 该样本该用哪个阈值。 */
export function requiredRatio(sample, thresholds = DEFAULT_THRESHOLDS) {
  const kind = sample && sample.kind
  if (kind === 'border' || kind === 'surface') return thresholds.nonText
  return isLargeText(sample && sample.fontSize, sample && sample.fontWeight) ? thresholds.largeText : thresholds.text
}

/**
 * 判定一个样本：pass / fail / exempt。
 * exempt 只给「禁用控件」——WCAG 1.4.3 明确豁免，但仍要出现在表里（退化才看得见）。
 */
export function judge(sample, thresholds = DEFAULT_THRESHOLDS) {
  const need = requiredRatio(sample, thresholds)
  if (sample && sample.exempt) return { need, status: 'exempt' }
  const ratio = Number(sample && sample.ratio)
  const ok = Number.isFinite(ratio) && ratio + 1e-9 >= need
  return { need, status: ok ? 'pass' : 'fail' }
}

/** {r,g,b} → `#rrggbb`（表格里显示用）。 */
export function toHex(color) {
  const part = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + part(color.r) + part(color.g) + part(color.b)
}

// ══════════════════════════════════════════════════════════════════════
// 二、浏览器里跑的那段测量
//
// 这个函数会被 .toString() 注进预览 HTML，在无头浏览器里执行：
//   - 拿 getComputedStyle 的**计算值**（不是读源码猜 token）；
//   - 沿祖先链收集背景色，用 compCanvas 自底向上叠出「真实的合成背景」；
//   - 文字/边框颜色再用 parseCanvas 解析，最后叠到背景上算比值。
// 它只产样（samples），判定与聚合在 Node 侧做。
// ══════════════════════════════════════════════════════════════════════

function measurePage(cfg) {
  const result = { theme: cfg.themeLabel, samples: [], skipped: 0, errors: [] }
  const noteError = (message) => {
    if (result.errors.length < 40) result.errors.push(String(message).slice(0, 200))
  }

  // ── 坑 ②：两块 canvas，各干各的。共用一块会让「解析颜色」的 fillRect 把合成好的背景覆盖成纯色。
  const parseCanvas = document.createElement('canvas')
  parseCanvas.width = 1
  parseCanvas.height = 1
  const parseCtx = parseCanvas.getContext('2d', { willReadFrequently: true })

  const compCanvas = document.createElement('canvas')
  compCanvas.width = 1
  compCanvas.height = 1
  const compCtx = compCanvas.getContext('2d', { willReadFrequently: true })

  const SENTINEL = '#010203'

  // ── 坑 ①：颜色串交给 canvas 的 fillStyle，不要用正则。color-mix() 算完是 `color(srgb … / α)`。
  function cssColor(value) {
    if (!value) return null
    parseCtx.fillStyle = SENTINEL
    parseCtx.fillStyle = value
    if (parseCtx.fillStyle === SENTINEL) {
      // 浏览器都不认识 → 才走纯 JS 兜底（同一个 parseColorString）
      const fallback = parseColorString(value)
      if (!fallback) {
        noteError('无法解析颜色：' + String(value).slice(0, 80))
        return null
      }
      return fallback
    }
    parseCtx.clearRect(0, 0, 1, 1)
    parseCtx.fillRect(0, 0, 1, 1)
    const pixel = parseCtx.getImageData(0, 0, 1, 1).data
    return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 }
  }

  // 合成专用画布：自底向上逐层 fillRect，读回来的就是真实背景色。
  function drawStack(layers) {
    compCtx.clearRect(0, 0, 1, 1)
    for (const layer of layers) {
      if (!layer || !(layer.a > 0)) continue
      compCtx.fillStyle = 'rgba(' + layer.r + ',' + layer.g + ',' + layer.b + ',' + layer.a + ')'
      compCtx.fillRect(0, 0, 1, 1)
    }
    const pixel = compCtx.getImageData(0, 0, 1, 1).data
    return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 }
  }

  // 从元素向上收集背景层，遇到第一层不透明就停（再往上的都被挡住了），最远到主题区块。
  // 整条链都不透明不到（面板自己没底、外面是工装）→ 拿页面 body 的底色兜底，
  // 否则空栈会被读成 #000000，凭空造出一条「15:1 通过」的假行。
  function backdrop(el, root) {
    const layers = []
    let hasImage = false
    let node = el
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node)
      if (style.backgroundImage && style.backgroundImage !== 'none') hasImage = true
      const color = cssColor(style.backgroundColor)
      if (color && color.a > 0) layers.push(color)
      if (color && color.a >= 0.999) break
      if (node === root) break
      node = node.parentElement
    }
    const covered = 1 - layers.reduce((open, layer) => open * (1 - layer.a), 1)
    if (covered < 0.999) {
      const pageBackground = cssColor(getComputedStyle(document.body).backgroundColor)
      if (pageBackground && pageBackground.a > 0) layers.push(pageBackground)
    }
    return { layers: layers.reverse(), hasImage }
  }

  // opacity 作用在整棵子树上；近似成「乘进前景 alpha」（与上一轮口径一致）。
  function opacityOf(el, root) {
    let opacity = 1
    let node = el
    while (node && node.nodeType === 1) {
      const value = parseFloat(getComputedStyle(node).opacity)
      if (Number.isFinite(value)) opacity *= value
      if (node === root) break
      node = node.parentElement
    }
    return opacity
  }

  function isDisabled(el, root) {
    let node = el
    while (node && node.nodeType === 1) {
      if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true') return true
      if (node === root) break
      node = node.parentElement
    }
    return false
  }

  function selectorOf(el) {
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter((name) => /^(dt-|sa-|dsw-)/.test(name)).slice(0, 4)
    let out = el.tagName.toLowerCase() + classes.map((name) => '.' + name).join('')
    const attrs = ['data-tone', 'data-state', 'role', 'type', 'aria-selected', 'aria-pressed', 'aria-current', 'aria-checked']
    for (const name of attrs) {
      const value = el.getAttribute(name)
      if (value === null) continue
      out += value === '' ? '[' + name + ']' : '[' + name + '="' + value + '"]'
    }
    if (el.hasAttribute('disabled')) out += '[disabled]'
    return out
  }

  function ownText(el) {
    let text = ''
    for (const child of el.childNodes) if (child.nodeType === 3) text += child.nodeValue
    return text.replace(/\s+/g, ' ').trim()
  }

  function placeholderColor(el) {
    try {
      const style = getComputedStyle(el, '::placeholder')
      return style && style.color ? style.color : null
    } catch (error) {
      return null
    }
  }

  // box-shadow 的颜色：只用它判断「有没有可见边界」，不还原阴影本身的视觉强度。
  function shadowStrength(style, background) {
    const shadow = style.boxShadow
    if (!shadow || shadow === 'none') return 0
    const colors = shadow.match(/(?:rgba?|color)\([^)]*\)|#[0-9a-fA-F]{3,8}/g) || []
    let best = 0
    for (const token of colors) {
      const parsed = cssColor(token)
      if (!parsed || parsed.a <= 0) continue
      const painted = alphaOver(background, parsed)
      best = Math.max(best, contrastRatio(background, painted))
    }
    return best
  }

  const themed = Array.prototype.slice.call(document.querySelectorAll('.themed')).filter((node) => {
    const title = node.previousElementSibling
    return title && (title.textContent || '').indexOf(cfg.themeLabel) >= 0
  })[0]

  if (!themed) {
    const found = Array.prototype.slice.call(document.querySelectorAll('.themed')).map(
      (node) => ((node.previousElementSibling && node.previousElementSibling.textContent) || '?').trim()
    )
    noteError('找不到主题区块「' + cfg.themeLabel + '」，页面里有：' + found.join(' / '))
    return result
  }

  // 一个场景一块：面板帧 + 卫星环弹层。标题取它前面那个 h2（工装自己的标题，不算面板内容）。
  const scopes = []
  const collect = (selector, fallbackName) => {
    Array.prototype.forEach.call(themed.querySelectorAll(selector), (node) => {
      const title = node.previousElementSibling
      scopes.push({ root: node, page: ((title && title.textContent) || fallbackName).trim() })
    })
  }
  collect('.preview-frame', '未命名页面')
  collect('.preview-popover', '卫星环弹层')
  result.scopes = scopes.map((scope) => scope.page)

  const SKIP = '.preview-mask, .preview-title, .theme-name, script, style, head, title'

  for (const scope of scopes) {
    const nodes = [scope.root].concat(Array.prototype.slice.call(scope.root.querySelectorAll('*')))
    for (const el of nodes) {
      try {
        if (el.closest && el.closest(SKIP)) continue
        const visible = typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
          : el.getClientRects().length > 0
        if (!visible) continue

        const style = getComputedStyle(el)
        const disabled = isDisabled(el, themed)
        const exempt = disabled ? '禁用控件（WCAG 1.4.3 豁免）' : ''
        const opacity = opacityOf(el, themed)
        // 是「控件」还是「装饰」：1.4.11 只对控件的边界/状态硬要求 3:1，
        // 纯分隔线（列表项之间的 0.5px 边框）属装饰，记下来供参考，别让人以为每根线都得改。
        const control = /^(button|input|select|textarea|a)$/i.test(el.tagName)
          || ['button', 'tab', 'switch', 'checkbox', 'link', 'menuitem', 'option'].indexOf(el.getAttribute('role') || '') >= 0
        // 整条链路透明度 ≈ 0 = 根本看不见（`.sa-dock-actions` 就是 hover 才显形的那组按钮）。
        // 这种元素没有「读不读得清」的问题，硬算会把比值算成 1.00 的假缺陷。
        if (opacity < 0.05) {
          result.skipped += 1
          continue
        }
        const shared = {
          page: scope.page,
          selector: selectorOf(el),
          fontSize: parseFloat(style.fontSize) || 0,
          fontWeight: parseInt(style.fontWeight, 10) || 400,
          control,
          exempt,
        }

        // ① 文字：只认「自己的直接文字节点」，父节点的文字已经在父节点上量过了。
        let text = ownText(el)
        let textColor = style.color
        if (!text && /^(input|textarea)$/i.test(el.tagName)) {
          const value = (el.value || '').trim()
          if (value) {
            text = value
          } else if (el.getAttribute('placeholder')) {
            text = el.getAttribute('placeholder')
            textColor = placeholderColor(el) || style.color
          }
        }
        if (text) {
          const foreground = cssColor(textColor)
          const back = backdrop(el, themed)
          if (!foreground) {
            result.skipped += 1
          } else if (back.hasImage) {
            result.skipped += 1
          } else {
            const background = drawStack(back.layers)
            const painted = alphaOver(background, {
              r: foreground.r,
              g: foreground.g,
              b: foreground.b,
              a: Math.min(1, foreground.a * opacity),
            })
            result.samples.push(Object.assign({}, shared, {
              kind: 'text',
              fg: toHex(painted),
              bg: toHex(background),
              ratio: contrastRatio(background, painted),
            }))
          }
        }

        // ② 边框：控件边界的一半线索在这里（另一半是填充）。对的是「边框外面那层背景」。
        //    场景根节点（.preview-frame / .preview-popover）的边框是**工装自己的**外框，不属于面板，跳过。
        let worstBorder = null
        let strongestBorder = 0
        for (const side of el === scope.root ? [] : ['Top', 'Right', 'Bottom', 'Left']) {
          const width = parseFloat(style['border' + side + 'Width'])
          const borderStyle = style['border' + side + 'Style']
          if (!(width > 0) || borderStyle === 'none' || borderStyle === 'hidden') continue
          const color = cssColor(style['border' + side + 'Color'])
          if (!color || color.a <= 0) continue
          const parent = el.parentElement || el
          const back = backdrop(parent === el ? el : parent, themed)
          if (back.hasImage) {
            result.skipped += 1
            continue
          }
          const background = drawStack(back.layers)
          const painted = alphaOver(background, {
            r: color.r,
            g: color.g,
            b: color.b,
            a: Math.min(1, color.a * opacity),
          })
          const ratio = contrastRatio(background, painted)
          strongestBorder = Math.max(strongestBorder, ratio)
          if (!worstBorder || ratio < worstBorder.ratio) {
            worstBorder = { ratio, fg: painted, bg: background }
          }
        }
        if (worstBorder) {
          result.samples.push(Object.assign({}, shared, {
            kind: 'border',
            fg: toHex(worstBorder.fg),
            bg: toHex(worstBorder.bg),
            ratio: worstBorder.ratio,
          }))
        }

        // ③ 控件状态面：只有「选中/按下」这种承载状态的填充才算 1.4.11 的对象。
        //    默认态的底色是装饰，不该被当缺陷（否则每个带底的按钮都会报一条）。
        const stateful = (
          el.getAttribute('aria-pressed') === 'true' ||
          el.getAttribute('aria-selected') === 'true' ||
          el.getAttribute('aria-checked') === 'true' ||
          /^(page|true|step|location|date|time)$/.test(el.getAttribute('aria-current') || '')
        )
        if (stateful) {
          const fill = cssColor(style.backgroundColor)
          if (fill && fill.a > 0) {
            const parent = el.parentElement || el
            const back = backdrop(parent === el ? el : parent, themed)
            if (!back.hasImage) {
              const background = drawStack(back.layers)
              const painted = alphaOver(background, {
                r: fill.r,
                g: fill.g,
                b: fill.b,
                a: Math.min(1, fill.a * opacity),
              })
              const ratio = contrastRatio(background, painted)
              // 填充本身不够 3:1，但边框或 box-shadow 环够 → 边界由它们承担，不算缺陷。
              const boundary = Math.max(strongestBorder, shadowStrength(style, background))
              const boundaryExempt = boundary >= 3
                ? '边界由边框/描边给出（' + boundary.toFixed(2) + ':1）'
                : ''
              result.samples.push(Object.assign({}, shared, {
                kind: 'surface',
                fg: toHex(painted),
                bg: toHex(background),
                ratio,
                exempt: exempt || boundaryExempt,
              }))
            }
          }
        }
      } catch (error) {
        noteError((scope.page || '?') + ' / ' + (el.tagName || '?') + '：' + ((error && error.message) || error))
      }
    }
  }

  return result
}

// ══════════════════════════════════════════════════════════════════════
// 三、CLI
// ══════════════════════════════════════════════════════════════════════

const THEMES = {
  light: { label: '浅色主题', flags: null, title: '浅色（不带 --dark 渲染，取「浅色主题」区块）' },
  dark: { label: '深色主题', flags: ['--dark'], title: '深色（--dark 渲染）' },
}

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

function findBrowser(explicit) {
  const wanted = explicit || process.env.DSH_AUDIT_BROWSER || ''
  if (wanted) return existsSync(wanted) ? wanted : null
  for (const candidate of BROWSER_CANDIDATES) if (existsSync(candidate)) return candidate
  return null
}

function parseArgs(argv) {
  const options = {
    themes: ['light', 'dark'],
    thresholds: Object.assign({}, DEFAULT_THRESHOLDS),
    json: false,
    only: '',
    browser: '',
    help: false,
  }
  for (const arg of argv) {
    if (arg === '--json') options.json = true
    else if (arg === '--dark') options.themes = ['dark']
    else if (arg === '--light') options.themes = ['light']
    else if (arg === '--both') options.themes = ['light', 'dark']
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('--text=')) options.thresholds.text = Number(arg.slice('--text='.length))
    else if (arg.startsWith('--large=')) options.thresholds.largeText = Number(arg.slice('--large='.length))
    else if (arg.startsWith('--nontext=')) options.thresholds.nonText = Number(arg.slice('--nontext='.length))
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length)
    else if (arg.startsWith('--browser=')) options.browser = arg.slice('--browser='.length)
    else throw new Error('不认识的参数：' + arg + '（--help 看用法）')
  }
  for (const [name, value] of Object.entries(options.thresholds)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('阈值不合法：' + name + '=' + value)
  }
  return options
}

/** 把纯函数 + 测量函数拼成页面脚本，避免「同一套公式在两头各写一遍」。 */
function buildPageScript(themeLabel) {
  const helpers = [parseColorString, alphaOver, contrastRatio, relativeLuminance, srgbChannelToLinear, toHex]
    .map((fn) => fn.toString())
    .join('\n\n')
  const payload = JSON.stringify({ themeLabel })
  return '<script>\n(function () {\n' + helpers + '\n\n' + measurePage.toString() + '\n\n'
    + 'var __result = measurePage(' + payload + ')\n'
    + 'var __pre = document.createElement("pre")\n'
    + '__pre.id = "__audit_result__"\n'
    + '__pre.textContent = JSON.stringify(__result)\n'
    + 'document.documentElement.appendChild(__pre)\n'
    + '})()\n</script>'
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&')
}

function browserArgs(profileDir) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--hide-scrollbars',
    '--window-size=1000,1000',
    '--user-data-dir=' + profileDir,
    '--virtual-time-budget=5000',
    '--dump-dom',
  ]
}

/** 渲一份预览 → 注入测量脚本 → 无头浏览器跑 → 取回 samples。 */
function measureTheme(themeKey, options, browser) {
  const spec = THEMES[themeKey]
  const workdir = mkdtempSync(join(tmpdir(), 'zhuli-contrast-' + themeKey + '-'))
  try {
    const harnessHtml = join(workdir, 'harness.html')
    const auditHtml = join(workdir, 'audit.html')
    const harnessArgs = [HARNESS, harnessHtml].concat(spec.flags || [])
    if (options.only) harnessArgs.push('--only=' + options.only)
    try {
      execFileSync(process.execPath, harnessArgs, { cwd: ROOT, stdio: 'pipe', timeout: 120000 })
    } catch (error) {
      const stderr = (error && error.stderr ? error.stderr.toString() : '').trim()
      throw new Error('render-preview.mjs 跑失败（' + themeKey + '）：' + (stderr || (error && error.message) || error))
    }

    writeFileSync(auditHtml, readFileSync(harnessHtml, 'utf8') + buildPageScript(spec.label))

    let dom = ''
    try {
      dom = execFileSync(browser, browserArgs(join(workdir, 'profile')).concat([pathToFileURL(auditHtml).href]), {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 180000,
      })
    } catch (error) {
      if (error && error.status === null) throw new Error('无头浏览器没有正常退出：' + browser)
      dom = (error && error.stdout) || ''
      if (!dom) throw new Error('无头浏览器跑失败（' + themeKey + '）：' + ((error && error.message) || error))
    }

    const matched = dom.match(/<pre id="__audit_result__">([\s\S]*?)<\/pre>/)
    if (!matched) throw new Error('页面里没找到测量结果（' + themeKey + '）：预览可能没渲染出来')
    let parsed = null
    try {
      parsed = JSON.parse(decodeEntities(matched[1]))
    } catch (error) {
      throw new Error('测量结果不是合法 JSON（' + themeKey + '）：' + ((error && error.message) || error))
    }
    return parsed
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

/** 同选择器 + 同颜色 + 同字号的样本合并成一行，节点数累加，页面去重。 */
function aggregate(themeKey, samples, thresholds) {
  const groups = new Map()
  for (const sample of samples) {
    const key = [
      sample.kind, sample.selector, sample.fg, sample.bg,
      sample.fontSize + '/' + sample.fontWeight, sample.exempt ? '1' : '0', sample.control ? '1' : '0',
    ].join('\u0001')
    let group = groups.get(key)
    if (!group) {
      group = {
        theme: themeKey,
        kind: sample.kind,
        selector: sample.selector,
        fg: sample.fg,
        bg: sample.bg,
        fontSize: sample.fontSize,
        fontWeight: sample.fontWeight,
        control: Boolean(sample.control),
        exempt: sample.exempt,
        ratio: sample.ratio,
        nodes: 0,
        pages: new Set(),
      }
      groups.set(key, group)
    }
    group.nodes += 1
    group.ratio = Math.min(group.ratio, sample.ratio)
    group.pages.add(sample.page)
  }
  const rows = []
  for (const group of groups.values()) {
    const verdict = judge({ kind: group.kind, fontSize: group.fontSize, fontWeight: group.fontWeight, ratio: group.ratio, exempt: group.exempt }, thresholds)
    rows.push(Object.assign({}, group, { pages: Array.from(group.pages), need: verdict.need, status: verdict.status }))
  }
  rows.sort((a, b) => a.theme.localeCompare(b.theme) || a.ratio - b.ratio)
  return rows
}

function summarize(themeKey, rows) {
  let nodes = 0
  let failNodes = 0
  let worst = null
  let worstEnforced = null
  const failGroups = rows.filter((row) => row.status === 'fail')
  // 非文字里只有「控件」那部分才是 1.4.11 的硬要求；装饰性分隔线单独计数，别混在一起吓人。
  const failControlGroups = failGroups.filter((row) => row.kind === 'surface' || (row.kind === 'border' && row.control))
  const failDecorativeGroups = failGroups.filter((row) => row.kind === 'border' && !row.control)
  for (const row of rows) {
    nodes += row.nodes
    if (row.status === 'fail') failNodes += row.nodes
    if (!worst || row.ratio < worst.ratio) worst = row
    if (row.status !== 'exempt' && (!worstEnforced || row.ratio < worstEnforced.ratio)) worstEnforced = row
  }
  return {
    theme: themeKey,
    groups: rows.length,
    nodes,
    failGroups: failGroups.length,
    failNodes,
    failControlGroups: failControlGroups.length,
    failDecorativeGroups: failDecorativeGroups.length,
    exemptGroups: rows.filter((row) => row.status === 'exempt').length,
    worst: worst ? { ratio: worst.ratio, selector: worst.selector, status: worst.status } : null,
    worstEnforced: worstEnforced ? { ratio: worstEnforced.ratio, selector: worstEnforced.selector } : null,
  }
}

function formatRatio(value) {
  return Number(value).toFixed(2)
}

function statusLabel(row) {
  if (row.status === 'exempt') return '豁免'
  if (row.status === 'pass') return '通过 ≥' + row.need
  return '**不达标 <' + row.need + '**'
}

function kindLabel(row) {
  if (row.kind === 'text') return '文字'
  if (row.kind === 'border') return row.control ? '控件边框' : '边框'
  return '控件面'
}

function pageLabel(pages) {
  if (!pages.length) return '-'
  if (pages.length === 1) return pages[0]
  return pages[0] + ' 等 ' + pages.length + ' 页'
}

function printTable(rows) {
  const header = ['#', '主题', '比值', '类别', '选择器', '前景', '背景', '字号/字重', '节点', '页面', '判定']
  const body = rows.map((row, index) => [
    String(index + 1),
    row.theme,
    formatRatio(row.ratio),
    kindLabel(row),
    row.selector,
    row.fg,
    row.bg,
    Math.round(row.fontSize) + 'px/' + row.fontWeight,
    String(row.nodes),
    pageLabel(row.pages),
    statusLabel(row),
  ])
  const widths = header.map((cell, column) => Math.max(cell.length, ...body.map((line) => line[column].length)))
  const render = (line) => '| ' + line.map((cell, column) => cell.padEnd(widths[column])).join(' | ') + ' |'
  console.log(render(header))
  console.log('|' + widths.map((width) => ' ' + '-'.repeat(width) + ' ').join('|') + '|')
  for (const line of body) console.log(render(line))
}

function printReport(rows, summaries, options) {
  console.log('主理鱼 · 对比度体检  scripts/audit-contrast.mjs')
  console.log('渲染源：真实 client.js → scripts/render-preview.mjs → 无头浏览器 getComputedStyle（静态渲染，不含量 :hover/:focus）')
  console.log('阈值：正文 ≥' + options.thresholds.text + ' · 大字（≥24px 或 ≥18.66px 且字重≥700）≥' + options.thresholds.largeText
    + ' · 非文字（边框/控件状态面）≥' + options.thresholds.nonText)
  console.log('类别：「控件边框」「控件面」是 1.4.11 的硬要求；「边框」是装饰性分隔线，同列出来供参考，改不改看设计。')
  console.log('')
  for (const summary of summaries) {
    const worst = summary.worst ? formatRatio(summary.worst.ratio) + ' ' + summary.worst.selector + (summary.worst.status === 'exempt' ? '（豁免）' : '') : '-'
    console.log('· ' + summary.theme + '：' + summary.nodes + ' 个节点 / ' + summary.groups + ' 组 ｜ 不达标 '
      + summary.failGroups + ' 组 ' + summary.failNodes + ' 节点（控件 ' + summary.failControlGroups
      + ' / 装饰边框 ' + summary.failDecorativeGroups + '）｜ 豁免 ' + summary.exemptGroups + ' 组 ｜ 最低 ' + worst)
  }
  console.log('')
  if (!rows.length) {
    console.log('（没有量到任何节点）')
    return
  }
  console.log('对比度总表（按比值升序，最差的排最前）')
  console.log('')
  printTable(rows)
}

function printJson(rows, summaries, options) {
  const violations = rows.filter((row) => row.status === 'fail')
  const payload = {
    ok: violations.length === 0,
    tool: 'scripts/audit-contrast.mjs',
    generatedAt: new Date().toISOString(),
    thresholds: options.thresholds,
    themes: options.themes,
    summary: summaries,
    violations: violations.map((row) => ({
      theme: row.theme,
      kind: row.kind,
      selector: row.selector,
      ratio: Number(row.ratio.toFixed(4)),
      need: row.need,
      fg: row.fg,
      bg: row.bg,
      fontSize: row.fontSize,
      fontWeight: row.fontWeight,
      nodes: row.nodes,
      pages: row.pages,
    })),
    groups: rows.map((row) => ({
      theme: row.theme,
      kind: row.kind,
      selector: row.selector,
      ratio: Number(row.ratio.toFixed(4)),
      need: row.need,
      status: row.status,
      exempt: row.exempt || null,
      fg: row.fg,
      bg: row.bg,
      fontSize: row.fontSize,
      fontWeight: row.fontWeight,
      nodes: row.nodes,
      pages: row.pages,
    })),
  }
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(String((error && error.message) || error))
    process.exitCode = 2
    return
  }
  if (options.help) {
    console.log('用法：node scripts/audit-contrast.mjs [--dark|--light|--both] [--json] [--only=场景名]')
    console.log('      [--text=4.5] [--large=3] [--nontext=3] [--browser=/path/to/chrome]')
    console.log('退出码：0 全部达标 / 1 有违规 / 2 环境或测量失败')
    return
  }

  const browser = findBrowser(options.browser)
  if (!browser) {
    console.error('找不到可用的无头浏览器（试过 Edge / Chrome / Chromium 的常见路径）。')
    console.error('装一个，或指定 --browser=/path/to/chrome（也可以用 DSH_AUDIT_BROWSER 环境变量）。')
    process.exitCode = 2
    return
  }

  const rows = []
  const summaries = []
  for (const themeKey of options.themes) {
    let measured
    try {
      measured = measureTheme(themeKey, options, browser)
    } catch (error) {
      console.error(String((error && error.message) || error))
      process.exitCode = 2
      return
    }
    for (const message of measured.errors || []) console.error('! ' + themeKey + '：' + message)
    if (!measured.samples || !measured.samples.length) {
      console.error('! ' + themeKey + '：一个节点都没量到（渲染可能空/选择器变了），按失败处理，不返回 0')
      process.exitCode = 2
      return
    }
    const themeRows = aggregate(themeKey, measured.samples, options.thresholds)
    for (const row of themeRows) rows.push(row)
    summaries.push(Object.assign(summarize(themeKey, themeRows), {
      scopes: measured.scopes || [],
      skipped: measured.skipped || 0,
    }))
  }

  rows.sort((a, b) => options.themes.indexOf(a.theme) - options.themes.indexOf(b.theme) || a.ratio - b.ratio)

  if (options.json) printJson(rows, summaries, options)
  else printReport(rows, summaries, options)

  const violations = rows.filter((row) => row.status === 'fail')
  process.exitCode = violations.length ? 1 : 0
}

// 被 test/ 里 import 时不能执行 CLI（否则单测会去开浏览器）。
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
  } catch (error) {
    return fa