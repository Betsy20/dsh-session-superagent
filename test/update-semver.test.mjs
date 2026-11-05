import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import { compareSemver, isStrictSemver } from '../lib/semver.js'

const SERVER_SOURCE = readFileSync(new URL('../lib/semver.js', import.meta.url), 'utf8')
const CLIENT_SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function comparatorBlock(source) {
  const match = /\/\/ SEMVER_COMPARATOR_SOURCE_START([\s\S]*?)\/\/ SEMVER_COMPARATOR_SOURCE_END/.exec(source)
  assert.ok(match, '必须保留唯一同源 comparator 标记块')
  const lines = match[1].split('\n')
  const indents = lines.filter((line) => line.trim()).map((line) => /^\s*/.exec(line)[0].length)
  const indent = Math.min(...indents)
  return lines.map((line) => line.slice(indent)).join('\n').trim()
}

function sign(left, right) {
  return compareSemver(left, right)
}

test('SemVer 官方 precedence 链与数字/非数字 prerelease 规则完整成立', () => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ]
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(sign(ordered[index - 1], ordered[index]), -1, ordered[index - 1] + ' < ' + ordered[index])
    assert.equal(sign(ordered[index], ordered[index - 1]), 1, ordered[index] + ' > ' + ordered[index - 1])
  }
  assert.equal(sign('1.0.0-alpha.999999999999999999999999', '1.0.0-alpha.1000000000000000000000000'), -1)
  assert.equal(sign('1.0.0-1', '1.0.0-alpha'), -1, '数字标识符必须低于非数字标识符')
  assert.equal(sign('1.0.0-alpha', '1.0.0-alpha.0'), -1, '前缀相同时标识符更多者更高')
})

test('major/minor/patch 以十进制字符串比较，不受安全整数或固定进制限制', () => {
  assert.equal(sign('999999999999999999999999999999.0.0', '2.0.0'), 1)
  assert.equal(sign('1.100000000000000000000000000000.0', '1.99999999999999999999999999999.0'), 1)
  assert.equal(sign('1.0.9007199254740993', '1.0.9007199254740992'), 1)
  // SemVer 先比较 major：minor=1000 不能进位成 major=1，也不能与 1.0.0 碰撞。
  assert.equal(sign('0.1000.0', '1.0.0'), -1)
  assert.equal(sign('1.0.0', '0.1000.0'), 1)
  assert.equal(sign('0.1001.0', '0.1000.999999999999999999'), 1)
})

test('build metadata 完全忽略；release 高于 prerelease，旧 prerelease 不触发更新方向', () => {
  assert.equal(sign('0.9.273+build.5', '0.9.273'), 0)
  assert.equal(sign('0.9.273+build.5', '0.9.273+build.99'), 0)
  assert.equal(sign('0.9.273-rc.1+build.5', '0.9.273-rc.1+other'), 0)
  assert.equal(sign('0.9.273-rc.1', '0.9.273'), -1)
  assert.equal(sign('0.9.273-rc.1', '0.9.273+build.5'), -1)
  assert.equal(sign('0.9.272-rc.1', '0.9.273'), -1)
  // GET 的方向固定是 compareSemver(latest, installed)：这些 latest 均不应提示更新。
  for (const latest of ['0.9.273-rc.1', '0.9.273+build.5', '0.9.272-rc.1']) {
    assert.equal(sign(latest, '0.9.273') === 1, false, latest + ' 不得视为更新')
  }
})

test('严格 grammar 拒绝前导零、空标识符、范围和非字符串，不 coercion', () => {
  for (const version of [
    '0.0.0', '1.2.3-rc.1', '1.2.3+001', '1.2.3-rc.1+build.5',
    '999999999999999999999999999999999999999.0.0',
  ]) assert.equal(isStrictSemver(version), true, version)
  for (const version of [
    '', 'v1.2.3', '1.2', '01.2.3', '1.02.3', '1.2.03', '1.2.3-01',
    '1.2.3-', '1.2.3+', '1.2.3-alpha..1', '1.2.3-alpha_1', '^1.2.3',
    null, undefined, 123, ['1.2.3'], { toString: () => '1.2.3' },
  ]) assert.equal(isStrictSemver(version), false, String(version))
  assert.equal(sign(['1.2.3'], '1.2.2'), null)
  assert.equal(sign('1.2.3', 'not-semver'), null)
})

