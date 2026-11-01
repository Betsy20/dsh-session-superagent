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
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { zstdDecompressSync } from 'node:zlib'

import { redact } from './redact.js'
import { decodeBody } from './body.js'
import {
  advanceSeen, applyWatcherAction, batchFresh, decideWake, DEFAULT_ACK_LABEL, formatWatchText,
  filterReason, hasAckLabel, inActiveHours, newestUpdatedAt, nextDelayMs, pushFiltered, normalizeFilters, partitionItems, passesFilters,
  mergeFilters, mergePollResult, pruneSeen, pruneWakeTimes, pushHistory, recordReported, staleWorktrees, worktreePlan,
} from './watch.js'

export const name = 'dsh-session-superagent'
export const inject = ['tools', 'agents', 'webServer']

const STATE_DIR = process.env.DSH_SUPERAGENT_STATE
  ? String(process.env.DSH_SUPERAGENT_STATE)
  : join(homedir(), '.dsh', 'state', 'session-superagent')
const SECRETS_FILE = join(STATE_DIR, 'secrets.json')
const STATE_FILE = join(STATE_DIR, 'watchers.json')
const TRIGGER_FILE = join(STATE_DIR, 'trigger.json')
// 客户端探针只认这几个键（别的键一律丢弃，防止被任意网页写盘）
const CLIENT_NOTE_KEYS = new Set(['client-version', 'apply', 'desk-registered', 'desk-fail', 'orbit-registered', 'orbit-fail', 'orbit-mount', 'badge-registered', 'badge-mount', 'badge-state', 'error'])
const DEFAULT_COOLDOWN_MS = 180_000

function readState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return { watchers: {} } }
}

function writeState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const text = JSON.stringify(state, null, 1)
    // 原子写：写一半崩掉不该把全部 watcher 清空
    const tmp = STATE_FILE + '.tmp'
    writeFileSync(tmp, text)
    try { renameSync(tmp, STATE_FILE) } catch { writeFileSync(STATE_FILE, text) }
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
    // 只回「有没有配」：连首尾各 4 个字符也算信息泄露
    tokenHint: s.token ? 'configured' : null,
    sshKeyPath: s.sshKeyPath ? 'configured' : 'none',
    // 从不在面板回显路径（Windows 路径里的反斜杠曾让掩码整段漏出）
    sshKeyHint: null,
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
/** sessionId → 会话日志路径的索引缓存（60 秒 TTL；命中后只 stat 单个文件）。 */
const sessionFileCache = { at: 0, byId: new Map() }

function sessionTitle(sessionId) {
  try {
    if (!sessionId) return null
    const home = process.env.DSH_HOME && String(process.env.DSH_HOME).trim()
      ? String(process.env.DSH_HOME).trim()
      : join(homedir(), '.dsh')
    const root = join(home, 'sessions')
    // 目录索引缓存：/state 每 5 秒一次 × 每条 watcher，全量 readdir + existsSync 太亏。
    // 关键：miss 也要走 TTL（负缓存）—— 只要有一个 watcher 的会话日志不存在，
    // 每次 /state 都全量重建会把 0.6ms 拖成 130-500ms（终审实测 200/800 会话两种规模）。
    if (Date.now() - sessionFileCache.at > 60 * 1000) {
      sessionFileCache.byId.clear()
      for (const group of readdirSync(root)) {
        const dir = join(root, group)
        let names = []
        try { names = readdirSync(dir) } catch { continue }
        for (const name of names) {
          const candidate = join(dir, name, 'session.v4.jsonl.zstd')
          if (existsSync(candidate)) sessionFileCache.byId.set(name, candidate)
        }
      }
      sessionFileCache.at = Date.now()
    }
    const file = sessionFileCache.byId.get(sessionId) || null
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

/**
 * 安全地取 agents 服务。
 * 定时器回调跑在「非活跃上下文」里，直接读 `ctx.agents` 会抛
 * `cannot get required service "agents" in inactive context`（2026-11-02 真机复验踩到）；
 * `ctx.get(name)` 不抛，取不到就返回 undefined。
 */
function agentsService(ctx) {
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('agents')
      if (viaGet) return viaGet
    }
  } catch {}
  try { return ctx.agents } catch { return undefined }
}

