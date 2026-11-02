// 真跑一遍"改坏就会红"的反向用例（清单见 scripts/regression-list.mjs）。
//
// 为什么单独跑：这些用例会临时改源码，必须串行、必须 finally 还原。
//
// 用法：node scripts/regression-cases.mjs
import { execFileSync } from 'node:child_process'
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

console.log('---')
if (passed === CASES.length) {
  console.log('PASS 反向用例 ' + passed + '/' + CASES.length + ' 项都能抓住退化')
} else {
  console.log('FAIL 反向用例只有 ' + passed + '/' + CASES.length + ' 项有效')
  process.exitCode = 1
}
