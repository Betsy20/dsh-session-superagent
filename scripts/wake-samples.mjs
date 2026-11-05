// 「真实唤醒消息」样本集：审核 T31 指出 `audit-line-length.mjs` 只量 first-run 的短标题
// （最长 108 字符 → PASS），而真实唤醒消息里有 175 / 156 / 162 / 492 字符的行，一个都测不到。
//
// 这个脚本用**真实的纯函数**造出 6 种典型场景的消息（与 pollWithItems 传参一致），
// 供 `audit-line-length.mjs` 与人工自查共用。
//
// 用法：
//   node scripts/wake-samples.mjs          # 打印所有样本
//   node scripts/wake-samples.mjs --stats  # 只打印每条的统计（行数 / 字符 / 最长行）
import { wakeCriteria } from '../lib/watch.js'
import { formatWatchText, mergeWakeTexts, accessNote } from '../lib/watch.js'

const item = (n, extra = {}) => ({
  number: n,
  title: '第 ' + n + ' 条：修登录流程里的空指针',
  state: 'open',
  html_url: 'https://github.com/acme/widgets/issues/' + n,
  user: { login: 'octocat' },
  labels: [{ name: 'bug' }, { name: 'P1' }],
  comments: 3,
  updated_at: '2026-11-05T08:00:00Z',
  ...extra,
})

const base = (fresh, options = {}) => ({
  repo: 'acme/widgets',
  fresh,
  options: {
    more: 0,
    batchLimit: 5,
    changedTotal: fresh.length,
    goal: null,
    identityBound: true,
    access: accessNote({ canPush: true, hasIssues: true }),
    criteria: wakeCriteria({}),
    skippedReasons: null,
    ...options,
  },
})

const longTitle = '【超长标题】' + '修复登录流程中的空指针异常并补上一段很长的说明文字'.repeat(6)
const longGoal = '这个仓库的目标是：' + '把所有 P1 级别的 bug 在 24 小时内修完并且补测试和文档'.repeat(3)

export const SAMPLES = [
  { name: '① 1 条 issue', spec: base([item(51)]) },
  {
    name: '② 7 条（超过 batchLimit=5）',
    spec: base([1, 2, 3, 4, 5].map((n) => item(n)), { more: 2, changedTotal: 7 }),
  },
  { name: '③ 带客户目标', spec: base([item(52)], { goal: '只修 P0/P1，其余不碰' }) },
  {
    name: '④ PR + CI 状态',
    spec: base([item(53, { pull_request: { draft: false }, statusCheckRollup: { state: 'FAILURE' }, mergeable: 'CONFLICTING' })]),
  },
  {
    name: '⑤ 带跳过原因',
    spec: base([item(54)], { skippedReasons: { '已关闭': 3, '已 ack': 2, '不在标签内': 1 }, changedTotal: 6 }),
  },
  { name: '⑥ 150 字标题 + 长目标', spec: base([item(55, { title: longTitle })], { goal: longGoal }) },
]

export function buildSamples() {
  return SAMPLES.map(({ name, spec }) => ({
    name,
    text: formatWatchText(spec.repo, spec.fresh, spec.options),
  }))
}

/** 合并场景单独造：两个守各一条，验证「接下来」还在（审核 T31 M2）。 */
export function buildMerged() {
  const a = formatWatchText('acme/widgets', [item(61)], { batchLimit: 5, changedTotal: 1, criteria: wakeCriteria({}) })
  const b = formatWatchText('acme/other', [item(62)], { batchLimit: 5, changedTotal: 1, criteria: wakeCriteria({}) })
  return { name: '⑦ 合并两个守', text: mergeWakeTexts([a, b]) }
}

const stat = (text) => {
  const lines = text.split(String.fromCharCode(10))
  const longest = lines.reduce((max, line) => Math.max(max, [...line].length), 0)
  return { lines: lines.length, chars: [...text].length, longest }
}

if (process.argv[1] && process.argv[1].endsWith('wake-samples.mjs')) {
  const all = [...buildSamples(), buildMerged()]
  if (process.argv.includes('--stats')) {
    for (const { name, text } of all) {
      const s = stat(text)
      console.log(name.padEnd(24) + s.lines + ' 行 / ' + s.chars + ' 字符 / 最长 ' + s.longest)
    }
  } else {
    for (const { name, text } of all) {
      console.log('='.repeat(60))
      console.log(name)
      console.log('='.repeat(60))
      console.log(text)
      console.log('')
    }
  }
}
