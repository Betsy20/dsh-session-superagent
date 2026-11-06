#!/usr/bin/env node
// issue #9：在独立 DSH 0.2.2-rc.1 app + 全新 home 中做只读验收。
// 运行：ELECTRON_RUN_AS_NODE=1 "DeepSeek Harness.exe" scripts/verify-dsh-022.mjs --app <独立app目录> --home <全新home> --profile issue9
// 不启动宿主、不访问 issue/PR、不读取或修改 live home/profile/state。
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function arg(name, fallback = '') {
  const index = process.argv.indexOf('--' + name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const appRoot = resolve(arg('app'))
const homeRoot = resolve(arg('home'))
const profileName = arg('profile', 'issue9')
assert.ok(process.versions.electron, '必须用独立 app 的 Electron/Node 运行时执行')
assert.ok(basename(homeRoot).startsWith('home-0.2.2-rc.1-issue9-'), 'home 必须是本任务新建的独立目录')
assert.ok(/^[A-Za-z0-9_-]+$/.test(profileName), 'profile 名称非法')

const dshRoot = join(appRoot, 'resources', 'app.asar', 'dsh')
const profileDir = join(homeRoot, 'profiles', profileName)
const pluginDir = join(profileDir, 'node_modules', 'dsh-session-superagent')
const stateDir = join(homeRoot, 'readonly-fixture-' + process.pid + '-' + Date.now())
const profileManifestPath = join(profileDir, 'package.json')
const profilePatchPath = join(profileDir, 'cordis.patch.yml')
const configBefore = {
  manifest: readFileSync(profileManifestPath, 'utf8'),
  patch: readFileSync(profilePatchPath, 'utf8'),
}

// 所有插件状态都重定向到全新 home 下唯一的 fixture 目录；离线双保险。
mkdirSync(stateDir, { recursive: true })
process.env.DSH_HOME = homeRoot
process.env.HOME = homeRoot
process.env.USERPROFILE = homeRoot
process.env.DSH_SUPERAGENT_STATE = stateDir
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
process.env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
delete process.env.DSH_SUPERAGENT_TRIGGER
delete process.env.DSH_GATE_LOCK_TOKEN

// 直接调用 rc1 自带的 profile loader，读取它真实返回的 skippedBundles。
const bootModule = await import(pathToFileURL(join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')).href)
const runtimeVersion = bootModule.getDshRuntimeVersion()
const profile = bootModule.loadProfileDirectory('dsh', profileDir, join(dshRoot, 'package.json'), { userLayer: false })
assert.equal(runtimeVersion, '0.2.2-rc.1')
assert.deepEqual(profile.skippedBundles, [])
assert.ok(profile.layers.some((layer) => layer.packageName === 'dsh-session-superagent'))

const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))
const plugin = await import(pathToFileURL(join(pluginDir, 'lib', 'index.js')).href)
assert.equal(plugin.SERVER_VERSION, pkg.version)

// 构造 fixture 守：只观察，已有本地水位；随后只调用 watch_status / watch_trace。
const repo = 'fixture/issue9-readonly'
const sessionId = 'session-issue9-readonly'
const id = repo + '#' + sessionId
const at = '2026-11-06T00:00:00.000Z'
plugin.__test.writeState({ watchers: { [id]: {
  id, repo, provider: 'github', sessionId,
  intervalSec: 3600, enabled: true, observe: true, isolated: false,
  filters: {}, priority: {}, cursor: at,
  seen: { 9: at }, lastReported: { 9: at },
  filteredLog: [], history: [], wakeTimes: [],
} } })

const tools = new Map()
const routes = new Map()
const disposedPaths = []
const cleanups = []
const disposeListeners = []
let followupCalls = 0
const agent = { id: sessionId, status: 'idle', followup: () => { followupCalls += 1 } }
const ctx = {
  tools: { register: (tool) => tools.set(tool.name, tool) },
  webServer: { register(route) {
    routes.set(route.path, route)
    let active = true
    return () => { if (active) { active = false; disposedPaths.push(route.path); routes.delete(route.path) } }
  } },
  agents: { currentInitiator: () => agent, get: (wanted) => wanted === sessionId ? agent : null },
  get: () => null,
  effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') cleanups.push(cleanup); return cleanup },
  on(event, callback) { if (event === 'dispose') disposeListeners.push(callback) },
}
plugin.apply(ctx)
const routeCount = routes.size
assert.ok(routeCount > 0)
assert.ok(cleanups.length > 0 && disposeListeners.length > 0)

const statePath = join(stateDir, 'watchers.json')
const stateBefore = readFileSync(statePath, 'utf8')
const status = JSON.parse(await tools.get('watch_status').execute({ format: 'json' }))
assert.equal(status.watchers.length, 1)
assert.equal(status.watchers[0].repo, repo)
assert.equal(status.watchers[0].sessionId, sessionId)
assert.equal(status.watchers[0].observe, true)
const trace = JSON.parse(await tools.get('watch_trace').execute({ repo, number: 9, format: 'json' }))
assert.equal(trace.results.length, 1)
assert.equal(trace.results[0].number, '9')
assert.equal(readFileSync(statePath, 'utf8'), stateBefore, '只读工具不得推进 fixture 水位或改写状态')
assert.equal(followupCalls, 0)
assert.deepEqual({
  manifest: readFileSync(profileManifestPath, 'utf8'),
  patch: readFileSync(profilePatchPath, 'utf8'),
}, configBefore, '验收不得改写独立 profile 配置')

// effect 与 dispose 两条路径都触发一次，验证清理幂等且路由恰好各摘一次。
for (const cleanup of cleanups) cleanup()
for (const listener of disposeListeners) listener()
const cleanShutdown = disposedPaths.length === routeCount && new Set(disposedPaths).size === routeCount && routes.size === 0
assert.equal(cleanShutdown, true)
assert.equal(readFileSync(statePath, 'utf8'), stateBefore, '清理也不得推进 fixture 水位')

console.log(JSON.stringify({
  runtimeVersion,
  packageVersion: pkg.version,
  layers: profile.layers.map((layer) => layer.packageName),
  skippedBundles: profile.skippedBundles,
  watcherReadOnly: true,
  fixtureOnly: true,
  issuePrApiCalls: 0,
  followupCalls,
  stateUnchanged: true,
  profileUnchanged: true,
  cleanShutdown,
  routeCount,
  stateDir,
}, null, 2))
