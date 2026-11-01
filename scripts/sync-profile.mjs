// 把插件源码目录同步到 profile 的安装副本。
//
// 为什么需要：profile 里是 `file:` 安装 —— pnpm 为**已存在的文件**建了硬链接，
// 所以改内容会自动生效；但**新增文件不会**自动出现。
// 真实事故（2026-11-01 23:59 重启）：新增的 lib/body.js 没进 profile，
// 宿主 import './body.js' 失败 → 整个插件不挂载 → 工具和 HTTP 路由全消失，
// 而客户端 bundle 照常加载，表面看起来"插件还在"。
//
// 用法： node scripts/sync-profile.mjs [profile 安装目录]
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PROFILE = join(
  process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'),
  'profiles',
  'desktop',
  'node_modules',
  'dsh-session-superagent',
)
const DEST = process.argv[2] || DEFAULT_PROFILE

/** 运行时要用的文件（不含 docs / test / scripts 这些开发件）。 */
const TARGETS = [
  'client.js', 'package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE',
  'lib/index.js', 'lib/watch.js', 'lib/redact.js', 'lib/body.js',
]

if (!existsSync(DEST)) {
  console.error('找不到 profile 安装目录：' + DEST)
  process.exit(1)
}

let linked = 0
let skipped = 0
for (const rel of TARGETS) {
  const src = join(ROOT, rel)
  const dst = join(DEST, rel)
  if (!existsSync(src)) continue
  if (existsSync(dst)) {
    const same = statSync(src).ino === statSync(dst).ino
    console.log((same ? 'ok       ' : '注意     ') + rel + (same ? '' : '（inode 不同，内容改动不会同步）'))
    skipped += 1
    continue
  }
  mkdirSync(dirname(dst), { recursive: true })
  try {
    linkSync(src, dst)
    linked += 1
    console.log('linked   ' + rel)
  } catch (error) {
    console.log('link 失败：' + rel + ' — ' + (error && error.message))
  }
}

// lib/ 里每个相对 import 都必须能解析到真实文件（这次事故的直接原因）
const libDir = join(ROOT, 'lib')
const missing = []
for (const name of readdirSync(libDir)) {
  if (!name.endsWith('.js')) continue
  const file = join(libDir, name)
  const code = readFileSync(file, 'utf8')
  for (const m of code.matchAll(/from '(\.[^']+)'/g)) {
    if (!existsSync(join(dirname(file), m[1]))) missing.push(name + ' → ' + m[1])
  }
}

console.log('---')
console.log(`新增链接 ${linked} 个，跳过 ${skipped} 个`)
console.log(`目标：${DEST}`)
if (missing.length > 0) {
  console.error('相对 import 解析失败：' + missing.join(', '))
  process.exit(2)
}
console.log('相对 import 全部可解析 ✓')
