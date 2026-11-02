import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

import { decodeBody } from '../lib/body.js'
import * as watchModule from '../lib/watch.js'
import {
  classifyGhError,
  parseGhInclude,
  accessNote,
  pickSuggestion,
  repoBadges,
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
  assert.deepEqual(parsed['7'], { login: 'helper', at: '2026-11-02T07:00:00Z' })
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
