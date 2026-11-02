import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import { decodeBody } from '../lib/body.js'
import * as watchModule from '../lib/watch.js'
import {
  linkedPrNote,
  pickLinkedPullRequests,
  TRIAGE_SIGNALS,
  assignmentNote,
  priorityScore,
  classifyGhError,
  parseGhInclude,
  accessNote,
  pickSuggestion,
  msUntilActiveWindow,
  nextWaketimeAt,
  repoBadges,
  stalenessNote,
  stateReasonNote,
  repoStructureNote,
  buildCommentBatchQuery,
  commentSummaryLine,
  parseCommentBatch,
  countReasons,
  jitterMs,
  retryAfterMs,
  throttleDelayMs,
  advanceSeen, applyWatcherAction, batchFresh, decideWake, formatWatchText, newestUpdatedAt,
  hasAckLabel, nextDelayMs, normalizeFilters, partitionItems, passesFilters, pruneSeen, pruneWakeTimes,
  inActiveHours, mergePollResult, filterReason, pushFiltered, recordReported, splitFresh,
  staleWorktrees, worktreePlan,
} from '../lib/watch.js'

const item = (number, updatedAt) => ({ number, updated_at: updatedAt, state: 'open', title: `t${number}`, html_url: `https://x/${number}`, user: { login: 'me' } })

test('empty state reports every item as news', () => {
  const items = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-01-02T00:00:00Z')]
  assert.equal(splitFresh(items, {}).length, 2)
})

test('per-item watermark suppresses the item it already reported', () => {
  const items = [item(2, '2026-01-02T00:00:00Z')]
  const state = { seen: { 2: '2026-01-02T00:00:00Z' } }
  assert.equal(splitFresh(items, state).length, 0, 'the same updated_at is not news')
})

test('a newer update on a seen item is news again', () => {
  const items = [item(2, '2026-01-03T00:00:00Z')]
  const state = { seen: { 2: '2026-01-02T00:00:00Z' } }
  assert.equal(splitFresh(items, state).length, 1)
})

test('the global cursor only floors never-seen items', () => {
  const items = [item(5, '2026-01-05T00:00:00Z')]
  assert.equal(splitFresh(items, { cursor: '2026-01-06T00:00:00Z' }).length, 0)
  assert.equal(splitFresh(items, { cursor: '2026-01-04T00:00:00Z' }).length, 1)
})

test('advanceSeen records each reported item and keeps old keys', () => {
  const next = advanceSeen({ 1: 'a' }, [item(2, 'b'), item(3, 'c')])
  assert.deepEqual(next, { 1: 'a', 2: 'b', 3: 'c' })
})

test('decideWake refuses a running agent and allows an idle one', () => {
  assert.equal(decideWake('running').ok, false)
  assert.match(decideWake('running').reason, /busy/)
  assert.equal(decideWake('idle').ok, true)
  assert.equal(decideWake(undefined).ok, true, 'unknown status is not a blocker')
})

test('formatWatchText 是任务书：类型/标签/指派/链接齐全', () => {
  const rich = {
    number: 7, updated_at: '2026-01-07T00:00:00Z', state: 'open', title: 't7',
    html_url: 'https://x/7', user: { login: 'me' },
    labels: [{ name: 'bug' }, { name: 'ai-fix' }],
    assignees: [{ login: 'alice' }],
  }
  const text = formatWatchText('o/r', [rich])
  assert.match(text, /^【主理鱼】o\/r 有 1 条新动态：/)
  assert.match(text, /#7 \[open\] t7 — @me \(issue\) 标签: bug, ai-fix 指派: @alice https:\/\/x\/7/)
  assert.match(text, /AGENTS\.md/)
  assert.match(text, /不要扩大范围/)
})

test('formatWatchText 把没铺开的条目给成编号，不丢信息', () => {
  const text = formatWatchText('o/r', [item(1, '2026-01-01T00:00:00Z')], { more: 3, restNumbers: [2, 3, 4] })
  assert.match(text, /另有 3 条：#2 #3 #4/)
})

test('newestUpdatedAt picks the newest timestamp', () => {
  const fresh = [item(1, '2026-01-01T00:00:00Z'), item(2, '2026-03-01T00:00:00Z')]
  assert.equal(newestUpdatedAt(fresh), '2026-03-01T00:00:00Z')
  assert.equal(newestUpdatedAt([]), null)
})

test('cooldown suppresses the churn that follows our own handling', () => {
  const now = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  const state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: now - 20_000 } }
  assert.equal(splitFresh(items, state, { now, cooldownMs: 180_000 }).length, 0)
})

test('after the cooldown a new update is reported again', () => {
  const now = Date.parse('2026-01-01T00:10:00Z')
  const items = [item(9, '2026-01-01T00:09:50Z')]
  const state = { seen: { 9: '2026-01-01T00:09:40Z' }, lastReported: { 9: now - 200_000 } }
  assert.equal(splitFresh(items, state, { now, cooldownMs: 180_000 }).length, 1)
})

test('recordReported stamps every reported item', () => {
  const now = 1_700_000_000_000
  const next = recordReported({ lastReported: { 1: 5 } }, [item(2, 'x')], now)
  assert.deepEqual(next, { 1: 5, 2: now })
})

test('partitionItems absorbs our own bump instead of delaying it', () => {
  const now = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  const state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: now - 20_000 } }
  const { fresh, absorbed } = partitionItems(items, state, { now, cooldownMs: 180_000 })
  assert.equal(fresh.length, 0)
  assert.equal(absorbed.length, 1)
})

test('absorbed bumps never resurface once the cooldown is over', () => {
  const t0 = Date.parse('2026-01-01T00:00:30Z')
  const items = [item(9, '2026-01-01T00:00:20Z')]
  let state = { seen: { 9: '2026-01-01T00:00:10Z' }, lastReported: { 9: t0 - 20_000 } }
  const first = partitionItems(items, state, { now: t0, cooldownMs: 180_000 })
  state = { ...state, seen: advanceSeen(state.seen, first.absorbed) }
  const later = partitionItems(items, { ...state, lastReported: {} }, { now: t0 + 600_000, cooldownMs: 180_000 })
  assert.equal(later.fresh.length, 0, 'watermark already covered it')
  assert.equal(later.absorbed.length, 0)
})

