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
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import os, { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { zstdDecompressSync } from 'node:zlib'

import { redact } from './redact.js'
import { decodeBody } from './body.js'
import {
  advanceSeen, applyWatcherAction, batchFresh, decideWake, DEFAULT_ACK_LABEL, formatWatchText,
  TRIAGE_SIGNALS, accessNote, buildCommentBatchQuery, classifyGhError, commentSummaryLine, parseCommentBatch, pickSuggestion, repoStructureNote, countReasons, filterReason, hasAckLabel, jitterMs, parseGhInclude, retryAfterMs, throttleDelayMs, inActiveHours, newestUpdatedAt, nextDelayMs, pushFiltered, normalizeFilters, partitionItems, passesFilters,
  shouldRunCleanup,
  bumpDailyWakes,
  busierThanUsual,
  countCapped,
  statusView,
  dailySummary,
  suggestSessionCap,
  itemTrace,
  splitBatch,
  mergeFilters, mergePollResult, mergeWakeTexts, pushEvent, silentStreak, msUntilActiveWindow, nextWaketimeAt, pruneSeen, sessionWakesLastHour, pruneWakeTimes, pushHistory, recordReported, staleWorktrees, worktreePlan,
} from './watch.js'

export const name = 'dsh-session-superagent'
/** 服务端版本：随 package.json 同步（meta 测试守着）。客户端据此挑「最新的那个实例」。 */
export const SERVER_VERSION = '0.9.57'
export const inject = ['tools', 'agents', 'webServer']
/** 一条会话每小时最多被唤醒几次（跨所有守累计）。单守上限挡不住多守叠加。 */
const DEFAULT_SESSION_WAKES = 12
/** 隔离区回收的最小间隔：没有超额时不必每次唤醒都跑 git。 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000

/** 仅供测试：读写状态文件（生产代码不要用）。 */
export const __test = { readState, writeState, hardenSecretsFile, wakeMerged }

const STATE_DIR = process.env.DSH_SUPERAGENT_STATE
  ? String(process.env.DSH_SUPERAGENT_STATE)
  : join(homedir(), '.dsh', 'state', 'session-superagent')
const SECRETS_FILE = join(STATE_DIR, 'secrets.json')
const STATE_FILE = join(STATE_DIR, 'watchers.json')
const TRIGGER_FILE = join(STATE_DIR, 'trigger.json')
// 客户端探针只认这几个键（别的键一律丢弃，防止被任意网页写盘）
const CLIENT_NOTE_KEYS = new Set(['client-version', 'client-base', 'apply', 'desk-registered', 'desk-fail', 'orbit-registered', 'orbit-fail', 'orbit-mount', 'badge-registered', 'badge-mount', 'badge-state', 'error'])
const DEFAULT_COOLDOWN_MS = 180_000

/**
 * 当前挂在这个进程上的路由 disposer。
 *
 * 宿主重载时若没走 dispose，旧实例会继续吃 HTTP 请求，而它的 ctx 可能已经 dispose ——
 * 真机表现：面板建的 watcher 第一轮就报
 * `cannot get required service "agents" in inactive context`（2026-11-02 复验）。
 *
 * 关键：宿主重载常常是**重新 import 一份模块**（模块级变量全新），所以光用模块级数组
 * 接不过去 —— 必须挂在 `globalThis` 上（用 Symbol.for 做键，多个模块实例共享同一个）。
 */
// 这三个结构必须跨模块实例共享：宿主重载常常是重新 import 一份模块，
// 模块级变量全新，但进程只有一个。新实例要能清掉旧实例的路由与定时器，
// 也要能看见旧实例「正在跑的那轮」（否则并发闸形同虚设）。
const TIMERS_KEY = Symbol.for('dsh-session-superagent.timers')
const INFLIGHT_KEY = Symbol.for('dsh-session-superagent.inFlight')
const sharedTimers = (globalThis[TIMERS_KEY] ||= new Map())
const sharedInFlight = (globalThis[INFLIGHT_KEY] ||= new Set())

const DEFAULT_ROUTE_BASE = '/session-superagent'
const ROUTE_GEN_KEY = Symbol.for('dsh-session-superagent.routeGeneration')
/** 本实例实际使用的路由前缀（正常情况下等于默认前缀）。 */
let activeBase = DEFAULT_ROUTE_BASE
const ROUTES_KEY = Symbol.for('dsh-session-superagent.activeRoutes')
const activeRoutes = (globalThis[ROUTES_KEY] ||= [])

// 最后一次成功读取的来源：正常 / 备份恢复 / 全新。面板与 /diagnose 会带上它。
let stateSource = 'new'

/**
 * 读状态文件。主文件坏了就退回上一次的备份（`.bak`），而不是直接当空状态 ——
 * 当空的后果是「客户所有守一夜消失」，这比多留一个备份文件糟糕得多。
 * 思路同 SQLite 的 WAL：**先保证有一份已提交的好副本**，再覆盖。
 */
function readState() {
  let raw
  try {
    raw = readFileSync(STATE_FILE, 'utf8')
  } catch {
    stateSource = 'new'
    return { watchers: {} }
  }
  try {
    const parsed = JSON.parse(raw)
    stateSource = 'ok'
    return parsed
  } catch {
    // 主文件坏了：试试备份
    try {
      const backup = JSON.parse(readFileSync(STATE_FILE + '.bak', 'utf8'))
      stateSource = 'backup'
      // 把备份写回主文件，避免下次还走恢复路径
      try { writeFileSync(STATE_FILE, JSON.stringify(backup, null, 2)) } catch {}
      return backup
    } catch {
      // 备份也没了/也坏了：把坏文件留个证据，再从空状态开始
      stateSource = 'corrupt'
      try { renameSync(STATE_FILE, STATE_FILE + '.corrupt-' + Date.now()) } catch {}
      return { watchers: {} }
    }
  }
}

function writeState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    // 合并写：调用方手里的 state 可能是很久以前读的快照（宿主重载、两个实例交替写），
    // 直接整份覆盖会把别人刚建的 watcher 抹掉 —— 真机上丢过两条（一条是用户的）。
    // 规则：盘上有、内存里没有的条目一律保留；只有墓碑里的 id 才允许消失。
    const disk = readState()
    const tombstones = { ...(disk.deleted || {}), ...(state.deleted || {}) }
    const merged = { ...disk, ...state }
    merged.watchers = { ...(disk.watchers || {}) }
    for (const [id, watcher] of Object.entries(state.watchers || {})) merged.watchers[id] = watcher
    const now = Date.now()
    for (const [id, at] of Object.entries(tombstones)) {
      delete merged.watchers[id]
      // 墓碑留 7 天足够覆盖任何迟到写入
      if (now - Date.parse(at) > 7 * 24 * 3600 * 1000) delete tombstones[id]
    }
    if (Object.keys(tombstones).length > 0) merged.deleted = tombstones
    else delete merged.deleted

    const text = JSON.stringify(merged, null, 1)
    // 原子写：写一半崩掉不该把全部 watcher 清空
    const tmp = STATE_FILE + '.tmp'
    writeFileSync(tmp, text)
    // 覆盖前先把「当前这份好的」留成备份：主文件将来被写坏（断电、磁盘满、手改），
    // readState 还能退回来，而不是把客户所有守当成空状态。
    try {
      const current = readFileSync(STATE_FILE, 'utf8')
      JSON.parse(current) // 只有当前文件是好的才备份，别把坏文件备份成"好版本"
      writeFileSync(STATE_FILE + '.bak', current)
    } catch {}
    try { renameSync(tmp, STATE_FILE) } catch { writeFileSync(STATE_FILE, text) }
    return merged
  } catch { return state /* state is best-effort: a failed write must not break a turn */ }
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
    // mode 在 Windows 上几乎无效，补 ACL（见 hardenSecretsFile 注释）
    hardenSecretsFile(SECRETS_FILE)
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
/**
 * 记一条时间线事件（有界、只存在状态里）。
 * 目的：回答"为什么这一轮没叫醒我" —— 以前只有 lastDeferred 一句，看不出前后因果。
 */
function noteEvent(entry, kind, text) {
  try {
    entry.events = pushEvent(entry.events, { kind, text })
  } catch { /* 观测失败不能影响主流程 */ }
}

