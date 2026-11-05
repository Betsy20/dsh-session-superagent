// 门禁互斥锁：会「改坏再还原」的检查必须独占，否则两个进程交错会把注入当原件写回去。
// 真机事故（2026-11-05）：client.js 永久留下 ZZ_DUP 两行、package.json 的 files 少两项、README 单测数变 9999。
//
// 审核 M4：**这些用例绝不能碰仓库根的生产锁** —— `preflight` 的第一项就是 `node --test`，
// 并行跑两次时第二次会删掉第一次正持有的锁（等于把事故重演一遍）。所以每条用例都显式传临时目录。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDir } from './fixtures/tmpdir.mjs'
import test from 'node:test'

import { acquireGate } from '../scripts/gate-lock.mjs'

// 统一走 tempDir()（退出时自动清理）：本机规则要求测试不许自己 mkdtemp
const tmpLock = () => join(tempDir('gate-lock-'), '.gate-lock')

test('拿锁 → 目录存在 → 释放后消失', () => {
  const lockPath = tmpLock()
  const release = acquireGate('unit-basic', { quiet: true, lockPath })
  assert.ok(existsSync(lockPath), '持锁期间锁目录必须存在')
  release()
  assert.ok(!existsSync(lockPath), '释放后锁目录必须消失')
})

test('重复释放不抛（finally 里会调两次）', () => {
  const release = acquireGate('unit-double', { quiet: true, lockPath: tmpLock() })
  release()
  assert.doesNotThrow(() => release(), '第二次释放要静默')
})

test('陈旧锁（持有者进程已死）能被自动清理', () => {
  const lockPath = tmpLock()
  mkdirSync(lockPath)
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
    name: 'stale', pid: 999999, at: new Date(Date.now() - 3600_000).toISOString(),
  }))
  const release = acquireGate('unit-stale', { quiet: true, timeoutMs: 3000, lockPath })
  // 审核 T23：以前只断言 existsSync —— 那个目录是**测试自己**刚 mkdir 的，恒真。
  // 真正的判据是「owner.json 换成了当前进程」。
  const owner = JSON.parse(readFileSync(join(lockPath, 'owner.json'), 'utf8'))
  assert.equal(Number(owner.pid), process.pid, '陈旧锁应该被本进程接管')
  assert.equal(owner.name, 'unit-stale')
  release()
})

test('单测不许再碰生产锁（M4 回归）', () => {
  const src = readFileSync(new URL('./gate-lock.test.mjs', import.meta.url), 'utf8')
  assert.ok(!/rmSync\(\s*GATE_LOCK_PATH/.test(src), '不许删除生产锁路径 —— 那会拆掉别人的锁')
  assert.ok(!/GATE_LOCK_PATH\s*\)/.test(src.split('import')[1] || ''), '生产锁路径不该出现在用例里')
})

test('释放时只删自己的锁（旧进程醒来不许拆新持有者的锁）', () => {
  const lockPath = tmpLock()
  const release = acquireGate('owner-test', { quiet: true, lockPath })
  // 模拟「锁已经归别人」：把 owner.json 改成另一个 pid
  writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({
    name: 'owner-test', pid: process.pid === 1 ? 2 : 1, at: new Date().toISOString(),
  }))
  release()
  assert.ok(existsSync(lockPath), '不是自己的锁，不能删')
  rmSync(lockPath, { recursive: true, force: true })
})

test('重入判据是 token，不是「固定名字的环境变量」（T18：export 一下就静默失效）', async () => {
  const { acquireGate } = await import('../scripts/gate-lock.mjs')
  // 假 token：不该被当成重入
  process.env.DSH_GATE_LOCK_TOKEN = 'forged-token-not-ours'
  try {
    // 真拿锁（会建目录），说明假 token 没有绕过
    const tmpLock = tempDir('gate-lock-token-')
    const lockPath = join(tmpLock, 'lock')
    const release = acquireGate('test-forged', { timeoutMs: 2000, quiet: true, lockPath })
    assert.ok(process.env.DSH_GATE_LOCK_TOKEN !== 'forged-token-not-ours', '不该沿用伪造的 token')
    release()
  } finally {
    delete process.env.DSH_GATE_LOCK_TOKEN
  }
})
