// 把官方 dsh-superagent 的 GUI 样式表移植进 client.js（可重复执行，幂等）。
//
// 官方包的 CSS 在编译产物里是 `var client_default = "<JSON 转义的 CSS>";`，
// 这里用 JSONDecoder 的等价物（JSON.parse 的 raw 扫描）取出来，再以 JSON 字符串
// 塞进本仓库 client.js 的 `const PORTED_CSS = "…";` 行。
//
// 用法： node scripts/port-official-ui.mjs [官方包路径]
import { readFileSync, writeFileSync } from 'node:fs'

const OFFICIAL = process.argv[2] ?? 'D:/主工作区/projects/dsh-superagent-prototype/lib/client.js'
const TARGET = new URL('../client.js', import.meta.url)

const official = readFileSync(OFFICIAL, 'utf8')
const marker = 'var client_default = '
const at = official.indexOf(marker)
if (at < 0) throw new Error('官方产物里找不到 client_default（CSS）常量，路径对吗？' + OFFICIAL)

// 从引号开始扫到匹配的收尾引号（处理反斜杠转义），再 JSON.parse 还原
let i = at + marker.length
if (official[i] !== '"') throw new Error('CSS 常量不是字符串字面量')
let j = i + 1
while (j < official.length) {
  if (official[j] === '\\') j += 2
  else if (official[j] === '"') break
  else j += 1
}
const css = JSON.parse(official.slice(i, j + 1))

const client = readFileSync(TARGET, 'utf8')
const linePrefix = '    const PORTED_CSS = '
const start = client.indexOf(linePrefix)
if (start < 0) throw new Error('client.js 里没有 PORTED_CSS 占位行')
const end = client.indexOf('\n', start)
if (end < 0) throw new Error('PORTED_CSS 行没有换行结尾')

const next = client.slice(0, start) + linePrefix + JSON.stringify(css) + ';' + client.slice(end)
writeFileSync(TARGET, next)

console.log(`官方 CSS: ${css.length} 字符 / ${css.split('\n').length} 行`)
console.log(`client.js: ${client.length} -> ${next.length} 字节`)
