// scripts/audit-contrast.mjs 的纯函数单测。
//
// 为什么单独测：对比度体检最怕「公式写错但看着像对」——0.9.187 那次一次性核对踩过的坑
// （color-mix() 解析不出来 → 背景算成纯白 → 比值虚高 0.7）就是公式没错、解析错了。
// 所以这里把三件事钉死：
//   ① WCAG 2.1 的公式本身（黑白 = 21、同色 = 1）；
//   ② 颜色解析（含 getComputedStyle 对 color-mix() 返回的 `color(srgb … / α)` 这种形状）；
//   ③ 阈值判定（正文 4.5 / 大字 3 / 非文字 3 / 禁用豁免）；
//   ④ 豁免规则（装饰性分隔线 / 选中态文字换档）—— 每一条都配一个「不该豁免」的反向用例。
// 全是纯函数，不需要浏览器、不需要网络，CI 里能直接跑。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_THRESHOLDS,
  EXEMPT_RULES,
  srgbChannelToLinear,
  relativeLuminance,
  contrastRatio,
  parseColorString,
  alphaOver,
  isLargeText,
  requiredRatio,
  judge,
  selectionExemption,
  decorativeBorderExemption,
  blockingViolation,
  aggregate,
  toHex,
} from '../scripts/audit-contrast.mjs'

const BLACK = { r: 0, g: 0, b: 0, a: 1 }
const WHITE = { r: 255, g: 255, b: 255, a: 1 }
const near = (actual, expected, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, '期望 ' + expected + ' ± ' + tolerance + '，实际 ' + actual)

// ── ① WCAG 2.1 公式 ────────────────────────────────────────────────

test('黑白对比度 = 21（WCAG 2.1 的锚点）', () => {
  near(contrastRatio(WHITE, BLACK), 21, 1e-9)
  // 顺序无关：L1 永远是比较亮的那一方
  near(contrastRatio(BLACK, WHITE), 21, 1e-9)
})

test('同色对比度 = 1（白对白、黑对黑、任意色对自身）', () => {
  near(contrastRatio(WHITE, WHITE), 1, 1e-9)
  near(contrastRatio(BLACK, BLACK), 1, 1e-9)
  const gray = { r: 129, g: 139, b: 152, a: 1 }
  near(contrastRatio(gray, gray), 1, 1e-9)
})

test('相对亮度：白 = 1、黑 = 0、中线灰约 0.214', () => {
  near(relativeLuminance(WHITE), 1, 1e-9)
  near(relativeLuminance(BLACK), 0, 1e-9)
  // #808080 的 sRGB 0.5 线性化后是 0.2158，L = 0.2158（三通道同值）
  near(relativeLuminance({ r: 128, g: 128, b: 128, a: 1 }), 0.2158, 0.001)
})

test('sRGB 线性化在 0.04045 处换挡（小值走 /12.92 而不是幂函数）', () => {
  near(srgbChannelToLinear(0.04045), 0.04045 / 12.92, 1e-12)
  near(srgbChannelToLinear(1), 1, 1e-12)
  near(srgbChannelToLinear(0), 0, 1e-12)
})

test('公式对真实色对给出的值与 WCAG 工具一致（#767676 on #fff ≈ 4.54）', () => {
  // 这是 WCAG 圈里常用的「刚好过 4.5」的灰：说明公式不是自造的
  near(contrastRatio({ r: 0x76, g: 0x76, b: 0x76, a: 1 }, WHITE), 4.54, 0.01)
})

// ── ② 颜色解析 ─────────────────────────────────────────────────────

test('hex：3/4/6/8 位都能解，alpha 按 /255 归一', () => {
  assert.deepEqual(parseColorString('#f00'), { r: 255, g: 0, b: 0, a: 1 })
  assert.deepEqual(parseColorString('#0f08'), { r: 0, g: 255, b: 0, a: 136 / 255 })
  assert.deepEqual(parseColorString('#818b98'), { r: 129, g: 139, b: 152, a: 1 })
  assert.deepEqual(parseColorString('#96C70080'), { r: 150, g: 199, b: 0, a: 128 / 255 })
  assert.equal(parseColorString('#ggg'), null)
  assert.equal(parseColorString('#12345'), null)
})

