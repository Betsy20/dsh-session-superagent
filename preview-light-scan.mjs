// 临时脚本：扫 client.js 里两段 CSS 常量中的硬编码颜色字面量。用完删。
import { readFileSync } from 'node:fs'

const src = readFileSync('client.js', 'utf8')

function sliceQuoted(marker, quote) {
  const head = src.indexOf(marker) + marker.length
  let i = head
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === quote) break
    i += 1
  }
  return src.slice(head, i)
}

const ported = JSON.parse('"' + sliceQuoted('const PORTED_CSS = "', '"') + '"')
const dock = sliceQuoted('const DOCK_CSS = `', '`')

const re = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g
for (const [name, text] of [['PORTED_CSS', ported], ['DOCK_CSS', dock]]) {
  text.split('\n').forEach((line, idx) => {
    const hits = [...line.matchAll(re)].map((x) => x[0])
    if (hits.length) console.log(`${name}:${idx + 1}: ${hits.join(', ')}   ||| ${line.trim().slice(0, 200)}`)
  })
}
console.log('---PORTED_CSS rules:', ported.split('\n').length, 'lines | DOCK_CSS:', dock.split('\n').length, 'lines')
