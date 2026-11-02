// 真机踩过的形态：我们 rmSync 掉孤儿目录后，git 的 worktrees/<id>/ 管理文件还在，
// 于是 `git worktree list` 一直显示一个已经不存在的目录。
// 这条用例用一个真 git 仓库把「删目录 → prune → list 干净」跑一遍。
import { execFileSync } from 'node:child_process'
import { tempDir } from './fixtures/tmpdir.mjs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('孤儿目录删掉后，git worktree prune 能把管理记录清干净', () => {
  const root = tempDir('zhuli-prune-')
  try {
    git(root, ['init', '-q'])
    git(root, ['config', 'user.email', 't@t.t'])
    git(root, ['config', 'user.name', 't'])
    writeFileSync(join(root, 'a.txt'), 'x')
    git(root, ['add', '.'])
    git(root, ['commit', '-qm', 'init'])

    const wt = join(root, '.dsh-zhuli', 'one')
    mkdirSync(join(root, '.dsh-zhuli'), { recursive: true })
    git(root, ['worktree', 'add', '-q', '-b', 'zhuli/one', wt])
    assert.match(git(root, ['worktree', 'list']), /\.dsh-zhuli/, 'worktree 建好了')

    // 模拟「目录被手动删掉，管理记录还在」
    rmSync(wt, { recursive: true, force: true })
    assert.match(git(root, ['worktree', 'list']), /\.dsh-zhuli/, '此时 list 仍然显示已不存在的目录（就是真机那个现象）')

    git(root, ['worktree', 'prune'])
    assert.doesNotMatch(git(root, ['worktree', 'list']), /\.dsh-zhuli/, 'prune 之后 list 才干净')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
