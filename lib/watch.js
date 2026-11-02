/**
 * Pure watcher logic — no I/O, no timers, no Cordis.
 *
 * Kept separate so the behaviour that matters (what counts as news, when a wake
 * is allowed, what the wake text says) is unit-testable without a DSH host.
 */

/**
 * Split items into "report now" and "absorb silently".
 *
 * An item's `updated_at` moves for two different reasons:
 *
 * 1. Genuinely new activity → report it.
 * 2. Our own follow-up actions (comment, close, label) on an item we just
 *    handled → the item is newer than its watermark, but it is not news.
 *
 * A pure cooldown is not enough: it only *delays* the second kind, and once the
 * window expires the item resurfaces. So a bump that falls inside the cooldown
 * is **absorbed** — its watermark is advanced without a wake — and never comes
 * back. Only bumps that arrive after the window are reported.
 *
 * @param {Array<{number:number, updated_at:string}>} items
 * @param {{seen?: Record<string,string>, cursor?: string|null, lastReported?: Record<string,number>}} state
 * @param {{now?: number, cooldownMs?: number}} [options]
 * @returns {{fresh: Array<object>, absorbed: Array<object>}}
 */
export function partitionItems(items, state = {}, options = {}) {
  const { now = Date.now(), cooldownMs = 0 } = options
  const seen = state.seen ?? {}
  const reported = state.lastReported ?? {}
  const floor = state.cursor ? Date.parse(state.cursor) : 0
  const fresh = []
  const absorbed = []
  for (const item of items ?? []) {
    const key = String(item.number)
    const prev = seen[key]
    const baseline = prev ? Date.parse(prev) : floor
    if (!(Date.parse(item.updated_at) > baseline)) continue
    const handledAt = reported[key]
    if (cooldownMs > 0 && handledAt && now - handledAt < cooldownMs) absorbed.push(item)
    else fresh.push(item)
  }
  return { fresh, absorbed }
}

/**
 * Backwards-compatible view: only the items that warrant a wake.
 * @param {Array<object>} items
 * @param {object} state
 * @param {{now?: number, cooldownMs?: number}} [options]
 * @returns {Array<object>}
 */
export function splitFresh(items, state = {}, options = {}) {
  return partitionItems(items, state, options).fresh
}

/** Remember when each item was reported, so the cooldown window can start. */
export function recordReported(state, fresh, now = Date.now()) {
  const next = { ...(state.lastReported ?? {}) }
  for (const item of fresh ?? []) next[String(item.number)] = now
  return next
}

/**
 * May we wake now?
 *
 * A followup spliced while the agent is driving a turn lands in the client's
 * pending-input strip; the client can later restore already-sent input as a
 * draft and re-submit it. Waiting for `idle` costs at most one poll interval.
 *
 * @param {string|undefined} status agent status (`idle` | `running`)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function decideWake(status) {
  if (!status) return { ok: true }
  if (status !== 'idle') return { ok: false, reason: `agent busy (${status})` }
  return { ok: true }
}

/** Advance per-item watermarks after a successful wake. */
export function advanceSeen(seen, fresh) {
  const next = { ...(seen ?? {}) }
  for (const item of fresh ?? []) next[String(item.number)] = item.updated_at
  return next
}

/** Build the wake text. Stable shape: one line per item, then the rule reminder. */
/**
 * 唤醒消息 = 任务书。竞品的触发都带足上下文（类型、状态、作者、标签、是否草稿），
 * 否则 agent 醒来还得自己查一遍。这里一次给全。
 */
