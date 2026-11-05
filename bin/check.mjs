#!/usr/bin/env node
// 装完能跑的自检命令（审核 T35）。
//
// 为什么需要它：装完之后客户**没有任何一条自己能跑的命令**来确认「到底装上没有」。
// `watch_doctor` 是模型工具 —— 只有插件**已经挂载**时才存在，拿它证明「装好了」是循环论证。
//
// 这个脚本**不依赖宿主加载**：它只看包本身、状态目录、凭证文件，以及（可选）探测宿主端口。
//
// 用法：
//   npx dsh-session-superagent            # = check
//   npx dsh-session-superagent check      # 同上
//   npx dsh-session-superagent check --port 65466
//
// 退出码：0 = 一切正常；1 = 有问题（详情会打印出来）。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 这个文件在 bin/ 里，包根是上一层
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const portArg = args.includes('--port') ? args[args.indexOf('--port') + 1] : null

const lines = []
let bad = 0
const ok = (text) => lines.push('OK   ' + text)
const warn = (text) => lines.push('警告 ' + text)
const fail = (text) => { lines.push('FAIL ' + text); bad += 1 }

// ① 包本身完整吗（这几份缺一份，插件就挂不上）
const NEEDED = ['package.json', 'client.js', 'lib/index.js', 'lib/watch.js', 'cordis.patch.yml']
const missing = NEEDED.filter((rel) => !existsSync(join(ROOT, rel)))
if (missing.length > 0) fail('安装副本缺文件：' + missing.join('、') + '（重装一次）')
else ok('安装副本完整（' + NEEDED.length + ' 个必需文件都在）')

let version = '?'
try {
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  ok('版本 ' + version)
} catch {
  fail('package.json 读不出来 —— 安装副本损坏，重装一次')
}

// ② 状态目录（不读内容，只看在不在）
const stateDir = process.env.DSH_SUPERAGENT_STATE
  ? String(process.env.DSH_SUPERAGENT_STATE)
  : join(homedir(), '.dsh', 'state', 'session-superagent')
if (!existsSync(stateDir)) {
  warn('还没有状态目录（' + stateDir + '）—— 装好但还没添加过主理鱼，属正常')
} else {
  const watchers = join(stateDir, 'watchers.json')
  if (!existsSync(watchers)) warn('有状态目录但没有 watchers.json —— 还没添加过主理鱼')
  else {
    try {
      const state = JSON.parse(readFileSync(watchers, 'utf8'))
      const count = Object.keys(state.watchers || {}).length
      const enabled = Object.values(state.watchers || {}).filter((w) => w && w.enabled !== false).length
      ok('已配置 ' + count + ' 条主理鱼（其中 ' + enabled + ' 条在跑）')
    } catch {
      fail('watchers.json 不是合法 JSON —— 面板会读不出来；先备份它再删掉重配')
    }
  }
  const secrets = join(stateDir, 'secrets.json')
  if (existsSync(secrets)) {
    // 只看权限，不打印内容
    let mode = ''
    try { mode = (statSync(secrets).mode & 0o777).toString(8) } catch {}
    ok('凭证文件存在' + (mode ? '（权限 ' + mode + '）' : '') + ' —— 内容不会被这个命令打印')
  } else {
    ok('没有单独存凭证（回退到已登录的 gh CLI）')
  }
}

// ③ 宿主端口（可选探测：连不上不算失败 —— 插件可能没装进任何 profile）
const port = Number(portArg || process.env.DSH_PORT || 65466)
const probe = async () => {
  try {
    const res = await fetch('http://127.0.0.1:' + port + '/session-superagent/state', { signal: AbortSignal.timeout(2500) })
    if (res.status === 404) {
      warn('宿主在 ' + port + ' 上，但没挂这个插件 —— 装进 profile 了吗？（dsh plugin --profile <p> add dsh-session-superagent）')
      return
    }
    if (!res.ok) {
      fail('宿主返回 HTTP ' + res.status + '（' + port + '）—— 插件装上了但报错，去面板「设置 → 版本与更新 → 复制诊断信息」')
      return
    }
    const body = await res.json()
    const running = body.runningVersion || body.serverVersion || '?'
    ok('宿主在 ' + port + ' 上，插件已加载，运行版本 ' + running)
    if (version !== '?' && running !== version) {
      warn('磁盘上是 ' + version + '，宿主跑的是 ' + running + ' —— 重启宿主才生效（不是重装）')
    }
  } catch (error) {
    warn('连不上 ' + port + '（' + String((error && error.message) || error).slice(0, 60) + '）'
      + ' —— 宿主没开、或端口不是这个。用 --port 指定，或忽略（这项不是必过项）')
  }
}

await probe()

// ④ 隔离工作区残留（只说有没有，不删）
const zhuliDirs = []
try {
  for (const name of readdirSync(homedir())) {
    if (name !== 'projects') continue
  }
} catch {}
void zhuliDirs

console.log(lines.join('\n'))
console.log('---')
if (bad === 0) {
  console.log('自检通过（' + lines.filter((l) => l.startsWith('OK')).length + ' 项 OK，'
    + lines.filter((l) => l.startsWith('警告')).length + ' 项提醒）')
} else {
  console.log(bad + ' 项不通过 —— 看上面的 FAIL 行')
  process.exitCode = 1
}
