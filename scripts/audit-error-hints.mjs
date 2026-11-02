// 错误建议体检：每条 hint 都要**短**且**能做**。
//
// 为什么机械检查：文案会随版本漂移，靠肉眼盯不住 ——
// 0.9.62 就出现过"兜底 hint 为空"，0.9.63 又出现过"建议被截断"。
//
// 判据（写死）：
//   ① 长度 ≤ 60 字符（面板窄，超过就折三行）；
//   ② 必须含一个可执行动作（跑 / 填 / 等 / 检查 / 确认 / 换），
//      或者明确说"不需要手动处理"（那也是动作：什么都不用做）。
//
// 用法：node scripts/audit-error-hints.mjs
import { classifyGhError } from '../lib/gh-format.js'

const LIMIT = 60
const ACTIONS = ['跑', '填', '等', '检查', '确认', '换', '不需要手动处理', '贴给']

const SAMPLES = [
  ['auth', 'HTTP 401: Bad credentials'],
  ['ratelimit', 'HTTP 403: API rate limit exceeded'],
  ['gateway', 'HTTP 502: Bad Gateway'],
  ['nogh', 'gh: command not found'],
  ['notfound', 'HTTP 404: Not Found'],
  ['network', 'Get "https://api.github.com/x": EOF'],
  ['other', 'something totally unexpected'],
]

let failed = false
const seen = new Set()

console.log('检查 ' + SAMPLES.length + ' 类错误的建议文案（上限 ' + LIMIT + ' 字符）')
console.log('---')
for (const [want, sample] of SAMPLES) {
  const got = classifyGhError(sample)
  const hint = String(got.hint || '').replace(/^（/, '').replace(/）$/, '')
  const length = [...hint].length
  const action = ACTIONS.find((word) => hint.includes(word))
  const kindOk = got.kind === want
  const ok = length > 0 && length <= LIMIT && Boolean(action) && kindOk
  if (!ok) failed = true
  seen.add(got.kind)
  console.log((ok ? 'PASS ' : 'FAIL ') + got.kind.padEnd(10)
    + length + ' 字符　动作=' + (action || '（无）')
    + (kindOk ? '' : '　分类不符（期望 ' + want + '）'))
  if (!ok) console.log('      ' + hint)
}

console.log('---')
if (seen.size < 6) {
  failed = true
  console.log('FAIL 只覆盖了 ' + seen.size + ' 类，至少要有 6 类')
} else {
  console.log('PASS 覆盖 ' + seen.size + ' 类错误')
}
if (failed) process.exitCode = 1