function bumpFailure(entry, baseMs) {
  entry.consecutiveFailures = (Number(entry.consecutiveFailures) || 0) + 1
  entry.nextAt = new Date(Date.now() + nextDelayMs(entry, baseMs || 60000)).toISOString()
}

/**
 * 回收过期的隔离区：每次唤醒都会开一个新 worktree，不回收就会一直涨。
 * 只删 .dsh-zhuli/ 下超过 keepDays 天没动过的目录，删不掉就留着（不阻断唤醒）。
 */
async function cleanupWorktrees(workdir, keepDays = 3, keepCount = 5, options = {}) {
  if (!workdir) return 0
  const BS = String.fromCharCode(92)
  const base = String(workdir).split(BS).join('/').replace(/\/+$/, '')
  const root = base + '/.dsh-zhuli'
  let names = []
  try { names = readdirSync(root) } catch { return 0 }

  // 节流：没有超额就不必每次都跑 git（remove / prune / branch -D 都是进程级开销）
  const decision = shouldRunCleanup({
    count: names.length,
    keepCount,
    lastRunAt: Number(options.lastRunAt) || 0,
    intervalMs: CLEANUP_INTERVAL_MS,
  })
  if (!decision.run) return 0
  if (typeof options.onRun === 'function') options.onRun(decision.reason)
  const entries = []
  for (const name of names) {
    try { entries.push({ name, mtimeMs: statSync(root + '/' + name).mtimeMs }) } catch {}
  }
  // 数量线：最近 N 个留着（默认 5），其余回收 —— 年龄线管不住"堆"
  const stale = staleWorktrees(entries, { keepMs: keepDays * 24 * 3600 * 1000, keepCount: Number(keepCount) || 5 })
  let removed = 0
  for (const item of stale) {
    const target = root + '/' + item.name
    const res = await run('git', ['-C', workdir, 'worktree', 'remove', '--force', target], { timeoutMs: 30000 })
    if (res.code !== 0) {
      // 已经不是工作树（孤儿目录）：直接删目录，别让它永远留着
      try { rmSync(target, { recursive: true, force: true }) } catch {}
      // 关键：目录删了，但 git 的 `worktrees/<id>/` 管理文件还在 —— 不 prune 的话
      // `git worktree list` 会一直显示一个已经不存在的目录。
      // 依据：git-worktree 文档里 `prune` 的职责正是「清掉那些目录已经不在了的管理记录」。
      await run('git', ['-C', workdir, 'worktree', 'prune'], { timeoutMs: 20000 })
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
/**
 * 让隔离区不污染客户的 `git status`。
 *
 * 隔离区开在仓库内的 .dsh-zhuli/ 下，默认是**未跟踪目录** ——
 * 客户一切 git status 就会看到它，甚至可能顺手 git add 进去。
 * 写到 `.git/info/exclude`（本地、不提交、不修改客户的 .gitignore）最合适。
 */
async function ensureIsolationExcluded(workdir) {
  try {
    const res = await run('git', ['-C', workdir, 'rev-parse', '--git-path', 'info/exclude'], { timeoutMs: 15000 })
    if (res.code !== 0) return false
    const file = String(res.stdout || '').trim()
    if (!file) return false
    let current = ''
    try { current = readFileSync(file, 'utf8') } catch { current = '' }
    if (current.split(/\r?\n/).includes('.dsh-zhuli/')) return true
    const next = current + (current.endsWith('\n') || current === '' ? '' : '\n') + '.dsh-zhuli/' + '\n'
    writeFileSync(file, next)
    return true
  } catch {
    return false
  }
}

async function prepareIsolation(entry) {
  if (!entry || !entry.isolated || !entry.workdir) return null
  const plan = worktreePlan({ workdir: entry.workdir, repo: entry.repo, sessionTag: entry.sessionId })
  try {
    // 先回收过期隔离区，再开新的
    await cleanupWorktrees(entry.workdir, Number(entry.isolateKeepDays) || 3, Number(entry.maxIsolated) || 5, {
      lastRunAt: Number(entry.lastCleanupAt) || 0,
      onRun: () => { entry.lastCleanupAt = Date.now() },
    })
    await ensureIsolationExcluded(entry.workdir)
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

/**
 * 同会话几秒内的多条唤醒合并成一条再注入。
 *
 * 实测：同会话 3 个守、间隔 60 秒时，首轮抖动只把相位拉开 ≤5 秒 —— 之后每一轮都一样，
 * 于是三次唤醒落在约 1 秒内，会话连着收到 3 条注入（5 个守就是 5 条）。
 * 不做硬间隔，是因为"先到的守永远赢"会把后面的饿死；**合并**既不丢也不饿死。
 */
// 合并窗口：生产 3 秒；测试里可用环境变量压到毫秒级，避免用例等 3 秒
const WAKE_WINDOW_MS = Number(process.env.DSH_SUPERAGENT_WAKE_WINDOW_MS) || 3000
const wakeBuffers = new Map()

function wakeMerged(ctx, sessionId, text, onSettled) {
  const now = Date.now()
  const buf = wakeBuffers.get(sessionId) || { parts: [], timer: null, openedAt: now, settled: [] }
  buf.parts.push(text)
  if (onSettled) buf.settled.push(onSettled)
  if (buf.timer) return { ok: true, merged: true, pending: buf.parts.length }
  buf.timer = setTimeout(() => {
    wakeBuffers.delete(sessionId)
    let result = { ok: false, reason: 'merged empty' }
    try {
      const merged = mergeWakeTexts(buf.parts)
      if (merged) result = wake(ctx, sessionId, merged)
    } catch (error) {
      result = { ok: false, reason: String((error && error.message) || error) }
    }
    // 关键：真正发送之后才回调 —— 记账（唤醒次数、水位、历史）不能提前
    for (const cb of buf.settled) {
      try { cb(result) } catch { /* 单个回调失败不影响其它 */ }
    }
  }, WAKE_WINDOW_MS)
  if (buf.timer && typeof buf.timer.unref === 'function') buf.timer.unref()
  wakeBuffers.set(sessionId, buf)
  return { ok: true, merged: true, pending: buf.parts.length }
}

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



/**
 * 收紧凭证文件权限。
 *
 * Node 文档明确：**on Windows only the write permission can be changed, and the distinction
 * among the permissions of group, owner, or others is not implemented** —— 也就是说
 * 光靠 `mode: 0o600` 在 Windows 上约等于没有保护，同机其他账户仍可能读到 token。
 * 所以在 Windows 上补一条 icacls：断开继承，只给当前用户完全控制。
 * 出处：https://nodejs.org/api/fs.html（fs.chmod 的 Caveats）
 */
let secretsHardened = 'unknown'
function hardenSecretsFile(file) {
  if (process.platform !== 'win32') {
    try {
      chmodSync(file, 0o600)
      secretsHardened = 'posix-0600'
    } catch { secretsHardened = 'failed' }
    return secretsHardened
  }
  try {
    const user = os.userInfo().username
    execFileSync('icacls', [file, '/inheritance:r', '/grant:r', user + ':F'], { stdio: 'ignore', timeout: 15000 })
    secretsHardened = 'win32-acl'
  } catch {
    secretsHardened = 'failed'
  }
  return secretsHardened
}


/**
 * token 的权限范围（scopes）。
 *
 * 为什么值得看：GitHub 明确建议「最小权限」——细粒度 token 按端点授予，
 * 而经典 PAT 的 `repo` 一把就是全仓库读写。我们的实现只需要
 * 「读 issue/PR + 写评论和标签」，用 `delete:packages`、`admin:repo_hook` 这类 scope 纯属多余暴露。
 * 出处：https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
 *
 * 探测成本约 0.5 秒（起一个 gh 进程），所以缓存 5 分钟，别在每次 /state 里都跑。
 */
let scopesCache = { at: 0, value: null }
const BROAD_SCOPES = ['delete:packages', 'admin:repo_hook', 'admin:org', 'workflow', 'write:packages', 'admin:public_key']

async function tokenScopes() {
  if (scopesCache.value && Date.now() - scopesCache.at < 5 * 60 * 1000) return scopesCache.value
  const res = await run('gh', ['api', '-i', 'user'], { timeoutMs: 20000, env: ghEnv() })
  let value = { ok: false, scopes: [], broad: [], error: null, checkedAt: new Date().toISOString() }
  if (res.code !== 0) {
    value.error = redact(res.stderr).slice(0, 160)
  } else {
    const text = String(res.stdout || '')
    const line = text.split(String.fromCharCode(10)).find((l) => l.toLowerCase().startsWith('x-oauth-scopes:'))
    const raw = line ? line.slice('x-oauth-scopes:'.length).trim() : ''
    const scopes = raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : []
    value = {
      ok: true,
      scopes,
      broad: scopes.filter((scope) => BROAD_SCOPES.includes(scope)),
      error: null,
      checkedAt: new Date().toISOString(),
    }
  }
  scopesCache = { at: Date.now(), value }
  return value
}


/**
 * 新增守之前的即时体检：仓库在不在、能不能写、有没有 issue。
 *
 * 为什么放在这里：`probeAccess` 是后台跑的，客户要等到下一次 /state 才看到提示；
 * 而"填错仓库名"是最常见的输入错误，应该在点「添加」那一刻就说。
 *
 * 依据：`GET /repos/{owner}/{repo}` 对不存在的仓库（或无权访问的私有仓库）返回 404 ——
 * 官方文档把这两种情况归为同一个响应，所以文案要一起说「不存在或没有权限」。
 * 出处：https://docs.github.com/en/rest/repos/repos#get-a-repository
 *
 * 注意：**只产出警告，不阻止创建** —— 网络抖动不该让客户没法添加；
 * 测试环境（DSH_SUPERAGENT_NO_POLL=1）直接跳过，避免单测依赖网络。
 */
async function precheckRepo(repo) {
  const warnings = []
  if (process.env.DSH_SUPERAGENT_NO_POLL === '1') return { warnings, skipped: true }
  const res = await run('gh', ['api', 'repos/' + repo, '--jq',
    '{push: .permissions.push, hasIssues: .has_issues, archived: .archived, disabled: .disabled, private: .private, fork: .fork, parent: (.parent.full_name // null)}',
  ], { timeoutMs: 10000, env: ghEnv() })
  if (res.code !== 0) {
    const detail = redact(res.stderr)
    if (detail.includes('404')) {
      let hint = ''
      // 只在 404 之后才搜一次：search 池是 30 次/分钟（core 是 5000），不能滥用
      const name = repo.split('/')[1] || repo
      if (name.length >= 5) {
        const search = await run('gh', ['api', 'search/repositories?q=' + encodeURIComponent(name + ' in:name') + '&per_page=5', '--jq', '.items[].full_name'],
          { timeoutMs: 10000, env: ghEnv() })
        if (search.code === 0) {
          const picked = pickSuggestion(repo, String(search.stdout || '').split(String.fromCharCode(10)).map((v) => v.trim()).filter(Boolean))
          if (picked) hint = ' 是不是想填 ' + picked + '？'
        }
      }
      warnings.push('仓库 ' + repo + ' 不存在，或当前 token 没有访问权限 —— 先确认名字（owner/name）与权限。' + hint)
      return { warnings, notFound: true }
    }
    warnings.push('添加前没能确认这个仓库（' + detail.slice(0, 100) + '），稍后会在面板里再次探测。')
    return { warnings }
  }
  let info = {}
  try { info = JSON.parse(res.stdout) } catch { return { warnings } }
  const note = repoStructureNote({
    repo,
    hasIssues: info.hasIssues !== false,
    archived: info.archived === true,
    disabled: info.disabled === true,
    fork: info.fork === true,
    parent: info.parent || null,
    push: info.push === true,
    private: info.private === true,
  })
  if (note) warnings.push(note)
  return { warnings, access: { repo, push: info.push === true, private: info.private === true, fork: info.fork === true, hasIssues: info.hasIssues !== false, archived: info.archived === true, disabled: info.disabled === true, parent: info.parent || null, checkedAt: new Date().toISOString() } }
}

/** 隔离区占用：客户长期运行会攒下一堆一次性 worktree，面板上得看得见。 */
function isolationReport(entries) {
  const roots = new Map()
  for (const entry of entries) {
    if (!entry || entry.isolated !== true || !entry.workdir) continue
    roots.set(entry.workdir, true)
  }
  let totalBytes = 0
  const list = []
  for (const workdir of roots.keys()) {
    const base = String(workdir).replace(/[\/]+$/, '') + '/.dsh-zhuli'
    let count = 0
    let bytes = 0
    try {
      for (const name of readdirSync(base)) {
        const full = base + '/' + name
        count += 1
        bytes += dirSize(full, 2)
      }
    } catch { /* 目录还没有就是 0 */ }
    totalBytes += bytes
    list.push({ workdir, count, bytes })
  }
  return { roots: list, totalBytes }
}

/** 递归算目录大小（深度有上限，够用来判断"是不是涨到几百 MB 了"）。 */
function dirSize(path, depth) {
  if (depth <= 0) return 0
  let total = 0
  let items = []
  try { items = readdirSync(path, { withFileTypes: true }) } catch { return 0 }
  for (const item of items) {
    const full = path + '/' + item.name
    if (item.isDirectory()) total += dirSize(full, depth - 1)
    else {
      try { total += statSync(full).size } catch {}
    }
  }
  return total
}


/**
 * 取一批 issue 的「最后评论」。并发跑、短超时、最多 3 条、失败静默 ——
 * 多出来的 API 调用只在这几种条件下发生，别让它变成常态开销。
 */


/**
 * 已安装版本 vs 已加载版本。
 *
 * `SERVER_VERSION` 是**当前进程里加载的代码**的版本；磁盘上 package.json 的 version 是
 * **装好的**版本。两者不同 = 「文件换了，但宿主还在跑老模块」—— 这正是本机反复出现的情况
 * （client 热重载会生效，服务端不会，界面上看不出来）。
 */
function installedVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch { return null }
}

/** 当前 token 对应的账号（判断"最后一条评论是不是我们自己发的"）。缓存 10 分钟。 */
let viewerCache = { at: 0, login: null }
async function viewerLogin() {
  if (viewerCache.login && Date.now() - viewerCache.at < 10 * 60 * 1000) return viewerCache.login
  try {
    const res = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 12000, env: ghEnv() })
    if (res.code === 0) {
      const login = String(res.stdout || '').trim()
      if (login) { viewerCache = { at: Date.now(), login }; return login }
    }
  } catch {}
  return viewerCache.login
}

async function fetchLastComments(repo, items, maxItems = 3) {
  const targets = (items || []).filter((item) => Number(item.comments) > 0).slice(0, maxItems)
  if (targets.length === 0) return
  const me = await viewerLogin()
  const mark = (item, info) => {
    item.lastComment = {
      login: info.login,
      at: info.at,
      self: Boolean(me && String(info.login).toLowerCase() === me.toLowerCase()),
    }
  }
  // 首选：一次 GraphQL 批量（N 条评论 → 1 个请求）
  try {
    const [owner, name] = String(repo).split('/')
    const query = buildCommentBatchQuery(targets.length)
    const args = ['api', 'graphql', '-f', 'query=' + query, '-F', 'owner=' + owner, '-F', 'name=' + name]
    targets.forEach((item, i) => args.push('-F', 'n' + i + '=' + item.number))
    const res = await run('gh', args, { timeoutMs: 15000, env: ghEnv() })
    // 有 errors 但 data 有值时仍然可用（别的 issue 不存在不影响这一条）
    const payload = JSON.parse(String(res.stdout || '{}'))
    const parsed = parseCommentBatch(payload)
    let hit = 0
    for (const item of targets) {
      const info = parsed[String(item.number)]
      if (!info) continue
      if (info.login) mark(item, info)
      if (Array.isArray(info.linked) && info.linked.length > 0) item.linkedPr = info.linked
      hit += 1
    }
    if (hit > 0) return
  } catch { /* 落到 REST 兜底 */ }
  // 兜底：逐条 REST（GraphQL 不可用时仍要能工作）
  await Promise.all(targets.map(async (item) => {
    try {
      const res = await run('gh', ['api', `repos/${repo}/issues/${item.number}/comments?per_page=1&sort=created&direction=desc`,
        '--jq', '.[0] | {login: .user.login, at: .created_at}'], { timeoutMs: 12000, env: ghEnv() })
      if (res.code !== 0) return
      const parsed = JSON.parse(res.stdout)
      if (parsed && parsed.login) mark(item, { login: parsed.login, at: parsed.at })
    } catch { /* 少一行信息，不阻断唤醒 */ }
  }))
}

async function pollOnce(ctx, entry, baseMs) {
  // 活跃时段要**在拉 API 之前**判断：以前放在后面，夜里照样每 N 秒打一次 GitHub，纯浪费。
  // 不在时段内就把下一次轮询安排到"开门那一刻"，攒着的条目不会多等一个周期。
  if (entry.activeHours && !inActiveHours(entry.activeHours)) {
    const wait = msUntilActiveWindow(entry.activeHours)
    entry.nextAt = new Date(Date.now() + wait).toISOString()
    entry.lastDeferred = `不在活跃时段（${entry.activeHours}），${Math.round(wait / 60000)} 分钟后开始`
    entry.deferReason = 'active-hours'
    noteEvent(entry, 'defer', entry.lastDeferred)
    return
  }
  // 条件请求：带上上次的 ETag，没变化时 GitHub 回 304，且**不计入**速率限制
  const args = ['api', '--include', `repos/${entry.repo}/issues?state=all&sort=updated&direction=desc&per_page=20`]
  if (entry.etag) args.push('-H', 'If-None-Match: ' + entry.etag)
  const res = await run('gh', args, { timeoutMs: 45000, env: ghEnv() })
  entry.lastPoll = new Date().toISOString()
  if (res.code !== 0) {
    // 先看是不是被限流：GH 的 secondary limit 会给 Retry-After，照它等最准
    const failure = parseGhInclude(res.stdout)
    const wait = retryAfterMs(failure.retryAfter)
    if (wait > 0) {
      entry.nextAt = new Date(Date.now() + wait).toISOString()
      entry.lastDeferred = '被 GitHub 限流，按 Retry-After 等 ' + Math.round(wait / 1000) + ' 秒'
    entry.deferReason = 'ratelimit'
    noteEvent(entry, 'ratelimit', entry.lastDeferred)
      entry.lastError = null
      return
    }
    const detail = redact(res.stderr).slice(0, 240)
    // 常见失败给一句能照着做的提示，别只丢原始 stderr
    const classified = classifyGhError(detail)
    entry.lastError = (classified.short + classified.hint).slice(0, 300)
    bumpFailure(entry, baseMs)
    return
  }
  const parsed = parseGhInclude(res.stdout)
  // 额度自适应：剩余低于 500 时不再按固定间隔撞墙，直接把下一轮推到额度重置（最多 1 小时）
  const throttle = throttleDelayMs({ remaining: parsed.remaining, resetAt: parsed.resetAt })
  if (throttle > 0) {
    entry.nextAt = new Date(Date.now() + throttle).toISOString()
    entry.lastDeferred = '额度紧张（剩余 ' + parsed.remaining + '），已推迟到 '
    entry.deferReason = 'quota'
      + new Date(Date.now() + throttle).toISOString().slice(11, 16) + 'Z'
    entry.lastError = null
    return
  }
  if (parsed.status === 304) {
    // 没变化：不解析、不算失败、不重置退避，只记一笔
    entry.lastError = null
    entry.consecutiveFailures = 0
    entry.nextAt = null
    entry.lastDeferred = '未变化（304，不计入速率限制）'
    entry.deferReason = 'unchanged'
    noteEvent(entry, 'unchanged', entry.lastDeferred)
    return
  }
  if (parsed.etag) entry.etag = parsed.etag
  let items
  try { items = JSON.parse(parsed.body) } catch { entry.lastError = 'bad json'; bumpFailure(entry, baseMs); return }
  if (!Array.isArray(items)) { entry.lastError = 'unexpected payload'; bumpFailure(entry, baseMs); return }

  entry.lastError = null
  entry.consecutiveFailures = 0
  entry.nextAt = null
  // 记住最近一条"被重新打开"的 issue：这是最该被看见的信号（之前判过不做）
  const reopened = items.find((item) => (item.state_reason || '') === 'reopened')
  if (reopened) entry.lastReopened = reopened.number

  // 触发要有许可：过滤器不通过的条目根本不进候选集，也不写 seen 水位
  // 记忆要有遗忘：seen 只增不减会问成几 MB 的字典
  entry.seen = pruneSeen(entry.seen)
  const ackLabel = entry.ackLabel || DEFAULT_ACK_LABEL
  // 幂等痕迹留在 GitHub 上：带 ack 标签的条目直接跳过（换机器、删状态都不会重报）
  const considered = []
  // 每轮重置：这行要被读成「本轮跳过多少」，累计值会越滚越大、误导客户
  entry.filterCounts = {}
  for (const item of items) {
    if (hasAckLabel(item, ackLabel)) {
      entry.filteredLog = pushFiltered(entry.filteredLog, { at: entry.lastPoll, number: item.number, title: String(item.title || '').slice(0, 80), reason: '已 ack' })
      entry.filterCounts = countReasons(entry.filterCounts, '已 ack')
      continue
    }
    const reason = filterReason(item, entry.filters)
    if (reason) {
      entry.filterCounts = countReasons(entry.filterCounts, reason)
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
    entry.deferReason = 'observe'
    noteEvent(entry, 'observe', entry.lastDeferred)
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

  // 会话级上限（跨守累计）：单守上限 × 守数量 = 实际频率，光有单守上限挡不住
  const sessionCap = Math.max(1, Number(entry.sessionMaxWakes) || DEFAULT_SESSION_WAKES)
  const sessionUsed = sessionWakesLastHour(Object.values(readState().watchers || {}), entry.sessionId)
  if (sessionUsed >= sessionCap) {
    entry.lastDeferred = '这条会话一小时内已被唤醒 ' + sessionUsed + ' 次（上限 ' + sessionCap + '），已攒 ' + fresh.length + ' 条待处理'
    entry.deferReason = 'cap-session'
    noteEvent(entry, 'cap-session', entry.lastDeferred)
    return
  }

  // 每小时唤醒上限：宁可攒着，也不要连续叫醒把上下文打爆
  const cap = Math.max(1, Number(entry.maxWakesPerHour) || 6)
  entry.wakeTimes = pruneWakeTimes(entry.wakeTimes)
  if (entry.wakeTimes.length >= cap) {
    // 只记原因，绝不动 seen/cursor —— 否则「攒着」等于「丢掉」
    const freeAt = nextWaketimeAt(entry.wakeTimes, cap)
    const waitMin = Math.max(1, Math.round((freeAt - Date.now()) / 60000))
    entry.lastDeferred = `每小时最多唤醒 ${cap} 次，已攒 ${fresh.length} 条待处理（约 ${waitMin} 分钟后可再唤醒）`
    entry.deferReason = 'cap-watcher'
    noteEvent(entry, 'cap-watcher', entry.lastDeferred)
    return
  }

  // 条目不丢：水位照常全部前移，消息里只铺开前 N 条，其余给编号
  const limit = Math.max(1, Number(entry.batchLimit) || 5)
  const { listed, rest } = splitBatch(fresh, Number(entry.batchLimit) || 3, entry.priorityOrder || entry.priority)
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

  // 会话忙时**不要**先开隔离区：`git worktree add`（本机实测 0.19s，大仓库更久）
  // 加上回收过期副本的若干次 git 调用，全都是白发 —— 因为 decideWake 之后一定会拒绝。
  {
    const agents = agentsService(ctx)
    const agent = agents && typeof agents.get === 'function' ? agents.get(entry.sessionId) : undefined
    const pre = decideWake(agent && agent.status)
    if (!pre.ok) {
      entry.lastDeferred = '会话正忙（' + String(pre.reason || '') + '），这一轮不准备隔离区，下一轮再试'
      return
    }
  }
  const isolation = await prepareIsolation(entry)
  if (isolation && isolation.dir) entry.lastWorktree = isolation.dir
  // 批次前几条补「最后是谁在说话」（最多 3 条，失败静默）
  await fetchLastComments(entry.repo, listed)
  const wakeText = formatWatchText(entry.repo, listed, {
    more: rest.length,
    restNumbers: rest.map((item) => item.number),
    isolation,
    // entry.goal 之前只写不读：现在真的进唤醒消息
    goal: entry.goal || '',
    // 只读仓库要在任务书里直说，否则会话会去试写然后吃 403
    access: accessNote(entry.repoAccess),
    // 完成标准要可观测（Given-When-Then 的思路）：三件事缺一不算完成
    criteria: [
      '改了什么：文件清单 + 一句话为什么（别只写"已修复"）',
      '怎么验证的：跑过的测试/命令 + 结果；跑不了就写清为什么跑不了',
      iso && iso.dir ? '回写到哪：推分支并开 PR，然后在 issue 里留言 + watch_ack 打标签' : '回写到哪：在 issue 里留言 + watch_ack 打标签',
    ],
    // 「为什么是这几条」：把本轮的筛选依据一并写进任务书
    changedTotal: fresh.length,
    batchLimit: listed.length,
    skippedReasons: entry.filterCounts || {},
  })
  entry.lastWakeCount = fresh.length
  entry.lastBatch = listed.map((item) => item.number)
  // 记账一律放到「真正发送之后」：
  // 之前是入队即记账 —— 会话忙时 decideWake 会拒绝，次数却已经记了、seen 也已经推进，
  // 于是那几条既不会重试（seen 已推进）又白白占掉名额。这是会丢消息的 bug。
  wakeMerged(ctx, entry.sessionId, wakeText, (result) => {
    entry.lastWake = result.ok ? new Date().toISOString() : 'failed: ' + String(result.reason || '')
    entry.history = pushHistory(entry.history, {
      at: new Date().toISOString(),
      numbers: entry.lastBatch,
      ok: result.ok,
      reason: result.ok ? null : String(result.reason || '').slice(0, 120),
    })
    if (result.ok) {
      // 上一次唤醒之后有没有 ack？没有就累计"叫醒了没回音"
      entry.silentWakes = silentStreak({
        previousWakeAt: entry.prevWakeAt,
        lastAckedAt: entry.lastAcked && entry.lastAcked.at,
        previousStreak: entry.silentWakes,
      })
      if (entry.silentWakes === 0 && entry.prevWakeAt) noteEvent(entry, 'acked', '上一次唤醒有回音（ack 出现过了）')
      entry.prevWakeAt = new Date().toISOString()
      entry.wakeTimes.push(Date.now())
      entry.dailyWakes = bumpDailyWakes(entry.dailyWakes)
      entry.lastDeferred = null
      entry.deferReason = null
      noteEvent(entry, 'wake', '唤醒了 ' + (entry.lastBatch || []).length + ' 条：' + (entry.lastBatch || []).map((n) => '#' + n).join(' '))
      entry.seen = advanceSeen(entry.seen, fresh)
      entry.lastReported = recordReported(entry, fresh)
      entry.cursor = newestUpdatedAt(fresh)
    } else {
      // 保留水位，下一轮重试这次事件
      entry.lastError = 'wake failed: ' + String(result.reason || '')
      noteEvent(entry, 'wake-failed', entry.lastError)
      // 会话正忙是暂时的：下一轮直接重试；退避反而会越拖越久
      entry.deferReason = 'busy'
      if (/busy|running|idle/i.test(String(result.reason || ''))) {
        entry.lastDeferred = '会话正忙，下一轮重试'
      } else {
        bumpFailure(entry, baseMs)
      }
    }
    persistEntry(entry)
  })
}

export function apply(ctx) {
  const timers = sharedTimers
  // 并发闸的唯一事实源：tick 和 HTTP「立刻」拿到的是两个不同的 entry 对象，
  // 靠 entry.polling 标记永远对不上（审核专员 probe-c 实证：同一条被唤醒 3 次）。
  // 跨模块实例共享：旧实例还没跑完的那轮，新实例不能同时再跑一遍。
  const inFlight = sharedInFlight

  /** 后台查一次仓库权限：push=false 说明只能读，回写评论/标签都会 403。 */
  const probeAccess = async (entry) => {
    try {
      const res = await run('gh', ['api', 'repos/' + entry.repo, '--jq',
        '{push: .permissions.push, private: .private, fork: .fork, hasIssues: .has_issues, archived: .archived, disabled: .disabled, parent: (.parent.full_name // null)}'],
      { timeoutMs: 20000, env: ghEnv() })
      if (res.code !== 0) return
      const info = JSON.parse(res.stdout)
      entry.repoAccess = {
        repo: entry.repo,
        push: info.push === true,
        private: info.private === true,
        fork: info.fork === true,
        hasIssues: info.hasIssues !== false,
        archived: info.archived === true,
        disabled: info.disabled === true,
        parent: info.parent || null,
        checkedAt: new Date().toISOString(),
      }
      persistEntry(entry)
    } catch { /* 探测失败不影响主流程 */ }
  }

  const startWatcher = (entry) => {
    if (timers.has(entry.id)) return
    const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000
    // 首轮错峰：多条守同间隔时不要整点一起发车（之后按 every 稳定推进，不累积漂移）
    const firstDelay = jitterMs(entry.id, Math.min(5000, every * 0.1))

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
    // 首轮按确定性抖动错峰（0~5 秒），之后按 every 稳定推进
    if (firstDelay > 0) {
      const boot = setTimeout(() => { tick() }, firstDelay)
      boot.unref?.()
    } else {
      tick()
    }
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

  /**
   * 版本检查（只读）：问 npm registry 最新版是多少，和本实例版本比。
   * 不触发安装 —— 装/升级要改 profile，必须由人执行且升级后要重载宿主。
   * 10 分钟内存缓存，避免面板每次刷新都打 registry。
   */
  const UPDATE_CACHE_MS = 10 * 60 * 1000
  let updateCache = null
  const checkUpdate = async (force) => {
    if (!force && updateCache && Date.now() - updateCache.at < UPDATE_CACHE_MS) return updateCache.value
    const current = SERVER_VERSION
    const value = { current, latest: null, publishedAt: null, hasUpdate: false, command: '', error: null }
    try {
      const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent('dsh-session-superagent') + '/latest', {
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'application/json' },
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const body = await res.json()
      value.latest = String(body.version || '')
      const published = typeof body.dist?.tarball === 'string' ? body.dist.tarball : ''
      if (published) value.publishedAt = published
      const score = (v) => String(v || '0').split('.').map((n) => Number(n) || 0).reduce((acc, n) => acc * 1000 + n, 0)
      value.hasUpdate = score(value.latest) > score(current)
      value.command = 'dsh plugin --profile <你的 profile> add dsh-session-superagent@' + (value.latest || 'latest')
    } catch (error) {
      value.error = String((error && error.message) || error).slice(0, 160)
    }
    updateCache = { at: Date.now(), value }
    return value
  }

  // Read-only status endpoints for the web panel. `httpServer` is looked up
  // through ctx.inject: the service may load after this plugin, and ctx.get()
  // does not wait for it.
  const registerRoutes = (httpServer) => {
    if (!httpServer || typeof httpServer.register !== 'function') return
    for (const dispose of activeRoutes) { try { dispose() } catch {} }
    activeRoutes.length = 0
    for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
    timers.clear()
    const routes = []
    // 宿主热重载时旧实例的路由可能还没 dispose；一条重复会让整个 try 崩掉，
    // 面板和所有接口一起 404（2026-11-02 真机踩到 webserver: duplicate exact route）。
    // 改成每条路由单独容错：重复的那条记下来，其余照常注册。
    const failedRoutes = []
    const attempted = []
    const addRoute = (options) => {
      attempted.push(options)
      try {
        const dispose = httpServer['register'](options)
        routes.push(dispose)
        activeRoutes.push(dispose)
      } catch (error) {
        failedRoutes.push(String((error && error.message) || error).slice(0, 120))
      }
    }
    const record = (kind, detail) => {
      const state = readState()
      state.client = state.client || {}
      state.client[kind] = { at: new Date().toISOString(), detail }
      writeState(state)
    }
    try {
      addRoute({
        kind: 'exact',
        path: '/session-superagent/state',
        handler: async (req, res) => {
          if (req.method !== 'GET') { res.statusCode = 405; res.end('method not allowed'); return }
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const focusSession = url.searchParams.get('sessionId') || ''
          const state = readState()
          // 顺带刷新一次 token scopes（缓存 5 分钟；失败不影响 /state）
          tokenScopes().catch(() => {})
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
            sessionMaxWakes: w.sessionMaxWakes ?? 12,
            consecutiveFailures: w.consecutiveFailures ?? 0,
            nextAt: w.nextAt ?? null,
            lastDeferred: w.lastDeferred ?? null,
            observe: w.observe === true,
            filteredLog: (w.filteredLog ?? []).slice(-5),
            filterCounts: w.filterCounts ?? {},
            repoAccess: w.repoAccess ?? null,
            lastReopened: w.lastReopened ?? null,
            priority: w.priority ?? null,
            isolated: w.isolated === true,
            workdir: w.workdir ?? null,
            lastWorktree: w.lastWorktree ?? null,
            activeHours: w.activeHours ?? null,
            isolateKeepDays: w.isolateKeepDays ?? 3,
            maxIsolated: w.maxIsolated ?? 5,
            history: (w.history ?? []).slice(-5),
            events: (w.events ?? []).slice(-20),
            deferReason: w.deferReason ?? null,
            daily: dailySummary(w.dailyWakes),
            busy: busierThanUsual(dailySummary(w.dailyWakes)),
            silentWakes: w.silentWakes ?? 0,
            note: w.goal ?? '',
            title: sessionTitle(w.sessionId),
          }))
          const stateBody = {
            gh,
            routeBase: activeBase,
            serverVersion: SERVER_VERSION,
            updatedAt: new Date().toISOString(),
            credentials: secretsSummary(),
            sessionGoal: goalView(ctx, focusSession),
            stateSource,
            // 会话级用量：上限够不够，客户应该一眼看到（数据都在状态里，零新增请求）
            sessionUsage: (() => {
              const list = Object.values(state.watchers || {})
              const usage = list.length === 0 ? null : sessionWakesLastHour(list, focusSession)
              const cap = list.length === 0 ? null : (Number(list[0].sessionMaxWakes) || 12)
              const capped = countCapped(list)
              if (usage === null) return null
              const suggest = suggestSessionCap({ used: usage, cap, capped })
              return { used: usage, cap, capped, suggest }
            })(),
            // 版本漂移：文件换了但宿主还在跑老模块（客户端热重载会掩盖这件事）
            installedVersion: installedVersion(),
            runningVersion: SERVER_VERSION,
            triageSignals: TRIAGE_SIGNALS,
            tokenScopes: scopesCache.value || null,
            isolation: isolationReport(Object.values(state.watchers || {})),
            sessionTitle: sessionTitle(focusSession),
            watchers: watchers.map((w) => ({ ...w, goal: goalView(ctx, w.sessionId) })),
          }
          // ETag/304：面板每 5 秒拉一次 /state，没变化时没必要重传整份 JSON ——
          // 和我们自己对 GitHub 做的事一样，只是方向反过来（这次我们是服务端）。
          // 依据：RFC 9110 §15.4.5 规定 304 不带正文，客户端沿用本地缓存。
          const payload = JSON.stringify(stateBody)
          // 注意：updatedAt 每次都变，把它排除在指纹之外，否则 ETag 永远不命中
          const stable = JSON.stringify({ ...stateBody, updatedAt: undefined })
          const etag = '"' + createHash('sha1').update(stable).digest('hex').slice(0, 16) + '"'
          res.setHeader('etag', etag)
          // 测试里的假 req 可能没有 headers，别因此崩
          const inm = String((req.headers && req.headers['if-none-match']) || '')
          if (inm && inm.split(',').map((v) => v.trim()).includes(etag)) {
            res.statusCode = 304
            res.end()
            return
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(payload)
        },
      })
      addRoute({
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
      })
      addRoute({
        kind: 'exact',
        path: '/session-superagent/client-error',
        handler: (req, res) => { record('error', String(req.url).slice(0, 400)); res.statusCode = 204; res.end() },
      })
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
      addRoute({
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
            if (result.deleted) {
              // 立墓碑：否则一个持有旧快照的写入会把这条又"复活"
              state.deleted = { ...(state.deleted || {}), [id]: new Date().toISOString() }
            }
            if (result.deleted || result.enabled === false) stopWatcher(id)
            writeState(state)
            if (result.enabled === true) startWatcher(state.watchers[id])
            return json(res, 200, result)
          }
          const repo = String(body.repo || '').trim()
          if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return json(res, 400, { error: 'repo must be owner/name' })
          const sessionId = String(body.sessionId || '').trim()
          if (!sessionId) return json(res, 400, { error: 'sessionId is required (open the panel in the session that should be woken)' })
          // 若这个实例的 ctx 已经 dispose（宿主重载后旧 handler 仍在服务请求），
          // 建出来的 watcher 一定跑不起来（定时器一 tick 就 inactive context）。
          // 与其静默造一条死守，不如直接拒绝并让用户重载宿主。
          const agentsHere = agentsService(ctx)
          const canReachSessions = agentsHere && typeof agentsHere.get === 'function'
          if (!canReachSessions) {
            json(res, 503, { ok: false, error: '插件实例已失效（当前 handler 跑在已释放的上下文里）：请重载 DSH 后再添加' })
            return
          }
          const intervalSec = Math.max(30, Math.min(3600, Number(body.intervalSec) || 60))
          const state = readState()
          state.watchers = state.watchers || {}
          const id = repo + '#' + sessionId
          const created = !(state.watchers && state.watchers[id])
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
          if (body.sessionMaxWakes != null) entry.sessionMaxWakes = Math.max(1, Math.min(60, Number(body.sessionMaxWakes) || DEFAULT_SESSION_WAKES))
          if (typeof body.ackLabel === 'string' && body.ackLabel.trim()) entry.ackLabel = body.ackLabel.trim().slice(0, 60)
          // 优先级开关：客户可以关掉某几类"加权"，只按 updated 顺序处理
          if (body.priority && typeof body.priority === 'object') {
            entry.priority = {
              reopened: body.priority.reopened !== false,
              comments: body.priority.comments !== false,
              labels: body.priority.labels !== false,
              // 默认关：没有官方依据支持"无人认领更紧急"
              unassigned: body.priority.unassigned === true,
              stale: body.priority.stale === true,
            }
          }
          // 隔离执行（对标 DeepSeek DSec）：每次唤醒开一次性 worktree，改副本不碰主工作区
          entry.observe = body.observe === undefined ? entry.observe === true : body.observe === true
          entry.isolated = body.isolated === undefined ? entry.isolated === true : body.isolated === true
          if (body.isolateKeepDays != null) entry.isolateKeepDays = Math.max(1, Math.min(30, Number(body.isolateKeepDays) || 3))
          // 同时最多留几个隔离区（越界回收最旧的）—— 1~50
          if (body.maxIsolated != null) entry.maxIsolated = Math.max(1, Math.min(50, Number(body.maxIsolated) || 5))
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
          // 只有**新建**时才做添加前体检：编辑已有守不该再打一次网络
          const isNew = !created && !state.watchers[id]
          let warnings = []
          if (isNew) {
            const pre = await precheckRepo(repo)
            warnings = pre.warnings || []
            if (pre.access) entry.repoAccess = pre.access
          }
          state.watchers[id] = entry
          writeState(state)
          // 编辑已有 watcher 时，间隔/配置变化要立刻生效：startWatcher 会因为 timer 已存在而直接返回
          if (entry.enabled) {
            stopWatcher(id)
            probeAccess(entry).catch(() => {})

            startWatcher(entry)
          }
          json(res, 200, { ok: true, id, repo, intervalSec, enabled: entry.enabled, warnings })
        },
      })

      // Credentials typed by the operator. Stored 0600 under the state dir and
      // never echoed back; the answer carries only a masked summary.
      addRoute({
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
      })

      // 客户报障用：把「版本 / 挂载状态 / 每条守的最近错误」拼成一段可直接粘贴的文本。
      // 客户在别的电脑上，我们看不到他的状态文件 —— 让他一键复制这段就够了。
      addRoute({
        kind: 'exact',
        path: '/session-superagent/diagnose',
        handler: (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const state = readState()
          const mounted = state.server || {}
          const lines = []
          lines.push('主理鱼诊断 · ' + new Date().toISOString())
          lines.push('插件版本: ' + SERVER_VERSION)
          lines.push('宿主: DSH / node ' + String(process.version || ''))
          lines.push('凭证保护: ' + (secretsHardened === 'unknown' ? '未写入过 token' : secretsHardened))
          lines.push('挂载: routes=' + String(mounted.routes ?? '?')
            + ' failed=' + String((mounted.failed || []).length)
            + ' base=' + String(mounted.base || '-')
            + ' at=' + String(mounted.at || '-'))
          if ((mounted.failed || []).length > 0) lines.push('挂载失败: ' + mounted.failed.join('; '))
          const entries = Object.values(state.watchers || {})
          lines.push('值守: ' + entries.length + ' 条')
          for (const entry of entries) {
            lines.push('- ' + entry.repo
              + ' | ' + (entry.enabled === false ? '已暂停' : '启用')
              + ' | 间隔 ' + entry.intervalSec + 's'
              + ' | 会话 ' + String(entry.sessionId || '').slice(0, 20)
              + ' | 上次轮询 ' + String(entry.lastPoll || '-')
              + ' | 失败 ' + (entry.consecutiveFailures || 0)
              + (entry.lastError ? ' | 错误: ' + String(entry.lastError).slice(0, 160) : ''))
          }
          const text = redact(lines.join(String.fromCharCode(10)))
          json(res, 200, { ok: true, text })
        },
      })

      // 单条追溯：面板点「追溯」时来问。只回传结论与明细，不回传 seen/lastReported 这类大字段。
      addRoute({
        kind: 'exact',
        path: '/session-superagent/trace',
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const repo = url.searchParams.get('repo') || ''
          const number = url.searchParams.get('number') || ''
          const state = readState()
          const list = Object.values(state.watchers || {}).filter((entry) => !repo || entry.repo === repo)
          const lines = []
          for (const entry of list) {
            const trace = itemTrace(entry, number)
            if (!trace) continue
            const touched = Boolean(trace.seen || trace.reported || trace.filtered.length || trace.wakes.length)
            if (!touched) continue
            lines.push('#' + trace.number + ' @ ' + (trace.repo || '?') + '：' + trace.verdict)
            if (trace.seen) lines.push('水位 ' + trace.seen)
            if (trace.reported) lines.push('上次上报 ' + trace.reported)
            for (const item of trace.filtered) lines.push('被过滤（' + (item.reason || '未知') + '）' + item.at)
            for (const item of trace.wakes) lines.push('唤醒尝试 ' + item.at + '　' + (item.ok ? '成功' : '失败（' + (item.reason || '未知') + '）'))
          }
          const text = lines.length > 0
            ? lines.join(String.fromCharCode(10))
            : '#' + number + ' 在' + (repo || '所有守') + ' 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。'
          json(res, 200, { ok: true, text })
        },
      })

      // 版本检查（只读；面板「设置」页那一行「有新版本」靠它）
      addRoute({
        kind: 'exact',
        path: '/session-superagent/update',
        handler: async (req, res) => {
          if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' })
          const url = new URL(String(req.url || '/'), 'http://127.0.0.1')
          const value = await checkUpdate(url.searchParams.get('refresh') === '1')
          json(res, 200, value)
        },
      })

      // Set / edit / clear the session's REAL goal through ctx.goals — the same
      // service the /goal command drives, so the panel and the conversation are
      // one source of truth (polling reads it back).
      addRoute({
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
      })

      // 热重载时旧实例的 handler 摘不掉（宿主路由表行为）：默认前缀会全部撞车。
      // 那就换一个带序号的前缀整组重放 —— 面板会自己发现新前缀（客户端 discoverBase）。
      if (failedRoutes.length > 0) {
        const generation = (Number(globalThis[ROUTE_GEN_KEY]) || 1) + 1
        globalThis[ROUTE_GEN_KEY] = generation
        const altBase = DEFAULT_ROUTE_BASE + '/r' + generation
        const replay = attempted.map((options) => ({ ...options, path: String(options.path).replace(DEFAULT_ROUTE_BASE, altBase) }))
        failedRoutes.length = 0
        for (const options of replay) addRoute(options)
        if (failedRoutes.length === 0) {
          activeBase = altBase
          record('route-base', altBase)
        }
      }
      const state = readState()
      state.server = { at: new Date().toISOString(), routes: routes.length, failed: failedRoutes, base: activeBase }
      writeState(state)
    } catch (error) {
      const state = readState()
      state.server = { at: new Date().toISOString(), routes: routes.length, failed: failedRoutes, error: String((error && error.message) || error).slice(0, 300) }
      writeState(state)
    }
    const teardown = () => {
      for (const dispose of routes) { try { dispose() } catch {} }
      routes.length = 0
      activeRoutes.length = 0
      // 插件卸载/热重载后旧定时器不能继续跑：它们还持有已 dispose 的 ctx
      for (const handle of timers.values()) { try { clearInterval(handle) } catch {} }
      timers.clear()
      try { clearInterval(sweepHandle) } catch {}
    }
    // 两条路都挂上：ctx.effect 的清理函数在 effect 作用域销毁时一定被调用；
    // ctx.on('dispose') 覆盖宿主走事件广播的卸载方式。真机踩过「路由没 dispose →
    // 重载后重复路由 → 六条接口全灭」，多挂一条成本很低。
    try { ctx.effect(() => teardown) } catch {}
    ctx.on('dispose', teardown)
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
      format: { type: 'string', description: "'text' (default) or 'json'." },
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
      if (failed) {
        return (args && args.format === 'json')
          ? JSON.stringify({ schemaVersion: 1, ok: false, repo: entry.repo, acked: results, failed: { number: failed.number, text: failed.text } })
          : `[error: #${failed.number} gh exited ${failed.code}] ${failed.text}`
      }
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
      if (args && args.format === 'json') {
        return JSON.stringify({ schemaVersion: 1, ok: true, repo: entry.repo, label, acked: results, at: nowIso })
      }
      return `acked ${entry.repo} #${results.join(' #')} with label "${label}"`
    },
  }))

  // 单条追溯：agent 被问"这条为什么没叫醒我"时不用猜，直接查
  ctx.tools.register(defineTool({
    name: 'watch_trace',
    description:
      'Explain what happened to one issue/PR: whether it was filtered (and why), absorbed by the cooldown, already reported, or never seen. Read-only — changes nothing. Use it when the customer asks "why did this not wake me".',
    parameters: {
      repo: { type: 'string', description: 'owner/name; defaults to the only watched repo' },
      number: { type: 'number', description: 'issue or PR number to trace' },
      format: { type: 'string', description: "'text' (default) or 'json'." },
    },
    async execute(args) {
      const state = readState()
      const all = Object.values(state.watchers || {})
      const wanted = typeof args.repo === 'string' && args.repo.trim() ? args.repo.trim() : null
      const list = wanted ? all.filter((entry) => entry && entry.repo === wanted) : all
      if (list.length === 0) {
        const message = 'no watcher for that repo — ' + (wanted ? 'nothing is watching ' + wanted : 'run watch_status to see what is watched')
        // format=json 时错误也要是 JSON：消费方不该在两种格式间猜
        return (args && args.format === 'json') ? JSON.stringify({ schemaVersion: 1, error: message }) : '[error: ' + message + ']'
      }
      const number = Number(args.number)
      if (!Number.isFinite(number)) {
        return (args && args.format === 'json') ? JSON.stringify({ schemaVersion: 1, error: 'number is required' }) : '[error: number is required]'
      }
      const lines = []
      for (const entry of list) {
        const trace = itemTrace(entry, number)
        if (!trace) continue
        const touched = Boolean(trace.seen || trace.reported || trace.filtered.length || trace.wakes.length)
        if (!touched) continue
        lines.push('#' + trace.number + ' @ ' + (trace.repo || '?') + '：' + trace.verdict)
        if (trace.seen) lines.push('  水位 seen：' + trace.seen)
        if (trace.reported) lines.push('  上次上报：' + trace.reported)
        for (const item of trace.filtered) lines.push('  被过滤（' + item.reason + '）：' + item.at)
        for (const item of trace.wakes) lines.push('  唤醒尝试：' + item.at + '　' + (item.ok ? '成功' : '失败（' + (item.reason || '未知') + '）'))
      }
      if (args && args.format === 'json') {
        const results = []
        for (const entry of list) {
          const trace = itemTrace(entry, number)
          if (!trace) continue
          const touched = Boolean(trace.seen || trace.reported || trace.filtered.length || trace.wakes.length)
          if (!touched) continue
          results.push(trace)
        }
        return JSON.stringify({ schemaVersion: 1, number: String(number), results }, null, 2)
      }
      if (lines.length === 0) {
        return '#' + number + ' 在' + (wanted ? ' ' + wanted : '所有守') + ' 里都没有痕迹 —— 可能还没被轮询到，或者编号写错了。'
      }
      return lines.join(String.fromCharCode(10))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_doctor',
    description:
      'Self-check the watchers: gh login, repo access, ack label existence, isolation workdir. Read-only; prints a checklist.',
    parameters: {
      repo: { type: 'string', description: 'only check this owner/name; default = every watcher' },
      format: { type: 'string', description: "'text' (default) or 'json'." },
    },
    async execute(args) {
      const lines = []
      const state = readState()
      const all = Object.values(state.watchers || {})
      const wanted = args.repo ? all.filter((w) => w && w.repo === String(args.repo)) : all

      // -1. 版本一致性：文件换了但没重启时，服务端仍然跑老代码（客户端热重载会掩盖这件事）
      const installed = installedVersion()
      if (installed && installed !== SERVER_VERSION) {
        lines.push(`WARN 代码已更新但未生效：磁盘 ${installed} / 正在运行 ${SERVER_VERSION} —— 需要重启宿主（不是重装）`)
      } else if (installed) {
        lines.push(`OK 版本一致：${SERVER_VERSION}`)
      }

      // 0. 挂载状态：面板/HTTP 靠路由，路由注册失败时工具仍然可用 —— 这种「半死」状态
      //    光看工具是发现不了的（2026-11-02 真机踩过：duplicate exact route 让六条接口全灭）
      if (state.server) {
        const mounted = Number(state.server.routes) || 0
        const failed = Array.isArray(state.server.failed) ? state.server.failed : []
        if (state.server.error) {
          lines.push(`FAIL 面板接口挂载：${state.server.error}（工具仍可用，但面板会空白；重载一次即可）`)
        } else if (failed.length > 0) {
          lines.push(`WARN 面板接口部分失败（${mounted}/6 成功）：${failed.join('；')}`)
        } else {
          lines.push(`OK   面板接口挂载：${mounted} 条，无失败`)
        }
      } else {
        lines.push('WARN 还没有挂载记录（刚装上或从未加载过路由）')
      }

      // 1. gh 是否登录
      const auth = await run('gh', ['auth', 'status'], { env: ghEnv() })
      const authed = auth.code === 0
      lines.push(`${authed ? 'OK  ' : 'FAIL'} gh 登录：${auth.code === 0 ? '正常' : redact([auth.stderr, auth.stdout].join(' ')).slice(0, 120)}`)

      if (wanted.length === 0) {
        lines.push('INFO 当前没有任何 watcher —— 先 watch_start 或到面板加一条')
        if (args && args.format === 'json') {
          const checks = lines.map((line) => {
            const m = /^(OK|WARN|FAIL|INFO)\s*(.*)$/.exec(line)
            return { status: m ? m[1].toLowerCase() : 'info', text: (m ? m[2] : line).trim() }
          })
          return JSON.stringify({ schemaVersion: 1, checks }, null, 2)
        }
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
      // format=json 时从同一份文本行解析出结构 —— 单一来源，不会出现两套逻辑走偏
      if (args && args.format === 'json') {
        const checks = lines.map((line) => {
          const m = /^(OK|WARN|FAIL|INFO)\s*(.*)$/.exec(line)
          return { status: m ? m[1].toLowerCase() : 'info', text: (m ? m[2] : line).trim() }
        })
        return JSON.stringify({ schemaVersion: 1, checks }, null, 2)
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
      format: { type: 'string', description: "'text' (default) or 'json'." },
      batchLimit: { type: 'number', description: 'Max items listed per wake (1-20, default 5).' },
      maxWakesPerHour: { type: 'number', description: 'Max wakes per hour per watcher (1-60, default 6).' },
      sessionMaxWakes: { type: 'number', description: 'Max wakes per hour for the whole session, summed across watchers (1-60, default 12).' },
      isolateKeepDays: { type: 'number', description: 'With isolated: remove isolation worktrees older than this many days (1-30, default 3).' },
      maxIsolated: { type: 'number', description: 'With isolated: keep at most this many worktrees, oldest removed first (1-50, default 5).' },
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
      // 面板能改的三项，工具也要能改 —— 否则被问"把隔离区最多留 3 个"时 agent 无从下手
      if (typeof args.sessionMaxWakes === 'number') entry.sessionMaxWakes = Math.max(1, Math.min(60, Math.round(args.sessionMaxWakes)))
      if (typeof args.isolateKeepDays === 'number') entry.isolateKeepDays = Math.max(1, Math.min(30, Math.round(args.isolateKeepDays)))
      if (typeof args.maxIsolated === 'number') entry.maxIsolated = Math.max(1, Math.min(50, Math.round(args.maxIsolated)))
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
      if (args && args.format === 'json') {
        return JSON.stringify({ schemaVersion: 1, ok: true, repo, sessionId, id, intervalSec: entry.intervalSec,
          flags, filters: entry.filters || {}, updated: Boolean(existing), observe: entry.observe === true,
          isolated: entry.isolated === true, activeHours: entry.activeHours || null }, null, 2)
      }
      return `watching ${repo} → session ${sessionId} every ${entry.intervalSec}s` +
        (flags.length ? ' [' + flags.join(' ') + ']' : '') +
        (existing ? ' (updated existing watcher)' : '')
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_status',
    description: 'Report active watchers: schedule, why one is paused, unanswered wakes, and how much of the session wake budget is used. Use format=json for machine-readable output. Read-only.',
    parameters: {
      format: { type: 'string', description: "'text' (default, human) or 'json' (same data, structured)." },
    },
    async execute(args) {
      const state = readState()
      const list = Object.values(state.watchers || {})
      if (!list.length) return args && args.format === 'json' ? JSON.stringify({ schemaVersion: 1, session: null, watchers: [] }) : '(no watchers)'
      // 同一份数据：结构化视图 -> 文本只是它的一种渲染，两边永远对得上
      const view = statusView(list)
      if (args && args.format === 'json') return JSON.stringify(view, null, 2)
      const body = view.watchers.map((w) => {
        const flags = []
        if (w.observe) flags.push('observe')
        if (w.isolated) flags.push('isolated')
        if (!w.enabled) flags.push('paused')
        if (w.activeHours) flags.push('hours=' + w.activeHours)
        if (w.labels.length) flags.push('labels=' + w.labels.join(','))
        if (w.onlyAssigned) flags.push('onlyAssigned')
        if (w.deferReason) flags.push('defer=' + w.deferReason)
        if (w.silentWakes > 0) flags.push('silent=' + w.silentWakes)
        return [w.repo, '→', w.sessionId,
          '| every ' + w.intervalSec + 's',
          flags.length ? '| ' + flags.join(' ') : '',
          '| lastPoll=' + (w.lastPoll || '-'),
          '| lastWake=' + (w.lastWake || '-'),
          '| err=' + (w.lastError || '-'),
        ].filter(Boolean).join(' ')
      }).join(String.fromCharCode(10))
      const s2 = view.session
      const summary = 'session: ' + s2.used + '/' + s2.cap + ' wakes last hour'
        + (s2.capped > 0 ? '，' + s2.capped + ' 条守正因上限暂停' : '')
        + (s2.suggest ? '，建议把会话上限调到 ' + s2.suggest : '')
      return body + String.fromCharCode(10) + summary
    },
  }))

  ctx.tools.register(defineTool({
    name: 'watch_stop',
    description: 'Stop watching a repository for the current session.',
    parameters: {
      repo: { type: 'string', required: true, description: 'owner/name' },
      format: { type: 'string', description: "'text' (default) or 'json'." },
    },
    async execute(args) {
      const toolAgents = agentsService(ctx)
      const agent = toolAgents && typeof toolAgents.currentInitiator === 'function' ? toolAgents.currentInitiator() : undefined
      const sessionId = agent && agent.id
      const id = `${args.repo}#${sessionId}`
      const state = readState()
      if (!state.watchers || !state.watchers[id]) {
        const message = 'no watcher for ' + id
        return (args && args.format === 'json') ? JSON.stringify({ schemaVersion: 1, ok: false, id, error: message }) : '(' + message + ')'
      }
      state.watchers[id].enabled = false
      writeState(state)
      const timer = timers.get(id)
      if (timer) { clearInterval(timer); timers.delete(id) }
      if (args && args.format === 'json') return JSON.stringify({ schemaVersion: 1, ok: true, id, repo: args.repo })
      return `stopped ${id}`
    },
  }))
}
