// 知识库的 ✅ 不能只靠自己声称：每个 ✅ x.y.z 都要能在 CHANGELOG 里找到对应版本。
//
// 为什么需要：KB 是"我们学过什么、落地了什么"的唯一索引。如果它写着 ✅ 0.9.22，
// 而 CHANGELOG 里根本没有这个版本，那这条结论就是无据的 —— 而且没人会发现。
//
// 用法：node scripts/audit-kb-claims.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kbDir = join(root, 'docs', 'kb')

const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const released = new Set([...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]))

const files = readdirSync(kbDir).filter((name) => name.endsWith('.md') && name !== 'README.md')
const claims = []
const noClaim = []

for (const name of files) {
  const text = readFileSync(join(kbDir, name), 'utf8')
  const versions = [...text.matchAll(/✅[^\n]*?(\d+\.\d+\.\d+)/g)].map((m) => m[1])
  // "写了落地状态"：有专门的段落，或明确写了未落地 —— 不要求必须有 ✅ + 版本号
  const statesStatus = text.includes('是否已落地') || text.includes('未落地')
  if (!statesStatus) noClaim.push(name)
  for (const version of versions) claims.push({ name, version })
}

const unknown = claims.filter((c) => !released.has(c.version))

console.log('知识库文档        ' + files.length + ' 篇')
console.log('CHANGELOG 版本    ' + released.size + ' 个（最新 ' + [...released][0] + '）')
console.log('✅ 声明            ' + claims.length + ' 条')
console.log('没写落地状态的     ' + noClaim.length + ' 篇')
console.log('---')

for (const item of noClaim) console.log('  没写落地状态：docs/kb/' + item)

let failed = false
if (unknown.length > 0) {
  failed = true
  console.log('FAIL 这些 ✅ 宣称的版本在 CHANGELOG 里找不到：')
  for (const item of unknown) console.log('  ' + item.version + '  ← docs/kb/' + item.name)
} else {
  console.log('PASS 所有 ✅ 的版本都能在 CHANGELOG 找到对应发布')
}

if (noClaim.length > 0) {
  console.log('WARN ' + noClaim.length + ' 篇没有写"是否已落地"（KB 的固定格式要求这一项）')
  failed = true
}

// ② 文件路径交叉验证：KB 里提到的脚本/源码路径必须真的存在
//    重构改名后 KB 常留旧路径，这类漂移完全可自动检测。
const pathClaims = []
for (const name of files) {
  const text = readFileSync(join(kbDir, name), 'utf8')
  for (const match of text.matchAll(/(?:^|[^\w/])((?:scripts|lib|test|src|docs)\/[\w./-]+\.(?:mjs|js|md|yml|json))(?!\w)/g)) {
    pathClaims.push({ name, path: match[1] })
  }
}
const allPaths = new Set(pathClaims.map((c) => c.path))
const missingPaths = [...allPaths].filter((item) => !existsSync(join(root, item)))
console.log('提到的文件路径    ' + allPaths.size + ' 个')
if (missingPaths.length > 0) {
  failed = true
  console.log('FAIL 这些路径在仓库里不存在（重构后忘了改 KB）：')
  for (const missing of missingPaths) {
    const owners = [...new Set(pathClaims.filter((c) => c.path === missing).map((c) => c.name))]
    console.log('  ' + missing + '  <- ' + owners.join(', '))
  }
} else {
  console.log('PASS KB 提到的每个文件路径都真实存在')
}

if (failed) process.exitCode = 1