test('applyWatcherAction: pause / resume / delete 只动目标那一条', () => {
  const makeState = () => ({
    watchers: {
      'a/b#s1': { id: 'a/b#s1', repo: 'a/b', sessionId: 's1', enabled: true, lastError: 'boom' },
      'c/d#s2': { id: 'c/d#s2', repo: 'c/d', sessionId: 's2', enabled: true, lastError: null },
    },
  })

  let state = makeState()
  assert.deepEqual(applyWatcherAction(state, { action: 'pause', id: 'a/b#s1' }), { ok: true, action: 'pause', id: 'a/b#s1', enabled: false })
  assert.equal(state.watchers['a/b#s1'].enabled, false)
  assert.equal(state.watchers['c/d#s2'].enabled, true, '不该顺手动别的条目')

  state = makeState()
  state.watchers['a/b#s1'].enabled = false
  assert.deepEqual(applyWatcherAction(state, { action: 'resume', id: 'a/b#s1' }), { ok: true, action: 'resume', id: 'a/b#s1', enabled: true })
  assert.equal(state.watchers['a/b#s1'].lastError, null, '恢复时清掉旧的错误，别让卫星一上来就是红的')

  state = makeState()
  assert.deepEqual(applyWatcherAction(state, { action: 'delete', id: 'a/b#s1' }), { ok: true, action: 'delete', id: 'a/b#s1', deleted: true })
  assert.equal(state.watchers['a/b#s1'], undefined)
  assert.ok(state.watchers['c/d#s2'], '删除不该连带别的条目')

  state = makeState()
  assert.equal(applyWatcherAction(state, { action: 'nope', id: 'a/b#s1' }).ok, false, '未知动作要拒绝')
  assert.equal(applyWatcherAction(state, { action: 'pause', id: 'x/y#zz' }).ok, false, '未知 id 要拒绝')
  assert.equal(applyWatcherAction({}, { action: 'pause', id: 'a/b#s1' }).ok, false, '空状态要拒绝')
  assert.equal(Object.keys(makeState().watchers).length, 2, '被拒绝的调用不能改状态')
})

// ── 竞品蒸馏：过滤器 / 批量 / 退避 / 每小时上限 ──────────────────────────

test('passesFilters：默认跳过机器人、草稿、非 open', () => {
  const bot = { number: 1, state: 'open', user: { login: 'dependabot[bot]', type: 'Bot' } }
  const draft = { number: 2, state: 'open', user: { login: 'me' }, draft: true, pull_request: {} }
  const closed = { number: 3, state: 'closed', user: { login: 'me' } }
  const ok = { number: 4, state: 'open', user: { login: 'me' } }
  assert.equal(passesFilters(bot), false)
  assert.equal(passesFilters(draft), false)
  assert.equal(passesFilters(closed), false)
  assert.equal(passesFilters(ok), true)
  // 显式关掉这些闸就别拦
  assert.equal(passesFilters(bot, { skipBots: false }), true)
  assert.equal(passesFilters(closed, { skipClosed: false }), true)
})

test('passesFilters：label 白名单/黑名单与「只看指派」', () => {
  const withLabels = (names) => ({ number: 9, state: 'open', user: { login: 'me' }, labels: names.map((name) => ({ name })) })
  assert.equal(passesFilters(withLabels(['bug']), normalizeFilters({ labels: ['AI-Fix'] })), false, '大小写不同但没这个标签')
  assert.equal(passesFilters(withLabels(['ai-fix']), normalizeFilters({ labels: ['AI-Fix'] })), true, '标签匹配忽略大小写')
  assert.equal(passesFilters(withLabels(['bug', 'wontfix']), normalizeFilters({ ignoreLabels: ['wontfix'] })), false)
  assert.equal(passesFilters(withLabels(['bug']), normalizeFilters({ ignoreLabels: ['wontfix'] })), true)

  const assigned = { number: 10, state: 'open', user: { login: 'me' }, assignees: [{ login: 'Alice' }] }
  assert.equal(passesFilters(assigned, normalizeFilters({ onlyAssigned: true })), true)
  assert.equal(passesFilters(assigned, normalizeFilters({ onlyAssigned: true, assignee: 'alice' })), true)
  assert.equal(passesFilters(assigned, normalizeFilters({ onlyAssigned: true, assignee: 'bob' })), false)
  assert.equal(passesFilters(withLabels(['bug']), normalizeFilters({ onlyAssigned: true })), false, '没人指派就跳过')
})

test('normalizeFilters 宽容处理脏输入', () => {
  const f = normalizeFilters({ labels: [' a ', '', 'b'], skipBots: false, assignee: '  ' })
  assert.deepEqual(f.labels, ['a', 'b'])
  assert.equal(f.skipBots, false)
  assert.equal(f.assignee, null)
  assert.equal(normalizeFilters(null).skipDrafts, true)
})

test('batchFresh 只取前 N 条，N 非法时退回 3', () => {
  const list = [1, 2, 3, 4, 5]
  assert.deepEqual(batchFresh(list, 2), [1, 2])
  assert.deepEqual(batchFresh(list, 0), [1, 2, 3])
  assert.deepEqual(batchFresh([], 5), [])
})

test('nextDelayMs：失败翻倍，封顶 30 分钟，成功复位', () => {
  const base = 30000
  assert.equal(nextDelayMs({ consecutiveFailures: 0 }, base), base)
  assert.equal(nextDelayMs({ consecutiveFailures: 1 }, base), 60000)
  assert.equal(nextDelayMs({ consecutiveFailures: 3 }, base), 240000)
  assert.equal(nextDelayMs({ consecutiveFailures: 20 }, base), 30 * 60 * 1000, '封顶 30 分钟')
})

test('pruneWakeTimes 只保留最近一小时的唤醒', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const times = [
    Date.parse('2026-11-01T10:00:00Z'),
    Date.parse('2026-11-01T11:30:00Z'),
    Date.parse('2026-11-01T11:59:00Z'),
  ]
  assert.deepEqual(pruneWakeTimes(times, now), [times[1], times[2]])
  assert.deepEqual(pruneWakeTimes(undefined, now), [])
})

test('hasAckLabel：大小写无关，认标签', () => {
  const done = { labels: [{ name: 'bug' }, { name: '主理鱼:已处理' }] }
  const nope = { labels: [{ name: 'bug' }] }
  assert.equal(hasAckLabel(done), true)
  assert.equal(hasAckLabel(done, '主理鱼:已处理'), true)
  assert.equal(hasAckLabel(nope), false)
  assert.equal(hasAckLabel({}), false)
  assert.equal(hasAckLabel({ labels: ['主理鱼:已处理'] }), true, '字符串标签也要认')
})

