// 把插件源码目录同步到 profile 的安装副本。
//
// 为什么需要：profile 里是 `file:` 安装 —— pnpm 为**已存在的文件**建了硬链接，
// 改内容会自动生效；但**新增文件不会**自动出现，而**被原子写入替换的文件会断链**。
//
// 真实事故 1（2026-11-01 23:59 重启）：新增的 lib/body.js 没进 profile，
//   宿主 import './body.js' 失败 → 整个插件不挂载 → 工具和 HTTP 路由全消失，
//   客户端 bundle 却照常加载，表面看起来"插件还在"。
// 真实事故 2（潜伏）：某些工具用「写临时文件再 rename」保存，profile 里那份仍是旧 inode，
//   于是宿主跑的是旧代码，而仓库里看着已经是新代码。
//
// 用法：
//   node scripts/sync-profile.mjs            补齐缺失文件（不动断链，只警告）
//   node scripts/sync-profile.mjs --repair   断链也重建硬链接，并清理 profile 里的陈旧文件
//   node scripts/sync-profile.mjs --check    只检查：有缺失/断链/陈旧就 exit 1（给 CI 用）
//   node scripts/sync-profile.mjs --dir <path>  指定 profile 安装目录
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const REPAIR = args.includes('--repair')
const CHECK = args.includes('--check')
const dirFlag = args.indexOf('--dir')
const DEFAULT_PROFILE = join(
  process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'),
  'profiles',
  'desktop',
  'node_modules',
  'dsh-session-superagent',
)
const DEST = dirFlag >= 0 ? args[dirFlag + 1] : DEFAULT_PROFILE

/** 运行时要用的文件（不含 docs / test / scripts 这些开发件）。 */
const TARGETS = [
  'client.js', 'package.json', 'cordis.patch.yml', 'README.md', 'CHANGELOG.md', 'LICENSE',
  'lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/gitee.js', 'lib/redact.js', 'lib/body.js', 'lib/state-migration.js',
]

if (!existsSync(DEST)) {
  console.error('找不到 profile 安装目录：' + DEST)
  process.exit(1)
}

const drift = { missing: [], broken: [], stale: [] }
let linked = 0

for (const rel of TARGETS) {
  const src = join(ROOT, rel)
  const dst = join(DEST, rel)
  if (!existsSync(src)) continue
  if (!existsSync(dst)) {
    drift.missing.push(rel)
    if (!CHECK) {
      mkdirSync(dirname(dst), { recursive: true })
      try { linkSync(src, dst); linked += 1; console.log('linked   ' + rel) } catch (error) {
        console.log('link 失败：' + rel + ' — ' + (error && error.message))
      }
    }
    continue
  }
  const same = statSync(src).ino === statSync(dst).ino
  if (same) continue
  drift.broken.push(rel)
  if (REPAIR && !CHECK) {
    try {
      unlinkSync(dst)
      linkSync(src, dst)
      linked += 1
      console.log('relinked ' + rel + '（原来断了）')
    } catch (error) {
      console.log('重建失败：' + rel + ' — ' + (error && error.message))
    }
  } else {
    console.log('注意     ' + rel + '（inode 不同：内容改动不会同步到 profile，用 --repair 重建）')
  }
}

// 陈旧文件：profile 里有、仓库里已经没有（例如删掉的模块）
for (const name of readdirSync(join(DEST, 'lib')).filter((f) => f.endsWith('.js'))) {
  if (!existsSync(join(ROOT, 'lib', name))) {
    drift.stale.push('lib/' + name)
    if (REPAIR && !CHECK) {
      try { unlinkSync(join(DEST, 'lib', name)); console.log('pruned   lib/' + name) } catch {}
    } else {
      console.log('陈旧     lib/' + name + '（仓库已删除，profile 里还在）')
    }
  }
}

// lib/ 里每个相对 import 都必须能解析（这正是事故 1 的直接原因）
const libDir = join(ROOT, 'lib')
const missingImports = []
for (const name of readdirSync(libDir)) {
  if (!name.endsWith('.js')) continue
  const code = readFileSync(join(libDir, name), 'utf8')
  for (const line of code.split(String.fromCharCode(10))) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('import ')) continue
    const at = trimmed.lastIndexOf("from '")
    let spec = null
    if (at >= 0) {
      spec = trimmed.slice(at + 6).split("'")[0]
    } else if (trimmed.slice('import '.length).startsWith("'")) {
      spec = trimmed.slice('import '.length + 1).split("'")[0]
    }
    if (spec && spec.startsWith('.') && !existsSync(join(libDir, spec))) {
      missingImports.push(name + ' -> ' + spec)
    }
  }
}

const drifted = drift.missing.length + drift.broken.length + drift.stale.length
console.log('---')
console.log(`目标：${DEST}`)
console.log(`缺失 ${drift.missing.length} / 断链 ${drift.broken.length} / 陈旧 ${drift.stale.length}` +
  (linked ? `，本次处理 ${linked} 个` : ''))

if (missingImports.length > 0) {
  console.error('相对 import 解析失败：' + missingImports.join(', '))
  process.exit(2)
}
console.log('相对 import 全部可解析 ✓')

if (CHECK && drifted > 0) {
  console.error('profile 与仓库不一致（跑 --repair 修）')
  process.exit(1)
}