export function formatWatchText(repo, fresh, options = {}) {
  const list = fresh ?? []
  const more = Number(options.more) || 0
  const lines = list.map((item) => {
    const kind = item.pull_request ? 'PR' : 'issue'
    const draft = item.draft ? ' 草稿' : ''
    const who = (item.user && item.user.login) || '?'
    const labels = labelNames(item)
    const tail = [
      `(${kind}${draft})`,
      labels.length > 0 ? `标签: ${labels.join(', ')}` : null,
      (item.assignees ?? []).length > 0 ? `指派: ${item.assignees.map((a) => '@' + a.login).join(' ')}` : null,
      item.html_url,
      (stateReasonNote(item) && String(item.state_reason || '') === 'reopened') ? '⚠ ' + stateReasonNote(item) : null,
      assignmentNote(item) || null,
      (item.state === 'open' ? stalenessNote(item) : '') || null,
      linkedPrNote(item.linkedPr) || null,
      item.lastComment
        ? '最后评论: ' + commentSummaryLine({
          login: item.lastComment.self ? '' : item.lastComment.login,
          at: item.lastComment.at,
        }, null) + (item.lastComment.self ? '我（上一轮留的）' : '')
        : null,
    ].filter(Boolean).join(' ')
    return `#${item.number} [${item.state}] ${item.title} — @${who} ${tail}`
  })
  const rest = (options.restNumbers ?? []).map((n) => '#' + n).join(' ')
  const iso = options.isolation
  const isoLine = iso && iso.dir
    ? `\n【隔离工作区】${iso.dir}（分支 ${iso.branch}）—— 只在这里改，推这个分支开 PR，别碰主工作区；用完 git worktree remove 掉。`
    : iso && iso.error
      ? `\n【隔离失败】${iso.error}；这次请谨慎，改完别留下未提交内容。`
      : ''
  const goalLine = options.goal
    ? `${String.fromCharCode(10)}本条目主理目标：${String(options.goal).split(String.fromCharCode(13)).join(' ').split(String.fromCharCode(10)).join(' ').slice(0, 200)}`
    : ''
  const moreLine = more > 0
    ? `\n（另有 ${more} 条：${rest}，处理完这批再看）`
    : ''
  // 「为什么是这几条」：只给结果不给依据，会话/客户都没法判断要不要调过滤条件。
  // 依据：GitHub 的通知带 reason（为什么通知你）、Slack 摘要会说明分组依据 —— 同一个道理。
  const whyLine = (() => {
    const parts = []
    const changed = Number(options.changedTotal)
    if (Number.isFinite(changed) && changed > 0) parts.push('本轮共 ' + changed + ' 条变化')
    if (options.batchLimit) parts.push('按「最近更新」取前 ' + options.batchLimit + ' 条')
    const skipped = options.skippedReasons && typeof options.skippedReasons === 'object'
      ? Object.entries(options.skippedReasons).filter(([, n]) => Number(n) > 0).slice(0, 3)
      : []
    if (skipped.length > 0) parts.push('同时跳过 ' + skipped.map(([reason, n]) => reason + ' × ' + n).join('、'))
    return parts.length > 0 ? String.fromCharCode(10) + '【为什么是这几条】' + parts.join('；') : ''
  })()
  // 完成标准要「可观测」：只说"做好它"等于没说。
  // 依据：Given-When-Then 的核心是把验收写成可观察的结果（martinfowler.com/bliki/GivenWhenThen.html）。
  const accessLine = options.access ? String.fromCharCode(10) + '【权限提示】' + options.access : ''
  const criteria = Array.isArray(options.criteria) ? options.criteria.filter(Boolean).slice(0, 4) : []
  const criteriaLine = criteria.length > 0
    ? String.fromCharCode(10) + '【完成标准】' + String.fromCharCode(10)
      + criteria.map((line, i) => (i + 1) + '. ' + line).join(String.fromCharCode(10))
    : ''
  return (
    `【主理鱼】${repo} 有 ${lines.length} 条新动态：\n` +
    lines.join('\n') +
    whyLine +
    moreLine +
    isoLine +
    goalLine +
    accessLine +
    criteriaLine +
    '\n\n先读仓库 AGENTS.md 的判断规则，再决定「修 / 回 / 待定」。完成标准 = 有测试结果：没跑测试不算完成，跑不了就写清原因；做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。'
  )
}

// ── 竞品蒸馏出来的四道闸（见 docs/competitive-analysis.md） ────────────────

export const DEFAULT_FILTERS = {
  labels: [],
  ignoreLabels: [],
  skipBots: true,
  skipDrafts: true,
  skipClosed: true,
  onlyAssigned: false,
  assignee: null,
}

