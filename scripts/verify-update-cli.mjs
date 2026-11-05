#!/usr/bin/env node
// 0.9.272 真机回归：只解析官方 DSH CLI 并执行 desktop-host cli.js --help。
// 不执行 plugin add，不安装、不重启，也不读取或打印凭证。
//
// 用法：node scripts/verify-update-cli.mjs [--json] [--timeout-ms 30000]
// stdout 始终是一行 JSON；人类可读 PASS/FAIL/SKIP 写到 stderr。
// PASS=0，FAIL=1，SKIP=2。SKIP 不是通过，CI 必须失败关闭。

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redact } from '../lib/redact.js'

const SCHEMA_VERSION = 1
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_OUTPUT_LIMIT_BYTES = 16 * 1024
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '..')
const STARTED = Date.now()
const STARTED_AT = new Date(STARTED).toISOString()
const ELECTRON_NAME = 'DeepSeek Harness.exe'
const OFFICIAL_HOST_CLI_SUFFIX = join('app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
const USAGE = [
  '用法：node scripts/verify-update-cli.mjs [--json] [--timeout-ms 30000] [--output-limit-bytes 16384]',
  '定位 DeepSeek Harness.exe：DSH_ELECTRON_PATH → resourcesPath → DSH_PROFILE_DIR → DSH_HOME。',
  '找不到 exe 时输出 SKIP 并以 2 退出；这不是通过，CI 不应忽略。',
  '可显式指定：DSH_ELECTRON_PATH="D:/DeepSeek Harness/Desktop/DeepSeek Harness.exe" node scripts/verify-update-cli.mjs',
  '也可用真实 Electron 直接运行：ELECTRON_RUN_AS_NODE=1 "D:/DeepSeek Harness/Desktop/DeepSeek Harness.exe" scripts/verify-update-cli.mjs',
  '只调用 resolveDshCommand({}) 与官方 desktop-host cli.js --help；不会执行 plugin add、安装或重启。',
].join('\n')

let cliOptions = { json: false, nested: false }

function sanitize(value) {
  let text = redact(String(value ?? ''))
  // 本探针额外覆盖 DeepSeek/OpenAI 常见 sk-*，以及错误回显中的键值形凭证。
  text = text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '***')
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|token)\s*[:=]\s*["']?[^\s,"']{6,}/gi, (match) => match.slice(0, match.search(/[:=]/) + 1) + ' ***')
  return text
}

function capUtf8(value, limit) {
  const buffer = Buffer.from(String(value ?? ''), 'utf8')
  if (buffer.length <= limit) return { text: buffer.toString('utf8'), truncated: false }
  let end = limit
  while (end > 0 && (buffer[end] & 0b1100_0000) === 0b1000_0000) end -= 1
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}

function collector(limit) {
  // 多留 4 KiB 给跨 chunk 的凭证匹配；最终返回仍严格 capped + redacted。
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
      const sanitized = sanitize(Buffer.concat(chunks, bytes).toString('utf8'))
      const capped = capUtf8(sanitized, limit)
      let text = capped.text
      if (truncated || capped.truncated) {
        // 截断点可能恰好落在尚未匹配完整的前缀型 token 中，尾部一律保守遮蔽。
        text = text.replace(/[A-Za-z0-9_+/.=-]{20,}$/, '***')
      }
      return { text, truncated: truncated || capped.truncated }
    },
  }
}

function isFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

function normalizedPath(path) {
  let value = resolve(String(path || '')).replace(/[\\/]+/g, '/').replace(/\/$/, '')
  if (process.platform === 'win32') value = value.toLowerCase()
  return value
}

function samePath(a, b) {
  return normalizedPath(a) === normalizedPath(b)
}

function normalizedSuffix(path) {
  let value = String(path || '').replace(/[\\/]+/g, '/').replace(/^\/+|\/+$/g, '')
  if (process.platform === 'win32') value = value.toLowerCase()
  return value
}

function baseReport(status, exitCode) {
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    ok: status === 'PASS',
    ciPass: status === 'PASS',
    exitCode,
    startedAt: STARTED_AT,
    workspace: ROOT,
    runtime: {
      platform: process.platform,
      node: process.version,
      electron: process.versions.electron || null,
      execPath: process.execPath,
      resourcesPath: process.resourcesPath || null,
      electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
    },
    checks: [],
  }
}

function finishReport(report, status, exitCode) {
  report.status = status
  report.ok = status === 'PASS'
  report.ciPass = report.ok
  report.exitCode = exitCode
  report.finishedAt = new Date().toISOString()
  report.durationMs = Date.now() - STARTED
  return report
}

