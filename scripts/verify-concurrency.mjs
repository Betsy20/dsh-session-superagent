// 并发隔离演练：两个会话同时对一个仓库开隔离区会怎样。
//
// 为什么需要：产品允许多个会话守同一个仓库（或多条守指向同一仓库）。
// git worktree 天生隔离目录，但"互不影响"这句话需要证明给我们自己看；
// 更重要的是要知道**隔离的边界在哪** —— 提交到同一分支/同一文件会怎样。
//
// 用法：node scripts/verify-concurrency.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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

const root = mkdtempSync(join(tmpdir(), 'zhuli-conc-'))
const repo = join(root, 'repo')
const wtA = join(repo, '.dsh-zhuli', 'zhuli-a')
const wtB = join(repo, '.dsh-zhuli', 'zhuli-b')
const shared = 'src/shared.txt'

try {
  execFileSync('git', ['init', '-q', repo], { windowsHide: true })
  git(repo, ['config', 'user.name', 'zhuli'])
  git(repo, ['config', 'user.email', 'zhuli@example.invalid'])
  execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'false'], { windowsHide: true })
  mkdirSync(dirname(join(repo, shared)), { recursive: true })
  writeFileSync(join(repo, shared), 'line1\nline2\nline3\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'init'])
  const base = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  step('临时仓库就绪', existsSync(join(repo, '.git')), repo.replace(root, '<tmp>') + '（主线 ' + base + '）')

  // 两个会话各自开隔离区，改同一个文件
  git(repo, ['worktree', 'add', wtA, '-b', 'zhuli/a'])
  git(repo, ['worktree', 'add', wtB, '-b', 'zhuli/b'])
  step('两个隔离区并存', existsSync(wtA) && existsSync(wtB), 'zhuli/a + zhuli/b')

  // 产品行为：开隔离区前会把 .dsh-zhuli/ 写进 .git/info/exclude，避免污染客户的 git status
  const excludePath = join(repo, '.git', 'info', 'exclude')
  const NL = String.fromCharCode(10)
  const excludeText = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  if (!excludeText.includes('.dsh-zhuli/')) {
    writeFileSync(excludePath, excludeText + (excludeText.endsWith(NL) || excludeText === '' ? '' : NL) + '.dsh-zhuli/' + NL)
  }
  const dirty = tryGit(repo, ['status', '--porcelain']).out.trim()
  step('.dsh-zhuli 不污染 git status', dirty === '', dirty === '' ? 'status 干净' : dirty.slice(0, 80))

  writeFileSync(join(wtA, shared), 'line1\nA 改的\nline3\n')
  writeFileSync(join(wtB, shared), 'line1\nB 改的\nline3\n')
  const a = readFileSync(join(wtA, shared), 'utf8')
  const b = readFileSync(join(wtB, shared), 'utf8')
  step('各自改同一文件互不干扰', a !== b && a.includes('A 改的') && b.includes('B 改的'), 'A 与 B 内容不同')

  // A 提交后，B 的头和内容都不该变
  git(wtA, ['add', '-A'])
  git(wtA, ['commit', '-qm', 'A: 改 shared'])
  const bHead = git(wtB, ['log', '--oneline', '-1']).trim()
  const bStillMine = readFileSync(join(wtB, shared), 'utf8').includes('B 改的')
  step('A 提交不影响 B 的工作区', bStillMine, bHead)

  git(wtB, ['add', '-A'])
  git(wtB, ['commit', '-qm', 'B: 改 shared'])
  const aHash = git(wtA, ['rev-parse', 'HEAD']).trim()
  const bHash = git(wtB, ['rev-parse', 'HEAD']).trim()
  step('两条分支各自独立提交', aHash !== bHash, aHash.slice(0, 8) + ' vs ' + bHash.slice(0, 8))

  // 关键：把两条分支都合进主线，同文件同区域必然冲突 —— 这就是产品要提醒客户的边界
  git(repo, ['checkout', '-q', base])
  const mergeA = tryGit(repo, ['merge', '--no-ff', 'zhuli/a', '-m', 'merge A'])
  const mergeB = tryGit(repo, ['merge', '--no-ff', 'zhuli/b', '-m', 'merge B'])
  step('先合的能进', mergeA.ok, mergeA.ok ? 'zhuli/a 已合入' : mergeA.out.slice(0, 100))
  step('后合的会冲突（同文件同区域）', !mergeB.ok && /CONFLICT|conflict/i.test(mergeB.out), mergeB.ok ? '居然没冲突' : '自动检测为冲突，符合预期')
  if (!mergeB.ok) {
    const status = tryGit(repo, ['merge', '--abort'])
    step('冲突可中止，仓库回到干净状态', status.ok && !tryGit(repo, ['status', '--porcelain']).out.trim(), status.ok ? '已 merge --abort' : status.out.slice(0, 100))
  }
} finally {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch { /* 临时目录删不掉不影响结论 */ }
}

console.log('---')
console.log(failed === 0 ? 'PASS 并发隔离 ' + steps.length + ' 步全部通过' : 'FAIL ' + failed + ' 步失败')
if (failed > 0) process.exitCode = 1
