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
// 只有「真·不达标」进退出码（`blockingViolation`）：装饰性分隔线与被豁免的组合不算违规（见下面的豁免清单）。
//
// ── 判定口径（WCAG 2.1）──────────────────────────────────────────────
//   正文            ≥ 4.5:1   1.4.3
//   大字            ≥ 3:1     1.4.3；大字 = ≥24px（18pt）常规，或 ≥18.66px（14pt）且字重 ≥700
//   非文字（边框/控件状态面）≥ 3:1   1.4.11
//
// ── 豁免（仍然量、仍然列，只把判定标成「豁免」，退化一样看得见）──────────
//   ① 禁用控件：WCAG 1.4.3 明确豁免。
//   ② 装饰性分隔线：`kind === 'border' && control === false`。
//      1.4.11 管的是「控件的边界与状态面」，列表项之间那根 0.5px 分隔线不承载信息、也没有
//      「看不看得清」的读法。这类条目**永远不导致退出码 1**（`blockingViolation()` 也再挡一次，
//      不靠单个判断点），但仍然完整列在总表里，设计要不要加深是另一回事。
//   ③ 选中态靠「同元素文字换档」区分：填充 vs 页面底只有 1.06（浅）/ 1.09（深），但同一元素上
//      文字色从 #59636e（6.11）换成 #1f2328（14.84）、字重 400→500 —— 状态完全靠文字就能看出来，
//      填充差不构成唯一线索，按 1.4.11 罚这条是口径错位。
//      判据（见 EXEMPT_RULES，两个数都写在代码里）：同一元素的文字 ≥4.5，且
//      「选中文字对比度 / 未选中文字对比度」≥1.5。文字自己不够读、或两档文字几乎一样 → 不豁免。
//
//   这三条都是「放行口径」而不是「放宽阈值」：真问题（控件边框 1.36–1.92、caption 灰字 3.45）
//   一条都不碰，`test/audit-contrast.test.mjs` 里有反向用例钉住（该豁免的才豁免）。
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

// ── 豁免规则（判据全部落在代码里，不靠调阈值把报表抹平）──────────────────
//
// 为什么会需要「豁免」而不是「修样式」：这两类组合在数值上不达标，但在**读法**上没有问题 ——
// 量出来的比值为 1.06 的分隔线依旧是一条看得见的分隔线，为 1.06 的选中底依旧靠文字换档
// 表达选中。把它们计入退出码，CI 会永远红着，人就学会忽略这条命令 —— 那才是真正的安全损失。

/**
 * 豁免判据里的两个数字，每个都有出处：
 *
 * ① `selectionTextRatio = 4.5`
 *    选中态的文字必须**本身就够读**，否则「靠文字换档」这个理由不成立（文字才是问题）。
 *    取 max(4.5, 该元素字号对应的正文/大字档位)：4.5 是正文档，也是这条例外最弱的下限；
 *    大字档只有 3，低于 4.5，所以这里永远按 ≥4.5 卡 —— 比 WCAG 对该元素的要求更严，不会放过真问题。
 *
 * ② `selectionColorShift = 1.5`
 *    选中 vs 未选中的**文字对比度之比**。1.5 的依据：同一元素上换一档文字色，肉眼能分辨的
 *    最低幅度约是「一档色阶」；实测本面板是 #59636e(6.11) → #1f2328(14.84) = 2.43×，
 *    留一倍余量后取 1.5。比它低的组合（例如 7.00 vs 6.11 = 1.15×）文字几乎没变，
 *    读者看不出选中，仍按不达标处理。
 */
export const EXEMPT_RULES = Object.freeze({
  selectionTextRatio: 4.5,
  selectionColorShift: 1.5,
})

/** 豁免理由的短标签（表格「判定」列用，完整理由进 JSON 的 exempt 字段）。 */
export const EXEMPT_KIND_LABELS = Object.freeze({
  disabled: '禁用',
  boundary: '边界由描边给出',
  selection: '文字换档',
  decorative: '装饰边框',
})

/**
 * 豁免 ③：选中态由「同一元素的文字换档」给出时，状态填充与页面底的那点差不算缺陷。
 *
 * 入参 `sample` 是浏览器量出来的 surface 样本，需要带 `textShift = { selected, resting }`：
 *   selected = 该元素选中时，文字 vs 它自己的合成背景（含选中底）的比值；
 *   resting  = 同款但未选中的那个元素，文字 vs 它自己的背景的比值。
 * 缺任何一项都返回 ''（没有证据就不豁免 —— 不能拿「没量到」当「达标」）。
 *
 * 判据（两条同时满足）：
 *   · 选中文字本身够读：selected ≥ max(EXEMPT_RULES.selectionTextRatio, 该字号的 WCAG 档位)；
 *   · 换档幅度够大：selected / resting ≥ EXEMPT_RULES.selectionColorShift。
 *
 * @returns {string} 非空 = 豁免理由；'' = 不豁免。
 */
