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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { redact } from './redact.js'
import { advanceSeen, decideWake, formatWatchText, newestUpdatedAt, partitionItems, recordReported } from './watch.js'

export const name = 'dsh-session-superagent'
export const inject = ['tools', 'agents', 'webServer']

const STATE_DIR = join(homedir(), '.dsh', 'state', 'session-superagent')
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

function persistEntry(entry) {
  try {
    const state = readState()
    state.watchers = state.watchers || {}
    state.watchers[entry.id] = Object.assign({}, state.watchers[entry.id] || {}, entry)
    writeState(state)
  } catch {}
}

/** Spawn a command, capture both streams, never echo the credential. */
function run(file, args, options = {}) {
  const { input, cwd, timeoutMs = 60000 } = options
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, windowsHide: true, shell: false })
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

async function pollOnce(ctx, entry) {
  const res = await run('gh', ['api', `repos/${entry.repo}/issues?state=all&sort=updated&direction=desc&per_page=20`], { timeoutMs: 45000 })
  entry.lastPoll = new Date().toISOString()
  if (res.code !== 0) {
    entry.lastError = redact(res.stderr).slice(0, 300)
    return
  }
  let items
  try { items = JSON.parse(res.stdout) } catch { entry.lastError = 'bad json'; return }
  if (!Array.isArray(items)) { entry.lastError = 'unexpected payload'; return }

  entry.lastError = null
  const { fresh, absorbed } = partitionItems(items, entry, { cooldownMs: Number(entry.cooldownMs) || DEFAULT_COOLDOWN_MS })

  // Our own comment/close bumps: advance the watermark without waking anyone,
  // so the item never resurfaces once the cooldown window is over.
  if (absorbed.length > 0) {
    entry.seen = advanceSeen(entry.seen, absorbed)
    entry.lastAbsorbed = absorbed.length
    const newestAbsorbed = newestUpdatedAt(absorbed)
    if (!entry.cursor || Date.parse(newestAbsorbed) > Date.parse(entry.cursor)) entry.cursor = newestAbsorbed
  }
  if (fresh.length === 0) return

  const result = wake(ctx, entry.sessionId, formatWatchText(entry.repo, fresh))
  entry.lastWake = result.ok ? new Date().toISOString() : `failed: ${result.reason}`
  entry.lastWakeCount = fresh.length
  if (result.ok) {
    entry.seen = advanceSeen(entry.seen, fresh)
    entry.lastReported = recordReported(entry, fresh)
    entry.cursor = newestUpdatedAt(fresh)
  } else {
    // Keep the watermark untouched so the next poll retries this event.
    entry.lastError = `wake failed: ${result.reason}`
  }
}

export function apply(ctx) {
  const timers = new Map()

  const startWatcher = (entry) => {
    if (timers.has(entry.id)) return
    const tick = async () => {
      try {
        await pollOnce(ctx, entry)
      } catch (error) {
        entry.lastError = String((error && error.message) || error)
      } finally {
        persistEntry(entry)
      }
    }
    const every = Math.max(30, Number(entry.intervalSec) || 60) * 1000
    timers.set(entry.id, setInterval(tick, every))
    tick()
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
          const state = readState()
          const watchers = Object.values(state.watchers || {}).map((w) => ({
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
          }))
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ updatedAt: new Date().toISOString(), watchers }))
        },
      }))
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/client-hello',
        handler: (req, res) => { record('hello', String(req.url)); res.statusCode = 204; res.end() },
      }))
      routes.push(httpServer.register({
        kind: 'exact',
        path: '/session-superagent/client-error',
        handler: (req, res) => { record('error', String(req.url).slice(0, 400)); res.statusCode = 204; res.end() },
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
        input: write && args.body ? args.body : undefined,
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
      const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef,visibility,url'], { cwd: process.cwd() })
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
        const res = await run('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: process.cwd() })
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
