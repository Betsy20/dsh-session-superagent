// 文档里提到的「工具名 / 路由 / 面板小节」必须真的存在。
//
// 为什么需要：README 与 docs 里的标识符是客户会照着敲的；重构改名后文档不会报错，
// 只有人去试才发现。版本号与链接已有门禁，这里补的是**标识符**。
//
// 用法：node scripts/audit-claims-consistency.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const index = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
const client = readFileSync(join(root, 'client.js'), 'utf8')

// 真实存在的工具与路由
const tools = new Set([...index.matchAll(/name: '(watch_[a-z_]+)'/g)].map((m) => m[1]))
const routes = new Set([...index.matchAll(/path: '(\/session-superagent\/[a-z-]+)'/g)].map((m) => m[1]))

// 面板里真实存在的小节标题
const sectionTitles = new Set([...client.matchAll(/title: '([^']{2,24})'/g)].map((m) => m[1]))

// 要检查的文档
const docs = ['README.md', 'MAINTENANCE.md', 'HANDOFF.md', 'docs/whats-new-0.9.md', 'docs/optimization-plan.md']
  .filter((name) => { try { readFileSync(join(root, name)); return true } catch { return false } })

const mentionsTools = []
const mentionsRoutes = []
const mentionsSections = []

for (const name of docs) {
  const text = readFileSync(join(root, name), 'utf8')
  for (const match of text.matchAll(/`?(watch_[a-z_]+)`?/g)) mentionsTools.push({ doc: name, id: match[1] })
  for (const match of text.matchAll(/`(\/session-superagent\/[a-z-]+)`/g)) mentionsRoutes.push({ doc: name, id: match[1] })
  for (const match of text.matchAll(/「([^」]{2,12})」/g)) mentionsSections.push({ doc: name, id: match[1] })
}

const badTools = [...new Set(mentionsTools.map((m) => m.id))].filter((id) => !tools.has(id))
const badRoutes = [...new Set(mentionsRoutes.map((m) => m.id))].filter((id) => !routes.has(id))
// 小节标题只警告不失败：文档里的「」多是引用概念，不一定是我们面板的标题
const unknownSections = [...new Set(mentionsSections.map((m) => m.id))]
  .filter((id) => !sectionTitles.has(id))

console.log('工具 ' + tools.size + ' 个：' + [...tools].join(' '))
console.log('路由 ' + routes.size + ' 条')
console.log('文档提到的工具 ' + new Set(mentionsTools.map((m) => m.id)).size + ' 个 / 路由 ' + new Set(mentionsRoutes.map((m) => m.id)).size + ' 条')
console.log('---')

let failed = false
if (badTools.length > 0) {
  failed = true
  console.log('FAIL 文档里提到但不存在的工具：' + badTools.join('、'))
  for (const id of badTools) {
    const owners = [...new Set(mentionsTools.filter((m) => m.id === id).map((m) => m.doc))]
    console.log('  ' + id + '  ← ' + owners.join(', '))
  }
} else {
  console.log('PASS 文档里提到的工具名都真实存在')
}

if (badRoutes.length > 0) {
  failed = true
  console.log('FAIL 文档里提到但不存在（或已改名）的路由：' + badRoutes.join('、'))
} else {
  console.log('PASS 文档里提到的路由都真实存在')
}

if (unknownSections.length > 0) {
  console.log('提示 这些「」不是面板小节标题（多半是概念引用，正常）：' + unknownSections.slice(0, 8).join('、') + (unknownSections.length > 8 ? ' …' : ''))
}

if (failed) process.exitCode = 1
