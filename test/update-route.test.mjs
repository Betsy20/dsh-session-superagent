import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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

async function setup({ runner, timeoutMs = 1000, installedVersion, installedVersionReader, profile = 'test-profile' } = {}) {
  for (const key of ['DSH_PROFILE', 'DSH_PROFILE_NAME', 'DSH_ACTIVE_PROFILE']) delete process.env[key]
  if (profile) process.env.DSH_PROFILE = profile
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
    readInstalledVersion: installedVersionReader || (() => installedVersion === undefined ? mod.SERVER_VERSION : installedVersion),
  })
  const route = routes.get('/session-superagent/update')
  assert.ok(route, '必须注册 /session-superagent/update')
  return {
    calls,
    runningVersion: mod.SERVER_VERSION,
    async call(method, body, headers = {}, query = '') {
      const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      const res = makeRes()
      await route.handler(makeReq(method, '/session-superagent/update' + query, raw, headers), res)
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
  assert.equal(get.json().runningVersion, route.runningVersion)
  assert.equal(get.json().installedVersion, route.runningVersion)
  assert.equal(get.json().hasUpdate, false)
  const put = await route.call('PUT', { version: '0.9.271' })
  assert.equal(put.statusCode, 405)
  assert.equal(put.headers.Allow, 'GET, POST')
  assert.deepEqual(put.json(), { error: 'method not allowed' })
  assert.equal(runs, 0)
})

test('GET 以 installedVersion 为磁盘基线，SemVer 反例与 running 漂移均准确', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  const cases = [
    ['rc latest 不覆盖 release', '0.9.273-rc.1', '0.9.273', false],
    ['build 不制造更新', '0.9.273+build.5', '0.9.273', false],
    ['反向 build 仍同 precedence', '0.9.273', '0.9.273+build.5', false],
    ['旧 prerelease 不更新', '0.9.272-rc.1', '0.9.273', false],
    ['minor=1000 不越过 major', '0.1000.0', '1.0.0', false],
    ['major 更新不受固定进制影响', '1.0.0', '0.1000.0', true],
    ['latest 等于 running 但磁盘较旧仍提示', '0.9.273', '0.9.272-rc.1', true],
    ['latest 高于 installed 即磁盘升级，即使仍低于 running', '0.9.272', '0.9.270', true],
    ['大整数不丢失精度', '9007199254740993.0.0', '9007199254740992.0.0', true],
  ]
  for (const [name, latest, installedVersion, expected] of cases) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: latest, dist: {} }) })
    const route = await setup({ installedVersion })
    const res = await route.call('GET')
    assert.equal(res.statusCode, 200, name)
    assert.equal(res.json().hasUpdate, expected, name)
    assert.equal(res.json().installedVersion, installedVersion, name)
    assert.equal(res.json().runningVersion, route.runningVersion, name)
    assert.equal(res.json().current, route.runningVersion, name)
  }
})

test('registry latest 非字符串或非法 SemVer 时 GET 明确报错，POST 不执行', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  for (const latest of [['0.9.274'], '01.0.0']) {
    let runs = 0
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: latest, dist: {} }) })
    const route = await setup({ runner: async () => { runs += 1; return { code: 0 } } })
    const get = await route.call('GET')
    assert.equal(get.statusCode, 200)
    assert.equal(get.json().hasUpdate, false)
    assert.match(get.json().error, /严格 semver/)
    assert.equal(get.json().command, '')
    const post = await route.call('POST', {})
    assert.equal(post.statusCode, 503)
    assert.equal(post.json().code, 'latest_unavailable')
    assert.equal(runs, 0)
  }
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

