import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// 把「preflight 第 N 项」这类**必然错位**的引用改成「preflight 的对应检查」。
// 依据：preflight 不打印序号，任何一次插入都会让后面全部失效（T21 实测 20 处全错）。
const out = execFileSync('node', ['scripts/audit-doc-ordinals.mjs'], { encoding: 'utf8', cwd: process.cwd() })
const files = [...new Set(out.split(/\r?\n/).filter((l) => l.trim().startsWith('docs/')).map((l) => l.trim().split(':')[0]))]
if (files.length === 0) {
  console.log('没有需要改的')
  process.exit(0)
}

let total = 0
for (const rel of files) {
  let s = readFileSync(rel, 'utf8')
  const lines = s.split('\n')
  let changed = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (!/preflight/i.test(lines[i])) continue
    const next = lines[i].replace(/第\s*\d+\s*项(检查)?/g, () => {
      changed += 1
      return '对应检查'
    })
    if (next !== lines[i]) lines[i] = next
  }
  if (changed > 0) {
    writeFileSync(rel, lines.join('\n'))
    total += changed
  }
}
console.log('改了 ' + total + ' 处序号引用（' + files.length + ' 份文档）')