function check(report, name, pass, detail) {
  const row = { name, pass: Boolean(pass) }
  if (detail !== undefined) row.detail = typeof detail === 'string' ? sanitize(detail) : detail
  report.checks.push(row)
  return row.pass
}

function errorInfo(error) {
  return {
    code: error && error.code ? String(error.code) : 'probe_error',
    message: sanitize((error && error.message) || error),
  }
}

function sanitizeJson(value) {
  // 先逐字段脱敏再序列化；不能直接正则扫整段 JSON，否则 Authorization 等
  // 模式可能连同引号、逗号一起吃掉，反而破坏机器可读输出。
  if (typeof value === 'string') return sanitize(value)
  if (Array.isArray(value)) return value.map(sanitizeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJson(item)]))
  }
  return value
}

function emit(report, human) {
  const safeReport = sanitizeJson(report)
  process.stdout.write(JSON.stringify(safeReport) + '\n')
  if (!human) return
  for (const row of safeReport.checks || []) {
    const detail = row.detail === undefined
      ? ''
      : ' ' + (typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail))
    process.stderr.write(`${row.pass ? 'PASS' : 'FAIL'} ${row.name}${detail}\n`)
  }
  const summary = safeReport.status === 'PASS'
    ? `PASS 真实 DSH CLI 探针 profile=${safeReport.profile?.name || '-'} source=${safeReport.resolution?.source || '-'} helpExit=${safeReport.help?.exitCode}`
    : safeReport.status === 'SKIP'
      ? `SKIP 未找到 ${ELECTRON_NAME}；没有运行解析或 --help，exit=2，CI 不得记为通过`
      : `FAIL 真实 DSH CLI 探针 ${safeReport.error ? `${safeReport.error.code}: ${safeReport.error.message}` : '一项或多项检查失败'}`
  process.stderr.write(summary + '\n')
  if (safeReport.status === 'SKIP') process.stderr.write(USAGE + '\n')
}

function parsePositiveInteger(name, value, minimum, maximum) {
  if (!/^\d+$/.test(String(value || ''))) throw new Error(`${name} 必须是整数`)
  const number = Number(value)
  if (number < minimum || number > maximum) throw new Error(`${name} 必须在 ${minimum}..${maximum} 之间`)
  return number
}

function parseArgs(argv) {
  const options = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputLimitBytes: DEFAULT_OUTPUT_LIMIT_BYTES,
    json: false,
    nested: false,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--nested') options.nested = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--timeout-ms') options.timeoutMs = parsePositiveInteger(arg, argv[++index], 1, 300_000)
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = parsePositiveInteger('--timeout-ms', arg.slice(13), 1, 300_000)
    else if (arg === '--output-limit-bytes') options.outputLimitBytes = parsePositiveInteger(arg, argv[++index], 32, 65_536)
    else if (arg.startsWith('--output-limit-bytes=')) options.outputLimitBytes = parsePositiveInteger('--output-limit-bytes', arg.slice(21), 32, 65_536)
    else throw new Error(`未知参数 ${arg}；本探针不接受 CLI 子命令或版本参数`)
  }
  return options
}

function discoverElectron() {
  const candidates = []
  const seen = new Set()
  const add = (source, path) => {
    if (!path || typeof path !== 'string') return
    const absolute = resolve(path)
    const key = normalizedPath(absolute)
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ source, path: absolute, exists: isFile(absolute) })
  }
  add('DSH_ELECTRON_PATH', process.env.DSH_ELECTRON_PATH)
  add('process.resourcesPath', process.resourcesPath ? resolve(process.resourcesPath, '..', ELECTRON_NAME) : null)
  add('resourcesPath', process.env.resourcesPath ? resolve(process.env.resourcesPath, '..', ELECTRON_NAME) : null)
  add('DSH_RESOURCES_PATH', process.env.DSH_RESOURCES_PATH ? resolve(process.env.DSH_RESOURCES_PATH, '..', ELECTRON_NAME) : null)
  add('DSH_PROFILE_DIR', process.env.DSH_PROFILE_DIR ? resolve(process.env.DSH_PROFILE_DIR, '..', '..', '..', 'Desktop', ELECTRON_NAME) : null)
  add('DSH_HOME', process.env.DSH_HOME ? resolve(process.env.DSH_HOME, '..', 'Desktop', ELECTRON_NAME) : null)
  return { candidates, selected: candidates.find((candidate) => candidate.exists) || null }
}