test('pruneSeen：超龄与超量的记录都被丢掉，留下的按新到旧', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const seen = {
    1: '2026-08-01T00:00:00Z',   // 90 多天前，超龄
    2: '2026-10-31T12:00:00Z',   // 1 天前
    3: '2026-10-20T12:00:00Z',   // 12 天前
    4: '不是时间',
  }
  const kept = pruneSeen(seen, { now })
  assert.deepEqual(Object.keys(kept).sort(), ['2', '3'])
  assert.equal(kept['2'], '2026-10-31T12:00:00.000Z')

  const capped = pruneSeen(seen, { now, maxEntries: 1 })
  assert.deepEqual(Object.keys(capped), ['2'], '超量时只留最新的')
  assert.deepEqual(pruneSeen(undefined, { now }), {})
})

test('worktreePlan：路径安全、分支成对、每次不同', () => {
  const a = worktreePlan({ workdir: 'D:/repo/', repo: 'MYCF711/dsh-session-superagent', sessionTag: 'session-1e82afca-8be2', stamp: 1730000000000 })
  assert.ok(a.dir.startsWith('D:/repo/.dsh-zhuli/MYCF711-dsh-session-superagent-1e82afca-'), a.dir)
  assert.equal(a.branch, 'zhuli/' + a.id)
  const b = worktreePlan({ workdir: 'D:/repo', repo: 'MYCF711/dsh-session-superagent', sessionTag: 'session-1e82afca-8be2', stamp: 1730000001000 })
  assert.notEqual(a.id, b.id, '时间戳不同就该是不同 worktree')
  const odd = worktreePlan({ workdir: 'D:/repo', repo: 'a b/c!d', sessionTag: 'session-!!!', stamp: 1 })
  assert.ok(!odd.id.includes(' '), '空格要清洗掉：' + odd.id)
  assert.ok(!odd.id.includes('!'), '特殊字符要清洗掉：' + odd.id)
})

test('formatWatchText 带隔离工作区/隔离失败说明', () => {
  const one = [item(1, '2026-01-01T00:00:00Z')]
  const ok = formatWatchText('o/r', one, { isolation: { dir: 'D:/x/.dsh-zhuli/a', branch: 'zhuli/a' } })
  assert.ok(ok.includes('【隔离工作区】D:/x/.dsh-zhuli/a'), ok)
  assert.ok(ok.includes('zhuli/a'))
  assert.ok(ok.includes('别碰主工作区'))
  const bad = formatWatchText('o/r', one, { isolation: { error: 'not a git repo' } })
  assert.ok(bad.includes('【隔离失败】not a git repo'), bad)
  const plain = formatWatchText('o/r', one)
  assert.ok(!plain.includes('隔离'), '没有隔离选项时不该出现这段')
})

test('decodeBody：UTF-8 正常解，GBK 字节自动兜底', () => {
  const utf8 = Buffer.from('D:/中文路径/x', 'utf8')
  assert.equal(decodeBody(utf8), 'D:/中文路径/x')
  // "D:/中文路径" 的 GBK 字节：中=D6D0 文=CEC4 路=C2B7 径=BEB6
  const gbk = Buffer.from([0x44, 0x3a, 0x2f, 0xd6, 0xd0, 0xce, 0xc4, 0xc2, 0xb7, 0xbe, 0xb6])
  assert.equal(decodeBody(gbk), 'D:/中文路径')
  assert.equal(decodeBody(Buffer.alloc(0)), '')
})

test('staleWorktrees：只挑超龄的，脏输入直接跳过', () => {
  const now = Date.parse('2026-11-01T12:00:00Z')
  const entries = [
    { name: 'old', mtimeMs: now - 5 * 24 * 3600 * 1000 },
    { name: 'fresh', mtimeMs: now - 3600 * 1000 },
    { name: 'bad', mtimeMs: 'x' },
    null,
  ]
  assert.deepEqual(staleWorktrees(entries, { now }).map((e) => e.name), ['old'])
  assert.deepEqual(staleWorktrees(entries, { now, keepMs: 0 }).map((e) => e.name), ['old', 'fresh'])
  assert.equal(staleWorktrees([]).length, 0)
  assert.equal(staleWorktrees(undefined).length, 0)
})

test('lib/index.js 从 watch.js 导入的每个名字都必须真的导出', () => {
  // 踩过：给 watch.js 加函数时忘了写文件，index.js 却先 import 了 —— node --check 查不出来，
  // 宿主重启时才会整块插件加载失败。这条用例专门守这个洞。
  const src = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const marker = "} from './watch.js'"
  const end = src.indexOf(marker)
  assert.ok(end > 0, '找不到 index.js 里对 watch.js 的 import 块')
  const start = src.lastIndexOf('import {', end) + 'import {'.length
  const names = src.slice(start, end).split(',').map((v) => v.trim()).filter(Boolean)
  assert.ok(names.length > 5, '只解析到 ' + names.length + ' 个名字，解析逻辑可能错了')
  const missing = names.filter((n) => !(n in watchModule))
  assert.deepEqual(missing, [], '这些名字没从 watch.js 导出：' + missing.join(', '))
})

test('inActiveHours：普通时段 / 跨夜 / 空值', () => {
  const at = (h, m = 0) => new Date(2026, 10, 1, h, m)
  assert.equal(inActiveHours('09:00-23:00', at(12)), true)
  assert.equal(inActiveHours('09:00-23:00', at(3)), false)
  assert.equal(inActiveHours('09:00-23:00', at(23, 0)), false, '右开区间，23:00 已经不算')
  assert.equal(inActiveHours('22:00-06:00', at(2)), true, '跨夜要成立')
  assert.equal(inActiveHours('22:00-06:00', at(12)), false)
  assert.equal(inActiveHours('', at(3)), true, '空 = 一直活跃')
  assert.equal(inActiveHours('乱写', at(3)), true, '格式不对就退化成一直活跃')
  assert.equal(inActiveHours('09:00-09:00', at(3)), true, '起止相同也按一直活跃处理')
})

test('mergePollResult：配置字段以盘上为准，轮询结果才写回', () => {
  const stored = { id: 'a/b#s1', enabled: false, intervalSec: 30, filters: { labels: ['x'] }, seen: {}, lastPoll: 'old' }
  const polled = { id: 'a/b#s1', enabled: true, intervalSec: 999, seen: { 1: 'now' }, lastPoll: 'new', lastWake: 'w', extraGarbage: 1 }
  const merged = mergePollResult(stored, polled)
  assert.equal(merged.enabled, false, '暂停不能被 tick 收尾写回成运行中')
  assert.equal(merged.intervalSec, 30, '间隔属于配置，不从内存覆盖')
  assert.deepEqual(merged.filters, { labels: ['x'] }, '过滤器属于配置')
  assert.deepEqual(merged.seen, { 1: 'now' }, 'seen 是轮询结果，要写回')
  assert.equal(merged.lastPoll, 'new')
  assert.equal(merged.lastWake, 'w')
  assert.equal(merged.extraGarbage, undefined, '白名单之外的内存字段不落盘')
})

