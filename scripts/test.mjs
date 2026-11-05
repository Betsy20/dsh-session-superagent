#!/usr/bin/env node
// 跑单测的**唯一入口**（`npm test` 指向这里）。
//
// 为什么需要它（审核 T30）：
//   `test/routes.test.mjs` 里有几条会真的 spawn `gh`。不带 `DSH_SUPERAGENT_OFFLINE=1` 时：
//     带离线开关 1123ms / 不带 **146574ms**（两分半）。
//   而 `timeout 120 node --test` 会把那种跑法直接 kill 掉 —— 变成 `pass 355 / fail 1`，
//   看起来像「测试挂了」，其实是「等 gh 超时」。
//
//   文档（README / CONTRIBUTING / CHECKLIST）里给客户的命令也必须是**绿色的那条**，
//   所以统一走这里：`npm test` = 带齐环境变量的 `node --test`。
//
// 用法：
//   npm test                     # 全部
//   node scripts/test.mjs --watch
//   node scripts/test.mjs test/watch.test.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = { ...process.env }
// 单测不许出网：gh / Gitee / npm registry 全部短路
env.DSH_SUPERAGENT_OFFLINE = '1'
// 也不许真的探测更新（一次网络抖动就会让整条门禁变红）
env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
// 状态目录交给各用例自己用 tempDir() 设；这里不预设，避免「以为是临时目录其实是真目录」
delete env.DSH_SUPERAGENT_STATE
delete env.DSH_SUPERAGENT_NO_POLL
delete env.DSH_SUPERAGENT_TRIGGER
delete env.DSH_GATE_LOCK_TOKEN

const args = ['--test', ...process.argv.slice(2)]
const res = spawnSync(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' })
process.exit(res.status === null ? 1 : res.status)
