/**
 * dsh-session-superagent — session-level superagent for DeepSeek Harness.
 *
 * Two capabilities, one package:
 *   1. `github` / `repo_here` — call the GitHub API; the credential stays inside
 *      the plugin and every result is redacted before the model sees it.
 *   2. `watch_start` / `watch_status` / `watch_stop` — watch one repository and
 *      wake THIS session when something changes, by queueing a follow-up turn.
 *
 * Design constraints (see MAINTENANCE.md):
 *   - never inject while the agent is running (draft-replay hazard);
 *   - per-item watermarks, so our own writes never wake us (no self-echo);
 *   - advance the watermark only after a wake actually landed.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { zstdDecompressSync } from 'node:zlib'

import { redact } from './redact.js'
import { decodeBody } from './body.js'
import {
  advanceSeen, applyWatcherAction, batchFresh, decideWake, DEFAULT_ACK_LABEL, formatWatchText,
  hasAckLabel, inActiveHours, newestUpdatedAt, nextDelayMs, normalizeFilters, partitionItems, passesFilters,
  pruneSeen, pruneWakeTimes, recordReported, staleWorktrees, worktreePlan,
} from './watch.js'

export const name = 'dsh-session-superagent'
export const inject = ['tools', 'agents', 'webServer']

const STATE_DIR = join(homedir(), '.dsh', 'state', 'session-superagent')
const SECRETS_FILE = join(STATE_DIR, 'secrets.json')
const STATE_FILE = join(STATE_DIR, 'watchers.json')
const TRIGGER_FILE = join(STATE_DIR, 'trigger.json')
const DEFAULT_COOLDOWN_MS = 180_000

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return { watchers: {} } }
}

function writeState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
  } catch { /* state is best-effort: a failed write must not break a turn */ }
}

/** Credentials the operator typed in the panel. Never returned in plain text. */
function readSecrets() {
  try {
    const raw = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}

function writeSecrets(next) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(SECRETS_FILE, JSON.stringify(next, null, 1), { mode: 0o600 })
  } catch {}
}

/** A masked view of what is configured: shape only, never the value. */
function secretsSummary() {
  const s = readSecrets()
  return {
    token: s.token ? 'configured' : 'none',
    tokenHint: s.token ? `${String(s.token).slice(0, 4)}…${String(s.token).slice(-4)}` : null,
    sshKeyPath: s.sshKeyPath ? 'configured' : 'none',
    sshKeyHint: s.sshKeyPath ? String(s.sshKeyPath).replace(/^.*[\/]/, '…/') : null,
    updatedAt: s.updatedAt ?? null,
  }
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const titleCache = new Map()

/** Decompress a multi-frame zstd session log into text. */
function readFrames(buffer) {
  const starts = []
  let index = 0
  while ((index = buffer.indexOf(ZSTD_MAGIC, index)) !== -1) { starts.push(index); index += 4 }
  if (starts.length === 0 || starts[0] !== 0) starts.unshift(0)
  const parts = []
  for (let k = 0; k < starts.length; k += 1) {
    const end = k + 1 < starts.length ? starts[k + 1] : buffer.length
    try { parts.push(zstdDecompressSync(buffer.subarray(starts[k], end)).toString('utf8')) } catch {}
  }
  return parts.join('')
}

/** The human title the sidebar shows for a session, read from its own log. Cached by file mtime. */
function sessionTitle(sessionId) {
  try {
    if (!sessionId) return null
    const home = process.env.DSH_HOME && String(process.env.DSH_HOME).trim()
      ? String(process.env.DSH_HOME).trim()
      : join(homedir(), '.dsh')
    const root = join(home, 'sessions')
    let file = null
    for (const group of readdirSync(root)) {
      const candidate = join(root, group, sessionId, 'session.v4.jsonl.zstd')
      if (existsSync(candidate)) { file = candidate; break }
    }
    if (!file) return null
    const stat = statSync(file)
    const cached = titleCache.get(sessionId)
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached.title
    let title = null
    const lines = readFrames(readFileSync(file)).split(String.fromCharCode(10))
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]
      if (!line || line.indexOf('"session/title"') === -1) continue
      try {
        const parsed = JSON.parse(line)
        if (parsed && parsed.type === 'session/title' && parsed.data && typeof parsed.data.title === 'string') {
          title = parsed.data.title
          break
        }
      } catch {}
    }
    titleCache.set(sessionId, { mtime: stat.mtimeMs, size: stat.size, title })
    return title
  } catch { return null }
}