test('POST 成功失效缓存：即使强制额度已消费，紧接着 GET 也重读 installed 与 latest', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  let installed = '0.9.273'
  let latest = '0.9.274'
  let registryCalls = 0
  globalThis.fetch = async () => {
    registryCalls += 1
    return { ok: true, json: async () => ({ version: latest, dist: {} }) }
  }
  const route = await setup({
    installedVersionReader: () => installed,
    runner: async (request) => {
      installed = request.version
      latest = request.version
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  const before = await route.call('GET', undefined, {}, '?refresh=1')
  assert.equal(before.json().installedVersion, '0.9.273')
  assert.equal(before.json().hasUpdate, true)
  assert.equal(registryCalls, 1)

  const post = await route.call('POST', { version: '0.9.274' })
  assert.equal(post.statusCode, 200)
  const after = await route.call('GET', undefined, {}, '?refresh=1')
  assert.equal(registryCalls, 2, '60 秒 force 节流不得让安装前缓存复活')
  assert.equal(after.json().installedVersion, '0.9.274')
  assert.equal(after.json().runningVersion, route.runningVersion)
  assert.equal(after.json().latest, '0.9.274')
  assert.equal(after.json().hasUpdate, false)
})

test('POST 前在飞的旧 GET 晚到也不能把安装前快照写回缓存', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  let installed = '0.9.273'
  let registryCalls = 0
  let releaseRegistry
  globalThis.fetch = async () => {
    registryCalls += 1
    if (registryCalls === 1) {
      return new Promise((resolve) => {
        releaseRegistry = () => resolve({ ok: true, json: async () => ({ version: '0.9.274', dist: {} }) })
      })
    }
    return { ok: true, json: async () => ({ version: '0.9.275', dist: {} }) }
  }
  const route = await setup({
    installedVersionReader: () => installed,
    runner: async () => {
      installed = '0.9.275'
      return { code: 0, stdout: '', stderr: '' }
    },
  })
  const stalePending = route.call('GET', undefined, {}, '?refresh=1')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registryCalls, 1)
  const post = await route.call('POST', { version: '0.9.275' })
  assert.equal(post.statusCode, 200)
  releaseRegistry()
  const stale = await stalePending
  assert.equal(stale.json().installedVersion, '0.9.273', '旧请求自己的返回值仍是旧快照')

  const fresh = await route.call('GET')
  assert.equal(registryCalls, 2, '晚到旧响应不得填充缓存，下一 GET 必须真查')
  assert.equal(fresh.json().installedVersion, '0.9.275')
  assert.equal(fresh.json().latest, '0.9.275')
  assert.equal(fresh.json().hasUpdate, false)
})

test('无 version POST 拒绝相对 installed 的静默降级，显式 version 仍是用户明确选择', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.9.272', dist: {} }) })
  let runs = 0
  const route = await setup({
    installedVersion: '0.9.273',
    runner: async () => { runs += 1; return { code: 0, stdout: '', stderr: '' } },
  })
  const implicit = await route.call('POST', {})
  assert.equal(implicit.statusCode, 409)
  assert.equal(implicit.json().code, 'downgrade_requires_explicit_version')
  assert.equal(implicit.json().installedVersion, '0.9.273')
  assert.equal(runs, 0)

  const explicit = await route.call('POST', { version: '0.9.272' })
  assert.equal(explicit.statusCode, 200)
  assert.equal(explicit.json().version, '0.9.272')
  assert.equal(runs, 1)
})

test('installed 不可用时无 version POST 以 running 防降级，installed 较新时不被 running 掩盖', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  for (const installedVersion of [null, 'not-semver', '0.1000.0']) {
    let runs = 0
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: '0.9.272', dist: {} }) })
    const route = await setup({
      installedVersion,
      runner: async () => { runs += 1; return { code: 0 } },
    })
    const res = await route.call('POST', {})
    assert.equal(res.statusCode, 409, String(installedVersion))
    assert.equal(res.json().code, 'downgrade_requires_explicit_version')
    assert.equal(runs, 0)
  }
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

