// 门禁互斥锁：会「改坏再还原」的检查必须独占，否则两个进程交错会把注入当原件写回去。
// 真机事故（2026-11-05）：client.js 永久留下 ZZ_DUP 两行、package.json 的 files 少两项、README 单测数变 9999。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import test from 'node:test'

import { acquireGate, GATE_LOCK_PATH } from '../scripts/gate-lock.mjs'

test('拿锁 → 目录存在 → 释放后消失', () => {
  const release = acquireGate('unit-basic', { quiet: true })
  assert.ok(existsSync(GATE_LOCK_PATH), '持锁期间锁目录必须存在')
  release()
  assert.ok(!existsSync(GATE_LOCK_PATH), '释放后锁目录必须消失')
})

test('重复释放不抛（finally 里会调两次）', () => {
  const release = acquireGate('unit-double', { quiet: true })
  release()
  assert.doesNotThrow(() => release(), '第二次释放要静默')
})

test('陈旧锁（持有者进程已死）能被自动清理', () => {
  // 手工造一把「pid 一定不存在」的锁
  rmSync(GATE_LOCK_PATH, { recursive: true, force: true })
  mkdirSync(GATE_LOCK_PATH)
  writeFileSync(GATE_LOCK_PATH + '/owner.json', JSON.stringify({
    name: 'stale', pid: 999999, at: new Date(Date.now() - 3600_000).toISOString(),
  }))
  const release = acquireGate('unit-stale', { quiet: true, timeoutMs: 3000 })
  assert.ok(existsSync(GATE_LOCK_PATH), '应该已经拿到锁')
  release()
})