test('filterReason：每种过滤都给得出人话原因', () => {
  const base = { number: 1, state: 'open', user: { login: 'me' } }
  assert.equal(filterReason(base), null, '什么都没配时应该通过')
  assert.equal(filterReason({ ...base, state: 'closed' }), '已关闭')
  assert.equal(filterReason({ ...base, draft: true }), '草稿 PR')
  assert.equal(filterReason({ ...base, user: { login: 'x[bot]' } }), '机器人')
  assert.equal(filterReason({ ...base, labels: [{ name: 'wontfix' }] }, normalizeFilters({ ignoreLabels: ['wontfix'] })), '排除标签: wontfix')
  assert.equal(filterReason({ ...base, labels: [{ name: 'bug' }] }, normalizeFilters({ labels: ['ai-fix'] })), '不在标签白名单: ai-fix')
  assert.equal(filterReason(base, normalizeFilters({ onlyAssigned: true })), '没有指派给人')
  assert.equal(filterReason({ ...base, assignees: [{ login: 'bob' }] }, normalizeFilters({ onlyAssigned: true, assignee: 'alice' })), '未指派给 @alice')
})

test('pushFiltered：环形缓冲只留最近 max 条', () => {
  let log
  for (let i = 0; i < 8; i += 1) log = pushFiltered(log, { number: i, reason: 'r' + i }, 5)
  assert.equal(log.length, 5)
  assert.deepEqual(log.map((x) => x.number), [3, 4, 5, 6, 7])
})

test('formatWatchText 把 watcher 的「目标/规则」带进消息，并压平换行', () => {
  const one = [item(1, '2026-01-01T00:00:00Z')]
  const without = formatWatchText('o/r', one)
  const withGoal = formatWatchText('o/r', one, { goal: '把 widget 的 issue 都处理完' + String.fromCharCode(10) + '第二行' })
  assert.notEqual(without, withGoal, '带 goal 的消息必须和不带的不同（0.8.8 曾忘了拼接）')
  assert.ok(withGoal.includes('本条目主理目标：把 widget 的 issue 都处理完 第二行'), withGoal)
})

test('mergePollResult 必须保留 filteredLog（面板「最近被过滤」靠它落盘）', () => {
  const stored = { id: 'a/b#s1', enabled: true, filters: { labels: [] } }
  const polled = { id: 'a/b#s1', filteredLog: [{ at: 'now', number: 7, title: 't', reason: '机器人' }] }
  const merged = mergePollResult(stored, polled)
  assert.deepEqual(merged.filteredLog, polled.filteredLog, 'filteredLog 漏出白名单就会永远读不到')
})

test('classifyGhError：把 gh 的原始报错变成人话（真机踩过 EOF）', () => {
  const cases = [
    ['Get "https://api.github.com/repos/a/b/issues?per_page=20": EOF', 'network', '网络抖动'],
    ['HTTP 401: Bad credentials', 'auth', 'gh auth login'],
    ['HTTP 404: Not Found', 'notfound', 'owner/name'],
    ['gh: command not found', 'nogh', 'PATH'],
    ['HTTP 403: API rate limit exceeded', 'ratelimit', '限流'],
    ['something odd', 'other', ''],
  ]
  for (const [input, kind, hintPart] of cases) {
    const got = classifyGhError(input)
    assert.equal(got.kind, kind, input)
    if (hintPart) assert.ok(got.hint.includes(hintPart), `${input} -> ${got.hint}`)
  }
  // 长 URL 必须被压缩，否则面板会被一整条 API 地址占满
  const short = classifyGhError('Get "https://api.github.com/repos/a/b/issues?state=all&per_page=20": EOF').short
  assert.ok(!short.includes('api.github.com'), short)
  assert.ok(short.length <= 60, short)
})

test('parseGhInclude：解析 --include 的状态行 / ETag / 正文', () => {
  const LF = String.fromCharCode(10)
  const sample = [
    'HTTP/2.0 200 OK',
    'etag: W/"abc123"',
    'content-type: application/json',
    '',
    '[{"number":1}]',
  ].join(LF)
  const parsed = parseGhInclude(sample)
  assert.equal(parsed.status, 200)
  assert.equal(parsed.etag, 'W/"abc123"')
  assert.equal(parsed.body, '[{"number":1}]')

  // 304：没有正文，但状态要能认出来（这条路径不计入速率限制）
  const notModified = ['HTTP/2.0 304 Not Modified', 'etag: W/"abc123"', '', ''].join(LF)
  assert.equal(parseGhInclude(notModified).status, 304)

  // 纯正文（老版本 gh 或将来格式变化）：不炸，当 0 处理
  const plain = parseGhInclude('[1,2,3]')
  assert.equal(plain.status, 0)
  assert.equal(plain.body, '[1,2,3]')
})

test('jitterMs：同一条守永远同一个偏移，且在窗口内', () => {
  const a = jitterMs('owner/repo#session-1', 5000)
  const b = jitterMs('owner/repo#session-1', 5000)
  assert.equal(a, b, '同一个 key 必须稳定，否则调试时对不上')
  assert.ok(a >= 0 && a < 5000, '偏移必须落在窗口内：' + a)
  // 不同 key 不应该全都挤在同一个点（取 20 条看分布）
  const offsets = new Set(Array.from({ length: 20 }, (_, i) => jitterMs('repo#' + i, 5000)))
  assert.ok(offsets.size > 8, '20 条守应该散开，实际只用了 ' + offsets.size + ' 个偏移')
  assert.equal(jitterMs('x', 0), 0, '窗口为 0 时不出抖动')
})

test('parseGhInclude 读得出限流头（真实 gh 输出格式）', () => {
  const LF = String.fromCharCode(10)
  const sample = [
    'HTTP/2.0 200 OK',
    'ETag: W/"e1"',
    'X-Ratelimit-Limit: 5000',
    'X-Ratelimit-Remaining: 120',
    'X-Ratelimit-Reset: 1793608466',
    '',
    '[]',
  ].join(LF)
  const parsed = parseGhInclude(sample)
  assert.equal(parsed.remaining, 120)
  assert.equal(parsed.limit, 5000)
  assert.equal(parsed.resetAt, new Date(1793608466 * 1000).toISOString())
})

