// 全 docs/ 一致性体检：文档比知识库更容易腐烂（早期结论可能已被后来的版本推翻）。
//
// 检查四类，都是"机械可查"的：
//   ① 工具名（watch_*）必须存在于 lib/index.js
//   ② 路由（/session-superagent/*）必须存在
//   ③ 版本号：文档里声称的版本不能**高于**当前版本（那一定是写错或未来稿）
//   ④ 状态字段名（反引号里的 camelCase）必须能在 lib/ 里找到
//
// 用法：node scripts/audit-docs-all.mjs
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const current = pkg.version

const clientSrc = readFileSync(join(root, 'client.js'), 'utf8')
const code = [
  readFileSync(join(root, 'lib', 'index.js'), 'utf8'),
  readFileSync(join(root, 'lib', 'watch.js'), 'utf8'),
  readFileSync(join(root, 'lib', 'gh-format.js'), 'utf8'),
].join('\n')

const tools = new Set([...code.matchAll(/name: '(watch_[a-z_]+)'/g)].map((m) => m[1]))
const routes = new Set([...code.matchAll(/path: '(\/session-superagent\/[a-z-]+)'/g)].map((m) => m[1]))

function walkDocs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const info = statSync(full)
    if (info.isDirectory()) {
      if (name === 'node_modules' || name === 'kb') continue
      walkDocs(full, out)
    } else if (name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

const files = [
  join(root, 'README.md'),
  join(root, 'MAINTENANCE.md'),
  join(root, 'HANDOFF.md'),
  ...walkDocs(join(root, 'docs')),
].filter((file) => { try { return statSync(file).isFile() } catch { return false } })

const cmp = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

const problems = { tools: [], routes: [], versions: [], paths: [] }

for (const file of files) {
  const rel = file.slice(root.length + 1).replace(/\\/g, '/')
  if (rel === 'CHANGELOG.md') continue
  const text = readFileSync(file, 'utf8')

  for (const match of text.matchAll(/\b(watch_[a-z_]+)\b/g)) {
    if (!tools.has(match[1])) problems.tools.push({ rel, id: match[1] })
  }
  // 注意排除文件路径：~/.dsh/state/session-superagent/watchers.json 不是路由
  for (const match of text.matchAll(/(?<!state)(\/session-superagent\/[a-z-]+)(?![\w.])/g)) {
    if (!routes.has(match[1])) problems.routes.push({ rel, id: match[1] })
  }
  // 只统计"看起来是本项目版本"的三段式（0.8.x / 0.9.x），避免把 Node 22.x 之类算进来
  for (const match of text.matchAll(/\b(0\.[89]\.\d+)\b/g)) {
    if (cmp(match[1], current) > 0) problems.versions.push({ rel, id: match[1] })
  }
  // 文件路径：全 docs/ 都要能解析（老文档最容易把人带到不存在的文件）
  // 例外：描述**别的仓库**的文档（官方 GUI 源码等），路径本来就不在我们仓库里。
  const lines = text.split(String.fromCharCode(10))
  // 整份文档如果开头就说明"描述的是外部仓库"，就不做本仓库路径检查
  const externalDoc = /官方|prototype|上游|upstream/.test(lines.slice(0, 15).join(String.fromCharCode(10)))
  for (const line of lines) {
    if (externalDoc) break
    if (/官方|prototype|上游|upstream/.test(line)) continue
    for (const match of line.matchAll(/(?:^|[^\w/])((?:scripts|lib|test|src)\/[\w./-]+\.(?:mjs|js))/g)) {
      problems.paths.push({ rel, id: match[1] })
    }
  }
}

const dedupe = (list) => {
  const seen = new Map()
  for (const item of list) {
    if (!seen.has(item.id)) seen.set(item.id, new Set())
    seen.get(item.id).add(item.rel)
  }
  return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

console.log('扫描 ' + files.length + ' 份文档（不含 docs/kb 与 CHANGELOG）')
console.log('当前版本 ' + current + '；代码里 ' + tools.size + ' 个工具 / ' + routes.size + ' 条路由')
console.log('---')

let failed = false
for (const [label, list] of [
  ['工具名', problems.tools],
  ['路由', problems.routes],
  ['版本号', problems.versions],
  ['文件路径', problems.paths.filter((item) => !existsSync(join(root, item.id)))],
]) {
  const grouped = dedupe(list)
  if (grouped.length === 0) {
    console.log('PASS ' + label + '都对得上')
    continue
  }
  failed = true
  console.log('FAIL ' + label + '对不上（' + grouped.length + ' 个）：')
  for (const [id, owners] of grouped.slice(0, 12)) {
    console.log('  ' + id + '  ← ' + [...owners].join(', '))
  }
}

// 字段名只提示：文档里的普通英文单词也会落到这里
if (failed) process.exitCode = 1
