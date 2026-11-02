// 首次使用演练（不需要宿主、不需要 gh）：把「添加一条守 → 轮询 → 唤醒消息长什么样」
// 用真实的纯函数完整跑一遍，并把结果打印出来。
//
// 为什么要有它：
//   1. 客户/同事不必先装 DSH 才能看到产品实际产出；
//   2. 我每次改文案时，这是第一道自查 —— 改完跑一遍，读一遍客户会读到什么；
//   3. 它只依赖 lib/watch.js 的纯函数，所以在 CI 里也能跑。
//
// 用法：node scripts/first-run.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyGhError } from '../lib/gh-format.js'
import {
  accessNote,
  batchFresh,
  decideWake,
  formatWatchText,
  hasAckLabel,
  normalizeFilters,
  partitionItems,
  pickSuggestion,
  repoBadges,
  repoStructureNote,
  summarizeByRepo,
} from '../lib/watch.js'

const REPO = 'acme/widgets'
const NOW = Date.UTC(2026, 10, 2, 10, 0, 0)
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString()

const items = [
  {
    number: 42, title: '登录页在 Safari 上白屏', state: 'open', html_url: 'https://github.com/' + REPO + '/issues/42',
    user: { login: 'customer-a' }, labels: [{ name: 'bug' }], assignees: [], comments: 3,
    updated_at: iso(12), body: '复现步骤：1) 打开 Safari 2) 点登录',
  },
  {
    number: 43, title: '希望支持导出 CSV', state: 'open', html_url: 'https://github.com/' + REPO + '/issues/43',
    user: { login: 'customer-b' }, labels: [{ name: 'enhancement' }], assignees: [], comments: 0,
    updated_at: iso(40), body: '我们每周要导一次报表',
  },
  {
    number: 77, title: '修复表头错位', state: 'open', html_url: 'https://github.com/' + REPO + '/pull/77',
    user: { login: 'contributor' }, labels: [], assignees: [], comments: 1,
    updated_at: iso(90), body: '这个 PR 修了表头', pull_request: { url: 'x' },
  },
]

const watcher = { id: REPO + '#session-demo', repo: REPO, sessionId: 'session-demo', seen: {}, lastReported: {}, wakeTimes: [] }
const out = []
const say = (line = '') => out.push(line)

say('===== 1. 轮询：从 3 条动态里挑出该唤醒的 =====')
const { fresh, absorbed } = partitionItems(items, watcher, { now: NOW, cooldownMs: 180_000 })
say('仓库里最近有 ' + items.length + ' 条动态；其中 ' + fresh.length + ' 条是「新」的，' + absorbed.length + ' 条被冷却期吸收（是我自己刚操作过的）')

say('')
say('===== 2. 一次只叫醒 N 条 =====')
const listed = batchFresh(fresh, 2)
// 剩余要按编号取差集：batchFresh 会按优先级重排，切片会把已选中的算进剩余（产品里也修过）
const listedNumbers = new Set(listed.map((item) => item.number))
const rest = fresh.filter((item) => !listedNumbers.has(item.number))
say('批大小 2 → 这次唤醒带 ' + listed.length + ' 条，剩余 ' + rest.length + ' 条下一轮再说')
say('本轮选中：' + listed.map((item) => '#' + item.number + ' ' + item.title).join(' / '))

say('')
say('===== 3. 唤醒消息（客户会读到的原文）=====')
const text = formatWatchText(REPO, listed, {
  more: rest.length,
  restNumbers: rest.map((item) => item.number),
  goal: '让客户的问题当天有回应',
  access: accessNote({ repo: REPO, push: true }),
  criteria: [
    '改了什么：文件清单 + 一句话为什么',
    '怎么验证的：跑过的测试/命令 + 结果',
    '回写到哪：在 issue 里留言 + watch_ack 打标签',
  ],
  changedTotal: fresh.length,
  batchLimit: listed.length,
  skippedReasons: {},
})
say(text)