test('throttleDelayMs：额度充足不动，紧张时推到重置（最多 1 小时）', () => {
  const now = Date.parse('2026-11-02T08:00:00.000Z')
  // 充足：不推迟
  assert.equal(throttleDelayMs({ remaining: 4000, resetAt: '2026-11-02T09:00:00.000Z', now }), 0)
  // 没拿到头：不推迟
  assert.equal(throttleDelayMs({ remaining: null, now }), 0)
  // 紧张：等到重置（+1 秒缓冲）
  const wait = throttleDelayMs({ remaining: 10, resetAt: '2026-11-02T08:10:00.000Z', now })
  assert.equal(wait, 10 * 60 * 1000 + 1000)
  // 重置时间超过 1 小时：封顶 1 小时
  assert.equal(throttleDelayMs({ remaining: 10, resetAt: '2026-11-02T12:00:00.000Z', now }), 3600 * 1000)
  // 重置时间已过：不推迟
  assert.equal(throttleDelayMs({ remaining: 10, resetAt: '2026-11-02T07:00:00.000Z', now }), 0)
})

test('Retry-After：stage 2 限流按服务端说的等，别瞎猜', () => {
  const LF = String.fromCharCode(10)
  const sample = ['HTTP/2.0 403 Forbidden', 'Retry-After: 42', '', ''].join(LF)
  assert.equal(parseGhInclude(sample).retryAfter, 42)
  assert.equal(retryAfterMs(42), 42000)
  assert.equal(retryAfterMs(0), 0, '没给就别推迟')
  assert.equal(retryAfterMs('abc'), 0, '解析不了当没给')
  assert.equal(retryAfterMs(99999), 3600 * 1000, '封顶 1 小时')
})

test('countReasons：按原因累计并按次数排序（客户问「为什么没叫醒」要有答案）', () => {
  let counts = {}
  counts = countReasons(counts, '不在标签白名单: ai-fix')
  counts = countReasons(counts, '不在标签白名单: ai-fix')
  counts = countReasons(counts, '机器人')
  assert.deepEqual(counts, { '不在标签白名单: ai-fix': 2, 机器人: 1 })
  assert.deepEqual(countReasons(counts, ''), counts, '空原因不记')
  // 种类有上限，且保留次数最多的
  let many = {}
  for (let i = 0; i < 30; i += 1) many = countReasons(many, '原因' + i, { maxKinds: 5 })
  assert.equal(Object.keys(many).length, 5)
  assert.deepEqual(Object.keys(countReasons({}, 'x', { maxKinds: 5 })), ['x'])
})

test('唤醒消息带「为什么是这几条」（只给结果不给依据，接收方没法调过滤）', () => {
  const items = [{ number: 7, title: '修一下登录', state: 'open', html_url: 'https://x/7', user: { login: 'a' }, labels: [], assignees: [] }]
  const text = formatWatchText('o/r', items, {
    changedTotal: 9,
    batchLimit: 1,
    skippedReasons: { '不在标签白名单: ai-fix': 5, '机器人': 3, '草稿': 0 },
  })
  assert.ok(text.includes('【为什么是这几条】'), text.slice(0, 120))
  assert.ok(text.includes('本轮共 9 条变化'), '要说清总共多少变化')
  assert.ok(text.includes('取前 1 条'), '要说清这批是怎么截的')
  assert.ok(text.includes('不在标签白名单: ai-fix × 5') && text.includes('机器人 × 3'), '要说清跳过了什么')
  assert.ok(!text.includes('草稿 × 0'), '次数为 0 的不要凑数')

  // 没有依据信息时不要凭空加一行
  const plain = formatWatchText('o/r', items, {})
  assert.ok(!plain.includes('【为什么是这几条】'), '没信息就别硬编')
})

test('唤醒消息的完成标准是可观测的三条（Given-When-Then 思路）', () => {
  const items = [{ number: 1, title: 'x', state: 'open', html_url: 'https://x/1', user: { login: 'u' }, labels: [], assignees: [] }]
  const text = formatWatchText('o/r', items, { criteria: ['改了什么', '怎么验证的', '回写到哪', '第四条留着', '第五条会被截'] })
  assert.ok(text.includes('【完成标准】'), '要有独立的完成标准块')
  assert.ok(text.includes('1. 改了什么') && text.includes('3. 回写到哪'), '按序号列出来')
  assert.ok(text.includes('第四条留着') && !text.includes('第五条'), '最多 4 条，第 5 条起丢掉')
  // 不给标准时退回原来的一句话
  const plain = formatWatchText('o/r', items, {})
  assert.ok(!plain.includes('【完成标准】'))
  assert.ok(plain.includes('完成标准 = 有测试结果'))
})

test('只读仓库要在任务书里直说（否则会话会去试写然后吃 403）', () => {
  assert.equal(accessNote({ push: true }), '', '有写权限就不该提示')
  assert.equal(accessNote(null), '')
  assert.equal(accessNote({}), '', '未知时不猜')
  const note = accessNote({ repo: 'o/r', push: false })
  assert.ok(note.includes('只有读权限'), note)
  assert.ok(note.includes('没法回写'), note)

  const items = [{ number: 1, title: 'x', state: 'open', html_url: 'https://x/1', user: { login: 'u' }, labels: [], assignees: [] }]
  const text = formatWatchText('o/r', items, { access: note })
  assert.ok(text.includes('【权限提示】'), '要单独成行，别混在正文里')
})

test('仓库结构提示：关闭 Issues / 是 fork 都要提前说（否则守着一个永远没条目的仓库）', () => {
  assert.equal(repoStructureNote(null), '')
  assert.equal(repoStructureNote({ hasIssues: true, fork: false }), '')
  const closed = repoStructureNote({ repo: 'o/r', hasIssues: false })
  assert.ok(closed.includes('关闭了 Issues'), closed)
  const fork = repoStructureNote({ repo: 'me/r', fork: true, parent: 'up/r' })
  assert.ok(fork.includes('fork') && fork.includes('up/r'), fork)
  // 有 issue 的 fork（用户自己开了）不提示
  assert.equal(repoStructureNote({ repo: 'me/r', fork: true, parent: 'up/r', hasIssues: true }), '')
})

