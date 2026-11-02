#!/usr/bin/env node
// 离线挂载冒烟：把插件真的 apply 一遍（假 ctx），看它能不能注册出预期数量的工具与路由。
//
// 为什么需要：本机真机跑的是很久以前的版本，服务端一改就是"几十个版本一起跳"，
// 挂载失败（少 import、profile 缺文件、路由撞车）在真机上表现为"整块功能消失"。
// 这个脚本让"能不能挂上去"在离线就有一条明确结论，并被 preflight 守着。
//
// 用法：node scripts/smoke-mount.mjs [--json]
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-mount-'))
process.env.DSH_SUPERAGENT_STATE = stateDir
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const expectedRoutes = [
  '/session-superagent/state',
  '/session-superagent/watch',
  '/session-superagent/credentials',
  '/session-superagent/diagnose',
  '/session-superagent/update',
  '/session-superagent/goal',
  '/session-superagent/client-note',
  '/session-superagent/client-error',
]

const tools = []
const routes = new Map()
const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agents: { currentInitiator: () => ({ id: 'session-smoke' }), get: () => null },
  get: () => null,
  effect: (fn) => fn(),
  inject: () => {},
}

let failure = null
try {
  const mod = await import('../lib/index.js')
  await mod.apply(ctx)
} catch (error) {
  failure = String((error && error.stack) || error)
}

const missing = expectedRoutes.filter((path) => !routes.has(path))
const result = {
  ok: !failure && missing.length === 0 && tools.length > 0,
  version: failure ? null : (await import('../lib/index.js')).SERVER_VERSION,
  tools: tools.map((tool) => tool.name),
  routes: [...routes.keys()],
  missing,
  failure,
}

rmSync(stateDir, { recursive: true, force: true })

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log(`挂载冒烟 OK：${result.version}，工具 ${result.tools.length} 个（${result.tools.join(',')}），路由 ${result.routes.length} 条`)
} else {
  console.error('挂载冒烟失败：' + (result.failure || ('缺路由 ' + result.missing.join(','))))
  process.exitCode = 1
}