test('rgb()/rgba()：旧逗号语法与新空格/斜杠语法都给同一个结果', () => {
  const expected = { r: 154, g: 103, b: 0, a: 1 }
  assert.deepEqual(parseColorString('rgb(154, 103, 0)'), expected)
  assert.deepEqual(parseColorString('rgba(154, 103, 0, 1)'), expected)
  assert.deepEqual(parseColorString('rgb(154 103 0)'), expected)
  assert.deepEqual(parseColorString('rgb(154 103 0 / 1)'), expected)
  // 百分比通道 + 百分比 alpha
  assert.deepEqual(parseColorString('rgba(100%, 0%, 0%, 50%)'), { r: 255, g: 0, b: 0, a: 0.5 })
  near(parseColorString('rgba(0, 0, 0, 0.35)').a, 0.35, 1e-9)
})

test('color(srgb …) 能解 —— 这正是 getComputedStyle 对 color-mix() 返回的形状（坑①）', () => {
  // 上一轮用 /^rgba?\(/ 正则解析，碰到这种串直接失败 → 被当成透明 → 胶囊底算成纯白 → 比值虚高。
  assert.deepEqual(parseColorString('color(srgb 0.603922 0.403922 0 / 0.12)'), { r: 154, g: 103, b: 0, a: 0.12 })
  assert.deepEqual(parseColorString('color(srgb 0 0 0)'), BLACK)
  assert.deepEqual(parseColorString('color(srgb 1 1 1 / 50%)'), { r: 255, g: 255, b: 255, a: 0.5 })
})

test('关键字与透明：transparent 是「全透明黑」而不是「没颜色」', () => {
  assert.deepEqual(parseColorString('transparent'), { r: 0, g: 0, b: 0, a: 0 })
  assert.deepEqual(parseColorString('WHITE'), WHITE)
  assert.deepEqual(parseColorString('green'), { r: 0, g: 128, b: 0, a: 1 })
  assert.equal(parseColorString('currentcolor'), null)
})

test('解析不了就返回 null —— 不许猜', () => {
  for (const input of ['', '   ', 'oklab(0.5 0.1 0.1 / 0.2)', 'not-a-color', null, undefined, 42]) {
    assert.equal(parseColorString(input), null, '不该解析：' + String(input))
  }
})

// ── 合成（source-over）─────────────────────────────────────────────

test('alphaOver：半透明黑盖白 ≈ 中点灰，全透明不改底色', () => {
  const half = alphaOver(WHITE, { r: 0, g: 0, b: 0, a: 0.5 })
  assert.deepEqual(half, { r: 128, g: 128, b: 128, a: 1 })
  assert.deepEqual(alphaOver(WHITE, { r: 255, g: 0, b: 0, a: 0 }), WHITE)
  assert.deepEqual(alphaOver(BLACK, WHITE), WHITE)
})

test('坑①的端到端复现：琥珀 12% 底色合成出来必须是 #f3ede0，比值 ≈ 4.17（不是 4.87）', () => {
  // 上一轮的正则解析把这一层当透明，于是背景算成 #ffffff，得出 4.87 的假结论。
  const amber = parseColorString('#9a6700')
  const layer = parseColorString('color(srgb 0.603922 0.403922 0 / 0.12)')
  const tagBackground = alphaOver(WHITE, layer)
  assert.equal(toHex(tagBackground), '#f3ede0')
  near(contrastRatio(amber, tagBackground), 4.17, 0.01)
  // 对照：如果错误地当透明，就会算出 4.87 —— 差 0.7，足够把「不达标」判成「通过」
  near(contrastRatio(amber, WHITE), 4.87, 0.01)
})

// ── ③ 阈值判定 ─────────────────────────────────────────────────────

test('大字：≥24px 常规，或 ≥18.66px 且字重 ≥700', () => {
  assert.equal(isLargeText(28, 700), true)
  assert.equal(isLargeText(24, 400), true)
  assert.equal(isLargeText(18.66, 700), true)
  assert.equal(isLargeText(18.66, 400), false)
  assert.equal(isLargeText(18, 700), false) // 18px 差 0.66，不算大字
  assert.equal(isLargeText(14, 500), false)
  assert.equal(isLargeText(0, 700), false)
})

