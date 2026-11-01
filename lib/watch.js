/**
 * Pure watcher logic — no I/O, no timers, no Cordis.
 *
 * Kept separate so the behaviour that matters (what counts as news, when a wake
 * is allowed, what the wake text says) is unit-testable without a DSH host.
 */

/**
 * Which items are news?
 *
 * A single global cursor is not enough: after the agent acts on an item the
 * item's `updated_at` moves, so a global cursor would report that same item
 * again — the self-echo. The watermark is therefore per item, with the global
 * cursor only as a floor for items never seen before.
 *
 * @param {Array<{number:number, updated_at:string}>} items
 * @param {{seen?: Record<string,string>, cursor?: string|null}} state
 * @returns {Array<object>} items whose own updated_at moved past its watermark
 */
export function splitFresh(items, state = {}) {
  const seen = state.seen ?? {}
  const floor = state.cursor ? Date.parse(state.cursor) : 0
  return (items ?? []).filter((item) => {
    const prev = seen[String(item.number)]
    const baseline = prev ? Date.parse(prev) : floor
    return Date.parse(item.updated_at) > baseline
  })
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
export function formatWatchText(repo, fresh) {
  const lines = (fresh ?? []).map((item) => {
    const kind = item.pull_request ? 'PR' : 'issue'
    const who = (item.user && item.user.login) || '?'
    return `#${item.number} [${item.state}] ${item.title} — @${who} (${kind}) ${item.html_url}`
  })
  return (
    `【watch】${repo} 有 ${lines.length} 条新动态：\n` +
    lines.join('\n') +
    '\n\n按 AGENTS.md 的项目规则判断后处理；不要扩大范围。'
  )
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
