#!/usr/bin/env node
// 接口契约快照：把「挂上去之后长什么样」固化成 JSON，改形状就让测试红。
//
// 为什么：0.8.87 的挂载冒烟只验「数量对不对」。如果哪天路由改名、工具参数少了一个字段，
// 数量可能还是 8 / 7，但客户那边的调用会全废 —— 形状要单独守。
//
// 用法：
//   node scripts/contract.mjs            # 打印当前契约
//   node scripts/contract.mjs --update   # 覆盖 test/fixtures/contract.json（改完记得看 diff）
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURE = join(ROOT, 'test', 'fixtures', 'contract.json')

/** 用假 ctx 真跑一遍 apply()，把外在可见的形状抽出来。 */
export async function buildContract() {
  const stateDir = mkdtempSync(join(tmpdir(), 'zhuli-contract-'))
  const prevState = process.env.DSH_SUPERAGENT_STATE
  const prevPoll = process.env.DSH_SUPERAGENT_NO_POLL
  process.env.DSH_SUPERAGENT_STATE = stateDir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'

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
    agents: { currentInitiator: () => ({ id: 'session-contract' }), get: () => null },
    get: () => null,
    effect: (fn) => fn(),
    inject: () => {},
  }

  try {
    const mod = await import('../lib/index.js?contract=' + Date.now())
    await mod.apply(ctx)
    const shape = {
      // 版本号故意不进快照：它本来就每次发版都变，放进来等于强制手工 --update
      inject: [...(mod.inject || [])].sort(),
      tools: tools
        .map((tool) => ({
          name: tool.name,
          // 只记「有哪些参数名」，不记描述文案（文案改动不该让契约红）
          params: Object.keys((tool.parameters && tool.parameters.properties) || {}).sort(),
          required: [...((tool.parameters && tool.parameters.required) || [])].sort(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      routes: [...routes.keys()].sort(),
    }
    return shape
  } finally {
    if (prevState === undefined) delete process.env.DSH_SUPERAGENT_STATE
    else process.env.DSH_SUPERAGENT_STATE = prevState
    if (prevPoll === undefined) delete process.env.DSH_SUPERAGENT_NO_POLL
    else process.env.DSH_SUPERAGENT_NO_POLL = prevPoll
    rmSync(stateDir, { recursive: true, force: true })
  }
}

export function readFixture() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'))
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const shape = await buildContract()
  if (process.argv.includes('--update')) {
    writeFileSync(FIXTURE, JSON.stringify(shape, null, 2) + String.fromCharCode(10))
    console.log('已更新契约快照：' + FIXTURE)
  } else {
    console.log(JSON.stringify(shape, null, 2))
  }
}