test('requiredRatio：正文 4.5 / 大字 3 / 边框与控件面 3', () => {
  assert.equal(requiredRatio({ kind: 'text', fontSize: 14, fontWeight: 400 }), DEFAULT_THRESHOLDS.text)
  assert.equal(requiredRatio({ kind: 'text', fontSize: 28, fontWeight: 700 }), DEFAULT_THRESHOLDS.largeText)
  assert.equal(requiredRatio({ kind: 'border' }), DEFAULT_THRESHOLDS.nonText)
  assert.equal(requiredRatio({ kind: 'surface' }), DEFAULT_THRESHOLDS.nonText)
  // 阈值可覆盖
  assert.equal(requiredRatio({ kind: 'text', fontSize: 14 }, { text: 7, largeText: 4.5, nonText: 3 }), 7)
})

test('judge：刚好 4.5 算过，4.49 算不过；大字按 3 判', () => {
  assert.deepEqual(judge({ kind: 'text', fontSize: 14, fontWeight: 400, ratio: 4.5 }), { need: 4.5, status: 'pass' })
  assert.deepEqual(judge({ kind: 'text', fontSize: 14, fontWeight: 400, ratio: 4.49 }), { need: 4.5, status: 'fail' })
  assert.deepEqual(judge({ kind: 'text', fontSize: 28, fontWeight: 700, ratio: 3 }), { need: 3, status: 'pass' })
  assert.deepEqual(judge({ kind: 'text', fontSize: 28, fontWeight: 700, ratio: 2.99 }), { need: 3, status: 'fail' })
  assert.deepEqual(judge({ kind: 'border', ratio: 3 }), { need: 3, status: 'pass' })
  assert.deepEqual(judge({ kind: 'border', ratio: 1.36 }), { need: 3, status: 'fail' })
  assert.deepEqual(judge({ kind: 'surface', ratio: 1.06 }), { need: 3, status: 'fail' })
})

test('judge：禁用控件豁免（但仍然会被量、被列出来）', () => {
  const disabled = { kind: 'text', fontSize: 12, fontWeight: 400, ratio: 1.81, exempt: '禁用控件（WCAG 1.4.3 豁免）' }
  assert.deepEqual(judge(disabled), { need: 4.5, status: 'exempt' })
})

test('judge：拿不到比值（NaN）一律算不过，不许静默通过', () => {
  assert.equal(judge({ kind: 'text', fontSize: 14, fontWeight: 400, ratio: NaN }).status, 'fail')
  assert.equal(judge({ kind: 'text', fontSize: 14, fontWeight: 400 }).status, 'fail')
})

test('toHex：补零、取整、钳位', () => {
  assert.equal(toHex({ r: 0, g: 0, b: 0 }), '#000000')
  assert.equal(toHex({ r: 255, g: 255, b: 255 }), '#ffffff')
  assert.equal(toHex({ r: 1, g: 15, b: 16 }), '#010f10')
  assert.equal(toHex({ r: -5, g: 300, b: 128.4 }), '#00ff80')
})

// ── ④ 豁免规则 ─────────────────────────────────────────────────────
//
// 这一节的写法是刻意的：每条豁免都配一个「长得几乎一样、但不该豁免」的用例。
// 豁免规则最危险的失败形态不是「没生效」，而是「生效得太宽」—— 那会让真问题静默消失。

/** 造一个最小的 surface 样本（= 选中态的填充），字段与浏览器量出来的形状一致。 */
const surfaceSample = (ratio, textShift, extra = {}) => Object.assign({
  kind: 'surface',
  selector: 'button.dt-settings-link[type="button"][aria-current="page"]',
  fontSize: 13,
  fontWeight: 500,
  control: true,
  exempt: '',
  exemptKind: '',
  fg: '#f6f8fa',
  bg: '#ffffff',
  ratio,
  page: '设置（来源）',
  textShift,
}, extra)

test('豁免③：选中态靠同元素文字换档（14.84 vs 6.11 = 2.43×）时，1.06 的填充差不计', () => {
  // 浅色实测：填充 #f6f8fa 对白底 1.06；同一元素文字 #1f2328 14.84；未选中 #59636e 6.11。
  const light = selectionExemption(surfaceSample(1.06, { selected: 14.84, resting: 6.11 }))
  assert.ok(light.includes('14.84') && light.includes('6.11'), '理由要带上两个实测值：' + light)
  assert.ok(light.includes('2.43'), '理由要带上换档倍数：' + light)
  // 深色实测：填充 1.09，文字 14.64 vs 8.98 = 1.63×，同样成立。
  const dark = selectionExemption(surfaceSample(1.09, { selected: 14.64, resting: 8.98 }))
  assert.ok(dark.includes('1.63'), '深色那组也要成立：' + dark)
})