test('非零退出同样失效缓存，后续 GET 读取部分改盘后的 installed 与 latest', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  let installed = '0.9.273'
  let latest = '0.9.274'
  let registryCalls = 0
  globalThis.fetch = async () => {
    registryCalls += 1
    return { ok: true, json: async () => ({ version: latest, dist: {} }) }
  }
  const route = await setup({
    installedVersionReader: () => installed,
    runner: async () => {
      installed = '0.9.271'
      latest = '0.9.275'
      return { code: 17, stdout: 'partial write', stderr: 'registry denied' }
    },
  })
  const before = await route.call('GET', undefined, {}, '?refresh=1')
  assert.equal(before.json().installedVersion, '0.9.273')
  assert.equal(before.json().latest, '0.9.274')
  assert.equal(registryCalls, 1)

  const failed = await route.call('POST', { version: '0.9.274' })
  assert.equal(failed.statusCode, 500)
  assert.equal(failed.json().exitCode, 17)
  const after = await route.call('GET', undefined, {}, '?refresh=1')
  assert.equal(registryCalls, 2, '非零 settle 必须绕过 force 节流并重新查询')
  assert.equal(after.json().installedVersion, '0.9.271')
  assert.equal(after.json().latest, '0.9.275')
  assert.equal(after.json().hasUpdate, true)
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

test('外层 504 不提前清缓存；迟到 settle 才失效并阻止旧 GET 晚写', async () => {
  delete process.env.DSH_SUPERAGENT_UPDATE_OFFLINE
  let installed = '0.9.273'
  let latest = '0.9.274'
  let registryCalls = 0
  let pauseRegistry = false
  let releaseStale
  globalThis.fetch = async () => {
    registryCalls += 1
    if (pauseRegistry) {
      pauseRegistry = false
      return new Promise((resolve) => {
        releaseStale = () => resolve({ ok: true, json: async () => ({ version: '0.9.274', dist: {} }) })
      })
    }
    return { ok: true, json: async () => ({ version: latest, dist: {} }) }
  }
  const late = deferred()
  const started = deferred()
  const route = await setup({
    timeoutMs: 20,
    installedVersionReader: () => installed,
    runner: async () => { started.resolve(); return late.promise },
  })
  const before = await route.call('GET')
  assert.equal(before.json().installedVersion, '0.9.273')
  assert.equal(registryCalls, 1)

  const timedOut = await route.call('POST', { version: '0.9.274' })
  await started.promise
  assert.equal(timedOut.statusCode, 504)
  const whilePending = await route.call('GET')
  assert.equal(registryCalls, 1, 'runner 仍 pending 时旧缓存必须继续可用，不能提前失效')
  assert.equal(whilePending.json().installedVersion, '0.9.273')

  pauseRegistry = true
  const stalePending = route.call('GET', undefined, {}, '?refresh=1')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registryCalls, 2)
  assert.equal(typeof releaseStale, 'function')

  installed = '0.9.272'
  latest = '0.9.275'
  late.resolve({ code: 'spawn_error', error: 'late partial failure', stdout: '', stderr: '' })
  await new Promise((resolve) => setImmediate(resolve))
  releaseStale()
  const stale = await stalePending
  assert.equal(stale.json().installedVersion, '0.9.273', '旧 GET 自己的响应仍保留其快照')
  assert.equal(stale.json().latest, '0.9.274')

  const fresh = await route.call('GET')
  assert.equal(registryCalls, 3, '迟到 settle 已递增 generation，旧 GET 不得重新填充缓存')
  assert.equal(fresh.json().installedVersion, '0.9.272')
  assert.equal(fresh.json().latest, '0.9.275')
  assert.equal(fresh.json().hasUpdate, true)
})

