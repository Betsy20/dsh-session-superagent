import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, dirname, extname, join, resolve } from 'node:path'

import { redact } from './redact.js'
import { isStrictSemver } from './semver.js'

export { isStrictSemver }

export const UPDATE_PACKAGE_NAME = 'dsh-session-superagent'
export const DEFAULT_UPDATE_TIMEOUT_MS = 120_000
export const UPDATE_OUTPUT_LIMIT_BYTES = 16 * 1024

const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const UPDATE_LOCK_KEY = Symbol.for('dsh-session-superagent.pluginUpdateInFlight')

function updateError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** The POST body is deliberately closed: no command, args, cwd, env, or profile overrides. */
export function validateUpdateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, code: 'invalid_body', error: '请求体必须是 JSON 对象，且只允许可选字段 version' }
  }
  const keys = Object.keys(body)
  if (keys.some((key) => key !== 'version')) {
    return { ok: false, code: 'invalid_body', error: '请求体只允许可选字段 version' }
  }
  if (body.version !== undefined && !isStrictSemver(body.version)) {
    return { ok: false, code: 'invalid_version', error: 'version 必须是严格 semver（例如 0.9.271），不接受 latest、范围或命令参数' }
  }
  return { ok: true, version: body.version }
}

export function resolveProfile(env = process.env) {
  const names = ['DSH_PROFILE', 'DSH_PROFILE_NAME', 'DSH_ACTIVE_PROFILE']
  for (const name of names) {
    const value = typeof env[name] === 'string' ? env[name].trim() : ''
    if (!value) continue
    if (!PROFILE_RE.test(value)) {
      throw updateError('invalid_profile', name + ' 含有不支持的字符；profile 只能包含字母、数字、点、下划线和连字符，且不能以连字符开头')
    }
    return value
  }
  throw updateError('profile_unavailable', '无法确定要更新的 DSH profile：宿主环境未提供 DSH_PROFILE（也支持 DSH_PROFILE_NAME / DSH_ACTIVE_PROFILE）')
}

export function pluginAddArguments(profile, version) {
  if (!PROFILE_RE.test(String(profile || ''))) throw updateError('invalid_profile', 'profile 格式无效')
  if (!isStrictSemver(version)) throw updateError('invalid_version', 'version 必须是严格 semver')
  return ['plugin', '--profile', profile, 'add', UPDATE_PACKAGE_NAME + '@' + version]
}

function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

function pathCandidates(env, platform) {
  const pathValue = typeof env.PATH === 'string' ? env.PATH : ''
  const names = platform === 'win32' ? ['dsh.exe', 'dsh.cmd', 'dsh'] : ['dsh']
  const dirs = pathValue.split(delimiter).map((part) => part.trim()).filter(Boolean)
  const found = []
  for (const dir of dirs) {
    for (const name of names) found.push(join(dir, name))
  }
  return found
}

function layoutCandidates(resourcesPath, execPath, platform) {
  const roots = []
  for (const root of [resourcesPath, execPath ? join(dirname(execPath), 'resources') : null]) {
    if (root && !roots.includes(root)) roots.push(root)
  }
  const name = platform === 'win32' ? 'dsh.cmd' : 'dsh'
  return roots.map((root) => join(root, 'runtime', 'cli', 'bin', name))
}

/** Official @deepseek-ai/dsh bin.js inside the installed asar; Electron can execute it directly. */
function cliJsCandidates(resourcesPath, execPath, env) {
  const relative = ['app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js']
  const roots = []
  for (const root of [resourcesPath, execPath ? join(dirname(execPath), 'resources') : null]) {
    if (root && !roots.includes(root)) roots.push(root)
  }
  const installRoots = []
  if (env.DSH_PROFILE_DIR) installRoots.push(resolve(env.DSH_PROFILE_DIR, '..', '..', '..'))
  if (env.DSH_HOME) installRoots.push(resolve(env.DSH_HOME, '..'))
  const candidates = roots.map((root) => join(root, ...relative))
  for (const root of installRoots) {
    if (root) candidates.push(join(root, 'Desktop', 'resources', ...relative))
  }
  return candidates
}