test('仓库能力徽章：归档/禁用/无 Issues/fork/只读/私有', () => {
  assert.deepEqual(repoBadges(null), [])
  assert.deepEqual(repoBadges({ push: true, hasIssues: true }), [], '正常仓库不该有徽章')
  const archived = repoBadges({ archived: true })
  assert.ok(archived.some((b) => b.text === '已归档' && b.tone === 'warning'))
  const full = repoBadges({ archived: true, disabled: true, hasIssues: false, fork: true, parent: 'up/r', push: false, private: true })
  assert.equal(full.length, 6, full.map((b) => b.text).join('|'))
  assert.ok(full.some((b) => b.tone === 'danger'), '禁用要用危险色')
  // fork 自己开了 Issues：不给 fork 徽章（避免误伤）
  assert.ok(!repoBadges({ fork: true, parent: 'up/r', hasIssues: true }).some((b) => b.text.startsWith('fork')))
})

test('仓库名纠错：优先同名、其次包含、别乱猜', () => {
  const candidates = ['MYCF711/dsh-session-superagent', 'someone/dsh-session-superagent-fork', 'other/unrelated']
  assert.equal(pickSuggestion('me/dsh-session-superagent', candidates), 'MYCF711/dsh-session-superagent', '仓库名相同就是它')
  assert.equal(pickSuggestion('me/dsh-session', candidates), 'MYCF711/dsh-session-superagent', '包含关系也能推')
  assert.equal(pickSuggestion('me/zzz', candidates), null, '完全不相关就别乱建议')
  assert.equal(pickSuggestion('', candidates), null)
  assert.equal(pickSuggestion('me/x', null), null, '没有候选不崩')
  assert.equal(pickSuggestion('me/abc', ['x/abc']), 'x/abc', '短名字只要同名仍然可用')
})

test('「最后是谁在说话」：有就给一行，没就给空（不许瞎编）', () => {
  assert.equal(commentSummaryLine(null), '')
  assert.equal(commentSummaryLine({}), '')
  assert.equal(commentSummaryLine({ login: 'octocat' }), '@octocat')
  assert.equal(commentSummaryLine({ login: 'octocat', at: '2026-11-02T08:00:00Z' }), '@octocat 2026-11-02T08:00:00Z')

  const items = [{
    number: 5, title: '有人已经在处理', state: 'open', html_url: 'https://x/5',
    user: { login: 'author' }, labels: [], assignees: [], comments: 2,
    lastComment: { login: 'helper', at: '2026-11-02T07:00:00Z' },
  }]
  const text = formatWatchText('o/r', items, {})
  assert.ok(text.includes('最后评论: @helper'), text.slice(0, 200))
})

test('最后评论是"我自己发的"要说清楚（那不是有人在处理，是上一轮的痕迹）', () => {
  assert.equal(commentSummaryLine({ login: 'helper', at: 't' }, 'me'), '@helper t')
  assert.equal(commentSummaryLine({ login: 'ME', at: 't' }, 'me'), '我（上一轮留的） t', '大小写不敏感')
  assert.equal(commentSummaryLine({ login: 'helper', at: 't' }, null), '@helper t', '不知道我是谁时照常显示')

  const items = [{
    number: 6, title: '上一轮我评论过', state: 'open', html_url: 'https://x/6',
    user: { login: 'author' }, labels: [], assignees: [], comments: 1,
    lastComment: { login: 'me', at: '2026-11-02T06:00:00Z', self: true },
  }]
  const text = formatWatchText('o/r', items, {})
  assert.ok(text.includes('我（上一轮留的）'), text.slice(0, 200))
})

test('GraphQL 批量：一次查多条，单条 NOT_FOUND 不影响其他条', () => {
  const q3 = buildCommentBatchQuery(3)
  assert.ok(q3.includes('i0:') && q3.includes('i2:'), '要有 3 个别名')
  assert.ok(q3.includes('$n0: Int!') && q3.includes('$n2: Int!'), '变量声明要齐')
  assert.equal(buildCommentBatchQuery(0).includes('i0:'), false, '0 条时不生成别名')
  assert.equal(buildCommentBatchQuery(99).match(/i\d+:/g).length, 10, '上限 10')

  const payload = {
    data: { repository: {
      i0: { number: 7, comments: { nodes: [{ author: { login: 'helper' }, createdAt: '2026-11-02T07:00:00Z' }] } },
      i1: null, // NOT_FOUND
      i2: { number: 9, comments: { nodes: [] } },
    } },
    errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }],
  }
  const parsed = parseCommentBatch(payload)
  assert.deepEqual(parsed['7'], { login: 'helper', at: '2026-11-02T07:00:00Z', linked: [] }, '没关联 PR 时给空数组')
  assert.equal(parsed['9'], undefined, '没有评论就不放进来')
  assert.equal(parseCommentBatch(null) && Object.keys(parseCommentBatch(null)).length, 0)
})

test('关闭原因与"反复重开"：只有重开才在消息里警示', () => {
  assert.equal(stateReasonNote(null), '')
  assert.equal(stateReasonNote({ state: 'open' }), '', '没原因就不说话')
  assert.match(stateReasonNote({ state: 'open', state_reason: 'reopened' }), /重新打开/)
  assert.match(stateReasonNote({ state: 'closed', state_reason: 'not_planned' }), /不做/)
  assert.match(stateReasonNote({ state: 'closed', state_reason: 'completed' }), /已完成/)

  const base = { number: 11, title: 'x', html_url: 'https://x/11', user: { login: 'u' }, labels: [], assignees: [] }
  const reopened = formatWatchText('o/r', [{ ...base, state: 'open', state_reason: 'reopened' }], {})
  assert.ok(reopened.includes('⚠'), '重开的要显眼')
  const closedFine = formatWatchText('o/r', [{ ...base, state: 'closed', state_reason: 'not_planned' }], {})
  assert.ok(!closedFine.includes('⚠'), '正常的关闭原因不喧哗')
})

test('一次只能处理 N 条时，先处理更该处理的（重开 > 有评论 > 有标签 > 其他）', () => {
  assert.equal(priorityScore(null), 0)
  assert.equal(priorityScore({}), 0)
  assert.equal(priorityScore({ state_reason: 'reopened' }), 100)
  assert.equal(priorityScore({ comments: 3 }), 10)
  assert.equal(priorityScore({ labels: [{ name: 'ai-fix' }] }), 5)
  assert.equal(priorityScore({ state_reason: 'reopened', comments: 2, labels: [{ name: 'x' }] }), 115)

  const plain = { number: 1, title: 'a' }
  const tagged = { number: 2, title: 'b', labels: [{ name: 'x' }] }
  const commented = { number: 3, title: 'c', comments: 4 }
  const reopened = { number: 4, title: 'd', state_reason: 'reopened' }
  const picked = batchFresh([plain, tagged, commented, reopened], 2)
  assert.deepEqual(picked.map((i) => i.number), [4, 3], '重开第一、有评论第二')

  // 分数相同保持 GitHub 的 updated 顺序（稳定）
  const a = { number: 11 }, b = { number: 12 }, c = { number: 13 }
  assert.deepEqual(batchFresh([a, b, c], 3).map((i) => i.number), [11, 12, 13])
  assert.deepEqual(batchFresh([a, b, c], 3).map((i) => i.number), [11, 12, 13], '多次调用顺序一致')
})