/**
 * The session's real goal, read through the host's own goal service — the same
 * one `/goal` and the create_goal tool use. Returns null when the host has no
 * goal service or the session has no current goal.
 */
function goalView(ctx, sessionId) {
  try {
    if (!sessionId || typeof ctx.get !== 'function') return null
    const goals = ctx.get('goals')
    const agents = ctx.get('agents')
    if (!goals || !agents || typeof goals.get !== 'function') return null
    const agent = agents.get(sessionId)
    if (!agent) return null
    const view = goals.get(agent)
    if (!view) return null
    return {
      objective: view.objective ?? null,
      phase: view.phase ?? null,
      revision: view.ref ? view.ref.revision : (view.revision ?? null),
    }
  } catch { return null }
}

/** Environment for every gh call: a panel token wins over the CLI login. */
function ghEnv() {
  const s = readSecrets()
  if (!s.token) return process.env
  return { ...process.env, GH_TOKEN: String(s.token) }
}

function persistEntry(entry) {
  try {
    const state = readState()
    state.watchers = state.watchers || {}
    // Deleted between the tick start and its write-back: never resurrect it.
    if (!state.watchers[entry.id]) return
    state.watchers[entry.id] = Object.assign({}, state.watchers[entry.id], entry)
    writeState(state)
  } catch {}
}

/**
 * 失败退避：连续失败就把下一次允许轮询的时间往后推（30s → 60 → 120 … 上限 30min）。
 * 竞品的教训很直白 —— 401 的时候还按 30 秒撞墙，只会把配额和日志一起打光。
 */
function bumpFailure(entry, baseMs) {
  entry.consecutiveFailures = (Number(entry.consecutiveFailures) || 0) + 1
  entry.nextAt = new Date(Date.now() + nextDelayMs(entry, baseMs || 60000)).toISOString()
}

/**
 * 回收过期的隔离区：每次唤醒都会开一个新 worktree，不回收就会一直涨。
 * 只删 .dsh-zhuli/ 下超过 keepDays 天没动过的目录，删不掉就留着（不阻断唤醒）。
 */
async function cleanupWorktrees(workdir, keepDays = 3) {
  if (!workdir) return 0
  const BS = String.fromCharCode(92)
  const base = String(workdir).split(BS).join('/').replace(/\/+$/, '')
  const root = base + '/.dsh-zhuli'
  let names = []
  try { names = readdirSync(root) } catch { return 0 }
  const entries = []
  for (const name of names) {
    try { entries.push({ name, mtimeMs: statSync(root + '/' + name).mtimeMs }) } catch {}
  }
  const stale = staleWorktrees(entries, { keepMs: keepDays * 24 * 3600 * 1000 })
  let removed = 0
  for (const item of stale) {
    const res = await run('git', ['-C', workdir, 'worktree', 'remove', '--force', root + '/' + item.name], { timeoutMs: 30000 })
    if (res.code === 0) removed += 1
  }
  return removed
}

/**
 * 给一次唤醒准备隔离工作区：在目标仓库上开一个一次性 git worktree。
 * 失败不阻断唤醒 —— 退化成普通模式，并在消息里说明原因。
 */
async function prepareIsolation(entry) {
  if (!entry || !entry.isolated || !entry.workdir) return null
  const plan = worktreePlan({ workdir: entry.workdir, repo: entry.repo, sessionTag: entry.sessionId })
  try {
    // 先回收过期隔离区，再开新的
    await cleanupWorktrees(entry.workdir, Number(entry.isolateKeepDays) || 3)
    const res = await run('git', ['-C', entry.workdir, 'worktree', 'add', plan.dir, '-b', plan.branch], { timeoutMs: 45000 })
    if (res.code !== 0) {
      return { error: redact([res.stderr, res.stdout].filter(Boolean).join(' ')).slice(0, 200) }
    }
    return plan
  } catch (error) {
    return { error: String((error && error.message) || error).slice(0, 200) }
  }
}