/**
 * Convert the standard Windows dsh.cmd wrapper into its direct Electron form.
 * This preserves shell:false even on Node versions that refuse to spawn .cmd.
 */
function standardWindowsCommand(cmdPath, fileExists) {
  const binDir = dirname(cmdPath)
  const desktopDir = resolve(binDir, '..', '..', '..', '..')
  const resourcesDir = resolve(binDir, '..', '..', '..')
  const executable = join(desktopDir, 'DeepSeek Harness.exe')
  const asar = join(resourcesDir, 'app.asar')
  if (!fileExists(executable) || !fileExists(asar)) return null
  return {
    file: executable,
    args: [
      '--expose-internals',
      join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/** Desktop profile 的 plugin 管理在 desktop-host；通用 dsh/bin.js 会拒绝 reserved desktop。 */
function desktopWindowsCommand(jsPath, execPath, fileExists) {
  if (!/DeepSeek Harness\.exe$/i.test(execPath) || !fileExists(execPath)) return null
  const marker = join('app.asar', 'dsh', 'node_modules', '@deepseek-ai')
  const index = jsPath.indexOf(marker)
  if (index < 0) return null
  const hostSuffix = join('@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  const hostCli = jsPath.endsWith(hostSuffix)
    ? jsPath
    : join(jsPath.slice(0, index), 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  if (!fileExists(hostCli)) return null
  return {
    file: execPath,
    args: ['--expose-internals', hostCli],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  }
}

/**
 * Resolution order is explicit and deterministic:
 *   1. DSH_CLI_PATH
 *   2. each PATH entry
 *   3. resources/runtime/cli/bin/dsh[.cmd] from the DSH installation layout
 * Existing but unusable candidates do not become a false success.
 */
export function resolveDshCommand(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const execPath = options.execPath || process.execPath
  const resourcesPath = options.resourcesPath === undefined ? process.resourcesPath : options.resourcesPath
  const fileExists = options.fileExists || isFile
  const candidates = []
  const add = (path, source) => {
    if (path && !candidates.some((item) => item.path === path)) candidates.push({ path, source })
  }
  if (typeof env.DSH_CLI_PATH === 'string' && env.DSH_CLI_PATH.trim()) add(env.DSH_CLI_PATH.trim(), 'DSH_CLI_PATH')
  for (const path of pathCandidates(env, platform)) add(path, 'PATH')
  for (const path of layoutCandidates(resourcesPath, execPath, platform)) add(path, 'DSH installation')
  for (const path of cliJsCandidates(resourcesPath, execPath, env)) add(path, 'DSH installation CLI JS')

  let unsupported = false
  for (const candidate of candidates) {
    if (!fileExists(candidate.path)) continue
    const extension = extname(candidate.path).toLowerCase()
    if (['.js', '.mjs', '.cjs'].includes(extension)) {
      if (platform === 'win32' && candidate.path.includes('app.asar')) {
        const converted = desktopWindowsCommand(candidate.path, execPath, fileExists)
        if (!converted) {
          throw updateError('cli_unsupported', 'Windows Desktop 的 asar CLI 必须配套 dsh-desktop-host/lib/cli.js 与 DeepSeek Harness.exe；本次没有退回通用 bin.js 管理 desktop profile')
        }
        return { ...converted, source: candidate.source }
      }
      return {
        file: execPath,
        args: [candidate.path],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        source: candidate.source,
      }
    }
    if (platform === 'win32' && ['.cmd', '.bat'].includes(extension)) {
      const converted = standardWindowsCommand(candidate.path, fileExists)
      if (converted) return { ...converted, source: candidate.source }
      unsupported = true
      continue
    }
    return { file: candidate.path, args: [], env: {}, source: candidate.source }
  }
  if (unsupported) {
    throw updateError('cli_unsupported', '找到了 Windows dsh.cmd/dsh.bat，但它不属于可直接执行的标准 DSH 安装布局；为避免 shell 注入，本次没有执行。请把 DSH_CLI_PATH 指向标准安装中的 dsh.cmd、dsh.exe 或 cli.js')
  }
  throw updateError('cli_not_found', '找不到可执行的 DSH CLI：已按 DSH_CLI_PATH → PATH → DSH 安装布局顺序查找。请把 DSH_CLI_PATH 指向 dsh 可执行文件或 cli.js')
}

function outputCollector(limit) {
  // 多留一段用于跨 chunk 的完整 token 匹配；最终仍是先脱敏、再截断。
  const captureLimit = limit + 4096
  const chunks = []
  let bytes = 0
  let truncated = false
  return {
    append(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8')
      const remaining = Math.max(0, captureLimit - bytes)
      if (remaining > 0) chunks.push(buffer.subarray(0, Math.min(remaining, buffer.length)))
      bytes += Math.min(remaining, buffer.length)
      if (buffer.length > remaining) truncated = true
    },
    finish() {
      const sanitized = redact(Buffer.concat(chunks, bytes).toString('utf8'))
      const capped = capInjectedOutput(sanitized)
      let text = capped.text
      if (truncated || capped.truncated) {
        // 截断点只留下已知 token 前缀时保守遮蔽；普通长文本不整段吞掉。
        text = text.replace(/(?:gh[pousr]_|sk-[A-Za-z0-9_-]*|xox[baprs]-|AKIA|AIza|eyJ)[A-Za-z0-9_+/.=-]*$/i, '***')
      }
      return { text, truncated: truncated || capped.truncated }
    },
  }
}

function normalizeTimeout(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : DEFAULT_UPDATE_TIMEOUT_MS
}

/** Production runner: argv is an array and shell is always false. */
export function createSpawnRunner(options = {}) {
  const spawnImpl = options.spawn || spawn
  return async function spawnRunner(request) {
    const timeoutMs = normalizeTimeout(request.timeoutMs ?? options.timeoutMs)
    const env = options.env || process.env
    const command = (options.resolveCommand || resolveDshCommand)({
      env,
      platform: options.platform,
      execPath: options.execPath,
      resourcesPath: options.resourcesPath,
      fileExists: options.fileExists,
    })
    const args = [...command.args, ...pluginAddArguments(request.profile, request.version)]

    return new Promise((resolveResult) => {
      let child
      try {
        child = spawnImpl(command.file, args, {
          env: { ...env, ...(command.env || {}) },
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        resolveResult({ code: 'spawn_error', error: String((error && error.message) || error), stdout: '', stderr: '' })
        return
      }

      const stdout = outputCollector(UPDATE_OUTPUT_LIMIT_BYTES)
      const stderr = outputCollector(UPDATE_OUTPUT_LIMIT_BYTES)
      let settled = false
      let timeoutResult = null
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const out = stdout.finish()
        const err = stderr.finish()
        resolveResult({
          ...result,
          stdout: out.text,
          stderr: err.text,
          stdoutTruncated: out.truncated,
          stderrTruncated: err.truncated,
        })
      }
      const timer = setTimeout(() => {
        timeoutResult = { code: 'timeout', error: 'DSH CLI 更新命令超过 ' + timeoutMs + 'ms，已终止该 CLI 子进程；未确认安装成功' }
        try { child.kill('SIGKILL') } catch {}
        // kill() 只表示已发送信号；必须等 close 确认进程与 stdio 都已结束。
        // 若 close 永不到达，此 Promise 保持 pending，外层超时后并发锁也继续保持。
      }, timeoutMs)

      child.stdout?.on('data', stdout.append)
      child.stderr?.on('data', stderr.append)
      child.on('error', (error) => {
        if (timeoutResult) return
        finish({ code: 'spawn_error', error: String((error && error.message) || error) })
      })
      child.on('close', (code, signal) => {
        if (timeoutResult) {
          finish(timeoutResult)
        } else if (typeof code === 'number') {
          finish({ code })
        } else {
          finish({ code: 'spawn_error', error: 'DSH CLI 未给出退出码' + (signal ? '（signal=' + signal + '）' : '') })
        }
      })
    })
  }
}

export const spawnPluginUpdate = createSpawnRunner()

function capInjectedOutput(value) {
  const text = String(value ?? '')
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= UPDATE_OUTPUT_LIMIT_BYTES) return { text, truncated: false }
  // Back off at most three bytes so the cap never splits a UTF-8 continuation sequence.
  let end = UPDATE_OUTPUT_LIMIT_BYTES
  let back = 0
  while (end > 0 && back < 4 && (buffer[end] & 0b1100_0000) === 0b1000_0000) {
    end -= 1
    back += 1
  }
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}

function normalizeRunnerResult(result) {
  // 必须在任何截断之前脱敏：否则 16KiB 边界可能只留下半截 token，路由再脱敏也认不出来。
  const stdout = capInjectedOutput(redact(result && result.stdout))
  const stderr = capInjectedOutput(redact(result && result.stderr))
  return {
    ...(result || {}),
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: Boolean(result && result.stdoutTruncated) || stdout.truncated,
    stderrTruncated: Boolean(result && result.stderrTruncated) || stderr.truncated,
  }
}

function normalizeFailure(error) {
  const rawCode = String((error && error.code) || '')
  const code = rawCode.toLowerCase() === 'cli_not_found' ? 'cli_not_found'
    : rawCode.toLowerCase() === 'cli_unsupported' ? 'cli_unsupported'
      : rawCode || 'update_failed'
  return {
    ok: false,
    code,
    // 先脱敏再截断：错误回显也可能带凭证，截断后只剩 token 前缀就无法再识别。
    error: redact(String((error && error.message) || error || '更新失败')).slice(0, 1000),
    stdout: '',
    stderr: '',
  }
}

/**
 * Single-process/cross-module update gate plus an outer timeout for injected runners.
 * After an outer timeout the lock stays held until a late runner actually settles,
 * so a hung runner can never cause a second installation to overlap the first.
 */
export async function runExclusiveUpdate(request) {
  if (!isStrictSemver(request && request.version)) return normalizeFailure(updateError('invalid_version', 'version 必须是严格 semver'))
  let profile
  try { profile = resolveProfile(request.env || process.env) } catch (error) { return normalizeFailure(error) }
  if (globalThis[UPDATE_LOCK_KEY]) {
    return { ok: false, code: 'update_in_flight', error: '已有一个插件更新命令在执行，本次没有重复启动', stdout: '', stderr: '' }
  }
  globalThis[UPDATE_LOCK_KEY] = true
  const runner = request.runner || spawnPluginUpdate
  const timeoutMs = normalizeTimeout(request.timeoutMs)
  let timedOut = false
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (globalThis[UPDATE_LOCK_KEY]) delete globalThis[UPDATE_LOCK_KEY]
  }
  const work = Promise.resolve().then(() => runner({
    version: request.version,
    profile,
    timeoutMs,
  }))
  // Attach both handlers now: a late rejection after the HTTP timeout is still handled.
  work.then(() => { if (timedOut) release() }, () => { if (timedOut) release() })
  let timer
  let outerTimeoutError = null
  try {
    const result = await new Promise((resolveResult, rejectResult) => {
      outerTimeoutError = updateError('timeout', '等待更新命令超过 ' + timeoutMs + 'ms；未确认安装成功，请核对磁盘版本后再试')
      timer = setTimeout(() => rejectResult(outerTimeoutError), timeoutMs)
      work.then(resolveResult, rejectResult)
    })
    const normalized = normalizeRunnerResult(result)
    return { ...normalized, ok: normalized.code === 0, profile, version: request.version }
  } catch (error) {
    if (error === outerTimeoutError) {
      timedOut = true
      return { ...normalizeFailure(error), code: 'timeout', profile, version: request.version }
    }
    return { ...normalizeFailure(error), profile, version: request.version }
  } finally {
    clearTimeout(timer)
    if (!timedOut) release()
  }
}
