// 隔离执行真机演练（不需要 DSH 宿主，只需要 git）：在本机临时仓库里把
// 「开 worktree → 改文件 → 提交 → 回收」整条链路真跑一遍。
//
// 为什么需要：唤醒消息里写着"在隔离工作区里改，推分支开 PR"，但这条链路一直没有被真实验证 ——
// 之前只有"读过代码"和"worktree list 里出现过目录"。这个脚本把每一步都跑出来并打印。
//
// 用法：node scripts/verify-isolation.mjs
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { staleWorktrees } from '../lib/watch.js'

const steps = []
let failed = 0
const step = (name, ok, detail) => {
  steps.push({ name, ok, detail })
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '　' + detail : ''))
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
const tryGit = (cwd, args) => {
  try {
    return { ok: true, out: git(cwd, args) }
  } catch (error) {
    return { ok: false, out: String((error && error.stdout) || '') + String((error && error.stderr) || '') }
  }
}

const root = mkdtempSync(join(tmpdir(), 'zhuli-iso-'))
const repo = join(root, 'repo')
const isoDir = join(repo, '.dsh-zhuli', 'zhuli-demo')
const branch = 'zhuli/demo'

try {
  // 1. 造一个最小仓库
  execFileSync('git', ['init', '-q', repo], { windowsHide: true })
  git(repo, ['config', 'user.name', 'zhuli'])
  git(repo, ['config', 'user.email', 'zhuli@example.invalid'])
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'init'])
  step('临时仓库就绪', existsSync(join(repo, '.git')), repo)

  // 2. 开隔离工作区（产品的真实命令形状）
  const added = tryGit(repo, ['worktree', 'add', isoDir, '-b', branch])
  step('开隔离工作区', added.ok && existsSync(isoDir), added.ok ? isoDir.replace(root, '<tmp>') : added.out.slice(0, 120))

  // 3. 在隔离区里改文件并提交（模拟会话干活）
  if (added.ok) {
    writeFileSync(join(isoDir, 'README.md'), '# demo\n\n修好了，见 issue #42\n')
    git(isoDir, ['add', '-A'])
    git(isoDir, ['commit', '-qm', 'fix: #42'])
    const log = git(isoDir, ['log', '--oneline', '-1']).trim()
    step('隔离区里能改能提交', log.includes('#42'), log)
    const mainUntouched = readFileSync(join(repo, 'README.md'), 'utf8') === '# demo\n'
    step('主工作区没被污染', mainUntouched, mainUntouched ? 'README.md 仍是原样' : '主工作区被改了！')
  }

  // 4. 回收：worktree remove + 分支删除
  const removed = tryGit(repo, ['worktree', 'remove', '--force', isoDir])
  const listed = git(repo, ['worktree', 'list']).trim().split(String.fromCharCode(10))
  step('回收隔离区', removed.ok && !existsSync(isoDir), listed.length + ' 个 worktree')
  // 实测：worktree remove **不会**删分支 —— 产品里是显式再跑一次 branch -D，这里照做并验证
  const branchBefore = git(repo, ['branch', '--list', branch]).trim()
  const del = tryGit(repo, ['branch', '-D', branch])
  const branchAfter = git(repo, ['branch', '--list', branch]).trim()
  step('回收后分支仍在（remove 不管分支）', Boolean(branchBefore) && branchAfter !== branchBefore, branchBefore.replace(/^\s*/, ''))
  step('显式删分支才真的清掉', del.ok && !branchAfter, del.ok ? branch + ' 已删除' : del.out.slice(0, 100))

  // 5. 数量线：8 个副本里只留最近 5 个（不真的建副本，直接喂给纯函数）
  const now = Date.now()
  const entries = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ name: 'wt' + i, mtimeMs: now - i * 60_000 }))
  const stale = staleWorktrees(entries, { now, keepMs: 3 * 86400_000, keepCount: 5 })
  step('数量线回收最旧的 3 个', stale.length === 3, stale.map((e) => e.name).join(','))

  // 6. 孤儿目录：被手工删掉的 worktree，prune 后不再出现在列表里
  const orphan = join(repo, '.dsh-zhuli', 'zt-ghost')
  git(repo, ['worktree', 'add', orphan, '-b', 'zhuli/ghost'])
  rmSync(orphan, { recursive: true, force: true })
  git(repo, ['worktree', 'prune'])
  const after = git(repo, ['worktree', 'list'])
  step('孤儿目录 prune 后不再挂着', !after.includes('zt-ghost'), after.trim().split(String.fromCharCode(10)).length + ' 个 worktree')
} finally {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch { /* 临时目录删不掉不影响结论 */ }
}

console.log('---')
console.log(failed === 0 ? 'PASS 隔离链路 ' + steps.length + ' 步全部通过' : 'FAIL ' + failed + ' 步失败')
if (failed > 0) process.exitCode = 1