/** 宽容地把用户传进来的 filters 规范化，缺字段走默认。 */
export function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {}
  const list = (v) => (Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean) : [])
  return {
    labels: list(f.labels),
    ignoreLabels: list(f.ignoreLabels),
    skipBots: f.skipBots !== false,
    skipDrafts: f.skipDrafts !== false,
    skipClosed: f.skipClosed !== false,
    onlyAssigned: f.onlyAssigned === true,
    assignee: typeof f.assignee === 'string' && f.assignee.trim() ? f.assignee.trim() : null,
  }
}

const labelNames = (item) => (item.labels ?? []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter(Boolean)
const isBot = (item) => {
  const user = item.user || {}
  return user.type === 'Bot' || /\[bot\]$/i.test(String(user.login || ''))
}

/**
 * 触发要有许可：不是仓库里任何风吹草动都叫醒会话。
 * 返回 false 的条目直接不进候选集，也不会污染 seen 水位。
 */
/**
 * 为什么这条被过滤掉？返回 null 表示通过，否则返回一个可读的原因码。
 * 拆出原因是为了面板能展示「最近被过滤了什么、因为哪条规则」——
 * 否则「不在干活」和「在过滤」在界面上长得一样。
 */
export function filterReason(item, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) }
  if (f.skipClosed && item.state && item.state !== 'open') return '已关闭'
  if (f.skipDrafts && item.draft) return '草稿 PR'
  if (f.skipBots && isBot(item)) return '机器人'

  const names = labelNames(item).map((n) => String(n).toLowerCase())
  const lower = (arr) => (arr || []).map((n) => String(n).toLowerCase())
  const ignored = lower(f.ignoreLabels).find((n) => names.includes(n))
  if (ignored) return '排除标签: ' + ignored
  if (f.labels.length > 0 && !lower(f.labels).some((n) => names.includes(n))) {
    return '不在标签白名单: ' + f.labels.join(',')
  }

  if (f.onlyAssigned) {
    const assignees = (item.assignees ?? []).map((a) => String((a && a.login) || a).toLowerCase())
    if (f.assignee) return assignees.includes(f.assignee.toLowerCase()) ? null : '未指派给 @' + f.assignee
    return assignees.length > 0 ? null : '没有指派给人'
  }
  return null
}

export function passesFilters(item, filters = DEFAULT_FILTERS) {
  return filterReason(item, filters) === null
}

/** 环形缓冲：最近被过滤的条目（默认留 5 条），够解释「为什么没动」就行。 */
export function pushFiltered(log, record, max = 5) {
  const list = Array.isArray(log) ? log.slice() : []
  list.push(record)
  return list.slice(-Math.max(1, max))
}

/** 单次唤醒最多带几条；其余留到下一轮，别让一次唤醒把上下文撑爆。 */
/**
 * 优先级：一次只能处理 N 条时，该先处理哪 N 条。
 *
 * 依据：GitHub 的 issue 列表支持 `sort=created|updated|comments`（服务端排序），
 * 但它排的是"哪条更热"，我们要的是"哪条更该现在处理"——两者不同，所以在本地排。
 * 出处：https://docs.github.com/en/rest/issues/issues#list-repository-issues
 *
 * 权重（简单、可解释、可测）：
 *   被重开 100   —— 之前判过"不做"被推翻，最该看
 *   有人评论 10  —— 说明在等回应
 *   命中我们的标签 5
 *   其余按 GitHub 的 updated 顺序（稳定排序保持原相对次序）
 */
export const DEFAULT_PRIORITY = { reopened: true, comments: true, labels: true, unassigned: false }

export function priorityScore(item, options) {
  if (!item || typeof item !== 'object') return 0
  const on = { ...DEFAULT_PRIORITY, ...(options || {}) }
  let score = 0
  if (on.reopened !== false && String(item.state_reason || '') === 'reopened') score += 100
  if (on.comments !== false && Number(item.comments) > 0) score += 10
  if (on.labels !== false && Array.isArray(item.labels) && item.labels.length > 0) score += 5
  // 默认关闭：这是产品判断而非规则，客户想用再开
  if (on.unassigned === true && assignmentNote(item) !== '') score += 3
  if (on.stale === true && stalenessNote(item) !== '') score += 2
  return score
}