say('')
say('===== 3b. 有跳过时的同一条消息 =====')
// 这条分支以前从没被演练过：一直传空 skippedReasons，于是"累计冒充本轮"的 bug 藏了很久
const skippedText = formatWatchText(REPO, listed, {
  changedTotal: 7,
  batchLimit: listed.length,
  skippedReasons: { '已关闭': 2, '机器人': 1, '已 ack': 1 },
})
const skipLine = skippedText.split(String.fromCharCode(10)).find((line) => line.includes('为什么是这几条'))
say(skipLine || '（没有为什么行——这是个 bug）')

say('')
say('===== 4. 面板会看到什么 =====')
watcher.deferReason = null
const groups = summarizeByRepo([{ ...watcher, enabled: true, lastWake: iso(5), silentWakes: 0 }])
say('按仓库：' + groups.map((g) => g.repo + '（' + g.count + ' 条守）').join('、'))
say('徽章：' + (repoBadges({ repo: REPO, push: true, hasIssues: true }).map((b) => b.text).join(' / ') || '（无）'))

say('')
say('===== 5. 这些情况下产品会怎么说 =====')
say('· 仓库已归档：' + repoStructureNote({ repo: REPO, archived: true }))
say('· 关闭了 Issues：' + repoStructureNote({ repo: REPO, hasIssues: false }))
say('· 只有读权限：' + accessNote({ repo: REPO, push: false }))
say('· 仓库名联想（输入 acme/wid 时）: ' + (pickSuggestion('acme/wid', ['acme/widgets', 'acme/gadgets']) || '（无）'))
say('· 已打 ack 标签的条目会被跳过：' + hasAckLabel({ labels: [{ name: '主理鱼:已处理' }] }, '主理鱼:已处理'))

say('')
say('===== 5b. 失败与不唤醒时长什么样（客户最常问：为什么没动静）=====')
const failures = [
  'Get "https://api.github.com/repos/a/b/issues?per_page=20": EOF',
  'HTTP 403: API rate limit exceeded for user ID 1',
  'HTTP 404: Not Found',
]
for (const raw of failures) {
  const got = classifyGhError(raw)
  say('· ' + raw.slice(0, 46) + '…')
  say('    kind=' + got.kind + '　面板显示：' + got.short + '　建议：' + (got.hint || '（不给建议）'))
}
say('')
say('· 会话正忙（不在 idle）→ 不唤醒，记下原因：' + JSON.stringify(decideWake('running')))
say('· 会话空闲 → 允许唤醒：' + JSON.stringify(decideWake('idle')))
say('    面板上会显示「暂停唤醒：agent busy (running)」，下一轮空闲时自动补上。')
say('')
say('===== 6. 过滤默认值 =====')
const filters = normalizeFilters({})
say(JSON.stringify(filters, null, 2))

say('')
const rendered = out.join(String.fromCharCode(10)) + String.fromCharCode(10)
const mode = process.argv[2] || ''
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', '示例-唤醒消息.md')

if (mode === '--write') {
  writeFileSync(target, '# 唤醒消息示例（由 scripts/first-run.mjs 生成，不要手改）' + String.fromCharCode(10, 10)
    + '```text' + String.fromCharCode(10) + rendered + '```' + String.fromCharCode(10))
  console.log('已写入 docs/示例-唤醒消息.md（' + rendered.split(String.fromCharCode(10)).length + ' 行）')
} else if (mode === '--check') {
  const saved = existsSync(target) ? readFileSync(target, 'utf8') : ''
  const wanted = '# 唤醒消息示例（由 scripts/first-run.mjs 生成，不要手改）' + String.fromCharCode(10, 10)
    + '```text' + String.fromCharCode(10) + rendered + '```' + String.fromCharCode(10)
  if (saved === wanted) {
    console.log('PASS 示例与当前实现一致（' + rendered.split(String.fromCharCode(10)).length + ' 行）')
  } else {
    const savedLines = saved.split(String.fromCharCode(10))
    const nowLines = wanted.split(String.fromCharCode(10))
    const changed = nowLines.filter((line, i) => savedLines[i] !== line).length
    console.log('提示 客户会读到的文字有变化：约 ' + changed + ' 行不同')
    console.log('      确认没问题后跑 node scripts/first-run.mjs --write 更新示例')
    process.exitCode = 1
  }
} else {
  console.log(rendered)
}
