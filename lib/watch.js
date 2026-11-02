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

/**
 * 隔离区（worktree）会随每次唤醒累积。返回超过 keepMs 没动过的那些，交给调用方回收。
 * 纯函数，单测覆盖。
 */
export function staleWorktrees(entries, options = {}) {
  const { now = Date.now(), keepMs = 3 * 24 * 3600 * 1000 } = options
  return (entries ?? []).filter((entry) => {
    if (!entry || !entry.name) return false
    const mtime = Number(entry.mtimeMs)
    return Number.isFinite(mtime) && now - mtime > keepMs
  })
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
export function classifyGhError(detail) {
  const text = String(detail || '')
  // 长 URL 压缩，避免一整条 API 地址占满面板
  const short = text
    .replace(/Get "https?:\/\/[^"]{16,}"/g, 'GitHub API 请求')
    .replace(/Post "https?:\/\/[^"]{16,}"/g, 'GitHub API 请求')
    .slice(0, 200)

  if (/HTTP 401|Bad credentials|requires authentication/i.test(text)) {
    return { kind: 'auth', short, hint: '（gh 登录失效：跑 gh auth login，或在面板填 token）' }
  }
  if (/HTTP 403|rate limit|API rate limit exceeded/i.test(text)) {
    return { kind: 'ratelimit', short, hint: '（被 GitHub 限流：等几分钟，或换成带 token 的凭证）' }
  }
  if (/ENOENT|not found.*gh|gh: command not found/i.test(text)) {
    return { kind: 'nogh', short, hint: '（找不到 gh 命令：确认已安装且在 PATH）' }
  }
  if (/HTTP 404|HTTP 403|Not Found[\s\S]*404|Not Found/.test(text)) {
    return { kind: 'notfound', short, hint: '（仓库不存在或没权限：检查 owner/name）' }
  }
  if (/EOF|i\/o timeout|connection reset|dial tcp|TLS handshake|no such host|proxyconnect|timeout/i.test(text)) {
    return { kind: 'network', short, hint: '（网络抖动：这一轮没连上 GitHub，已按退避自动重试，不需要手动处理）' }
  }
  return { kind: 'other', short, hint: '' }
}

/**
 * 解析 `gh api --include` 的输出：状态行 / 响应头 / 空行 / 正文。
 *
 * 为什么用它而不是直接 `gh api`：GitHub 官方文档明确说
 * 「Make authenticated conditional requests, so that unchanged data does not count against
 * your primary rate limit」—— 带上 If-None-Match 后，没变化时拿 304，
 * 304 **不计入**速率限制。对一个每 N 秒轮询的工具，这是最直接的省额度手段。
 *
 * 出处：https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api
 */
export function parseGhInclude(stdout) {
  const text = String(stdout || '')
  const LF = String.fromCharCode(10)
  const blank = LF + LF
  const idx = text.indexOf(blank)
  const head = idx < 0 ? text : text.slice(0, idx)
  const body = idx < 0 ? text.trim() : text.slice(idx + blank.length)
  const lines = head.split(LF)
  const statusParts = String(lines[0] || '').split(' ')
  const status = Number(statusParts[1]) || 0
  const header = (name) => {
    const needle = name.toLowerCase() + ':'
    for (const line of lines) {
      if (line.toLowerCase().startsWith(needle)) return line.slice(needle.length).trim()
    }
    return null
  }
  const numeric = (name) => {
    const raw = header(name)
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  const resetSeconds = numeric('x-ratelimit-reset')
  // Stage 2 限流（secondary rate limit）用 Retry-After 告诉你等多久；primary 用 x-ratelimit-reset
  const retryAfterRaw = header('retry-after')
  return {
    status,
    etag: header('etag'),
    remaining: numeric('x-ratelimit-remaining'),
    limit: numeric('x-ratelimit-limit'),
    resetAt: resetSeconds ? new Date(resetSeconds * 1000).toISOString() : null,
    retryAfter: Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : null,
    body,
  }
}

/**
 * 额度自适应：GitHub 主额度快用完时，不要继续按固定间隔撞墙。
 *
 * 依据：GitHub 每次响应都带 `X-RateLimit-Remaining` / `X-RateLimit-Reset`
 * （实测 `gh api --include` 的输出里就是这几个头）。
 * 剩余低于阈值时，把下一次轮询推到额度重置时间（最多等 1 小时），而不是继续发请求。
 */
/**
 * GitHub 的「第二阶段限流」会在 403/429 响应里带 `Retry-After: <秒>`。
 * 按它等，比我们瞎猜一个退避时间准确得多。
 * 依据：GitHub 暴露头里明确包含 `Retry-After`（实测 `gh api --include` 的
 * Access-Control-Expose-Headers 一行里就能看到），且官方限流文档要求遵守它。
 */
export function retryAfterMs(retryAfter, { capMs = 3600 * 1000 } = {}) {
  const seconds = Number(retryAfter)
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.min(capMs, Math.round(seconds * 1000))
}

export function throttleDelayMs({ remaining, resetAt, now = Date.now(), threshold = 500, capMs = 3600 * 1000 } = {}) {
  if (remaining === null || remaining === undefined) return 0
  if (Number(remaining) >= Number(threshold)) return 0
  const reset = Date.parse(resetAt || '')
  if (!Number.isFinite(reset)) return Math.min(capMs, 5 * 60 * 1000)
  const wait = reset - now + 1000
  if (wait <= 0) return 0
  return Math.min(capMs, wait)
}

/**
 * 去同步抖动：给每个 watcher 一个**确定性的**起始偏移，避免 N 条守在同一条时间线上一起发车。
 *
 * 为什么不用随机数：随机数每次启动都不同，调试时对不上；用 id 的哈希则「同一条守永远同一个偏移」，
 * 既错峰又可复现。范围固定在 [0, windowMs)。
 *
 * 依据：AWS Architecture Blog 的《Exponential Backoff And Jitter》——同步发车会让
 * 下游在整点承压，加入抖动后峰值被摊平。（https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/）
 */
export function jitterMs(key, windowMs) {
  const width = Math.max(0, Math.floor(Number(windowMs) || 0))
  if (width === 0) return 0
  const text = String(key || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 1000003
  return hash % width
}

/**
 * 把「为什么没叫醒」做成可统计的分布。
 *
 * 背景：我们每轮只留最近 5 条过滤记录（`filteredLog`），客户想知道
 * 「为什么我加的标签一条都没被叫醒」时看不出全貌。这里按原因累计次数，
 * 面板上就能直接读「不在标签白名单: ai-fix × 37」这种结论。
 *
 * 依据：GitHub 的 issue 过滤语义本身就是「限定词 + 集合运算」
 * （label:/assignee:/state:…，见 GitHub 文档「Filtering and searching issues」），
 * 所以「被哪条限定词刷掉」比「被刷掉」更值得告诉用户。
 */
export function countReasons(counts, reason, { maxKinds = 12 } = {}) {
  const map = { ...(counts || {}) }
  if (!reason) return map
  const key = String(reason).slice(0, 60)
  map[key] = (Number(map[key]) || 0) + 1
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, maxKinds)
  return Object.fromEntries(entries)
}

/**
 * 仓库权限提示：只读仓库上我们**没法**回写结果（评论、打标签都会 403）。
 *
 * 依据：`GET /repos/{owner}/{repo}` 返回 `permissions.push`，官方文档里这个对象就是
 * "你有没有写权限"的权威来源。事先知道，比跑到一半才发现 403 好。
 * 出处：https://docs.github.com/en/rest/repos/repos#get-a-repository
 */
export function accessNote(repoAccess) {
  if (!repoAccess || typeof repoAccess !== 'object') return ''
  if (repoAccess.push === true) return ''
  if (repoAccess.push === false) {
    return '你对 ' + String(repoAccess.repo || '这个仓库') + ' 只有读权限：能看、能被叫醒，但没法回写评论或打标签 —— '
      + '要么换有写权限的 token，要么把结论写在本地/PR 描述里。'
  }
  return ''
}

/**
 * 仓库结构提示：主理鱼只认 issue/PR，所以「这个仓库没有 issue」要提前说。
 *
 * 依据：`GET /repos/{owner}/{repo}` 返回 `has_issues` / `fork` / `parent.full_name`
 * （本机实测这三个字段都在：`{fork, has_issues, parent, private}`）。
 * 出处：https://docs.github.com/en/rest/repos/repos#get-a-repository
 */
export function repoStructureNote(repoAccess) {
  if (!repoAccess || typeof repoAccess !== 'object') return ''
  const repo = String(repoAccess.repo || '这个仓库')
  if (repoAccess.archived === true) {
    return repo + ' 已归档：GitHub 上归档仓库是只读的，评论和打标签都会失败 —— 守它只能看、不能回写。'
  }
  if (repoAccess.disabled === true) {
    return repo + ' 已被禁用：这个仓库当前不可用，主理鱼不会拿到任何条目。'
  }
  if (repoAccess.hasIssues === false) {
    return repo + ' 关闭了 Issues —— 主理鱼只认 issue / PR，这里不会有任何条目可接。'
  }
  if (repoAccess.fork === true && repoAccess.parent && repoAccess.hasIssues !== true) {
    return repo + ' 是 ' + String(repoAccess.parent) + ' 的 fork。fork 默认不带 Issues，'
      + 'issue 大多落在上游 —— 确认你要守的是哪一个（守上游就把仓库填成 ' + String(repoAccess.parent) + '）。'
  }
  return ''
}

/**
 * 仓库能力徽章：把「这条守到底能不能干活」压缩成几个短标签。
 *
 * 依据：`GET /repos` 的 `archived` / `disabled` / `private` / `fork` / `has_issues` / `permissions.push`
 * 就是全部需要的判断依据（本机实测 atom/atom 的 `archived` 为 true）。
 * 出处：https://docs.github.com/en/rest/repos/repos#get-a-repository
 */
export function repoBadges(repoAccess) {
  if (!repoAccess || typeof repoAccess !== 'object') return []
  const badges = []
  // 归档仓库在 GitHub 上是完全只读的：评论、打标签都会失败 —— 比"没有写权限"更彻底
  if (repoAccess.archived === true) badges.push({ text: '已归档', tone: 'warning' })
  if (repoAccess.disabled === true) badges.push({ text: '已禁用', tone: 'danger' })
  if (repoAccess.hasIssues === false) badges.push({ text: '无 Issues', tone: 'warning' })
  if (repoAccess.fork === true && repoAccess.parent && repoAccess.hasIssues !== true) {
    badges.push({ text: 'fork · 上游 ' + String(repoAccess.parent), tone: 'outline' })
  }
  if (repoAccess.push === false) badges.push({ text: '只读', tone: 'warning' })
  if (repoAccess.private === true) badges.push({ text: '私有', tone: 'outline' })
  return badges
}

/**
 * 仓库名纠错：404 之后从搜索结果里挑一个最像的，别让客户自己猜。
 *
 * 依据：`GET /search/repositories?q=<name>+in:name` 能按仓库名检索；
 * **但它走独立的 search 池**（本机实测 response header：`x-ratelimit-limit: 30`，
 * 即 30 次/分钟，远小于 core 的 5000）—— 所以只能在 404 之后偶尔调用，绝不能每轮轮询都用。
 * 出处：https://docs.github.com/en/rest/search/search#search-repositories
 */
export function pickSuggestion(query, candidates) {
  const wanted = String(query || '').trim().toLowerCase()
  if (!wanted) return null
  const list = Array.isArray(candidates) ? candidates.filter((name) => typeof name === 'string') : []
  const exactName = wanted.includes('/') ? wanted.split('/')[1] : wanted
  // 优先级：仓库名完全相同 > 名字里包含 > 仅 owner 相同（最后这种基本没价值，直接丢）
  const sameName = list.find((name) => name.toLowerCase().endsWith('/' + exactName))
  if (sameName) return sameName
  const contains = list.find((name) => name.toLowerCase().includes(exactName) && exactName.length >= 4)
  return contains || null
}

/**
 * 「最后是谁在说话」：一条 issue 的最后评论者与时间。
 *
 * 为什么要它：会话被叫醒后第一件事就是判断「是不是已经有人处理了」。
 * 只给 issue 作者和更新时间不够 —— 更新时间可能是我自己打的标签引起的。
 *
 * 代价：每条 issue 一次 `GET /issues/{n}/comments`，所以只在**评论数 > 0** 且**批次前几条**里取，
 * 失败就静默省略（宁可少一行，不要拖慢唤醒）。
 * 出处：https://docs.github.com/en/rest/issues/comments#list-issue-comments
 */
export function commentSummaryLine(lastComment, viewer) {
  if (!lastComment || typeof lastComment !== 'object') return ''
  const login = lastComment.login ? String(lastComment.login) : ''
  // 最后一条是"我们自己"发的，意义完全不同：那不是"有人在处理"，而是上一轮留下的痕迹。
  // 依据：GET /user 返回当前 token 对应的账号（本机实测：`gh api user --jq .login` → 我们的账号名）。
  // 出处：https://docs.github.com/en/rest/users/users#get-the-authenticated-user
  const isSelf = Boolean(login && viewer && login.toLowerCase() === String(viewer).toLowerCase())
  const who = login ? (isSelf ? '我（上一轮留的）' : '@' + login) : ''
  const when = lastComment.at ? String(lastComment.at) : ''
  if (!who && !when) return ''
  return [who, when].filter(Boolean).join(' ')
}

/**
 * 批量取"最后一条评论"的 GraphQL 查询：一次请求拿 N 条，别一条一个 REST 调用。
 *
 * 依据：GraphQL 支持别名（alias）在同一请求里查多个 issue，且计费按点数而非请求数；
 * 但我们只用它的"批量"能力，复杂度极低（一个 repository + N 个 issue 别名）。
 * 出处：https://docs.github.com/en/graphql
 */
export function buildCommentBatchQuery(count) {
  const n = Math.max(0, Math.min(10, Number(count) || 0))
  const parts = []
  for (let i = 0; i < n; i += 1) {
    parts.push('  i' + i + ': issue(number: $n' + i + ') { number comments(last: 1) { nodes { author { login } createdAt } } }')
  }
  const vars = Array.from({ length: n }, (_, i) => '$n' + i + ': Int!').join(', ')
  return 'query($owner: String!, $name: String!' + (n > 0 ? ', ' + vars : '') + ') {'
    + ' repository(owner: $owner, name: $name) {'
    + String.fromCharCode(10) + parts.join(String.fromCharCode(10)) + String.fromCharCode(10)
    + '} }'
}

/**
 * 解析批量结果：把 {i0: {number, comments:{nodes:[…]}}} 摊平成 {number: {login, at}}。
 * 单个 issue 不存在时 GraphQL 会在 `errors` 里报 NOT_FOUND，但同请求里别的 issue 仍然有值 ——
 * 所以我们**只看 data，不因为 errors 整体放弃**。
 */
export function parseCommentBatch(payload) {
  const out = {}
  const repo = payload && payload.data && payload.data.repository
  if (!repo || typeof repo !== 'object') return out
  for (const value of Object.values(repo)) {
    if (!value || typeof value !== 'object') continue
    const nodes = value.comments && value.comments.nodes
    const node = Array.isArray(nodes) && nodes.length > 0 ? nodes[nodes.length - 1] : null
    if (!node) continue
    const login = node.author && node.author.login ? String(node.author.login) : ''
    if (!login) continue
    out[String(value.number)] = { login, at: node.createdAt ? String(node.createdAt) : '' }
  }
  return out
}