test('client UMD 内联 comparator 与 lib/semver.js 逐字同源且行为一致', () => {
  assert.equal((CLIENT_SOURCE.match(/\/\/ SEMVER_COMPARATOR_SOURCE_START/g) || []).length, 1)
  assert.equal((CLIENT_SOURCE.match(/\/\/ SEMVER_COMPARATOR_SOURCE_END/g) || []).length, 1)
  const server = comparatorBlock(SERVER_SOURCE)
  const client = comparatorBlock(CLIENT_SOURCE)
  assert.equal(client, server, 'UMD 不得维护漂移的第二套比较算法')

  const context = vm.createContext({})
  vm.runInContext(client + '\nthis.compareSemver = compareSemver; this.isStrictSemver = isStrictSemver', context)
  const pairs = [
    ['0.9.273-rc.1', '0.9.273'],
    ['0.9.273+build.5', '0.9.273'],
    ['0.1000.0', '1.0.0'],
    ['9007199254740993.0.0', '9007199254740992.999999999999.0'],
    ['1.0.0-beta.11', '1.0.0-rc.1'],
    ['bad', '1.0.0'],
  ]
  for (const [left, right] of pairs) assert.equal(context.compareSemver(left, right), sign(left, right), left + ' / ' + right)
  assert.equal(context.isStrictSemver(['1.2.3']), false)
})

function response(body, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

async function discoverWithVersions(versions) {
  const calls = []
  const fetch = async (url) => {
    calls.push(String(url))
    if (String(url).endsWith('/state')) {
      const base = String(url).slice(0, -'/state'.length)
      if (Object.hasOwn(versions, base)) {
        return response({ routeBase: base, serverVersion: versions[base], watchers: [] })
      }
      return response({ error: 'not found' }, false, 404)
    }
    if (String(url).endsWith('/update')) return response({ current: '0.0.0', latest: null, hasUpdate: false })
    return response({ ok: true })
  }

  let definition = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { definition = value } },
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      hidden: false,
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    navigator: { clipboard: { writeText: async () => {} } },
    fetch,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    queueMicrotask,
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(CLIENT_SOURCE, sandbox)
  assert.ok(definition, 'client.js 必须注册 UMD 模块')

  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    isValidElement: () => false,
    memo: (fn) => fn,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => { fn() },
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register(options, Component) { registrations.push({ options, Component }); return () => {} },
    },
  }
  definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('MODULE_NOT_FOUND: ' + name)
  }).apply(ctx)
  const desk = registrations.find((item) => item.options.id === 'session-superagent-desk')
  assert.ok(desk, '缺真实 ZhuliPanel 注册')
  desk.Component({})
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return calls
}

test('真实 discoverBase 按 SemVer 选实例：release/prerelease、major 与任意大整数', async () => {
  const scenarios = [
    {
      name: 'release 高于 rc，build 不制造额外优先级',
      versions: {
        '/session-superagent': '0.9.273-rc.1',
        '/session-superagent/r2': '0.9.273+build.5',
        '/session-superagent/r3': '0.9.272-rc.1',
      },
      expected: '/session-superagent/r2',
    },
    {
      name: 'major 优先于 minor=1000，禁止固定 base 碰撞',
      versions: {
        '/session-superagent': '0.1000.0',
        '/session-superagent/r2': '1.0.0',
      },
      expected: '/session-superagent/r2',
    },
    {
      name: '超出 Number.MAX_SAFE_INTEGER 仍精确',
      versions: {
        '/session-superagent': '9007199254740992.999999999999999999.0',
        '/session-superagent/r2': '9007199254740993.0.0',
      },
      expected: '/session-superagent/r2',
    },
    {
      name: '完整 SemVer 顺序而不是字典序选择 prerelease',
      versions: {
        '/session-superagent': '1.0.0-beta.2',
        '/session-superagent/r2': '1.0.0-beta.11',
        '/session-superagent/r3': '1.0.0-alpha.beta',
      },
      expected: '/session-superagent/r2',
    },
  ]
  for (const scenario of scenarios) {
    const calls = await discoverWithVersions(scenario.versions)
    const stateCalls = calls.filter((url) => url === scenario.expected + '/state')
    assert.ok(stateCalls.length >= 2, scenario.name + '：发现后必须继续使用最高 precedence 的 base；实际 ' + calls.join(', '))
    const baseNote = calls.find((url) => url.includes('/client-note?key=client-base'))
    assert.ok(baseNote && baseNote.startsWith(scenario.expected + '/'), scenario.name + '：client-base 必须记录所选前缀')
  }
})

test('discoverBase 跳过非法版本；同 precedence 的 build 不无故切换实例', async () => {
  const calls = await discoverWithVersions({
    '/session-superagent': '0.9.273+build.1',
    '/session-superagent/r2': ['0.9.274'],
    '/session-superagent/r3': '0.9.273+build.5',
  })
  assert.equal(calls.filter((url) => url === '/session-superagent/state').length >= 2, true)
  assert.equal(calls.some((url) => url.includes('/client-note?key=client-base')), false)
})