function profileInfo() {
  for (const name of ['DSH_PROFILE', 'DSH_PROFILE_NAME', 'DSH_ACTIVE_PROFILE']) {
    if (process.env[name]) return { name: process.env[name], source: name }
  }
  if (process.env.DSH_PROFILE_DIR) return { name: basename(process.env.DSH_PROFILE_DIR), source: 'DSH_PROFILE_DIR basename' }
  return { name: null, source: null }
}

function runOfficialHelp(command, options) {
  const args = [...command.args, '--help']
  const stdout = collector(options.outputLimitBytes)
  const stderr = collector(options.outputLimitBytes)
  const started = Date.now()
  return new Promise((resolveResult) => {
    let child
    let settled = false
    let timedOut = false
    let timer = null
    const finish = (exitCode, signal, spawnError) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      const out = stdout.finish()
      const err = stderr.finish()
      resolveResult({
        file: command.file,
        args,
        shell: false,
        timeoutMs: options.timeoutMs,
        exitCode,
        signal: signal || null,
        timedOut,
        error: spawnError ? errorInfo(spawnError) : null,
        stdout: out.text,
        stderr: err.text,
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        durationMs: Date.now() - started,
      })
    }
    try {
      child = spawn(command.file, args, {
        cwd: ROOT,
        env: { ...process.env, ...(command.env || {}), ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      finish(null, null, error)
      return
    }
    timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch {}
      finish(null, 'SIGKILL', null)
    }, options.timeoutMs)
    child.stdout?.on('data', stdout.append)
    child.stderr?.on('data', stderr.append)
    child.on('error', (error) => finish(null, null, error))
    child.on('close', (code, signal) => finish(typeof code === 'number' ? code : null, signal, null))
  })
}

async function runElectronProbe(options) {
  const report = baseReport('FAIL', 1)
  report.mode = 'electron'
  report.discovery = { source: 'process.execPath', path: process.execPath }
  report.profile = profileInfo()
  check(report, '真实 Electron 运行时', Boolean(process.versions.electron), `electron=${process.versions.electron || '-'}`)
  check(report, 'ELECTRON_RUN_AS_NODE=1', process.env.ELECTRON_RUN_AS_NODE === '1')
  check(report, '官方 DeepSeek Harness.exe', basename(process.execPath).toLowerCase() === ELECTRON_NAME.toLowerCase(), process.execPath)

  let command
  try {
    // 必须保留空调用：这里验证生产默认路径，不注入 mock/env/platform/fileExists。
    const { resolveDshCommand } = await import('../lib/update.js')
    command = resolveDshCommand({})
    report.resolution = {
      file: command.file,
      args: command.args,
      source: command.source,
      electronRunAsNode: command.env?.ELECTRON_RUN_AS_NODE || null,
    }
  } catch (error) {
    report.error = errorInfo(error)
    check(report, 'resolveDshCommand({})', false, report.error.message)
    return finishReport(report, 'FAIL', 1)
  }

  const entry = typeof command.args?.[1] === 'string' ? command.args[1] : null
  check(report, '解析结果 file/args/source 完整', typeof command.file === 'string' && Array.isArray(command.args) && typeof command.source === 'string')
  check(report, '解析文件就是当前官方 Electron', typeof command.file === 'string' && samePath(command.file, process.execPath) && isFile(command.file), command.file)
  check(report, 'argv 为 --expose-internals + 官方 desktop-host cli.js', Array.isArray(command.args) && command.args.length === 2
    && command.args[0] === '--expose-internals' && entry && normalizedPath(entry).endsWith('/' + normalizedSuffix(OFFICIAL_HOST_CLI_SUFFIX)), command.args)
  check(report, '来源是安装布局 CLI JS', command.source === 'DSH installation CLI JS', command.source)
  check(report, '解析环境含 ELECTRON_RUN_AS_NODE=1', command.env?.ELECTRON_RUN_AS_NODE === '1', command.env)

  if (report.checks.some((row) => !row.pass) || !entry) {
    report.error = { code: 'invalid_resolution', message: '解析结果不是预期的官方 desktop-host cli.js；为避免执行非官方入口，未启动 --help' }
    return finishReport(report, 'FAIL', 1)
  }

  try {
    const body = readFileSync(entry)
    report.entry = {
      path: entry,
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
    }
    check(report, '官方 desktop-host cli.js 可由 Electron 从 asar 读取并哈希', body.length > 0, report.entry)
  } catch (error) {
    report.error = errorInfo(error)
    check(report, '官方 desktop-host cli.js 可由 Electron 从 asar 读取并哈希', false, report.error.message)
    return finishReport(report, 'FAIL', 1)
  }

  report.help = await runOfficialHelp(command, options)
  report.help.firstLine = report.help.stdout.split(/\r?\n/, 1)[0].trim()
  check(report, '官方 desktop-host cli.js --help 退出码为 0', !report.help.timedOut && !report.help.error && report.help.exitCode === 0, {
    exitCode: report.help.exitCode,
    signal: report.help.signal,
    timedOut: report.help.timedOut,
    error: report.help.error,
  })
  check(report, 'CLI 帮助首行非空', Boolean(report.help.firstLine), report.help.firstLine || '(empty)')
  if (report.help.timedOut) report.error = { code: 'timeout', message: `官方 desktop-host cli.js --help 超过 ${options.timeoutMs}ms，已终止该子进程` }
  else if (report.help.error) report.error = report.help.error
  else if (report.help.exitCode !== 0) report.error = { code: 'help_exit_nonzero', message: `官方 desktop-host cli.js --help 实际退出码 ${report.help.exitCode}` }
  const pass = report.checks.every((row) => row.pass)
  return finishReport(report, pass ? 'PASS' : 'FAIL', pass ? 0 : 1)
}