test('优先级开关：关掉某一类加权后，就按"最近更新"顺序处理', () => {
  const reopened = { number: 1, state_reason: 'reopened' }
  const plain = { number: 2 }
  // 全开：重开在前
  assert.deepEqual(batchFresh([plain, reopened], 2).map((i) => i.number), [1, 2])
  // 关掉重开加权：退回原顺序（稳定）
  assert.deepEqual(batchFresh([plain, reopened], 2, { reopened: false }).map((i) => i.number), [2, 1])
  // 三项全关 == 原顺序
  assert.deepEqual(batchFresh([plain, reopened], 2, { reopened: false, comments: false, labels: false }).map((i) => i.number), [2, 1])
  // 权重本身不受影响
  assert.equal(priorityScore(reopened, { reopened: false }), 0)
  assert.equal(priorityScore({ comments: 1, labels: [{}] }, { comments: false }), 5)
})

test('认领状态：无人认领如实标注，加权默认关闭', () => {
  assert.equal(assignmentNote(null), '')
  assert.equal(assignmentNote({ assignees: [{ login: 'a' }] }), '')
  assert.equal(assignmentNote({ assignees: [] }), '未认领')
  assert.equal(assignmentNote({}), '未认领')

  const item = { number: 9, title: 'x', state: 'open', html_url: 'https://x/9', user: { login: 'u' }, labels: [], assignees: [] }
  const text = formatWatchText('o/r', [item], {})
  assert.ok(text.includes('未认领'), '消息里要如实标注')

  // 默认不加权；显式打开才有
  assert.equal(priorityScore(item), 0)
  assert.equal(priorityScore(item, { unassigned: true }), 3)
  // 已认领的不受 unassigned 影响
  assert.equal(priorityScore({ assignees: [{ login: 'a' }] }, { unassigned: true }), 0)
})

test('分诊信号表：每条都要说清"事实还是判断""默认开不开"', () => {
  assert.ok(Array.isArray(TRIAGE_SIGNALS) && TRIAGE_SIGNALS.length >= 4)
  for (const sig of TRIAGE_SIGNALS) {
    for (const field of ['key', 'label', 'kind', 'weight', 'default', 'why']) {
      assert.ok(sig[field] !== undefined, sig.key + ' 缺字段 ' + field)
    }
    assert.ok(['fact', 'judgment'].includes(sig.kind), sig.key + ' 的 kind 只能是 fact/judgment')
    assert.equal(typeof sig.default, 'boolean')
  }
  // 判断类的默认必须是关的：我们的判断不该默认生效
  for (const sig of TRIAGE_SIGNALS.filter((item) => item.kind === 'judgment')) {
    assert.equal(sig.default, false, sig.key + ' 是判断类，默认必须关')
  }
  // 表里的权重必须和实际打分一致（防止文档与代码走偏）
  const reopened = { state_reason: 'reopened' }
  assert.equal(priorityScore(reopened), TRIAGE_SIGNALS.find((s) => s.key === 'reopened').weight)
  const commented = { comments: 1 }
  assert.equal(priorityScore(commented), TRIAGE_SIGNALS.find((s) => s.key === 'comments').weight)
})

test('躺了多久：open 且超过阈值才说，closed 不吵', () => {
  const now = Date.parse('2026-11-02T00:00:00Z')
  const old = { state: 'open', updated_at: '2026-09-01T00:00:00Z' } // 62 天
  assert.match(stalenessNote(old, { now }), /躺了 62 天/)
  assert.equal(stalenessNote({ state: 'open', updated_at: '2026-11-01T00:00:00Z' }, { now }), '', '刚更新过不算躺')
  assert.equal(stalenessNote({ state: 'closed', updated_at: '2026-09-01T00:00:00Z' }, { now }), '', 'closed 不标')
  assert.equal(stalenessNote({ state: 'open' }, { now }), '', '没有时间戳就不猜')
  assert.equal(stalenessNote({ state: 'open', updated_at: '2026-09-01T00:00:00Z' }, { now, thresholdDays: 90 }), '', '阈值可调')

  const item = { number: 3, title: 'x', state: 'open', html_url: 'https://x/3', user: { login: 'u' }, labels: [], assignees: [], updated_at: new Date(Date.now() - 40 * 86400000).toISOString() }
  assert.ok(formatWatchText('o/r', [item], {}).includes('躺了 40 天'), '消息里要标出来')
  assert.equal(priorityScore(item), 0, '默认不参与排序')
  assert.equal(priorityScore(item, { stale: true }), 2, '开启后 +2')
})

