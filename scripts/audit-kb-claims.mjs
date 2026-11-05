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
  // 审核 T25 FN-6：以前要求 ✅ 与版本号**同一行**（[^\n] 排除了换行）。
  // 但知识库里「✅ 已落地」换行再写版本号很常见，那样一条都查不到。
  // 现在允许跨行，但只跨到**下一个空行**为止（避免把下一段的版本号算进来）。
  const versions = [...text.matchAll(/✅(?:(?!\n\s*\n)[\s\S]){0,200}?(\d+\.\d+\.\d+)/g)].map((m) => m[1])
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

// ①.5 内容交叉验证：✅ 版本对应的 CHANGELOG 条目，得真的在讲这件事
//      判据：KB 条目里的反引号标识符至少有一个出现在那条 CHANGELOG 里，
//      否则「已落地」只是一句自述。
const changelogSections = new Map()
for (const match of changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\][^\n]*\n([\s\S]*?)(?=^## \[|\Z)/gm)) {
  changelogSections.set(match[1], match[2])
}
const weakClaims = []
for (const name of files) {
  const text = readFileSync(join(kbDir, name), 'utf8')
  const versionMatch = text.match(/\u2705[^\n]*?(\d+\.\d+\.\d+)/)
  if (!versionMatch) continue
  const version = versionMatch[1]
  const section = changelogSections.get(version)
  if (!section) continue
  const idents = [...text.matchAll(/\`([\w.-]{4,})\`/g)]
    .map((m) => m[1])
    .filter((token) => !['true', 'false', 'null', 'undefined', 'node', 'json', 'text'].includes(token))
  const unique = [...new Set(idents)]
  if (unique.length === 0) continue
  if (!unique.some((token) => section.includes(token))) weakClaims.push({ name, version, sample: unique.slice(0, 3).join(', ') })
}

// 只作提示，不判失败：CHANGELOG 是写给人看的散文，KB 写的是实现细节，
// 两者必然用不同词。实测 109 条里有 8 条对不上标识符，但逐条看都是正常表述差异
// （教训见 KB audit-false-positives.md：判据太松的检查只会制造噪音）。
if (weakClaims.length > 0) {
  console.log('INFO 这些 ✅ 的 CHANGELOG 用词与 KB 的标识符对不上（仅提示，可能是正常表述差异）：')
  for (const item of weakClaims) console.log('  ' + item.version + '  ← docs/kb/' + item.name + '（例如 ' + item.sample + '）')
} else {
  console.log('PASS 每条 ✅ 的 CHANGELOG 里都能找到该 KB 提到的标识符')
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