/** gh CLI 可用性探针：5 分钟缓存，别让面板每 5 秒都 spawn 一次 gh。 */
const ghHealthCache = { at: 0, value: null }
async function ghHealth() {
  if (Date.now() - ghHealthCache.at < 5 * 60 * 1000 && ghHealthCache.value) return ghHealthCache.value
  let value
  try {
    const res = await run('gh', ['--version'], { timeoutMs: 10000 })
    value = res.code === 0
      ? { ok: true, version: String(res.stdout || '').trim().split(String.fromCharCode(10))[0].slice(0, 80) }
      : { ok: false, error: redact([res.stderr, res.stdout].join(' ')).slice(0, 160) }
  } catch (error) {
    value = { ok: false, error: String((error && error.message) || error).slice(0, 160) }
  }
  ghHealthCache.at = Date.now()
  ghHealthCache.value = value
  return value
}

function persistEntry(entry) {
  try {
    const state = readState()
    state.watchers = state.watchers || {}
    const stored = state.watchers[entry.id]
    // Deleted between the tick start and its write-back: never resurrect it.
    if (!stored) return
    state.watchers[entry.id] = mergePollResult(stored, entry)
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
    const target = root + '/' + item.name
    const res = await run('git', ['-C', workdir, 'worktree', 'remove', '--force', target], { timeoutMs: 30000 })
    if (res.code !== 0) {
      // 已经不是工作树（孤儿目录）：直接删目录，别让它永远留着
      try { rmSync(target, { recursive: true, force: true }) } catch {}
    } else {
      removed += 1
    }
    // 无论 worktree 是否删成功，都试着删分支：每次唤醒一个新分支，不删会无限涨
    await run('git', ['-C', workdir, 'branch', '-D', 'zhuli/' + item.name], { timeoutMs: 30000 })
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
  const agents = agentsService(ctx)
  const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
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
    const detail = redact(res.stderr).slice(0, 240)
    // 常见失败给一句能照着做的提示，别只丢原始 stderr
    const hint = /HTTP 401|Bad credentials/i.test(detail)
      ? '（gh 登录失效：跑 gh auth login，或在面板填 token）'
      : /HTTP 404|Not Found/i.test(detail)
        ? '（仓库不存在或没权限：检查 owner/name）'
        : /ENOENT|not found.*gh|gh.*not found/i.test(detail)
          ? '（找不到 gh 命令：确认已安装且在 PATH）'
          : ''
    entry.lastError = (detail + hint).slice(0, 300)
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
  const considered = []
  for (const item of items) {
    if (hasAckLabel(item, ackLabel)) {
      entry.filteredLog = pushFiltered(entry.filteredLog, { at: entry.lastPoll, number: item.number, title: String(item.title || '').slice(0, 80), reason: '已 ack' })
      continue
    }
    const reason = filterReason(item, entry.filters)
    if (reason) {
      entry.filteredLog = pushFiltered(entry.filteredLog, { at: entry.lastPoll, number: item.number, title: String(item.title || '').slice(0, 80), reason })
      continue
    }
    considered.push(item)
  }
  const { fresh, absorbed } = partitionItems(considered, entry, { cooldownMs: Number(entry.cooldownMs) || DEFAULT_COOLDOWN_MS })

  if (absorbed.length > 0) {
    entry.seen = advanceSeen(entry.seen, absorbed)
    entry.lastAbsorbed = absorbed.length
    const newestAbsorbed = newestUpdatedAt(absorbed)
    if (!entry.cursor || Date.parse(newestAbsorbed) > Date.parse(entry.cursor)) entry.cursor = newestAbsorbed
  }
  if (fresh.length === 0) {
    // 这一轮没有新增：上一轮的说法（比如「仅观察：本会唤醒 4 条」）已经过期了
    entry.lastDeferred = null
    return
  }

  // 仅观察模式（对标官方 observe）：照常判定，但只记录「本会唤醒哪几条」，不真唤醒
  if (entry.observe === true) {
    entry.lastDeferred = '仅观察：本轮本会唤醒 ' + fresh.length + ' 条（' + fresh.slice(0, 5).map((i) => '#' + i.number).join(' ') + '）'
    entry.history = pushHistory(entry.history, {
      at: new Date().toISOString(),
      numbers: fresh.slice(0, 5).map((i) => i.number),
      ok: false,
      reason: 'observe',
    })
    entry.seen = advanceSeen(entry.seen, fresh)
    entry.cursor = newestUpdatedAt(fresh) || entry.cursor
    return
  }

  // 活跃时段：夜里不叫醒，攒着（对标 Renovate 的 schedule）
  if (entry.activeHours && !inActiveHours(entry.activeHours)) {
    entry.lastDeferred = `不在活跃时段（${entry.activeHours}），已攒 ${fresh.length} 条`
    return
  }

  // 每小时唤醒上限：宁可攒着，也不要连续叫醒把上下文打爆
  const cap = Math.max(1, Number(entry.maxWakesPerHour) || 6)
  entry.wakeTimes = pruneWakeTimes(entry.wakeTimes)
  if (entry.wakeTimes.length >= cap) {
    // 只记原因，绝不动 seen/cursor —— 否则「攒着」等于「丢掉」
    entry.lastDeferred = `每小时最多唤醒 ${cap} 次，已攒 ${fresh.length} 条待处理`
    return
  }

  // 条目不丢：水位照常全部前移，消息里只铺开前 N 条，其余给编号
  const limit = Math.max(1, Number(entry.batchLimit) || 5)
  const listed = batchFresh(fresh, limit)
  const rest = fresh.slice(listed.length)
  // 暂停/删除可能发生在这一轮轮询期间：以盘上为准
  const liveEntry = (readState().watchers || {})[entry.id]
  if (!liveEntry || liveEntry.enabled === false) {
    entry.lastDeferred = '本轮期间被暂停或删除，跳过唤醒'
    return
  }
  // 会话忙就别开隔离区了：白建一个没人用的 worktree
  const liveAgents = agentsService(ctx)
  const liveAgent = liveAgents && typeof liveAgents.get === 'function' ? liveAgents.get(entry.sessionId) : undefined
  if (!liveAgent) {
    // 会话已经不在了（被删/换机器）：别开隔离区，也别假装在盯。
    // 必须走 bumpFailure —— 否则这条会每 intervalSec 打一次 GitHub，永不退避（第四轮审核指出）。
    entry.lastError = '会话已不在：请删除或重建这条主理鱼'
    bumpFailure(entry, baseMs)
    return
  }
  const gate = decideWake(liveAgent && liveAgent.status)
  if (!gate.ok) {
    entry.lastDeferred = '会话正忙，下一轮重试'
    return
  }

  const isolation = await prepareIsolation(entry)
  if (isolation && isolation.dir) entry.lastWorktree = isolation.dir
  const result = wake(ctx, entry.sessionId, formatWatchText(entry.repo, listed, {
    more: rest.length,
    restNumbers: rest.map((item) => item.number),
    isolation,
    // entry.goal 之前只写不读：现在真的进唤醒消息
    goal: entry.goal || '',
  }))
  entry.lastWake = result.ok ? new Date().toISOString() : `failed: ${result.reason}`
  entry.lastWakeCount = fresh.length
  entry.lastBatch = listed.map((item) => item.number)
  entry.history = pushHistory(entry.history, {
    at: new Date().toISOString(),
    numbers: entry.lastBatch,
    ok: result.ok,
    reason: result.ok ? null : String(result.reason || '').slice(0, 120),
  })
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
  // 并发闸的唯一事实源：tick 和 HTTP「立刻」拿到的是两个不同的 entry 对象，
  // 靠 entry.polling 标记永远对不上（审核专员 probe-c 实证：同一条被唤醒 3 次）。
  const inFlight = new Set()

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
      if (inFlight.has(entry.id)) return
      inFlight.add(entry.id)
      try {
        await pollOnce(ctx, entry, every)
      } catch (error) {
        // 未预期的异常（比如宿主上下文/服务不可用）也必须退避：
        // 之前只写 lastError，于是坏掉的 watcher 会按 intervalSec 无限重试（真机踩到过）。
        entry.lastError = String((error && error.message) || error)
        bumpFailure(entry, every)
      } finally {
        inFlight.delete(entry.id)
        persistEntry(entry)
      }
    }
    // unref：宿主本来不会退出，但测试进程不该被这个定时器吊住
    timers.set(entry.id, setInterval(tick, every).unref?.())
    // DSH_SUPERAGENT_NO_POLL=1 只登记不轮询（路由层单测用，避免真去请求 GitHub）
    if (process.env.DSH_SUPERAGENT_NO_POLL === '1') return
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
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return }
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const focusSession = url.searchParams.get('sessionId') || ''
          const state = readState()
          const gh = await ghHealth()
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
            observe: w.observe === true,
            filteredLog: (w.filteredLog ?? []).slice(-5),
            lastBatch: w.lastBatch ?? [],
            isolated: w.isolated === true,
            workdir: w.workdir ?? null,
            lastWorktree: w.lastWorktree ?? null,
            activeHours: w.activeHours ?? null,
            isolateKeepDays: w.isolateKeepDays ?? 3,
            history: (w.history ?? []).slice(-5),
            note: w.goal ?? '',
            title: sessionTitle(w.sessionId),
          }))
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({
            gh,
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
        path: '/session-superagent/client-note',
        handler: (req, res) => {
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const key = String(url.searchParams.get('key') || '')
          // 只接受已知探针键：否则任何网页用一个 <img> 就能往状态文件里塞任意键
          if (CLIENT_NOTE_KEYS.has(key)) {
            record('note:' + key, String(url.searchParams.get('value') || '').slice(0, 300))
          }
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
              if (inFlight.has(id)) return json(res, 409, { error: 'already polling', id })
              const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000
              inFlight.add(id)
              pollOnce(ctx, entry, every)
                .catch(() => {})
                .finally(() => { inFlight.delete(id); persistEntry(entry) })
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
          // 只有真正带了 goal 才覆盖：GUI 编辑保存不带这个字段，覆盖会清空
          if (typeof body.goal === 'string') entry.goal = body.goal.slice(0, 500)
          // 竞品蒸馏：触发要有许可（label/指派/跳过机器人草稿）、单次别铺开太多、每小时有上限
          entry.filters = mergeFilters(entry.filters, body.filters)
          entry.batchLimit = Math.max(1, Math.min(20, Number(body.batchLimit) || entry.batchLimit || 5))
          entry.maxWakesPerHour = Math.max(1, Math.min(60, Number(body.maxWakesPerHour) || entry.maxWakesPerHour || 6))
          if (typeof body.ackLabel === 'string' && body.ackLabel.trim()) entry.ackLabel = body.ackLabel.trim().slice(0, 60)
          // 隔离执行（对标 DeepSeek DSec）：每次唤醒开一次性 worktree，改副本不碰主工作区
          entry.observe = body.observe === undefined ? entry.observe === true : body.observe === true
          entry.isolated = body.isolated === undefined ? entry.isolated === true : body.isolated === true
          if (body.isolateKeepDays != null) entry.isolateKeepDays = Math.max(1, Math.min(30, Number(body.isolateKeepDays) || 3))
          if (typeof body.activeHours === 'string') entry.activeHours = body.activeHours.trim().slice(0, 20) || null
          if (typeof body.workdir === 'string' && body.workdir.trim()) {
            const workdir = body.workdir.trim()
            if (!isAbsolute(workdir)) return json(res, 400, { error: 'workdir must be an absolute path' })
            if (!existsSync(workdir)) return json(res, 400, { error: 'workdir does not exist: ' + workdir })
            entry.workdir = workdir
          }
          else if (entry.isolated && !entry.workdir) entry.workdir = process.cwd()
          entry.consecutiveFailures = 0
          entry.nextAt = null
          // 没传 enabled 就保持原值：只改间隔/标签不该把暂停的 watcher 悄悄恢复
          entry.enabled = body.enabled === undefined ? (entry.enabled !== false) : body.enabled !== false
          state.watchers[id] = entry
          writeState(state)
          // 编辑已有 watcher 时，间隔/配置变化要立刻生效：startWatcher 会因为 timer 已存在而直接返回
          if (entry.enabled) {
            stopWatcher(id)
            startWatcher(entry)
          }
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
    ctx.on('dispose', () => {
      for (const dispose of routes) { try { dispose() } catch {} }
      // 插件卸载/热重载后旧定时器不能继续跑：它们还持有已 dispose 的 ctx
      for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
      timers.clear()
      try { clearInterval(sweepHandle) } catch {}
    })
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
    // 测试通道：默认关闭。开着等于给本机任意进程一个「以用户口吻注入任意文本」的入口。
    if (process.env.DSH_SUPERAGENT_TRIGGER !== '1') return
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
  const sweepHandle = setInterval(sweepTrigger, 5000)
  sweepHandle.unref?.()

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
      // GitHub 不会因为加标签而自动建标签：不存在时返回 422。先幂等建一次（已存在也返回 422，忽略）。
      await run('gh', ['api', '-X', 'POST', `repos/${entry.repo}/labels`, '-f', `name=${label}`, '-f', 'color=ededed'], { env: ghEnv() })
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
    name: 'watch_doctor',
    description:
      'Self-check the watchers: gh login, repo access, ack label existence, isolation workdir. Read-only; prints a checklist.',
    parameters: {
      repo: { type: 'string', description: 'only check this owner/name; default = every watcher' },
    },
    async execute(args) {
      const lines = []
      const state = readState()
      const all = Object.values(state.watchers || {})
      const wanted = args.repo ? all.filter((w) => w && w.repo === String(args.repo)) : all

      // 1. gh 是否登录
      const auth = await run('gh', ['auth', 'status'], { env: ghEnv() })
      const authed = auth.code === 0
      lines.push(`${authed ? 'OK  ' : 'FAIL'} gh 登录：${auth.code === 0 ? '正常' : redact([auth.stderr, auth.stdout].join(' ')).slice(0, 120)}`)

      if (wanted.length === 0) {
        lines.push('INFO 当前没有任何 watcher —— 先 watch_start 或到面板加一条')
        return lines.join('\n')
      }

      for (const entry of wanted) {
        // 2. 仓库可访问
        const repoRes = await run('gh', ['api', `repos/${entry.repo}`, '--jq', '.full_name'], { env: ghEnv() })
        lines.push(`${repoRes.code === 0 ? 'OK  ' : 'FAIL'} ${entry.repo} 可访问：${repoRes.code === 0 ? repoRes.stdout.trim() : redact(repoRes.stderr).slice(0, 120)}`)

        // 3. ack 标签是否存在
        const label = entry.ackLabel || DEFAULT_ACK_LABEL
        const labRes = await run('gh', ['api', `repos/${entry.repo}/labels/${encodeURIComponent(label)}`, '--jq', '.name'], { env: ghEnv() })
        lines.push(`${labRes.code === 0 ? 'OK  ' : 'WARN'} ack 标签「${label}」：${labRes.code === 0 ? '已存在' : '不存在（首次 watch_ack 会自动创建）'}`)

        // 4. 隔离工作目录
        if (entry.isolated) {
          const wd = entry.workdir
          if (!wd) lines.push('WARN 隔离开着但没有 workdir，会在宿主 cwd 里建 worktree')
          else if (!existsSync(wd)) lines.push(`FAIL 隔离工作目录不存在：${wd}`)
          else {
            const gitRes = await run('git', ['-C', wd, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 15000 })
            lines.push(`${gitRes.code === 0 ? 'OK  ' : 'FAIL'} 隔离工作目录 ${wd}：${gitRes.code === 0 ? '是 git 仓库' : '不是 git 仓库'}`)
          }
        }

        // 5. 最近一次状态
        const last = entry.lastError ? `错误：${entry.lastError}` : entry.lastDeferred ? `等待：${entry.lastDeferred}` : '正常'
        lines.push(`INFO ${entry.enabled === false ? '已暂停' : '运行中'} · 上次轮询 ${entry.lastPoll || '无'} · ${last}`)
      }
      return lines.join('\n')
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
      if (String(args.path || '').trim().startsWith('-')) {
        return '[error: path must be a GitHub API path, not a flag]'
      }
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        return `[error: unsupported method ${method}]`
      }
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
      intervalSec: { type: 'number', description: 'Polling interval in seconds, clamped to 30-3600, default 60.' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Only handle items carrying one of these labels (whitelist).' },
      ignoreLabels: { type: 'array', items: { type: 'string' }, description: 'Skip items carrying any of these labels.' },
      onlyAssigned: { type: 'boolean', description: 'Only handle items assigned to someone (or to `assignee`).' },
      assignee: { type: 'string', description: 'With onlyAssigned: require this login.' },
      observe: { type: 'boolean', description: 'Observe only: record what WOULD be woken, never wake.' },
      isolated: { type: 'boolean', description: 'Run each wake in a throwaway git worktree.' },
      workdir: { type: 'string', description: 'Repository used for isolation worktrees (absolute path).' },
      activeHours: { type: 'string', description: 'Wake only inside this window, e.g. "09:00-23:00" (supports overnight).' },
      batchLimit: { type: 'number', description: 'Max items listed per wake (1-20, default 5).' },
      maxWakesPerHour: { type: 'number', description: 'Max wakes per hour (1-60, default 6).' },
      goal: { type: 'string', description: 'Optional per-watcher goal appended to the wake message.' },
    },
    async execute(args) {
      const toolAgents = agentsService(ctx)
      const agent = toolAgents && typeof toolAgents.currentInitiator === 'function' ? toolAgents.currentInitiator() : undefined
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
      if (typeof args.intervalSec === 'number' && args.intervalSec > 0) {
        // 之前只判断 >0，能把 5 秒存进状态文件（调度时会按 30 秒跑，但状态与实际不一致）
        entry.intervalSec = Math.max(30, Math.min(3600, Math.round(args.intervalSec)))
      }
      const patch = {}
      if (args.labels !== undefined) patch.labels = args.labels
      if (args.ignoreLabels !== undefined) patch.ignoreLabels = args.ignoreLabels
      if (args.onlyAssigned !== undefined) patch.onlyAssigned = args.onlyAssigned
      if (args.assignee !== undefined) patch.assignee = args.assignee
      if (Object.keys(patch).length > 0) entry.filters = mergeFilters(entry.filters, patch)
      if (typeof args.goal === 'string') entry.goal = args.goal.slice(0, 500)
      if (typeof args.observe === 'boolean') entry.observe = args.observe
      if (typeof args.isolated === 'boolean') entry.isolated = args.isolated
      if (typeof args.workdir === 'string' && args.workdir.trim()) {
        const workdir = args.workdir.trim()
        if (!isAbsolute(workdir)) return '[error: workdir must be an absolute path]'
        if (!existsSync(workdir)) return '[error: workdir does not exist: ' + workdir + ']'
        entry.workdir = workdir
      }
      if (typeof args.activeHours === 'string') entry.activeHours = args.activeHours.trim() || null
      if (typeof args.batchLimit === 'number') entry.batchLimit = Math.max(1, Math.min(20, Math.round(args.batchLimit)))
      if (typeof args.maxWakesPerHour === 'number') entry.maxWakesPerHour = Math.max(1, Math.min(60, Math.round(args.maxWakesPerHour)))
      entry.enabled = true
      state.watchers = state.watchers || {}
      state.watchers[id] = entry
      writeState(state)
      stopWatcher(id)
      startWatcher(entry)
      const flags = []
      if (entry.observe === true) flags.push('observe-only（只记录不唤醒）')
      if (entry.isolated === true) flags.push('isolated')
      if (entry.activeHours) flags.push('activeHours=' + entry.activeHours)
      if (entry.filters && entry.filters.labels && entry.filters.labels.length) flags.push('labels=' + entry.filters.labels.join(','))
      if (entry.filters && entry.filters.onlyAssigned) flags.push('onlyAssigned' + (entry.filters.assignee ? '(' + entry.filters.assignee + ')' : ''))
      if (entry.batchLimit) flags.push('batch=' + entry.batchLimit)
      if (entry.maxWakesPerHour) flags.push('perHour=' + entry.maxWakesPerHour)
      if (entry.goal) flags.push('goal=' + JSON.stringify(entry.goal.slice(0, 40)))
      return `watching ${repo} → session ${sessionId} every ${entry.intervalSec}s` +
        (flags.length ? ' [' + flags.join(' ') + ']' : '') +
        (existing ? ' (updated existing watcher)' : '')
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
        .map((w) => {
          const flags = []
          if (w.observe === true) flags.push('observe')
          if (w.isolated === true) flags.push('isolated')
          if (w.enabled === false) flags.push('paused')
          if (w.activeHours) flags.push('hours=' + w.activeHours)
          if (w.filters && w.filters.labels && w.filters.labels.length) flags.push('labels=' + w.filters.labels.join(','))
          if (w.filters && w.filters.onlyAssigned) flags.push('onlyAssigned')
          if (w.lastDeferred) flags.push('deferred=' + JSON.stringify(String(w.lastDeferred).slice(0, 40)))
          return [
            w.repo, '→', w.sessionId,
            '| every ' + w.intervalSec + 's',
            flags.length ? '| ' + flags.join(' ') : '',
            '| cursor=' + (w.cursor || '-'),
            '| lastPoll=' + (w.lastPoll || '-'),
            '| lastWake=' + (w.lastWake || '-'),
            '| err=' + (w.lastError || '-'),
          ].filter(Boolean).join(' ')
        })
        .join('\n')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_stop',
    description: 'Stop watching a repository for the current session.',
    parameters: { repo: { type: 'string', required: true, description: 'owner/name' } },
    async execute(args) {
      const toolAgents = agentsService(ctx)
      const agent = toolAgents && typeof toolAgents.currentInitiator === 'function' ? toolAgents.currentInitiator() : undefined
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
