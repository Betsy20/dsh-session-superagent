// 真跑一遍"改坏就会红"的反向用例（清单见 scripts/regression-list.mjs）。
//
// 为什么单独跑：这些用例会临时改源码，必须串行、必须 finally 还原。
//
// 用法：node scripts/regression-cases.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CASES } from './regression-list.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const runCheck = (args) => {
  try {
    const out = execFileSync('node', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') }
  }
}

// 开工前把「会被改坏的文件」各留一份快照：任何一次还原失败，都能从这里补回去。
// 真机事故（2026-11-05）：两次并发跑这个脚本，后一次把前一次的注入当成了 original，
// 于是 client.js 里永久留下了 ZZ_DUP 两行 —— 门禁红了，但没人知道是工装留下的。
const SNAPSHOT = new Map()
for (const item of CASES) {
  for (const rel of item.files || []) {
    if (SNAPSHOT.has(rel)) continue
    try { SNAPSHOT.set(rel, readFileSync(join(ROOT, rel), 'utf8')) } catch { /* 文件不存在就不管 */ }
  }
}
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
console.log('---')
if (passed === CASES.length) {
  console.log('PASS 反向用例 ' + passed + '/' + CASES.length + ' 项都能抓住退化')
} else {
  console.log('FAIL 反向用例只有 ' + passed + '/' + CASES.length + ' 项有效')
  process.exitCode = 1
}
