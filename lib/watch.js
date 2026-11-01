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
  const moreLine = more > 0
    ? `\n（另有 ${more} 条：${rest}，处理完这批再看）`
    : ''
  return (
    `【主理鱼】${repo} 有 ${lines.length} 条新动态：\n` +
    lines.join('\n') +
    moreLine +
    isoLine +
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
export function passesFilters(item, filters = DEFAULT_FILTERS) {
  const f = { ...DEFAULT_FILTERS, ...(filters || {}) }
  if (f.skipClosed && item.state && item.state !== 'open') return false
  if (f.skipDrafts && item.draft) return false
  if (f.skipBots && isBot(item)) return false

  const names = labelNames(item).map((n) => String(n).toLowerCase())
  const lower = (arr) => (arr || []).map((n) => String(n).toLowerCase())
  if (f.ignoreLabels.length > 0 && lower(f.ignoreLabels).some((n) => names.includes(n))) return false
  if (f.labels.length > 0 && !lower(f.labels).some((n) => names.includes(n))) return false

  if (f.onlyAssigned) {
    const assignees = (item.assignees ?? []).map((a) => String((a && a.login) || a).toLowerCase())
    if (f.assignee) return assignees.includes(f.assignee.toLowerCase())
    return assignees.length > 0
  }
  return true
}

/** 单次唤醒最多带几条；其余留到下一轮，别让一次唤醒把上下文撑爆。 */
export function batchFresh(fresh, limit = 3) {
  const list = fresh ?? []
  const n = Math.max(1, Number(limit) || 3)
  return list.slice(0, n)
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