export function batchFresh(fresh, limit = 3, priority) {
  const list = Array.isArray(fresh) ? fresh.slice() : []
  const n = Math.max(1, Number(limit) || 3)
  // 稳定排序：分数相同就保持 GitHub 给的 updated 顺序
  const ranked = list
    .map((item, index) => ({ item, index, score: priorityScore(item, priority) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.item)
  return ranked.slice(0, n)
}

/** 连续失败指数退避：30s → 60 → 120 → … 上限 30 分钟；成功即复位。 */
export function nextDelayMs(entry, baseMs) {
  const failures = Number((entry && entry.consecutiveFailures) || 0)
  if (failures <= 0) return baseMs
  const factor = Math.min(2 ** failures, 60)
  return Math.min(baseMs * factor, 30 * 60 * 1000)
}

/** 每小时唤醒上限：把过去一小时的唤醒时间戳剪掉再判断。 */
export function pruneWakeTimes(times, now = Date.now()) {
  const floor = now - 60 * 60 * 1000
  return (times || []).map(Number).filter((t) => Number.isFinite(t) && t >= floor)
}


/** Highest `updated_at` among fresh items, used as the falling-back global cursor. */
export function newestUpdatedAt(fresh) {
  let best = null
  for (const item of fresh ?? []) {
    const at = item.updated_at
    if (!best || Date.parse(at) > Date.parse(best)) best = at
  }
  return best
}

/**
 * Pause / resume / delete one watcher, as a pure state transition.
 *
 * The host route and the tests share this so the three actions cannot drift:
 * the route only has to persist the returned state and reconcile its timers.
 * @param state - mutable `{ watchers }` record read from disk.
 * @param request - `{ action, id }`; id is `repo#sessionId`.
 * @returns `{ ok: true, action, id, enabled?, deleted? }` or `{ ok: false, error }`.
 */
export function applyWatcherAction(state, { action, id } = {}) {
  const watchers = (state && state.watchers) || {}
  const entry = watchers[id]
  if (!entry) return { ok: false, error: `unknown watcher: ${id || '(missing id)'}` }
  if (action === 'delete') {
    delete watchers[id]
    return { ok: true, action, id, deleted: true }
  }
  if (action === 'pause') {
    entry.enabled = false
    return { ok: true, action, id, enabled: false }
  }
  if (action === 'resume') {
    entry.enabled = true
    // A stale error would make the satellite look broken on the first frame
    // after the operator turns it back on; the next poll repopulates it.
    entry.lastError = null
    return { ok: true, action, id, enabled: true }
  }
  return { ok: false, error: 'action must be pause | resume | delete' }
}

// ── DeepSeek 论文蒸馏：记忆要遗忘 + 幂等要留在外部系统 ──────────────────

/** 处理完打在这个 issue/PR 上的标签，轮询时直接跳过 —— 换机器也不会重报。 */
export const DEFAULT_ACK_LABEL = '主理鱼:已处理'

export function hasAckLabel(item, label = DEFAULT_ACK_LABEL) {
  const want = String(label).toLowerCase()
  return labelNames(item).some((n) => String(n).toLowerCase() === want)
}

/**
 * `seen` / `lastReported` 会随条目无限增长（DeepSeek-OCR 那篇把这件事叫记忆遗忘）。
 * 超过 maxAgeMs 或超过 maxEntries 的旧记录直接丢掉 —— 丢掉的代价只是「老 issue 可能被重报一次」。
 */
export function pruneSeen(seen, options = {}) {
  const { maxAgeMs = 30 * 24 * 3600 * 1000, maxEntries = 500, now = Date.now() } = options
  const entries = Object.entries(seen ?? {})
    .map(([k, v]) => [k, Date.parse(v)])
    .filter(([, t]) => Number.isFinite(t) && now - t <= maxAgeMs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntries)
  return Object.fromEntries(entries.map(([k, t]) => [k, new Date(t).toISOString()]))
}

/**
 * 隔离工作区命名（对应 DeepSeek DSec 的沙箱思路）：一次唤醒一个一次性 worktree，
 * 让 agent 在副本里改，主工作区不受污染。纯函数，方便测试。
 */
export function worktreePlan({ workdir, repo, sessionTag, stamp = Date.now() } = {}) {
  const safeRepo = String(repo || 'repo').replace(/[^A-Za-z0-9._-]+/g, '-')
  const safeTag = String(sessionTag || 'session').replace(/^session-/, '').replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 8) || 'session'
  const id = `${safeRepo}-${safeTag}-${Number(stamp).toString(36)}`
  const root = String(workdir || '.').replace(/[\\/]+$/, '')
  return {
    id,
    dir: `${root}/.dsh-zhuli/${id}`,
    branch: `zhuli/${id}`,
  }
}

/**
 * 隔离区（worktree）会随每次唤醒累积。返回超过 keepMs 没动过的那些，交给调用方回收。
 * 纯函数，单测覆盖。
 */
/**
 * 该回收的隔离区：**按年龄** + **按数量** 两条线（原来只有年龄）。
 *
 * 为什么补数量：年龄线管不住"堆" —— 上限 6 次/小时 × 保留 3 天 = 最坏 432 个副本。
 * 实测一个 worktree ≈ 该仓库工作树的大小（我们的仓库 1.3 MB，一个 3 MB 文件的测试仓库开出 2.9 MB），
 * 按 10 MB 估就是 4 GB 级占用。
 *
 * `keepCount`：最近 N 个无论多老都留着（正在用的那个不能被删）。
 */
export function staleWorktrees(entries, options = {}) {
  const { now = Date.now(), keepMs = 3 * 24 * 3600 * 1000, keepCount = 5 } = options
  const list = (entries ?? []).filter((entry) => entry && entry.name && Number.isFinite(Number(entry.mtimeMs)))
  const byAge = list.filter((entry) => now - Number(entry.mtimeMs) > keepMs)
  const cap = Math.max(0, Number(keepCount) || 0)
  const newest = list.slice().sort((a, b) => Number(b.mtimeMs) - Number(a.mtimeMs)).slice(0, cap)
  const keep = new Set(newest.map((entry) => entry.name))
  const byCount = list.filter((entry) => !keep.has(entry.name))
  const out = []
  const seen = new Set()
  for (const entry of [...byAge, ...byCount]) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)
    out.push(entry)
  }
  return out
}