/** Spawn a command, capture both streams, never echo the credential. */
function run(file, args, options = {}) {
  const { input, cwd, env, timeoutMs = 60000 } = options
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env: env ?? process.env, windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      resolve({ code: 'timeout', stdout, stderr })
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString('utf8') })
    child.stderr.on('data', (d) => { stderr += d.toString('utf8') })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: 'spawn-error', stdout, stderr: String((e && e.message) || e) })
    })
    child.on('close', (c) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: c === null ? 0 : c, stdout, stderr })
    })
    if (input !== undefined) child.stdin.write(input)
    child.stdin.end()
  })
}

function defineTool(options) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(options.parameters)) {
    properties[key] = {}
    if (spec.type) properties[key].type = spec.type
    if (spec.description) properties[key].description = spec.description
    if (spec.required) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties, ...(required.length ? { required } : {}) },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const record = args && typeof args === 'object' ? args : {}
      for (const key of required) {
        if (record[key] === undefined || record[key] === null || record[key] === '') {
          return `[error: missing required parameter "${key}"]`
        }
      }
      return options.execute(record)
    },
  }
}

/**
 * Wake one live session with a user message.
 *
 * `Agent.followup()` queues an ordinary turn AND wakes the driver; the durable
 * inbox alone only parks the message (the client shows it as a pending draft).
 */
function wake(ctx, sessionId, text) {
  const agent = ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : undefined
  if (!agent) return { ok: false, reason: 'session not live' }

  const allowed = decideWake(agent.status)
  if (!allowed.ok) return allowed

  const message = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
  try {
    if (typeof agent.followup === 'function') {
      agent.followup(message)
      return { ok: true, via: 'followup' }
    }
    if (typeof agent.steer === 'function') {
      agent.steer(message)
      return { ok: true, via: 'steer' }
    }
    const inbox = agent.inbox || (agent.session && agent.session.inbox)
    if (inbox && typeof inbox.append === 'function') {
      inbox.append('next-turn', message)
      return { ok: true, via: 'inbox.append' }
    }
    return { ok: false, reason: 'no followup/steer/inbox on agent' }
  } catch (error) {
    return { ok: false, reason: `throw: ${String((error && error.message) || error)}` }
  }
}

async function pollOnce(ctx, entry, baseMs) {
  const res = await run('gh', ['api', `repos/${entry.repo}/issues?state=all&sort=updated&direction=desc&per_page=20`], { timeoutMs: 45000, env: ghEnv() })
  entry.lastPoll = new Date().toISOString()
  if (res.code !== 0) {
    entry.lastError = redact(res.stderr).slice(0, 300)
    bumpFailure(entry, baseMs)
    return
  }
  let items
  try { items = JSON.parse(res.stdout) } catch { entry.lastError = 'bad json'; bumpFailure(entry, baseMs); return }
  if (!Array.isArray(items)) { entry.lastError = 'unexpected payload'; bumpFailure(entry, baseMs); return }

  entry.lastError = null
  entry.consecutiveFailures = 0
  entry.nextAt = null

  // 触发要有许可：过滤器不通过的条目根本不进候选集，也不写 seen 水位
  // 记忆要有遗忘：seen 只增不减会问成几 MB 的字典
  entry.seen = pruneSeen(entry.seen)
  const ackLabel = entry.ackLabel || DEFAULT_ACK_LABEL
  // 幂等痕迹留在 GitHub 上：带 ack 标签的条目直接跳过（换机器、删状态都不会重报）
  const considered = items.filter((item) => passesFilters(item, entry.filters) && !hasAckLabel(item, ackLabel))
  const { fresh, absorbed } = partitionItems(considered, entry, { cooldownMs: Number(entry.cooldownMs) || DEFAULT_COOLDOWN_MS })

  if (absorbed.length > 0) {
    entry.seen = advanceSeen(entry.seen, absorbed)
    entry.lastAbsorbed = absorbed.length
    const newestAbsorbed = newestUpdatedAt(absorbed)
    if (!entry.cursor || Date.parse(newestAbsorbed) > Date.parse(entry.cursor)) entry.cursor = newestAbsorbed
  }
  if (fresh.length === 0) return

  // 活跃时段：夜里不叫醒，攒着（对标 Renovate 的 schedule）
  if (entry.activeHours && !inActiveHours(entry.activeHours)) {
    entry.lastDeferred = `不在活跃时段（${entry.activeHours}），已攒 ${fresh.length} 条`
    return
  }

  // 每小时唤醒上限：宁可攒着，也不要连续叫醒把上下文打爆
  const cap = Math.max(1, Number(entry.maxWakesPerHour) || 6)
  entry.wakeTimes = pruneWakeTimes(entry.wakeTimes)
  if (entry.wakeTimes.length >= cap) {
    entry.lastDeferred = `每小时最多唤醒 ${cap} 次，已攒 ${fresh.length} 条待处理`
    entry.cursor = newestUpdatedAt(fresh) || entry.cursor
    entry.seen = advanceSeen(entry.seen, fresh)
    return
  }

  // 条目不丢：水位照常全部前移，消息里只铺开前 N 条，其余给编号
  const limit = Math.max(1, Number(entry.batchLimit) || 5)
  const listed = batchFresh(fresh, limit)
  const rest = fresh.slice(listed.length)
  const isolation = await prepareIsolation(entry)
  if (isolation && isolation.dir) entry.lastWorktree = isolation.dir
  const result = wake(ctx, entry.sessionId, formatWatchText(entry.repo, listed, {
    more: rest.length,
    restNumbers: rest.map((item) => item.number),
    isolation,
  }))
  entry.lastWake = result.ok ? new Date().toISOString() : `failed: ${result.reason}`
  entry.lastWakeCount = fresh.length
  entry.lastBatch = listed.map((item) => item.number)
  if (result.ok) {
    entry.wakeTimes.push(Date.now())
    entry.lastDeferred = null
    entry.seen = advanceSeen(entry.seen, fresh)
    entry.lastReported = recordReported(entry, fresh)
    entry.cursor = newestUpdatedAt(fresh)
  } else {
    // 保留水位，下一轮重试这次事件
    entry.lastError = `wake failed: ${result.reason}`
    // 会话正忙是暂时的：下一轮直接重试，要是也退避就会越拖越久
    if (/busy|running|idle/i.test(String(result.reason || ''))) {
      entry.lastDeferred = '会话正忙，下一轮重试'
    } else {
      bumpFailure(entry, baseMs)
    }
  }
}

