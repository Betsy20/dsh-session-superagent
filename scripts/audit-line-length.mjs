// 唤醒消息的单行长度体检：聊天窗口里一行太长会挤成一团。
//
// 注意：必须按**字符数**算，不能用 `awk length`（那在中文本机会按字节算，
// 一个汉字 3 字节 —— 我第一轮就被它误导过一次，以为 102 字符的行是 128）。
//
// 判据：单行 ≤ 120 字符（超了 formatWatchText 会把补充信息折到下一行）。
//
// 用法：node scripts/audit-line-length.mjs
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIMIT = 120

const wakeOut = execFileSync('node', [join(root, 'scripts', 'wake-samples.mjs')], { encoding: 'utf8' })
// 两份都量：first-run 是「首次演练」的短消息，wake-samples 是 7 种**真实**场景
const out = execFileSync('node', [join(root, 'scripts', 'first-run.mjs')], { encoding: 'utf8' }) + String.fromCharCode(10) + wakeOut
const lines = out.split(String.fromCharCode(10)).map((text) => ({ text, chars: [...text].length }))
const over = lines.filter((line) => line.chars > LIMIT)

// 审核 T25 FN-7：first-run 输出为空时（脚本坏了 / 被改成一字不打印），
// 上面那行会得到 1 行 0 字符，于是「没有超限」→ PASS。空输出必须算失败。
const MIN_LINES = 5
if (lines.filter((line) => line.text.trim()).length < MIN_LINES) {
  console.log('FAIL first-run 只输出了 ' + lines.filter((l) => l.text.trim()).length + ' 行有效内容（至少该有 ' + MIN_LINES + ' 行）—— 空输出不等于合规')
  process.exitCode = 1
}

const worst = lines.slice().sort((a, b) => b.chars - a.chars)[0]

console.log('检查 ' + lines.length + ' 行（按字符数）')
console.log('最长一行 ' + worst.chars + ' 字符：' + worst.text.slice(0, 50) + (worst.text.length > 50 ? '…' : ''))
console.log('上限 ' + LIMIT + ' 字符')
console.log('---')

if (over.length > 0) {
  console.log('FAIL ' + over.length + ' 行超过上限：')
  for (const line of over.slice(0, 5)) console.log('  ' + line.chars + ' 字符：' + line.text.slice(0, 60))
  process.exitCode = 1
} else {
  console.log('PASS 所有行都在 ' + LIMIT + ' 字符以内')
}
