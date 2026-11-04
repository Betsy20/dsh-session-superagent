// scripts/audit-contrast.mjs 的纯函数单测。
//
// 为什么单独测：对比度体检最怕「公式写错但看着像对」——0.9.187 那次一次性核对踩过的坑
// （color-mix() 解析不出来 → 背景算成纯白 → 比值虚高 0.7）就是公式没错、解析错了。
// 所以这里把三件事钉死：
//   ① WCAG 2.1 的公式本身（黑白 = 21、同色 = 1）；
//   ② 颜色解析（含 getComputedStyle 对 color-mix() 返回的 `color(srgb … / α)` 这种形状）；
//   ③ 阈值判定（正文 4.5 / 大字 3 / 非文字 3 / 禁用豁免）。
// 全是纯函数，不需要浏览器、不需要网络，CI 里能直接跑。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_THRESHOLDS,
  srgbChannelToLinear,
  relativeLuminance,
  contrastRatio,
  parseColorString,
  alphaOver,
  isLargeText,
  requiredRatio,
  judge,
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