/**
 * 活跃时段控制（对标 Renovate 的 schedule）：只在人和 agent 都清醒的时段唤醒，
 * 夜里攒着。spec 形如 "09:00-23:00"，支持跨夜 "22:00-06:00"；空值或格式不对 = 一直活跃。
 * 用本地时间判断。
 */
export function inActiveHours(spec, now = new Date()) {
  if (!spec || typeof spec !== 'string') return true
  const m = spec.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return true
  const toMin = (h, mi) => (Number(h) * 60 + Number(mi)) % (24 * 60)
  const start = toMin(m[1], m[2])
  const end = toMin(m[3], m[4])
  const cur = now.getHours() * 60 + now.getMinutes()
  if (start === end) return true
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

/**
 * 唤醒历史（面板要能看见「上一轮干了什么」）。只保留最近 max 条。
 */
export function pushHistory(history, record, max = 20) {
  const list = Array.isArray(history) ? history.slice() : []
  list.push(record)
  return list.slice(-Math.max(1, max))
}

/** 只允许从内存 entry 写回的轮询结果字段。配置类字段（enabled/filters/…）以盘上为准。 */
export const POLL_RESULT_FIELDS = [
  'lastPoll', 'lastError', 'nextAt', 'consecutiveFailures', 'seen', 'cursor', 'lastReported',
  'lastWake', 'lastWakeCount', 'lastBatch', 'lastAbsorbed', 'wakeTimes', 'lastDeferred',
  'history', 'lastWorktree', 'lastAcked', 'lastTrigger',
  // 过滤记录也是轮询结果：漏了它面板上的「最近被过滤」永远是空的
  'filteredLog',
]

/**
 * 把一次轮询的内存结果合并进盘上记录：配置类字段永远以盘上为准。
 * 这条规则是审核找出来的 —— tick 收尾曾把「暂停」写回成运行中。
 */
export function mergePollResult(stored, polled) {
  const merged = { ...(stored || {}) }
  for (const key of POLL_RESULT_FIELDS) {
    if (polled && polled[key] !== undefined) merged[key] = polled[key]
  }
  return merged
}

/**
 * 部分更新过滤器：只用 patch 里「出现过的键」覆盖，没出现的保持原值。
 * 踩过的坑：GUI 只发 labels/onlyAssigned，服务端整对象重建会把 ignoreLabels / skip* / assignee 全抹成默认。
 */
export function mergeFilters(base, patch) {
  const current = normalizeFilters(base)
  if (!patch || typeof patch !== 'object') return current
  const next = { ...current }
  if ('labels' in patch) next.labels = normalizeFilters({ labels: patch.labels }).labels
  if ('ignoreLabels' in patch) next.ignoreLabels = normalizeFilters({ ignoreLabels: patch.ignoreLabels }).ignoreLabels
  if ('skipBots' in patch) next.skipBots = patch.skipBots !== false
  if ('skipDrafts' in patch) next.skipDrafts = patch.skipDrafts !== false
  if ('skipClosed' in patch) next.skipClosed = patch.skipClosed !== false
  if ('onlyAssigned' in patch) next.onlyAssigned = patch.onlyAssigned === true
  if ('assignee' in patch) next.assignee = normalizeFilters({ assignee: patch.assignee }).assignee
  return next
}

/**
 * 把 gh 失败时的原始文本归类成「一句话原因 + 该怎么做」。
 *
 * 真机上出现过 `Get "https://api.github.com/...": EOF` 这种直接怼给用户看的原始报错 ——
 * 它既长又吓人，其实是**网络抖动**，自动退避重试就会好。这里把它变成人话。
 *
 * @returns {{ kind: string, short: string, hint: string }}
 */
// 拆分后：GitHub 交互层在 gh-format.js，这里转出以保持既有调用方不变
import {
  assignmentNote, commentSummaryLine, linkedPrNote, stalenessNote, stateReasonNote,
} from './gh-format.js'
export {
  TRIAGE_SIGNALS,
  accessNote,
  assignmentNote,
  buildCommentBatchQuery,
  classifyGhError,
  commentSummaryLine,
  countReasons,
  jitterMs,
  linkedPrNote,
  parseCommentBatch,
  parseGhInclude,
  pickLinkedPullRequests,
  pickSuggestion,
  repoBadges,
  repoStructureNote,
  retryAfterMs,
  stalenessNote,
  stateReasonNote,
  throttleDelayMs,
} from './gh-format.js'

/**
 * 距离「活跃时段开门」还有多久（毫秒）；已在时段内返回 0。
 *
 * 为什么要它：以前 activeHours 的判断在**拉完 API 之后**才做 ——
 * 夜里 8 小时照常每 N 秒打一次 GitHub，纯属白跑。现在提前到最前面，
 * 并把下一次轮询安排在"开门那一刻"，既不浪费请求，也不会让攒着的条目干等一个周期。
 */
export function msUntilActiveWindow(spec, now = new Date()) {
  if (!spec || typeof spec !== 'string') return 0
  const m = spec.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
  if (!m) return 0
  if (inActiveHours(spec, now)) return 0
  const startMin = (Number(m[1]) * 60 + Number(m[2])) % (24 * 60)
  const curMin = now.getHours() * 60 + now.getMinutes()
  const curSec = now.getSeconds()
  let diffMin = startMin - curMin
  if (diffMin <= 0) diffMin += 24 * 60
  // 精确到分钟的开头，再减掉当前秒数
  return Math.max(1000, diffMin * 60 * 1000 - curSec * 1000)
}

/**
 * 被「每小时上限」挡住时，下一个名额什么时候空出来。
 *
 * 为什么要它：cap=6 时最坏要等近 1 小时（实测：滑动窗口下 6 次集中在开头几分钟，
 * 之后要等最早那次过期）。这段时间里面板只说「已攒 N 条」，客户不知道要等多久，
 * 容易以为卡死了。算出具体时刻，就能写「约 43 分钟后可再唤醒」。
 */
export function nextWaketimeAt(wakeTimes, cap, now = Date.now()) {
  const times = pruneWakeTimes(wakeTimes, now).sort((a, b) => a - b)
  const n = Math.max(1, Number(cap) || 6)
  if (times.length < n) return now
  // 需要等最早的那 n 个里第一个过期：第 (times.length - n) 个之后的那次过期就空出一个名额
  const freeing = times[times.length - n]
  return freeing + 60 * 60 * 1000
}

/**
 * 同一条会话在过去一小时被唤醒了几次（跨所有守）。
 *
 * 为什么需要：`maxWakesPerHour` 是**按守**算的。一条会话守 5 个仓库时，
 * 上限实际是 5 × 6 = 30 次/小时 —— 这根本没保护到"别把会话的上下文打爆"，
 * 而那正是当初设这个上限的原因。
 *
 * 类比：只给单个 Pod 设 CPU limit，并不能防止整个 namespace 被打满，所以还要 ResourceQuota。
 * 出处：https://kubernetes.io/docs/concepts/policy/resource-quotas/
 */
export function sessionWakesLastHour(entries, sessionId, now = Date.now()) {
  if (!sessionId) return 0
  const list = Array.isArray(entries) ? entries : Object.values(entries || {})
  let total = 0
  for (const entry of list) {
    if (!entry || entry.sessionId !== sessionId) continue
    total += pruneWakeTimes(entry.wakeTimes, now).length
  }
  return total
}

/**
 * 把同一会话在几秒内产生的多条唤醒合并成一条。
 *
 * 实测（本轮）：同会话 3 个守、间隔都是 60 秒时，首轮抖动只把相位拉开 ≤5 秒，
 * **之后每一轮都一样** —— 三次唤醒落在 ~1 秒内，会话会连着收到 3 条注入。
 * 5 个守就是 5 条。这正是"上下文被瞬间打爆"的真实形态。
 *
 * 合并而不是"设个间隔挡掉"：硬间隔会让先到的守永远赢，后面的守被饿死。
 */
export function mergeWakeTexts(parts) {
  const list = (Array.isArray(parts) ? parts : []).filter((t) => typeof t === 'string' && t.trim())
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  // 每条唤醒都带着同一段【完成标准】和目标行 —— 合并后重复 3 遍纯属噪音（实测占约 40% 长度）。
  // 只保留第一份；内容不同的（不同仓库的完成标准确实不同）则各自保留。
  const seenCriteria = new Set()
  const seenGoal = new Set()
  const trimmed = list.map((text) => {
    let out = text
    const criteriaAt = out.indexOf('【完成标准】')
    if (criteriaAt >= 0) {
      const block = out.slice(criteriaAt)
      if (seenCriteria.has(block)) out = out.slice(0, criteriaAt).replace(/[\s]+$/, '')
      else seenCriteria.add(block)
    }
    out = out
      .split(String.fromCharCode(10))
      .filter((line) => {
        if (!line.startsWith('本条目主理目标：')) return true
        if (seenGoal.has(line)) return false
        seenGoal.add(line)
        return true
      })
      .join(String.fromCharCode(10))
    return out
  })
  const head = '【主理鱼】这一小段时间内有 ' + list.length + ' 处变化，合并成一条：'
  const body = trimmed.map((text, i) => String.fromCharCode(10, 10) + '—— 第 ' + (i + 1) + ' 处 ——' + String.fromCharCode(10) + text).join('')
  return head + body
}

/**
 * 该不该现在回收隔离区。
 *
 * 现状：每次唤醒都跑一遍回收 —— 里面是 `git worktree remove` / `branch -D` / `prune`
 * （本机实测 `worktree add` 0.19s，remove 同级；5 个过期副本就是 1 秒级），
 * 而绝大多数时候根本没有过期副本。
 *
 * 节流规则：
 * - 数量**超上限**时必须立刻回收（不能等，否则会堆）；
 * - 没超额时，距上次回收不足 `intervalMs`（默认 10 分钟）就跳过。
 */
export function shouldRunCleanup({ count = 0, keepCount = 5, lastRunAt = 0, now = Date.now(), intervalMs = 10 * 60 * 1000 } = {}) {
  const total = Number(count) || 0
  const cap = Math.max(1, Number(keepCount) || 5)
  if (total > cap) return { run: true, reason: 'over-cap' }
  const last = Number(lastRunAt) || 0
  if (last > 0 && now - last < Number(intervalMs)) return { run: false, reason: 'throttled' }
  return { run: true, reason: 'interval' }
}