function runLauncher(options) {
  const discovery = discoverElectron()
  if (!discovery.selected) {
    const report = baseReport('SKIP', 2)
    report.mode = 'launcher'
    report.discovery = discovery.candidates
    report.error = { code: 'electron_not_found', message: `未找到 ${ELECTRON_NAME}；未调用 resolveDshCommand({})，也未执行 --help` }
    report.usage = USAGE
    return Promise.resolve(finishReport(report, 'SKIP', 2))
  }

  const childArgs = [SCRIPT_PATH, ...process.argv.slice(2).filter((arg) => arg !== '--nested'), '--nested']
  return new Promise((resolveResult) => {
    execFile(discovery.selected.path, childArgs, {
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
      timeout: options.timeoutMs + 15_000,
      killSignal: 'SIGKILL',
      maxBuffer: 2 * 1024 * 1024,
    }, (launcherError, stdout, stderr) => {
      const actualExitCode = launcherError
        ? (typeof launcherError.code === 'number' ? launcherError.code : null)
        : 0
      let report
      try {
        const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean)
        report = JSON.parse(lines.at(-1))
        if (report.schemaVersion !== SCHEMA_VERSION || !['PASS', 'FAIL', 'SKIP'].includes(report.status)) throw new Error('探针 JSON schema 不符')
        report.launcher = {
          file: discovery.selected.path,
          source: discovery.selected.source,
          args: childArgs,
          exitCode: actualExitCode,
          stderr: capUtf8(sanitize(stderr), options.outputLimitBytes).text,
        }
        if (report.exitCode !== actualExitCode) {
          const jsonExitCode = report.exitCode
          report = finishReport(report, 'FAIL', 1)
          report.error = { code: 'launcher_exit_mismatch', message: `探针 JSON exitCode=${jsonExitCode}，Electron 实际 exitCode=${actualExitCode}` }
        }
      } catch (error) {
        report = baseReport('FAIL', 1)
        report.mode = 'launcher'
        report.discovery = discovery
        report.launcher = { file: discovery.selected.path, args: childArgs, exitCode: actualExitCode }
        report.error = launcherError && !String(stdout).trim()
          ? errorInfo(launcherError)
          : { code: 'invalid_probe_output', message: `无法解析 Electron 探针 JSON：${sanitize(error.message)}` }
        const out = capUtf8(sanitize(stdout), options.outputLimitBytes)
        const err = capUtf8(sanitize(stderr), options.outputLimitBytes)
        report.output = { stdout: out.text, stderr: err.text, stdoutTruncated: out.truncated, stderrTruncated: err.truncated }
        finishReport(report, 'FAIL', 1)
      }
      resolveResult(report)
    })
  })
}

async function main() {
  try {
    cliOptions = parseArgs(process.argv.slice(2))
  } catch (error) {
    const report = baseReport('FAIL', 1)
    report.error = errorInfo(error)
    report.usage = USAGE
    return finishReport(report, 'FAIL', 1)
  }
  if (cliOptions.help) {
    process.stderr.write(USAGE + '\n')
    return null
  }
  if (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE === '1') return runElectronProbe(cliOptions)
  return runLauncher(cliOptions)
}

main().then((report) => {
  if (!report) return
  emit(report, !cliOptions.json && !cliOptions.nested)
  process.exitCode = report.exitCode
}).catch((error) => {
  const report = baseReport('FAIL', 1)
  report.error = errorInfo(error)
  finishReport(report, 'FAIL', 1)
  emit(report, !cliOptions.json && !cliOptions.nested)
  process.exitCode = 1
})