test('豁免③反向：文字几乎没换档（<1.5×）就不豁免 —— 读者看不出选中', () => {
  // 7.00 vs 6.11 = 1.15×：填充差 1.06 依旧没有任何别的线索，必须继续报红。
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 7.0, resting: 6.11 })), '')
  // 9.00 vs 6.11 = 1.47×：差一点点，仍然不放过（阈值是硬的，不是「差不多就行」）。
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 9.0, resting: 6.11 })), '')
  // 9.20 vs 6.11 = 1.51×：过线。这条证明上一行不是「永远返回空」的假测试。
  assert.notEqual(selectionExemption(surfaceSample(1.06, { selected: 9.2, resting: 6.11 })), '')
  // 阈值本身要能在常量上读到，别藏进 if 里
  assert.equal(EXEMPT_RULES.selectionColorShift, 1.5)
  assert.equal(EXEMPT_RULES.selectionTextRatio, 4.5)
})

test('豁免③反向：文字自己不到 4.5 就不豁免 —— 该判「文字不够读」而不是「靠文字区分」', () => {
  // 换档很大（4.20 vs 1.20 = 3.5×），但选中态文字只有 4.20 < 4.5：文字才是问题，不能放行。
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 4.2, resting: 1.2 })), '')
  // 恰好 4.50 算过（与 judge 的边界口径一致）
  assert.notEqual(selectionExemption(surfaceSample(1.06, { selected: 4.5, resting: 2.0 })), '')
})

test('豁免③反向：没有对照或对照为 0 一律不豁免 —— 「没量到」不等于「达标」', () => {
  assert.equal(selectionExemption(surfaceSample(1.06, null)), '')
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 14.84 })), '')
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 14.84, resting: 0 })), '')
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: NaN, resting: 6.11 })), '')
  // 规则只对 surface 生效：同一条文字（kind=text）不适用
  const text = { kind: 'text', fontSize: 13, fontWeight: 400, ratio: 4.2, textShift: { selected: 14.84, resting: 6.11 } }
  assert.equal(selectionExemption(text), '')
})

test('豁免②：装饰性分隔线豁免、永不进退出码；控件边框与文字照旧报红', () => {
  const decorative = { kind: 'border', control: false, ratio: 1.36 }
  assert.notEqual(decorativeBorderExemption(decorative), '')
  // 「包着表单控件的壳」（control: true，例如 span.dt-input）不走这条豁免 —— 那正是真问题。
  assert.equal(decorativeBorderExemption({ kind: 'border', control: true, ratio: 1.36 }), '')
  // 文字与控件面也不吃这条豁免。
  assert.equal(decorativeBorderExemption({ kind: 'text', control: false, ratio: 3.45 }), '')
  assert.equal(decorativeBorderExemption({ kind: 'surface', control: true, ratio: 1.06 }), '')
  // 退出码判据（单点定义，判定与退出码共用）。第二行是防御性的：即使判定被改坏成 fail，
  // 装饰线也不许把退出码变成 1。
  assert.equal(blockingViolation({ kind: 'border', control: false, status: 'fail', ratio: 1.36 }), false)
  assert.equal(blockingViolation({ kind: 'border', control: true, status: 'fail', ratio: 1.36 }), true)
  assert.equal(blockingViolation({ kind: 'text', control: false, status: 'fail', ratio: 3.45 }), true)
  assert.equal(blockingViolation({ kind: 'surface', control: true, status: 'fail', ratio: 1.06 }), true)
  assert.equal(blockingViolation({ kind: 'border', control: false, status: 'pass', ratio: 3.6 }), false)
})