export function selectionExemption(sample, thresholds = DEFAULT_THRESHOLDS, rules = EXEMPT_RULES) {
  if (!sample || sample.kind !== 'surface') return ''
  const shift = sample.textShift
  if (!shift || typeof shift !== 'object') return ''
  const selected = Number(shift.selected)
  const resting = Number(shift.resting)
  if (!Number.isFinite(selected) || !Number.isFinite(resting) || resting <= 0) return ''
  // 文字阈值取「正文档」与 4.5 里更严的那个：大字档（3）低于 4.5，不会因此放松。
  const needText = Math.max(
    rules.selectionTextRatio,
    requiredRatio({ kind: 'text', fontSize: sample.fontSize, fontWeight: sample.fontWeight }, thresholds)
  )
  if (!(selected + 1e-9 >= needText)) return ''
  const colorShift = selected / resting
  if (!(colorShift + 1e-9 >= rules.selectionColorShift)) return ''
  return '选中态由同元素文字换档给出（选中文字 ' + selected.toFixed(2) + ':1 vs 未选中 ' + resting.toFixed(2)
    + ':1 = ' + colorShift.toFixed(2) + '×，文字本身已过 ≥' + needText + '；填充差不构成唯一状态线索）'
}

/**
 * 豁免 ②：装饰性分隔线（`kind === 'border'` 且 `control === false`）。
 *
 * 判据不是数字，是**类别**：1.4.11 只对「控件的边界/状态面」要求 3:1。列表项之间的
 * 0.5px 边框、卡片的浅描边、胶囊的描边都不承载信息 —— 看不清它，读者也不会少知道任何事。
 * 注意「包着表单控件的壳」被浏览器侧标成 `control: true`（`span.dt-input` 那种），
 * 那些**不走这条豁免**，仍然是硬要求。
 *
 * @returns {string} 非空 = 豁免理由；'' = 不豁免。
 */
export function decorativeBorderExemption(sample) {
  if (!sample || sample.kind !== 'border') return ''
  if (sample.control) return ''
  return '装饰性分隔线（不构成控件边界，WCAG 1.4.11 不适用；列出仅供设计参考，不计入退出码）'
}

/**
 * 这一组该不该算「真·不达标」。
 *
 * 判定与退出码共用它：装饰性分隔线**永远不阻断**，即使将来有人把 exemptions 改坏、
 * 让它重新拿到 `status === 'fail'`，退出码这一层仍然挡得住。这就是「类别 === 边框 的条目
 * 永不导致 exit 1」的落地位置 —— 单一判断点被绕过时还有第二道。
 */