export function apply(ctx) {
  const timers = new Map()

  const startWatcher = (entry) => {
    if (timers.has(entry.id)) return
    const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000

    const tick = async () => {
      // A pause (or delete) can land between two ticks; never poll a watcher
      // the operator has just switched off.
      if (entry.enabled === false) return
      // 连续失败后的退避窗口：到点之前一律不碰 API
      if (entry.nextAt && Date.now() < Date.parse(entry.nextAt)) return
      // 同一个 watcher 不允许两轮并跑（手动「立刻」+ 定时器撞一起会开两个隔离区）
      if (entry.polling) return
      entry.polling = true
      try {
        await pollOnce(ctx, entry, every)
      } catch (error) {
        entry.lastError = String((error && error.message) || error)
      } finally {
        delete entry.polling
        persistEntry(entry)
      }
    }
    timers.set(entry.id, setInterval(tick, every))
    tick()
  }

  // Must run before the entry leaves the state file: a live tick would
  // otherwise `persistEntry` the just-deleted watcher straight back.
  const stopWatcher = (id) => {
    const timer = timers.get(id)
    if (timer === undefined) return false
    clearInterval(timer)
    timers.delete(id)
    return true
  }

  // Read-only status endpoints for the web panel. `httpServer` is looked up
  // through ctx.inject: the service may load after this plugin, and ctx.get()
  // does not wait for it.
  const registerRoutes = (httpServer) => {
    if (!httpServer || typeof httpServer.register !== 'function') return
    const routes = []
    const record = (kind, detail) => {
      const state = readState()
      state.client = state.client || {}
      state.client[kind] = { at: new Date().toISOString(), detail }
      writeState(state)
    }
    try {
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/state',
        handler: (req, res) => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return }
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const focusSession = url.searchParams.get('sessionId') || ''
          const state = readState()
          const watchers = Object.values(state.watchers || {}).map((w) => ({
            id: w.id || (w.repo + '#' + w.sessionId),
            repo: w.repo,
            sessionId: w.sessionId,
            intervalSec: w.intervalSec,
            enabled: w.enabled !== false,
            cursor: w.cursor ?? null,
            lastPoll: w.lastPoll ?? null,
            lastWake: w.lastWake ?? null,
            lastWakeCount: w.lastWakeCount ?? 0,
            lastAbsorbed: w.lastAbsorbed ?? 0,
            lastError: w.lastError ?? null,
            filters: w.filters ?? null,
            batchLimit: w.batchLimit ?? 5,
            maxWakesPerHour: w.maxWakesPerHour ?? 6,
            consecutiveFailures: w.consecutiveFailures ?? 0,
            nextAt: w.nextAt ?? null,
            lastDeferred: w.lastDeferred ?? null,
            lastBatch: w.lastBatch ?? [],
            isolated: w.isolated === true,
            workdir: w.workdir ?? null,
            lastWorktree: w.lastWorktree ?? null,
            note: w.goal ?? '',
            title: sessionTitle(w.sessionId),
          }))
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({
            updatedAt: new Date().toISOString(),
            credentials: secretsSummary(),
            sessionGoal: goalView(ctx, focusSession),
            sessionTitle: sessionTitle(focusSession),
            watchers: watchers.map((w) => ({ ...w, goal: goalView(ctx, w.sessionId) })),
          }))
        },
      }))
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/client-hello',
        handler: (req, res) => { record('hello', String(req.url)); res.statusCode = 204; res.end() },
      }))
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/client-note',
        handler: (req, res) => {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          record('note:' + String(url.searchParams.get('key') || 'x'), String(url.searchParams.get('value') || '').slice(0, 300))
          res.statusCode = 204; res.end()
        },
      }))
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/client-error',
        handler: (req, res) => { record('error', String(req.url).slice(0, 400)); res.statusCode = 204; res.end() },
      }))
      const readBody = (req) => new Promise((resolve) => {
        const chunks = []
        req.on('data', (chunk) => chunks.push(chunk))
        req.on('end', () => {
          try {
            const raw = decodeBody(Buffer.concat(chunks).subarray(0, 64 * 1024))
            resolve(JSON.parse(raw || '{}'))
          } catch { resolve({}) }
        })
        req.on('error', () => resolve({}))
      })
      const json = (res, code, body) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.end(JSON.stringify(body))
      }

      // Operator-facing configuration: what is configured (never the values).
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/config',
        handler: (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const state = readState()
          json(res, 200, {
            credentials: secretsSummary(),
            watchers: Object.values(state.watchers || {}).map((w) => ({
              repo: w.repo, sessionId: w.sessionId, intervalSec: w.intervalSec,
              enabled: w.enabled !== false, goal: w.goal ?? '',
            })),
          })
        },
      }))

      // Create or update a watcher from the panel. The panel is session-scoped,
      // so it must send the session id it is bound to.
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/watch',
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          const body = await readBody(req)
          // pause / resume / delete target an existing watcher by id; the
          // create path below is the default when no action is supplied.
          if (body.action) {
            const action = String(body.action)
            const id = String(body.id || '')
            const state = readState()
            // 立刻跑一次（对应 Claude Code Action 的 interactive 模式）：
            // 不等定时器，马上轮询一次；仍然受 filters / ack 标签约束。
            if (action === 'poll') {
              const entry = state.watchers && state.watchers[id]
              if (!entry) return json(res, 404, { error: 'unknown watcher: ' + id })
              if (entry.enabled === false) return json(res, 409, { error: 'watcher is paused' })
              if (entry.polling) return json(res, 409, { error: 'already polling', id })
              const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000
              entry.polling = true
              pollOnce(ctx, entry, every)
                .catch(() => {})
                .finally(() => { delete entry.polling; persistEntry(entry) })
              return json(res, 202, { ok: true, action, id, polling: true })
            }
            const result = applyWatcherAction(state, { action, id })
            if (!result.ok) return json(res, 400, result)
            if (result.deleted || result.enabled === false) stopWatcher(id)
            writeState(state)
            if (result.enabled === true) startWatcher(state.watchers[id])
            return json(res, 200, result)
          }
          const repo = String(body.repo || '').trim()
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return json(res, 400, { error: 'repo must be owner/name' })
          const sessionId = String(body.sessionId || '').trim()
          if (!sessionId) return json(res, 400, { error: 'sessionId is required (open the panel in the session that should be woken)' })
          const intervalSec = Math.max(30, Math.min(3600, Number(body.intervalSec) || 60))
          const state = readState()
          state.watchers = state.watchers || {}
          const id = repo + '#' + sessionId
          const entry = state.watchers[id] || {
            id, repo, sessionId, cursor: null, seen: {}, lastReported: {},
            cooldownMs: 180000, createdAt: new Date().toISOString(),
            filters: normalizeFilters(), batchLimit: 5, maxWakesPerHour: 6,
            wakeTimes: [], consecutiveFailures: 0, ackLabel: DEFAULT_ACK_LABEL,
            isolated: false, workdir: null,
          }
          entry.intervalSec = intervalSec
          entry.goal = String(body.goal || '').slice(0, 500)
          // 竞品蒸馏：触发要有许可（label/指派/跳过机器人草稿）、单次别铺开太多、每小时有上限
          entry.filters = normalizeFilters(body.filters ?? entry.filters)
          entry.batchLimit = Math.max(1, Math.min(20, Number(body.batchLimit) || entry.batchLimit || 5))
          entry.maxWakesPerHour = Math.max(1, Math.min(60, Number(body.maxWakesPerHour) || entry.maxWakesPerHour || 6))
          if (typeof body.ackLabel === 'string' && body.ackLabel.trim()) entry.ackLabel = body.ackLabel.trim().slice(0, 60)
          // 隔离执行（对标 DeepSeek DSec）：每次唤醒开一次性 worktree，改副本不碰主工作区
          entry.isolated = body.isolated === true || entry.isolated === true
          if (body.isolateKeepDays != null) entry.isolateKeepDays = Math.max(1, Math.min(30, Number(body.isolateKeepDays) || 3))
          if (typeof body.activeHours === 'string') entry.activeHours = body.activeHours.trim().slice(0, 20) || null
          if (typeof body.workdir === 'string' && body.workdir.trim()) entry.workdir = body.workdir.trim()
          else if (entry.isolated && !entry.workdir) entry.workdir = process.cwd()
          entry.consecutiveFailures = 0
          entry.nextAt = null
          entry.enabled = body.enabled !== false
          state.watchers[id] = entry
          writeState(state)
          if (entry.enabled) startWatcher(entry)
          json(res, 200, { ok: true, id, repo, intervalSec, enabled: entry.enabled })
        },
      }))

      // Credentials typed by the operator. Stored 0600 under the state dir and
      // never echoed back; the answer carries only a masked summary.
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/credentials',
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          const body = await readBody(req)
          const next = readSecrets()
          if (typeof body.token === 'string') {
            const token = body.token.trim()
            if (token === '') delete next.token
            else if (!/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(token)) {
              return json(res, 400, { error: 'token shape not recognized (ghp_… or github_pat_…)' })
            } else next.token = token
          }
          if (typeof body.sshKeyPath === 'string') {
            const keyPath = body.sshKeyPath.trim()
            if (keyPath === '') delete next.sshKeyPath
            else if (!isAbsolute(keyPath)) return json(res, 400, { error: 'sshKeyPath must be absolute' })
            else next.sshKeyPath = keyPath
          }
          next.updatedAt = new Date().toISOString()
          writeSecrets(next)
          json(res, 200, { credentials: secretsSummary() })
        },
      }))

      // Set / edit / clear the session's REAL goal through ctx.goals — the same
      // service the /goal command drives, so the panel and the conversation are
      // one source of truth (polling reads it back).
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/goal',
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
          const body = await readBody(req)
          const sessionId = String(body.sessionId || '').trim()
          const objective = String(body.objective || '').trim()
          if (!sessionId) return json(res, 400, { error: 'sessionId is required' })
          const goals = typeof ctx.get === 'function' ? ctx.get('goals') : undefined
          const agents = typeof ctx.get === 'function' ? ctx.get('agents') : undefined
          if (!goals || !agents) return json(res, 501, { error: 'this host has no goal service' })
          const agent = agents.get(sessionId)
          if (!agent) return json(res, 404, { error: 'session is not live' })
          try {
            const current = goals.get(agent)
            if (objective === '') {
              if (!current) return json(res, 200, { ok: true, cleared: false, sessionGoal: null })
              goals.clear(agent, current.ref)
              return json(res, 200, { ok: true, cleared: true, sessionGoal: null })
            }
            const view = current
              ? goals.edit(agent, current.ref, { objective })
              : goals.create(agent, { objective })
            return json(res, 200, {
              ok: true,
              sessionGoal: { objective: view.objective, phase: view.phase, revision: view.ref ? view.ref.revision : null },
            })
          } catch (error) {
            return json(res, 400, { error: String((error && error.message) || error) })
          }
        },
      }))

      const state = readState()
      state.server = { at: new Date().toISOString(), routes: routes.length }
      writeState(state)
    } catch (error) {
      const state = readState()
      state.server = { at: new Date().toISOString(), error: String((error && error.message) || error).slice(0, 300) }
      writeState(state)
    }
    ctx.on('dispose', () => { for (const dispose of routes) { try { dispose() } catch {} } })
  }

  // Routes for the panel. `webServer` is the host's route registry (the same
  // service dsh-unlag injects); it is a required inject so this plugin simply
  // does not mount on a host that has no web surface, instead of silently
  // offering a panel that cannot read anything.
  try {
    registerRoutes(ctx.webServer)
  } catch (error) {
    const state = readState()
    state.server = { at: new Date().toISOString(), error: String((error && error.message) || error).slice(0, 300) }
    writeState(state)
  }

  // Manual test channel: {text, sessionId?} in trigger.json wakes that session
  // on the next 5 s sweep, then removes the file. Verifies the inbox path
  // without a host restart.
  const sweepTrigger = () => {
    if (!existsSync(TRIGGER_FILE)) return
    let payload = {}
    try { payload = JSON.parse(readFileSync(TRIGGER_FILE, 'utf8')) } catch {}
    try { unlinkSync(TRIGGER_FILE) } catch {}
    const state = readState()
    const any = Object.values(state.watchers || {}).find((w) => w && w.enabled)
    const sessionId = payload.sessionId || (any && any.sessionId)
    if (!sessionId) return
    const result = wake(ctx, sessionId, payload.text || '【watch】ping')
    state.lastTrigger = { at: new Date().toISOString(), ok: result.ok, reason: result.reason ?? null, sessionId }
    writeState(state)
  }
  setInterval(sweepTrigger, 5000).unref?.()

  try {
    const state = readState()
    for (const entry of Object.values(state.watchers || {})) {
      if (entry && entry.enabled) startWatcher(entry)
    }
  } catch {}

  ctx.tools.register(defineTool({
    name: 'watch_ack',
    description:
      'Mark an issue/PR as handled: adds the ack label on GitHub (主理鱼:已处理 by default) and advances the local watermark, so the same item will never wake this session again — even after a restart or on another machine.',
    parameters: {
      repo: { type: 'string', description: 'owner/name; defaults to the only watched repo' },
      number: { type: 'number', description: 'issue or PR number' },
      numbers: { type: 'string', description: '逗号分隔的多个编号，如 "12,13,14"（与 number 二选一）' },
      label: { type: 'string', description: 'ack label, default 主理鱼:已处理' },
    },
    async execute(args) {
      const numbers = String(args.numbers || args.number || '')
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v > 0)
      if (numbers.length === 0) return '[error: number (or numbers) is required]'
      const state = readState()
      const watchers = Object.values(state.watchers || {})
      const entry = args.repo
        ? watchers.find((w) => w && w.repo === String(args.repo))
        : watchers.find((w) => w && w.enabled)
      if (!entry) return '[error: no watcher for that repo — start one with watch_start first]'
      const label = String(args.label || entry.ackLabel || DEFAULT_ACK_LABEL)
      const results = []
      let failed = null
      for (const number of numbers) {
        const res = await run('gh', ['api', '-X', 'POST', `repos/${entry.repo}/issues/${number}/labels`, '-f', `labels[]=${label}`], { env: ghEnv() })
        if (res.code !== 0) {
          failed = { number, text: redact([res.stdout, res.stderr].filter(Boolean).join(' ').trim()).slice(0, 200) }
          break
        }
        results.push(number)
      }
      if (failed) return `[error: #${failed.number} gh exited ${failed.code}] ${failed.text}`
      const latest = readState()
      const live = latest.watchers && latest.watchers[entry.id]
      const nowIso = new Date().toISOString()
      if (live) {
        live.seen = advanceSeen(live.seen, results.map((number) => ({ number, updated_at: nowIso })))
        // 打标签本身就是一次外部更新，把光标推到当下，避免自己把自己叫醒
        live.cursor = nowIso
        live.lastAcked = { numbers: results, label, at: nowIso }
        writeState(latest)
      }
      return `acked ${entry.repo} #${results.join(' #')} with label "${label}"`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'github',
    description: 'Call the GitHub REST API. The credential stays inside the plugin — it is never returned, and every result is redacted. Write methods require confirm: true.',
    parameters: {
      method: { type: 'string', description: 'HTTP method, default GET.' },
      path: { type: 'string', required: true, description: 'API path after https://api.github.com/, e.g. repos/o/r/issues.' },
      body: { type: 'string', description: 'JSON body for write methods.' },
      confirm: { type: 'boolean', description: 'Must be true for POST/PATCH/PUT/DELETE.' },
    },
    async execute(args) {
      const method = String(args.method || 'GET').toUpperCase()
      const write = ['GET', 'HEAD'].indexOf(method) === -1
      if (write && args.confirm !== true) {
        return `[error: ${method} requires confirm: true — this plugin never writes to GitHub without an explicit flag]`
      }
      const res = await run('gh', ['api', '-X', method, args.path, '--header', 'Accept: application/vnd.github+json'], {
        input: write && args.body ? args.body : undefined, env: ghEnv(),
      })
      const text = redact([res.stdout, res.stderr].filter(Boolean).join('\n').trim())
      return `${text || '(empty)'}\n[exit code: ${res.code}]`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'repo_here',
    description: 'Report the GitHub repository of the current working directory (owner/name, default branch, visibility). Read-only.',
    parameters: {},
    async execute() {
      const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,visibility,url'], { cwd: process.cwd(), env: ghEnv() })
      const text = redact([res.stdout, res.stderr].filter(Boolean).join('\n').trim())
      return `${text || '(empty)'}\n[exit code: ${res.code}]`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_start',
    description: 'Watch a GitHub repository and wake THIS session when its issues or pull requests change. Idempotent per (repo, session). Default interval 60 s, minimum 30 s.',
    parameters: {
      repo: { type: 'string', description: 'owner/name. Omit to infer from the current working directory.' },
      intervalSec: { type: 'number', description: 'Polling interval in seconds, default 60.' },
    },
    async execute(args) {
      const agent = ctx.agents && typeof ctx.agents.currentInitiator === 'function' ? ctx.agents.currentInitiator() : undefined
      const sessionId = agent && agent.id
      if (!sessionId) return '[error: no live session — watch_start must be called from a session turn]'

      let repo = args.repo
      if (!repo) {
        const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: process.cwd(), env: ghEnv() })
        try { repo = JSON.parse(res.stdout).nameWithOwner } catch { return `[error: cannot infer repo]\n${redact(res.stderr)}` }
      }

      const id = `${repo}#${sessionId}`
      const state = readState()
      const existing = state.watchers && state.watchers[id]
      const entry = existing || {
        id, repo, sessionId,
        intervalSec: 60,
        cooldownMs: DEFAULT_COOLDOWN_MS,
        cursor: null,
        seen: {},
        lastReported: {},
        enabled: true,
        createdAt: new Date().toISOString(),
      }
      if (typeof args.intervalSec === 'number' && args.intervalSec > 0) entry.intervalSec = args.intervalSec
      entry.enabled = true
      state.watchers = state.watchers || {}
      state.watchers[id] = entry
      writeState(state)
      startWatcher(entry)
      return `watching ${repo} → session ${sessionId} every ${entry.intervalSec}s${existing ? ' (already existed)' : ''}`
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_status',
    description: 'Report active watchers with last poll, last wake and last error. Read-only.',
    parameters: {},
    async execute() {
      const state = readState()
      const list = Object.values(state.watchers || {})
      if (!list.length) return '(no watchers)'
      return list
        .map((w) => [
          w.repo, '→', w.sessionId,
          '| every ' + w.intervalSec + 's',
          '| cursor=' + (w.cursor || '-'),
          '| lastPoll=' + (w.lastPoll || '-'),
          '| lastWake=' + (w.lastWake || '-'),
          '| err=' + (w.lastError || '-'),
        ].join(' '))
        .join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_stop',
    description: 'Stop watching a repository for the current session.',
    parameters: { repo: { type: 'string', required: true, description: 'owner/name' } },
    async execute(args) {
      const agent = ctx.agents && typeof ctx.agents.currentInitiator === 'function' ? ctx.agents.currentInitiator() : undefined
      const sessionId = agent && agent.id
      const id = `${args.repo}#${sessionId}`
      const state = readState()
      if (!state.watchers || !state.watchers[id]) return `(no watcher for ${id})`
      state.watchers[id].enabled = false
      writeState(state)
      const timer = timers.get(id)
      if (timer) { clearInterval(timer); timers.delete(id) }
      return `stopped ${id}`
    },
  }))
}