test('spawn 超时后未 close 时 runner 保持 pending，外层 504 后第二个 POST 始终 409', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let spawns = 0
  let kills = 0
  const killObserved = deferred()
  child.kill = () => { kills += 1; killObserved.resolve(); return true }
  const runner = createSpawnRunner({
    resolveCommand: () => ({ file: '/dsh', args: [], env: {} }),
    env: {},
    spawn: () => { spawns += 1; return child },
  })
  const route = await setup({ runner, timeoutMs: 20 })
  const first = await route.call('POST', { version: '0.9.271' })
  assert.equal(first.statusCode, 504)
  assert.equal(first.json().code, 'timeout')
  await killObserved.promise
  assert.equal(kills, 1)
  assert.equal(spawns, 1)

  // 假 child 在 kill 后始终不 close：外层已经超时，也不能放行第二次安装。
  for (const version of ['0.9.272', '0.9.273']) {
    const retry = await route.call('POST', { version })
    assert.equal(retry.statusCode, 409)
    assert.equal(retry.json().code, 'update_in_flight')
    assert.equal(spawns, 1)
  }

  // 测试收尾才让迟到 close 到达；runner 以 timeout 结算后，锁才可释放。
  child.emit('close', null, 'SIGKILL')
  await new Promise((resolve) => setImmediate(resolve))
  const next = await setup({ runner: async () => ({ code: 0, stdout: '', stderr: '' }) })
  const afterClose = await next.call('POST', { version: '0.9.271' })
  assert.equal(afterClose.statusCode, 200)
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

test('16KiB 边界前先脱敏再按 UTF-8 截断，不泄露完整或部分动态 token', async () => {
  const token = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
  const prefix = 'x'.repeat(UPDATE_OUTPUT_LIMIT_BYTES - 10)
  const raw = prefix + token + '🙂'.repeat(UPDATE_OUTPUT_LIMIT_BYTES)
  const tokenStart = Buffer.byteLength(prefix)
  assert.ok(tokenStart < UPDATE_OUTPUT_LIMIT_BYTES)
  assert.ok(tokenStart + Buffer.byteLength(token) > UPDATE_OUTPUT_LIMIT_BYTES, '假 token 必须横跨截断边界')

  const route = await setup({ runner: async () => ({ code: 0, stdout: raw, stderr: '' }) })
  const res = await route.call('POST', { version: '0.9.271' })
  assert.equal(res.statusCode, 200)
  const output = res.json().stdout
  for (let length = 4; length <= token.length; length += 1) {
    assert.equal(output.includes(token.slice(0, length)), false, '不得保留完整或部分秘密前缀')
  }
  assert.ok(Buffer.byteLength(output) <= UPDATE_OUTPUT_LIMIT_BYTES)
  assert.equal(output.includes('\uFFFD'), false)
  assert.equal(Buffer.from(output, 'utf8').toString('utf8'), output, 'UTF-8 截断不能留下半个字符')
  assert.equal(output.endsWith('🙂'), true)
  assert.equal(res.json().stdoutTruncated, true)
})

test('normalizeFailure 与路由出口分别脱敏动态假 token，不留完整或部分秘密', async () => {
  const cases = [
    ['normalizeFailure：runner reject', async (token) => {
      const error = new Error('spawn failed while echoing ' + token)
      error.code = 'spawn_error'
      throw error
    }],
    ['路由出口：runner resolve error', async (token) => ({
      code: 'spawn_error', error: 'spawn failed while echoing ' + token, stdout: '', stderr: '',
    })],
  ]
  for (const [name, behavior] of cases) {
    const token = 'gh' + 'p_' + randomUUID().replaceAll('-', '')
    const route = await setup({ runner: async () => behavior(token) })
    const res = await route.call('POST', { version: '0.9.271' })
    assert.equal(res.statusCode, 500, name)
    assert.equal(res.json().code, 'spawn_error', name)
    const message = res.json().error
    assert.match(message, /\*\*\*/, name)
    for (let length = 4; length <= token.length; length += 1) {
      assert.equal(message.includes(token.slice(0, length)), false, name + '：不得泄露秘密前缀')
      assert.equal(message.includes(token.slice(-length)), false, name + '：不得泄露秘密后缀')
    }
  }
})

test('profile 不写死 desktop：环境缺失时 503 且 runner 不执行', async () => {
  delete process.env.DSH_PROFILE
  delete process.env.DSH_PROFILE_NAME
  delete process.env.DSH_ACTIVE_PROFILE
  let runs = 0
  const route = await setup({ profile: null, runner: async () => { runs += 1; return { code: 0 } } })
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

test('DSH_PROFILE_DIR 安装布局从 asar bin 候选转到 desktop-host CLI', () => {
  const root = process.platform === 'win32' ? 'C:\\DSH' : '/dsh'
  const executable = join(root, 'Desktop', 'DeepSeek Harness.exe')
  const binCandidate = join(root, 'Desktop', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const hostCli = join(root, 'Desktop', 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  const command = resolveDshCommand({
    env: { DSH_PROFILE_DIR: join(root, 'home', 'profiles', 'desktop'), PATH: '' },
    platform: 'win32', execPath: executable, resourcesPath: null,
    fileExists: (path) => [binCandidate, hostCli, executable].includes(path),
  })
  assert.equal(command.file, executable)
  assert.deepEqual(command.args, ['--expose-internals', hostCli])
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(command.source, 'DSH installation CLI JS')
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
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, '1')
})

test('显式 desktop-host cli.js 在 Windows 保留宿主入口并加 expose-internals', () => {
  const root = process.platform === 'win32' ? 'C:\\DSH\\Desktop' : '/dsh/Desktop'
  const executable = join(root, 'DeepSeek Harness.exe')
  const hostCli = join(root, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
  const command = resolveDshCommand({
    env: { DSH_CLI_PATH: hostCli, PATH: '' },
    platform: 'win32', execPath: executable, resourcesPath: null,
    fileExists: (path) => [hostCli, executable].includes(path),
  })
  assert.equal(command.file, executable)
  assert.deepEqual(command.args, ['--expose-internals', hostCli])
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, '1')
})

test('生产 spawn runner 使用固定 argv、shell:false，并截断两路输出', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  let invocation
  const runner = createSpawnRunner({
    resolveCommand: () => ({ file: '/dsh', args: [], env: { ELECTRON_RUN_AS_NODE: '1' } }),
    env: {
      DSH_PROFILE: 'spawn-profile',
      DSH_PROFILE_DIR: '/dsh-profile',
      PATH: '/dsh-bin',
      ELECTRON_RUN_AS_NODE: '0',
    },
    spawn: (file, args, options) => { invocation = { file, args, options }; return child },
  })
  const pending = runner({ version: '0.9.271', profile: 'spawn-profile', timeoutMs: 1000 })
  assert.equal(invocation.file, '/dsh')
  assert.deepEqual(invocation.args, ['plugin', '--profile', 'spawn-profile', 'add', 'dsh-session-superagent@0.9.271'])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.env.DSH_PROFILE, 'spawn-profile')
  assert.equal(invocation.options.env.DSH_PROFILE_DIR, '/dsh-profile')
  assert.equal(invocation.options.env.PATH, '/dsh-bin')
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1', '命令必需项可覆盖错误的继承值')
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

test('生产 outputCollector 也在跨边界截断前脱敏，不留秘密前缀', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  const runner = createSpawnRunner({
    resolveCommand: () => ({ file: '/dsh', args: [], env: {} }),
    env: { DSH_PROFILE: 'spawn-profile' },
    spawn: () => child,
  })
  const pending = runner({ version: '0.9.271', profile: 'spawn-profile', timeoutMs: 1000 })
  const token = 'ghp_' + 'A'.repeat(30)
  child.stdout.emit('data', Buffer.from('x'.repeat(UPDATE_OUTPUT_LIMIT_BYTES - 10) + token))
  child.emit('close', 0)
  const result = await pending
  assert.equal(result.code, 0)
  for (let length = 4; length <= token.length; length += 1) {
    assert.equal(result.stdout.includes(token.slice(0, length)), false, '生产 collector 不得泄露部分 token')
  }
  assert.ok(Buffer.byteLength(result.stdout) <= UPDATE_OUTPUT_LIMIT_BYTES)
})

test('生产 spawn runner 超时 kill 后等 close，仍返回 timeout', async () => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let killed = false
  child.kill = () => {
    killed = true
    queueMicrotask(() => child.emit('close', null, 'SIGKILL'))
    return true
  }
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