export function blockingViolation(row) {
  if (!row || row.status !== 'fail') return false
  if (row.kind === 'border' && !row.control) return false
  return true
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

  // ── 豁免 ③ 的证据：选中态是不是「靠同一元素的文字换档」看出来的 ──────────
  // 三个小函数分开写，是为了让「找同款未选中控件」与「量文字」复用同一套算法：
  // 两处口径只要差一点，就会给出一个看着很像、其实是假的豁免。

  // 「状态态」：选中 / 按下 / 当前项。这条判据在两处用到（本元素的填充、以及找同款未选中项），
  // 所以抽成一个函数，别各写一份。
  function isStateful(el) {
    return el.getAttribute('aria-pressed') === 'true'
      || el.getAttribute('aria-selected') === 'true'
      || el.getAttribute('aria-checked') === 'true'
      || /^(page|true|step|location|date|time)$/.test(el.getAttribute('aria-current') || '')
  }

  // 一个元素的「文字 vs 它自己的合成背景」的比值。
  // backdrop 从元素自身开始收集，所以这个比值**含它自己的填充**（选中底就在里面）——
  // 与总表里那一行 text 样本是同一个数（14.84 就是这里算出来的），不是另算一套口径。
  function textRatioOf(el) {
    const style = getComputedStyle(el)
    const text = ownText(el)
    if (!text) return null
    const foreground = cssColor(style.color)
    if (!foreground) return null
    const back = backdrop(el, themed)
    if (back.hasImage) return null
    const background = drawStack(back.layers)
    const opacity = opacityOf(el, themed)
    const painted = alphaOver(background, {
      r: foreground.r,
      g: foreground.g,
      b: foreground.b,
      a: Math.min(1, foreground.a * opacity),
    })
    return { ratio: contrastRatio(background, painted), fg: toHex(painted), bg: toHex(background) }
  }

  // 同款的「未选中」控件：同标签 + 同 class 组合，且自身不在任何状态态、可见、有自己的文字。
  // 找不到就返回 null —— 「没找到对照」不等于「对照是 0」，宁可让 Node 侧不豁免。
  function restingTextOf(el, root) {
    const classes = (el.getAttribute('class') || '').split(/\s+/).filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
    if (!classes.length) return null
    const query = el.tagName.toLowerCase() + classes.map((name) => '.' + name).join('')
    let candidates = []
    try {
      candidates = Array.prototype.slice.call(root.querySelectorAll(query))
    } catch (error) {
      return null
    }
    for (const candidate of candidates) {
      if (candidate === el) continue
      if (isStateful(candidate)) continue
      if (candidate.closest && candidate.closest(SKIP)) continue
      const visible = typeof candidate.checkVisibility === 'function'
        ? candidate.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
        : candidate.getClientRects().length > 0
      if (!visible) continue
      const measured = textRatioOf(candidate)
      if (measured) return measured
    }
    return null
  }

  // 交还给 Node 侧的证据包：选中时的文字比值 + 同款未选中时的文字比值。
  function textShiftOf(el, root) {
    const selected = textRatioOf(el)
    if (!selected) return null
    const resting = restingTextOf(el, root)
    if (!resting) return null
    return { selected: selected.ratio, resting: resting.ratio }
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
        // 豁免的**种类**跟理由分开：理由是人读的（带数字），种类是给汇总与表格用的稳定标签。
        const exemptKind = disabled ? 'disabled' : ''
        const opacity = opacityOf(el, themed)
        // 是「控件」还是「装饰」：1.4.11 只对控件的边界/状态硬要求 3:1，
        // 纯分隔线（列表项之间的 0.5px 边框）属装饰，记下来供参考，别让人以为每根线都得改。
        // 「包着表单控件的壳」也算控件：搜索框的边框画在 `span.dt-input` 上，不是 <input> 自己身上。
        const control = /^(button|input|select|textarea|a)$/i.test(el.tagName)
          || ['button', 'tab', 'switch', 'checkbox', 'link', 'menuitem', 'option'].indexOf(el.getAttribute('role') || '') >= 0
          || Boolean(el.querySelector(':scope > input, :scope > textarea, :scope > select'))
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
          exemptKind,
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
        if (isStateful(el)) {
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
              // 豁免 ③ 的证据：同一元素选中时的文字比值、同款未选中时的文字比值。
              // 判不判豁免在 Node 侧（parse 不到就宁可不豁免），这里只负责把两个数带回去。
              const textShift = textShiftOf(el, scope.root)
              result.samples.push(Object.assign({}, shared, {
                kind: 'surface',
                fg: toHex(painted),
                bg: toHex(background),
                ratio,
                exempt: exempt || boundaryExempt,
                exemptKind: exemptKind || (boundaryExempt ? 'boundary' : ''),
                textShift,
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

/**
 * 一个样本该不该豁免、凭什么豁免。
 *
 * 优先级是有意这样排的：浏览器已经判好的（禁用控件 / 边界由边框·描边给出）**先返回**，
 * 不让后面的规则去改写它的理由 —— 否则「禁用控件」会被写成「装饰边框」，
 * 排查的人就找不到真正的原因了。
 */
function exemptionFor(sample, thresholds) {
  if (sample.exempt) return { kind: sample.exemptKind || 'declared', reason: sample.exempt }
  const selection = selectionExemption(sample, thresholds)
  if (selection) return { kind: 'selection', reason: selection }
  const decorative = decorativeBorderExemption(sample)
  if (decorative) return { kind: 'decorative', reason: decorative }
  return null
}

/** 同选择器 + 同颜色 + 同字号的样本合并成一行，节点数累加，页面去重。 */
export function aggregate(themeKey, samples, thresholds = DEFAULT_THRESHOLDS) {
  const groups = new Map()
  for (const sample of samples) {
    const exemption = exemptionFor(sample, thresholds)
    const key = [
      sample.kind, sample.selector, sample.fg, sample.bg,
      sample.fontSize + '/' + sample.fontWeight, exemption ? exemption.kind : '0', sample.control ? '1' : '0',
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
        exempt: exemption ? exemption.reason : '',
        exemptKind: exemption ? exemption.kind : '',
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
  // 「不达标」= 真·不达标（blockingViolation）。装饰性分隔线已经被判成豁免；这里再按同一判据
  // 过一遍，保证「类别 === 边框」的条目无论判定从哪来都进不了这个数（也不进退出码）。
  const failGroups = rows.filter(blockingViolation)
  const failControlGroups = failGroups.filter((row) => row.kind === 'surface' || (row.kind === 'border' && row.control))
  const failTextGroups = failGroups.filter((row) => row.kind === 'text')
  const exemptCounts = { disabled: 0, boundary: 0, selection: 0, decorative: 0, declared: 0 }
  for (const row of rows) {
    if (row.status !== 'exempt') continue
    const kind = Object.prototype.hasOwnProperty.call(exemptCounts, row.exemptKind) ? row.exemptKind : 'declared'
    exemptCounts[kind] += 1
  }
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
    failTextGroups: failTextGroups.length,
    exemptCounts,
    exemptGroups: rows.filter((row) => row.status === 'exempt').length,
    worst: worst ? { ratio: worst.ratio, selector: worst.selector, status: worst.status } : null,
    worstEnforced: worstEnforced ? { ratio: worstEnforced.ratio, selector: worstEnforced.selector } : null,
  }
}

function formatRatio(value) {
  return Number(value).toFixed(2)
}

function statusLabel(row) {
  if (row.status === 'exempt') {
    // 表格是窄列，豁免只打短标签；完整理由（带数字）在 --json 的 exempt 字段里。
    const tag = EXEMPT_KIND_LABELS[row.exemptKind]
    return tag ? '豁免 · ' + tag : '豁免'
  }
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
  console.log('类别：「控件边框」「控件面」是 1.4.11 的硬要求；「边框」是装饰性分隔线 —— 只列出、不计入退出码。')
  console.log('豁免（列在总表里、仍标比值，只是不判不达标）：禁用控件 / 装饰性分隔线 / 选中态靠同元素文字换档（文字 ≥4.5 且换档 ≥1.5×）。')
  console.log('')
  for (const summary of summaries) {
    const worst = summary.worst ? formatRatio(summary.worst.ratio) + ' ' + summary.worst.selector + (summary.worst.status === 'exempt' ? '（豁免）' : '') : '-'
    const exemptDetail = [
      ['禁用', summary.exemptCounts.disabled],
      ['选中态换档', summary.exemptCounts.selection],
      ['装饰边框', summary.exemptCounts.decorative],
      ['边界由描边', summary.exemptCounts.boundary],
      ['其它', summary.exemptCounts.declared],
    ].filter((entry) => entry[1] > 0).map((entry) => entry[0] + ' ' + entry[1]).join(' / ')
    console.log('· ' + summary.theme + '：' + summary.nodes + ' 个节点 / ' + summary.groups + ' 组 ｜ 不达标 '
      + summary.failGroups + ' 组 ' + summary.failNodes + ' 节点（控件边框/状态面 ' + summary.failControlGroups
      + ' / 文字 ' + summary.failTextGroups + '）｜ 豁免 ' + summary.exemptGroups + ' 组'
      + (exemptDetail ? '（' + exemptDetail + '）' : '') + ' ｜ 最低 ' + worst)
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
  // 与退出码同一判据：装饰性分隔线即使拿到 fail 也不算违规（blockingViolation 里也是这条规则）。
  const violations = rows.filter(blockingViolation)
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
      control: row.control,
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
      control: row.control,
      selector: row.selector,
      ratio: Number(row.ratio.toFixed(4)),
      need: row.need,
      status: row.status,
      exempt: row.exempt || null,
      exemptKind: row.exemptKind || null,
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

  // 退出码只由「够得着真问题」的组决定：装饰性分隔线永远不阻断（`blockingViolation` 单点定义），
  // 但仍然完整打印在总表里。
  const violations = rows.filter(blockingViolation)
  process.exitCode = violations.length ? 1 : 0
}

// 被 test/ 里 import 时不能执行 CLI（否则单测会去开浏览器）。
const invokedDirectly = (() => {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
  } catch (error) {
    return false
  }
})()

if (invokedDirectly) {
  // `| head -30` 会提前关掉管道；别让 EPIPE 变成一段红色堆栈把 JSON 淹了。
  process.stdout.on('error', (error) => {
    if (error && error.code === 'EPIPE') process.exit(process.exitCode || 0)
  })
  main()
}