test('关联 PR：open 优先、去重、消息里提醒"已有 PR 在做"', () => {
  const nodes = [
    { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 21, state: 'CLOSED', url: 'u21' } },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 20, state: 'OPEN', url: 'u20' } },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'PullRequest', number: 20, state: 'OPEN', url: 'u20' } },
    { __typename: 'CrossReferencedEvent', source: { __typename: 'Issue', number: 99 } },
    { __typename: 'CrossReferencedEvent', source: null },
  ]
  const picked = pickLinkedPullRequests(nodes)
  assert.deepEqual(picked.map((p) => p.number), [20, 21], 'open 在前、去重、非 PR 忽略')
  assert.equal(pickLinkedPullRequests(null).length, 0)

  assert.equal(linkedPrNote(null), '')
  assert.equal(linkedPrNote([]), '')
  assert.equal(linkedPrNote([{ number: 20, state: 'OPEN' }]), '已有 PR #20（进行中）')
  assert.equal(linkedPrNote([{ number: 20, state: 'OPEN', draft: true }]), '已有 PR #20（进行中·草稿）', '草稿要说清楚')
  assert.equal(linkedPrNote([{ number: 21, state: 'MERGED', draft: true }]), '已有 PR #21（已合并）', '合并不可能是草稿，不加后缀')
  assert.equal(linkedPrNote([{ number: 22, state: 'OPEN', mergeable: 'CONFLICTING' }]), '已有 PR #22（进行中·有冲突）', '冲突要说')
  assert.equal(linkedPrNote([{ number: 23, state: 'OPEN', review: 'REVIEW_REQUIRED' }]), '已有 PR #23（进行中·等 review）')
  assert.equal(linkedPrNote([{ number: 26, state: 'OPEN', ci: 'FAILURE' }]), '已有 PR #26（进行中·CI 失败）')
  assert.equal(linkedPrNote([{ number: 26, state: 'OPEN', ci: 'PENDING' }]), '已有 PR #26（进行中·CI 运行中）')
  assert.equal(linkedPrNote([{ number: 26, state: 'OPEN', ci: 'SUCCESS' }]), '已有 PR #26（进行中）', 'CI 绿了不用提')
  assert.equal(linkedPrNote([{ number: 24, state: 'OPEN', review: 'CHANGES_REQUESTED' }]), '已有 PR #24（进行中·被要求修改）')
  assert.equal(
    linkedPrNote([{ number: 25, state: 'OPEN', mergeable: 'CONFLICTING', review: 'REVIEW_REQUIRED', draft: true }]),
    '已有 PR #25（进行中·草稿·有冲突·等 review）',
    '多个状态可叠加',
  )
  assert.equal(linkedPrNote([{ number: 21, state: 'MERGED' }]), '已有 PR #21（已合并）')
  assert.match(linkedPrNote([{ number: 20, state: 'OPEN' }, { number: 21, state: 'CLOSED' }]), /等 2 个/)

  const item = { number: 7, title: 'x', state: 'open', html_url: 'u7', user: { login: 'u' }, labels: [], assignees: [], linkedPr: [{ number: 20, state: 'OPEN' }] }
  assert.ok(formatWatchText('o/r', [item], {}).includes('已有 PR #20'), '消息里要提醒')
})

test('错误归类覆盖真实见过的 12 种（别退回 other）', () => {
  const cases = [
    ['unexpected EOF', 'network'],
    ['HTTP 403: API rate limit exceeded for user ID 1.', 'ratelimit'],
    ['gh: Not Found (HTTP 404)', 'notfound'],
    ['dial tcp 140.82.114.6:443: i/o timeout', 'network'],
    ['Bad credentials', 'auth'],
    ['error: unable to get local issuer certificate', 'network'],
    ['HTTP 502 Bad Gateway', 'gateway'],
    ['secondary rate limit', 'ratelimit'],
    ['repository "o/r" not found', 'notfound'],
    ['gh: command not found', 'nogh'],
    ['context deadline exceeded', 'network'],
    ['You have exceeded a secondary rate limit', 'ratelimit'],
  ]
  for (const [text, kind] of cases) {
    const r = classifyGhError(text)
    assert.equal(r.kind, kind, `「${text}」应归为 ${kind}，实际 ${r.kind}`)
    assert.ok(r.hint && r.hint.length > 4, `「${text}」必须带一句人话提示`)
  }
  // "command not found" 不能被当成 notfound 仓库
  assert.equal(classifyGhError('gh: command not found').kind, 'nogh')
})

test('时段外要算清"还有多久开门"（并把轮询安排到那一刻）', () => {
  const at = (h, m) => new Date(2026, 10, 2, h, m, 0)
  // 时段内：0
  assert.equal(msUntilActiveWindow('09:00-18:00', at(10, 0)), 0)
  // 夜里 23:30，第二天 09:00 开门 → 9.5 小时
  assert.equal(msUntilActiveWindow('09:00-18:00', at(23, 30)), (9 * 60 + 30) * 60 * 1000)
  // 早上 07:00 → 2 小时
  assert.equal(msUntilActiveWindow('09:00-18:00', at(7, 0)), 2 * 60 * 60 * 1000)
  // 跨夜时段 22:00-06:00：凌晨 3 点在时段内
  assert.equal(msUntilActiveWindow('22:00-06:00', at(3, 0)), 0)
  // 跨夜时段：下午 15:00 → 到 22:00 还有 7 小时
  assert.equal(msUntilActiveWindow('22:00-06:00', at(15, 0)), 7 * 60 * 60 * 1000)
  // 非法/空 → 0（当作一直活跃）
  assert.equal(msUntilActiveWindow('', at(3, 0)), 0)
  assert.equal(msUntilActiveWindow('乱写', at(3, 0)), 0)
  // 永远 >= 1 秒，避免 0 延迟死循环
  assert.ok(msUntilActiveWindow('09:00-18:00', at(8, 59)) >= 1000)
})

test('被每小时上限挡住时，要算得出"还有多久有名额"', () => {
  const now = Date.UTC(2026, 10, 2, 10, 0, 0)
  // 名额没满 -> 现在就可以
  assert.equal(nextWaketimeAt([now - 60_000], 6, now), now)
  // 满 6 次，最早那次在 30 分钟前 -> 还要等 30 分钟
  const times = [30, 25, 20, 15, 10, 5].map((min) => now - min * 60_000)
  assert.equal(nextWaketimeAt(times, 6, now), now - 30 * 60_000 + 60 * 60_000)
  // 过期的不算（超过 1 小时的自动剔除）
  assert.equal(nextWaketimeAt([now - 70 * 60_000], 6, now), now)
  // cap 非法/0 时按 6 兜底，不崩
  assert.equal(typeof nextWaketimeAt(times, 0, now), 'number')
})

test('隔离区回收：年龄线之外再加数量线（否则 6 次/小时 × 3 天 = 432 个副本）', () => {
  const now = Date.UTC(2026, 10, 2, 12, 0, 0)
  const mk = (name, minsAgo) => ({ name, mtimeMs: now - minsAgo * 60_000 })
  const entries = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk('wt' + i, i)) // wt1 最新

  // 都在 3 天内（年龄线不回收），但数量线只留 5 个 -> 回收最旧的 3 个
  const out = staleWorktrees(entries, { now, keepMs: 3 * 86400_000, keepCount: 5 })
  assert.deepEqual(out.map((e) => e.name).sort(), ['wt6', 'wt7', 'wt8'])

  // keepCount 足够大时，只剩年龄线生效
  assert.equal(staleWorktrees(entries, { now, keepMs: 3 * 86400_000, keepCount: 100 }).length, 0)

  // 超龄的即使很新也要回收（wt1 是 3 天前的？不：这里造一个超龄的）
  const oldOne = [mk('old', 60 * 24 * 60)] // 60 天前
  const aged = staleWorktrees([...entries, ...oldOne], { now, keepMs: 3 * 86400_000, keepCount: 100 })
  assert.deepEqual(aged.map((e) => e.name), ['old'])

  // 非法 entry 不该让它崩
  assert.equal(staleWorktrees([null, {}, { name: 'x' }], { now }).length, 0)
})
