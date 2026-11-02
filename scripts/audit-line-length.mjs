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

const out = execFileSync('node', [join(root, 'scripts', 'first-run.mjs')], { encoding: 'utf8' })
const lines = out.split(String.fromCharCode(10)).map((text) => ({ text, chars: [...text].length }))
const over = lines.filter((line) => line.chars > LIMIT)
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