test('端到端：豁免之后真问题一条都不漏，禁用豁免仍然生效', () => {
  const samples = [
    // 选中态：填充 1.06 靠文字换档豁免
    surfaceSample(1.06, { selected: 14.84, resting: 6.11 }),
    // 同款未选中的文字 6.11：通过
    {
      kind: 'text', selector: 'button.dt-settings-link[type="button"]', fontSize: 13, fontWeight: 400,
      control: true, exempt: '', exemptKind: '', fg: '#59636e', bg: '#ffffff', ratio: 6.11, page: '设置（来源）',
    },
    // 真问题：控件边框 1.36（必须留下）
    {
      kind: 'border', selector: 'button.dt-btn.dt-btn-ghost', fontSize: 14, fontWeight: 400,
      control: true, exempt: '', exemptKind: '', fg: '#ffffff', bg: '#d8dee4', ratio: 1.36, page: '总览',
    },
    // 装饰线 1.36（豁免，但仍然在表里）
    {
      kind: 'border', selector: 'div.dt-tabs[role="tablist"]', fontSize: 14, fontWeight: 400,
      control: false, exempt: '', exemptKind: '', fg: '#ffffff', bg: '#d8dee4', ratio: 1.36, page: '总览',
    },
    // 真问题：caption 灰字 3.45（必须留下）
    {
      kind: 'text', selector: 'span.dt-count', fontSize: 14, fontWeight: 400,
      control: false, exempt: '', exemptKind: '', fg: '#818b98', bg: '#ffffff', ratio: 3.45, page: '总览',
    },
    // 禁用控件：原有豁免必须仍然生效，且理由不被新规则改写
    {
      kind: 'text', selector: 'button.dt-btn[disabled]', fontSize: 12, fontWeight: 400,
      control: true, exempt: '禁用控件（WCAG 1.4.3 豁免）', exemptKind: 'disabled',
      fg: '#bdc1c5', bg: '#ffffff', ratio: 1.81, page: '暂停态',
    },
  ]
  const rows = aggregate('light', samples)
  const row = (selector) => rows.find((item) => item.selector === selector)

  assert.equal(row('button.dt-settings-link[type="button"][aria-current="page"]').status, 'exempt')
  assert.equal(row('button.dt-settings-link[type="button"][aria-current="page"]').exemptKind, 'selection')
  assert.equal(row('div.dt-tabs[role="tablist"]').status, 'exempt')
  assert.equal(row('div.dt-tabs[role="tablist"]').exemptKind, 'decorative')
  assert.equal(row('button.dt-btn[disabled]').status, 'exempt')
  assert.equal(row('button.dt-btn[disabled]').exemptKind, 'disabled')
  assert.equal(row('button.dt-btn[disabled]').exempt, '禁用控件（WCAG 1.4.3 豁免）')
  assert.equal(row('span.dt-count').status, 'fail')
  assert.equal(row('button.dt-btn.dt-btn-ghost').status, 'fail')
  // 豁免不是「删掉」：六组一个不少地留在表里
  assert.equal(rows.length, 6)
  // 进退出码的只有两个真问题
  assert.deepEqual(
    rows.filter(blockingViolation).map((item) => item.selector).sort(),
    ['button.dt-btn.dt-btn-ghost', 'span.dt-count']
  )
})

test('豁免③：--text 调严时跟着变严（4.5~7 之间的选中文字不再算「够读」）', () => {
  const strict = { text: 7, largeText: 4.5, nonText: 3 }
  // 默认口径下 6.11 够读
  assert.notEqual(selectionExemption(surfaceSample(1.06, { selected: 6.11, resting: 2.0 })), '')
  // 调成 7 之后就不够读了 —— 说明预算里没有偷偷写死 4.5
  assert.equal(selectionExemption(surfaceSample(1.06, { selected: 6.11, resting: 2.0 }), strict), '')
  assert.equal(requiredRatio({ kind: 'text', fontSize: 13, fontWeight: 400 }, strict), 7)
})

// ── 上一轮报告里的数字：拿它的结论当回归锚点 ───────────────────────

test('回归锚点：旧报告的总表数字能被这套公式复现（口径没跑偏）', () => {
  const pairs = [
    // [前景, 背景, 旧报告里的比值, 说明]
    ['#818b98', '#ffffff', 3.45, 'label-caption on bg-base'],
    ['#818b98', '#f6f8fa', 3.24, 'label-caption on bg-layer-2'],
    ['#818b98', '#f3f4f6', 3.14, 'label-caption on interactive-bg-hover'],
    ['#6e7781', '#ffffff', 4.55, 'label-tertiary on bg-base（擦边通过）'],
    ['#59636e', '#ffffff', 6.11, 'label-secondary on bg-base'],
    ['#c6cdd5', '#ffffff', 1.60, 'border-l4 on bg-base'],
    ['#d8dee4', '#ffffff', 1.36, 'border-l3 on bg-base'],
    ['#cf222e', '#fae8ea', 4.54, 'danger 胶囊'],
    ['#1a7f37', '#e8f2eb', 4.43, 'success 胶囊（同色底把文字吃掉）'],
  ]
  for (const [fg, bg, expected, label] of pairs) {
    near(contrastRatio(parseColorString(fg), parseColorString(bg)), expected, 0.011, label)
  }
})
