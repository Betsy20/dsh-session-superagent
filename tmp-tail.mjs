import { readFileSync, writeFileSync } from 'node:fs'

const path = 'lib/watch.js'
const raw = readFileSync(path, 'utf8')
const crlf = raw.includes('\r\n')
let s = raw.split('\r\n').join('\n')

const old = `    '\n\n先读仓库 AGENTS.md 的判断规则，再决定「修 / 回 / 待定」。完成标准 = 有测试结果：没跑测试不算完成，跑不了就写清原因；做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。'`
if (!s.includes(old)) {
  console.error('anchor missing')
  process.exit(1)
}

// 一段 260 字的墙 → 三行短句（一行一件事，和【完成标准】的编号风格一致）
const next = `    '\n\n接下来：',
    '1. 先读仓库 AGENTS.md 的判断规则，再决定「修 / 回 / 待定」；',
    '2. 没有测试结果不算完成 —— 跑不了就写清为什么跑不了；',
    '3. 做完一条就写回 GitHub，并调用 watch_ack 打上已处理标签，不要扩大范围。'`

s = s.replace(old, next)
if (crlf) s = s.split('\n').join('\r\n')
writeFileSync(path, s)
console.log('长段已拆成三行')
