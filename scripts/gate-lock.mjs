/**
 * 门禁互斥锁：同一时刻只允许一个「会改仓库文件」的检查在跑。
 *
 * 为什么需要：反向用例（`regression-cases.mjs`）会临时改坏 `package.json` / `client.js` / `README.md`
 * 再还原。两个这样的进程交错时，后一个会把前一个的**注入**当成原件写回去 ——
 * 2026-11-05 真机事故：`client.js` 里永久留下 `ZZ_DUP` 两行、`package.json` 的 `files` 少了两项、
 * `README.md` 的单测数变成 `9999`。当时看到的现象是「改坏后 code=0 / 还原后 code=1」这种反号。
 *
 * 实现：用 `mkdirSync` 的原子性（EEXIST 即被占用）做锁，锁目录里写 pid 与起始时间。
 * - 持锁进程已死 → 视为陈旧锁，清掉重试；
 * - 超过 maxAgeMs 仍占着 → 也视为陈旧（防止 pid 复用导致的永久卡死）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK = join(ROOT, '.gate-lock')

/** 同步睡眠（不求人、不引依赖）。 */
const sleepSync = (ms) => {
  const shared = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(shared, 0, 0, ms)
}

const alive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM = 进程存在但没权限（仍然算活着）；ESRCH = 不存在
    return Boolean(error && error.code === 'EPERM')
  }
}

const readOwner = () => {
  try {
    return JSON.parse(readFileSync(join(LOCK, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 拿锁。拿不到就等（默认最多等 120 秒），超时抛错（调用方会红，这是对的：
 * 说明另一个门禁跑了超过两分钟，需要人看一眼）。
 */
export function acquireGate(name = 'mutate', { timeoutMs = 240000, maxAgeMs = 5 * 60 * 1000, quiet = false } = {}) {
  // 可重入：门禁跑器自己会调用别的门禁脚本（如 audit-pack），子进程再抢同一把锁就是死锁。
  // 真机事故（2026-11-05）：父子互相等，两个进程挂了两分钟才被 timeout 杀掉。
  if (process.env.DSH_GATE_LOCK_HELD === name) return () => {}
  // maxAgeMs 只有 5 分钟：正经跑一遍门禁 <60 秒。pid 会被复用，光靠「进程还活着」判断不够 ——
  // 2026-11-05 真机：一次被 timeout 杀掉的门禁留下锁，下一个门禁对着一个复用了 pid 的进程白等 180 秒。
  const started = Date.now()
  let waited = false
  for (;;) {
    try {
      mkdirSync(LOCK)
      process.env.DSH_GATE_LOCK_HELD = name
      writeFileSync(join(LOCK, 'owner.json'), JSON.stringify({
        name, pid: process.pid, at: new Date().toISOString(), cwd: process.cwd(),
      }, null, 2))
      if (waited && !quiet) console.log('（等到锁了：另一个门禁先跑完了）')
      return () => {
        if (process.env.DSH_GATE_LOCK_HELD === name) delete process.env.DSH_GATE_LOCK_HELD
        try { rmSync(LOCK, { recursive: true, force: true }) } catch { /* 尽力而为 */ }
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
      const owner = readOwner()
      const age = owner && owner.at ? Date.now() - Date.parse(owner.at) : 0
      // 陈旧锁：持有者已死，或占得太久（pid 复用 / 挂起）
      if ((owner && !alive(Number(owner.pid))) || (Number.isFinite(age) && age > maxAgeMs)) {
        if (!quiet) console.log('清理陈旧锁：' + JSON.stringify(owner))
        try { rmSync(LOCK, { recursive: true, force: true }) } catch { /* 下一轮再试 */ }
        continue
      }
      if (Date.now() - started > timeoutMs) {
        // 用类型化的错误：只读检查可以选择「跳过」而不是「假红」
        const error = new Error('另一个门禁还在跑（pid ' + (owner && owner.pid) + '，从 ' + (owner && owner.at) + ' 开始）')
        error.code = 'GATE_BUSY'
        error.owner = owner
        throw error
      }
      if (!waited && !quiet) {
        console.log('另一个门禁在跑（pid ' + (owner && owner.pid) + '），等它……')
        waited = true
      }
      sleepSync(250)
    }
  }
}

/** 包一层：无论成功失败都释放。 */
export function withGate(name, fn, options) {
  const release = acquireGate(name, options)
  try {
    return fn()
  } finally {
    release()
  }
}

export const GATE_LOCK_PATH = LOCK
