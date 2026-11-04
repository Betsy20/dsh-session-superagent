// 真跑一遍"改坏就会红"的反向用例（清单见 scripts/regression-list.mjs）。
//
// 为什么单独跑：这些用例会临时改源码，必须串行、必须 finally 还原。
//
// 用法：node scripts/regression-cases.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './regression-list.mjs'
import { acquireGate } from './gate-lock.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const runCheck = (args) => {
  try {
    // 告诉子进程「锁已经在父进程手里」：否则子进程会等一把永远不会释放的锁（死锁）
    const out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DSH_GATE_LOCK_HELD: 'mutate' } })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') }
  }
}

// 开工前把「会被改坏的文件」各留一份快照：任何一次还原失败，都能从这里补回去。
// 真机事故（2026-11-05）：两次并发跑这个脚本，后一次把前一次的注入当成了 original，
// 于是 client.js 里永久留下了 ZZ_DUP 两行 —— 门禁红了，但没人知道是工装留下的。
// 这些用例会**改坏仓库文件**再还原：全程持锁，防止另一个门禁/session 同时改（真机踩过）。
const releaseGate = acquireGate('mutate', { timeoutMs: 150000 })

// Windows 上 spawnSync 的超时是 TerminateProcess：**SIGTERM 处理器和 exit 钩子都不跑**（审核 M2 实测）.
// 所以光装信号处理器不够 —— 还要一个「下次启动先还原」的落盘凭据.
const RECOVER_DIR = join(ROOT, '.gate-recover')
const RECOVER_MANIFEST = join(RECOVER_DIR, 'manifest.json')

/** 开工前先把「上一次被强杀留下的改坏文件」还原掉（如果有）. */
function recoverFromLastRun() {
  if (!existsSync(RECOVER_MANIFEST)) return 0
  let manifest = {}
  try { manifest = JSON.parse(readFileSync(RECOVER_MANIFEST, 'utf8')) } catch { return 0 }
  let restored = 0
  for (const [rel, body] of Object.entries(manifest.files || {})) {
    try { writeFileSync(join(ROOT, rel), body); restored += 1 } catch { /* 尽力而为 */ }
  }
  try { rmSync(RECOVER_DIR, { recursive: true, force: true }) } catch { /* 下次再清 */ }
  if (restored > 0) console.log('（上一次门禁被强杀，已从 .gate-recover 还原 ' + restored + ' 个文件）')
  return restored
}

/** 把当前快照落盘：进程被强杀时，下一次启动靠它还原. */
function persistRecovery(files) {
  try {
    mkdirSync(RECOVER_DIR, { recursive: true })
    writeFileSync(RECOVER_MANIFEST, JSON.stringify({ at: new Date().toISOString(), files }, null, 2))
  } catch { /* 落盘失败不该阻断门禁 */ }
}

recoverFromLastRun()
// timeout 发的是 SIGTERM：exit 钩子不跑，文件会永久留在「改坏」状态（真机踩过两次）
let released = false
const bail = (code) => { if (!released) { released = true; try { restoreAll() } catch {} try { releaseGate() } catch {} } process.exit(code) }
for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK']) process.on(sig, () => bail(1))
const SNAPSHOT = new Map()
for (const item of CASES) {
  for (const rel of item.files || []) {
    if (SNAPSHOT.has(rel)) continue
    try { SNAPSHOT.set(rel, readFileSync(join(ROOT, rel), 'utf8')) } catch { /* 文件不存在就不管 */ }
  }
}
// 快照一拿到就落盘：进程被强杀时，下一次启动靠它还原（Windows 上信号兜不住）
persistRecovery(Object.fromEntries(SNAPSHOT))
const restoreAll = () => {
  for (const [rel, text] of SNAPSHOT) {
    try { writeFileSync(join(ROOT, rel), text) } catch { /* 尽力而为 */ }
  }
}

let passed = 0
for (const item of CASES) {
  let restore = null
  try {
    const fault = item.fault(ROOT)
    // fault 可以直接返回还原函数，也可以返回 { restore, check }（用于"注入值要传进检查"的场合）
    const spec = typeof fault === 'function' ? { restore: fault, check: item.check } : fault
    restore = spec.restore
    const broken = runCheck(spec.check)
    restore()
    restore = null
    const healed = runCheck(spec.check)
    const ok = broken.code !== 0 && healed.code === 0
    if (ok) passed += 1
    console.log((ok ? 'PASS ' : 'FAIL ') + item.name.padEnd(16) + (ok ? '改坏会红 / 还原会绿' : '改坏后 code=' + broken.code + '，还原后 code=' + healed.code))
  } finally {
    if (restore) restore()
  }
}

restoreAll()
releaseGate()
try { rmSync(RECOVER_DIR, { recursive: true, force: true }) } catch { /* 下次再清 */ }
console.log('---')
if (passed === CASES.length) {
  console.log('PASS 反向用例 ' + passed + '/' + CASES.length + ' 项都能抓住退化')
} else {
  console.log('FAIL 反向用例只有 ' + passed + '/' + CASES.length + ' 项有效')
  process.exitCode = 1
}
