import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import test from 'node:test'

import {
  UPDATE_OUTPUT_LIMIT_BYTES,
  createSpawnRunner,
  isStrictSemver,
  pluginAddArguments,
  resolveDshCommand,
} from '../lib/update.js'
import { assertTempStateDir, tempDir } from './fixtures/tmpdir.mjs'

const STATE_DIR = tempDir('zhuli-update-route-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
process.env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
assertTempStateDir('update-route.test.mjs')

const ENV_BASELINE = { ...process.env }
const originalFetch = globalThis.fetch
let instance = 0

test.afterEach(() => {
  for (const key of Object.keys(process.env)) { if (!(key in ENV_BASELINE)) delete process.env[key] }
  Object.assign(process.env, ENV_BASELINE)
  globalThis.fetch = originalFetch
})

function makeReq(method, url, body, headers = {}) {
  const handlers = {}
  const req = {
    method,
    url,
    headers,
    on(event, callback) {
      ;(handlers[event] ||= []).push(callback)
      return req
    },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined) for (const callback of handlers.data || []) callback(Buffer.from(body))
    for (const callback of handlers.end || []) callback()
  })
  return req
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
    get body() { return this.chunks.join('') },
    json() { return JSON.parse(this.body) },
  }
}

async function setup({ runner, timeoutMs = 1000, installedVersion } = {}) {
  const routes = new Map()
  const tools = []
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: (route) => { routes.set(route.path, route); return () => {} } },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-update-test' }) },
    get: () => null,
    on() {},
    effect: (fn) => fn(),
  }
  const mod = await import('../lib/index.js?update-route=' + (++instance))
  const calls = []
  const updateRunner = runner || (async (request) => { calls.push(request); return { code: 0, stdout: '', stderr: '' } })
  mod.apply(ctx, {
    updateRunner,
    updateTimeoutMs: timeoutMs,
    readInstalledVersion: () => installedVersion === undefined ? mod.SERVER_VERSION : installedVersion,
  })
  const route = routes.get('/session-superagent/update')
  assert.ok(route, '必须注册 /session-superagent/update')
  return {
    calls,
    runningVersion: mod.SERVER_VERSION,
    async call(method, body, headers = {}) {
      const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      const res = makeRes()
      await route.handler(makeReq(method, '/session-superagent/update', raw, headers), res)
      return res
    },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('GET 保持只读；其它方法 405，均不启动 runner', async () => {
  let runs = 0
  const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
  const get = await route.call('GET')
  assert.equal(get.statusCode, 200)
  assert.equal(get.json().current, route.runningVersion)
  assert.equal(get.json().hasUpdate, false)
  const put = await route.call('PUT', { version: '0.9.271' })
  assert.equal(put.statusCode, 405)
  assert.equal(runs, 0)
})

test('POST 走 guardWrite：跨源请求 403 且不读版本、不启动 runner', async () => {
  let runs = 0
  const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
  const res = await route.call('POST', { version: '0.9.271' }, { origin: 'https://evil.example' })
  assert.equal(res.statusCode, 403)
  assert.match(res.json().error, /cross-origin/)
  assert.equal(runs, 0)
})

test('非法 semver、额外字段、畸形 JSON 全部 400，命令注入不会到达 runner', async () => {
  let runs = 0
  const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
  const invalid = [
    { version: 'latest' },
    { version: 'v0.9.271' },
    { version: '0.9' },
    { version: '01.9.271' },
    { version: '0.9.271-01' },
    { version: '0.9.271; shutdown' },
    { version: '0.9.271 --profile other' },
    { version: '0.9.271', command: 'arbitrary' },
    ['0.9.271'],
  ]
  for (const body of invalid) {
    const res = await route.call('POST', body)
    assert.equal(res.statusCode, 400, JSON.stringify(body))
  }
  const malformed = await route.call('POST', '{"version":')
  assert.equal(malformed.statusCode, 400)
  assert.equal(runs, 0)
})

test('找不到 CLI 返回可读 503，不伪装安装成功', async () => {
  const route = await setup({
    runner: async () => {
      const error = new Error('找不到可执行的 DSH CLI：已按 DSH_CLI_PATH → PATH → DSH 安装布局顺序查找')
      error.code = 'CLI_NOT_FOUND'
      throw error
    },
  })
  const res = await route.call('POST', { version: '0.9.271' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().ok, false)
  assert.equal(res.json().code, 'cli_not_found')
  assert.match(res.json().error, /DSH_CLI_PATH/)
  assert.equal(res.json().installedVersion, route.runningVersion)
  assert.equal(res.json().runningVersion, route.runningVersion)
  assert.equal(res.json().needsReload, false)
})

test('成功：显式版本、运行环境 profile、退出码与三种版本状态均准确', async () => {
  const requests = []
  const route = await setup({
    installedVersion: '9.9.9',
    runner: async (request) => {
      requests.push(request)
      return { code: 0, stdout: 'added dsh-session-superagent@9.9.9', stderr: '' }
    },
  })
  process.env.DSH_PROFILE = 'profile-from-env'
  const res = await route.call('POST', { version: '9.9.9' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(requests, [{ version: '9.9.9', profile: 'profile-from-env', timeoutMs: 1000 }])
  assert.equal(res.json().ok, true)
  assert.equal(res.json().code, 0)
  assert.equal(res.json().exitCode, 0)
  assert.equal(res.json().installedVersion, '9.9.9')
  assert.equal(res.json().runningVersion, route.runningVersion, '运行中代码仍必须报告加载时的版本')
  assert.equal(res.json().needsReload, true)
  assert.ok(res.json().message.includes('运行中代码仍为 ' + route.runningVersion))
})

test('成功：省略 version 时使用 checkUpdate 的 latest，不使用 @latest 标签', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  let registryCalls = 0
  globalThis.fetch = async (url) => {
    registryCalls += 1
    assert.equal(String(url), 'https://registry.npmjs.org/dsh-session-superagent/latest')
    return { ok: true, json: async () => ({ version: '0.9.272', dist: {} }) }
  }
  const requests = []
  const route = await setup({
    installedVersion: '0.9.272',
    runner: async (request) => { requests.push(request); return { code: 0, stdout: '', stderr: '' } },
  })
  process.env.DSH_PROFILE = 'registry-profile'
  const res = await route.call('POST', {})
  assert.equal(res.statusCode, 200)
  assert.equal(registryCalls, 1)
  assert.equal(requests[0].version, '0.9.272')
  assert.equal(requests[0].profile, 'registry-profile')
  assert.equal(res.json().version, '0.9.272')
})

test('latest 缺失时 503，不执行带 @latest 的更新', async () => {
  let runs = 0
  const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
  const res = await route.call('POST', {})
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().code, 'latest_unavailable')
  assert.equal(runs, 0)
})

test('非零退出码返回 500 与真实 exitCode，不声称已安装或已加载', async () => {
  const route = await setup({ runner: async () => ({ code: 17, stdout: 'partial', stderr: 'registry denied' }) })
  const res = await route.call('POST', { version: '0.9.271' })
  assert.equal(res.statusCode, 500)
  assert.equal(res.json().ok, false)
  assert.equal(res.json().code, 17)
  assert.equal(res.json().exitCode, 17)
  assert.equal(res.json().stderr, 'registry denied')
  assert.equal(res.json().installedVersion, route.runningVersion)
  assert.equal(res.json().runningVersion, route.runningVersion)
  assert.equal(res.json().needsReload, false)
})

test('超时返回 504；迟到完成会被接收并释放并发闸', async () => {
  const late = deferred()
  const started = deferred()
  const route = await setup({
    timeoutMs: 20,
    runner: async () => { started.resolve(); return late.promise },
  })
  const res = await route.call('POST', { version: '0.9.271' })
  await started.promise
  assert.equal(res.statusCode, 504)
  assert.equal(res.json().ok, false)
  assert.equal(res.json().code, 'timeout')
  assert.match(res.json().error, /未确认安装成功/)
  late.resolve({ code: 0, stdout: 'late', stderr: '' })
  await new Promise((resolve) => setImmediate(resolve))

  // 锁已随迟到结算释放；换一个快速 mock 验证后续请求可正常执行。
  const next = await setup({ runner: async () => ({ code: 0, stdout: '', stderr: '' }) })
  const retry = await next.call('POST', { version: '0.9.271' })
  assert.equal(retry.statusCode, 200)
})

test('runner 自己拒绝 timeout 也会释放锁，不伪装成仍在执行的外层计时器', async () => {
  const route = await setup({
    runner: async () => {
      const error = new Error('runner timeout')
      error.code = 'timeout'
      throw error
    },
  })
  const failed = await route.call('POST', { version: '0.9.271' })
  assert.equal(failed.statusCode, 504)
  const next = await setup({ runner: async () => ({ code: 0, stdout: '', stderr: '' }) })
  const retry = await next.call('POST', { version: '0.9.271' })
  assert.equal(retry.statusCode, 200)
})

test('并发第二个 POST 返回 409，只启动一个 runner', async () => {
  const pending = deferred()
  const started = deferred()
  let runs = 0
  const route = await setup({
    runner: async () => {
      runs += 1
      started.resolve()
      return pending.promise
    },
  })
  const firstPromise = route.call('POST', { version: '0.9.271' })
  await started.promise
  const second = await route.call('POST', { version: '0.9.272' })
  assert.equal(second.statusCode, 409)
  assert.equal(second.json().code, 'update_in_flight')
  assert.equal(runs, 1)
  pending.resolve({ code: 0, stdout: '', stderr: '' })
  const first = await firstPromise
  assert.equal(first.statusCode, 200)
  assert.equal(runs, 1)
})

test('runner 的 stdout/stderr 都有字节上限与截断标记', async () => {
  const route = await setup({
    runner: async () => ({
      code: 0,
      stdout: 'x'.repeat(UPDATE_OUTPUT_LIMIT_BYTES + 5000),
      stderr: 'y'.repeat(UPDATE_OUTPUT_LIMIT_BYTES + 5000),
    }),
  })
  const res = await route.call('POST', { version: '0.9.271' })
  assert.equal(res.statusCode, 200)
  assert.equal(Buffer.byteLength(res.json().stdout), UPDATE_OUTPUT_LIMIT_BYTES)
  assert.equal(Buffer.byteLength(res.json().stderr), UPDATE_OUTPUT_LIMIT_BYTES)
  assert.equal(res.json().stdoutTruncated, true)
  assert.equal(res.json().stderrTruncated, true)
})

test('profile 不写死 desktop：环境缺失时 503 且 runner 不执行', async () => {
  delete process.env.DSH_PROFILE
  delete process.env.DSH_PROFILE_NAME
  delete process.env.DSH_ACTIVE_PROFILE
  let runs = 0
  const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
  const res = await route.call('POST', { version: '0.9.271' })
  assert.equal(res.statusCode, 503)
  assert.equal(res.json().code, 'profile_unavailable')
  assert.equal(runs, 0)
})

test('严格 semver 接受正式版、预发布与 build 元数据', () => {
  for (const version of ['0.9.270', '1.2.3-rc.1', '1.2.3+build.5', '1.2.3-rc.1+build.5']) {
    assert.equal(isStrictSemver(version), true, version)
  }
  assert.deepEqual(pluginAddArguments('work-profile', '1.2.3-rc.1+build.5'), [
    'plugin', '--profile', 'work-profile', 'add', 'dsh-session-superagent@1.2.3-rc.1+build.5',
  ])
})

test('CLI 解析顺序：DSH_CLI_PATH → PATH → DSH 安装布局；找不到时报 cli_not_found', () => {
  const paths = {
    explicit: '/explicit/dsh',
    path: join('/path-bin', 'dsh'),
    layout: join('/dsh-resources', 'runtime', 'cli', 'bin', 'dsh'),
  }
  const allExist = (path) => Object.values(paths).includes(path)
  const explicit = resolveDshCommand({
    env: { DSH_CLI_PATH: paths.explicit, PATH: '/path-bin' },
    platform: 'linux', execPath: '/usr/bin/node', resourcesPath: '/dsh-resources', fileExists: allExist,
  })
  assert.equal(explicit.file, paths.explicit)
  assert.equal(explicit.source, 'DSH_CLI_PATH')

  const fromPath = resolveDshCommand({
    env: { PATH: '/path-bin' },
    platform: 'linux', execPath: '/usr/bin/node', resourcesPath: '/dsh-resources',
    fileExists: (path) => path === paths.path || path === paths.layout,
  })
  assert.equal(fromPath.file, paths.path)
  assert.equal(fromPath.source, 'PATH')

  const fromLayout = resolveDshCommand({
    env: { PATH: '/path-bin' },
    platform: 'linux', execPath: '/usr/bin/node', resourcesPath: '/dsh-resources',
    fileExists: (path) => path === paths.layout,
  })
  assert.equal(fromLayout.file, paths.layout)
  assert.equal(fromLayout.source, 'DSH installation')

  assert.throws(() => resolveDshCommand({
    env: { PATH: '/path-bin' }, platform: 'linux', execPath: '/usr/bin/node', resourcesPath: '/dsh-resources', fileExists: () => false,
  }), (error) => error.code === 'cli_not_found' && /DSH_CLI_PATH/.test(error.message))
})

test('标准 Windows dsh.cmd 布局转换为独立 Electron CLI，不经 shell', () => {
  const root = process.platform === 'win32' ? 'C:\\DSH\\Desktop' : '/dsh/Desktop'
  const resources = join(root, 'resources')
  const cmd = join(resources, 'runtime', 'cli', 'bin', 'dsh.cmd')
  const executable = join(root, 'DeepSeek Harness.exe')
  const asar = join(resources, 'app.asar')
  const command = resolveDshCommand({
    env: { DSH_CLI_PATH: cmd, PATH: '' },
    platform: 'win32', execPath: executable, resourcesPath: resources,
    fileExists: (path) => [cmd, executable, asar].includes(path),
  })
  assert.equal(command.file, executable)
  assert.equal(command.args[0], '--expose-internals')
  assert.equal(command.args[1], join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'))
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, '1')
})

test('DSH_CLI_PATH 指向 cli.js 时用当前 runtime 加 argv，不经 shell', () => {
  const command = resolveDshCommand({
    env: { DSH_CLI_PATH: '/dsh/cli.js', PATH: '' },
    platform: 'linux', execPath: '/runtime/node', resourcesPath: null,
    fileExists: (path) => path === '/dsh/cli.js',
  })
  assert.equal(command.file, '/runtime/node')
  assert.deepEqual(command.args, ['/dsh/cli.js'])
})

test('生产 spawn runner 使用固定 argv、shell:false，并截断两路输出', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  let invocation
  const runner = createSpawnRunner({
    resolveCommand: () => ({ file: '/dsh', args: [], env: {} }),
    env: { DSH_PROFILE: 'spawn-profile' },
    spawn: (file, args, options) => { invocation = { file, args, options }; return child },
  })
  const pending = runner({ version: '0.9.271', profile: 'spawn-profile', timeoutMs: 1000 })
  assert.equal(invocation.file, '/dsh')
  assert.deepEqual(invocation.args, ['plugin', '--profile', 'spawn-profile', 'add', 'dsh-session-superagent@0.9.271'])
  assert.equal(invocation.options.shell, false)
  child.stdout.emit('data', Buffer.from('a'.repeat(UPDATE_OUTPUT_LIMIT_BYTES + 100)))
  child.stderr.emit('data', Buffer.from('b'.repeat(UPDATE_OUTPUT_LIMIT_BYTES + 100)))
  child.emit('close', 0)
  const result = await pending
  assert.equal(result.code, 0)
  assert.equal(Buffer.byteLength(result.stdout), UPDATE_OUTPUT_LIMIT_BYTES)
  assert.equal(Buffer.byteLength(result.stderr), UPDATE_OUTPUT_LIMIT_BYTES)
  assert.equal(result.stdoutTruncated, true)
  assert.equal(result.stderrTruncated, true)
})

test('生产 spawn runner 超时只终止自己的 CLI 子进程并返回 timeout', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let killed = false
  child.kill = () => { killed = true; return true }
  const runner = createSpawnRunner({
    resolveCommand: () => ({ file: '/dsh', args: [], env: {} }),
    env: {},
    spawn: () => child,
  })
  const result = await runner({ version: '0.9.271', profile: 'spawn-profile', timeoutMs: 20 })
  assert.equal(result.code, 'timeout')
  assert.equal(killed, true)
  assert.match(result.error, /未确认安装成功/)
})
