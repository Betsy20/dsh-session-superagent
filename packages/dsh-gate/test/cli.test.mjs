import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempDir, writeJsonFile, writeTextFile } from './helpers.mjs'

const BIN = fileURLToPath(new URL('../bin/gate.mjs', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

function runCli(args, { cwd = PACKAGE_ROOT, input } = {}) {
  const home = tempDir('gate-cli-home-')
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      DSH_SUPERAGENT_STATE: join(home, 'state'),
      DSH_GATE_USER_CONFIG: join(home, 'user-gates.json'),
    },
  })
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, home }
}

function bodyFile(repo, text) {
  const path = join(repo, 'draft.md')
  writeTextFile(path, text)
  return path
}

test('CLI：干净回复 exit 0，输出 PASS', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '已修复：更新 lib/gate.js 并补测试，0.10.2 可验证。')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', '15', '--repo', repo])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /^PASS issue\.reply/)
  assert.match(result.stdout, /无命中/)
  assert.equal(result.stderr, '')
})

test('CLI：含 token exit 1，命中 secret', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, 'token=ghp_' + 'a'.repeat(30))
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', '15', '--repo', repo])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /^FAIL issue\.reply/)
  assert.match(result.stdout, /\[error\] secret/)
})

test('CLI：含本机绝对路径 exit 1，命中 abs-path', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '见 D:\\主工作区\\x.js')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', '15', '--repo', repo])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /\[error\] abs-path/)
})

test('CLI：引用其它 #编号 exit 1，命中 foreign-ref', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '另见 #13。')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', '15', '--repo', repo])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /\[error\] foreign-ref/)
})

test('CLI：只引用当前编号 exit 0', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '本 issue #15 已修复。')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', '15', '--repo', repo])
  assert.equal(result.code, 0)
})

test('CLI：不传 --current 时 foreign-ref 跳过', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '另见 #13。')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--repo', repo])
  assert.equal(result.code, 0)
})

test('CLI：--json 输出结构化结果', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, 'token=ghp_' + 'a'.repeat(30))
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--json', '--repo', repo])
  assert.equal(result.code, 1)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.trigger, 'issue.reply')
  assert.equal(parsed.current, null)
  assert.ok(parsed.hits.some((hit) => hit.id === 'secret'))
  assert.deepEqual(parsed.semantic, { skipped: true })
})

test('CLI：stdin（--body-file -）', () => {
  const repo = tempDir('gate-cli-repo-')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', '-', '--current', '15', '--repo', repo], {
    input: '另见 #13。',
  })
  assert.equal(result.code, 1)
  assert.match(result.stdout, /foreign-ref/)
})

test('CLI：缺 --trigger / 未知 trigger / 缺参数值 都是 exit 2', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '正文')

  const missing = runCli(['--body-file', file, '--repo', repo])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /缺少 --trigger/)

  const unknown = runCli(['--trigger', 'push', '--body-file', file, '--repo', repo])
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /未知 trigger/)

  const noValue = runCli(['--trigger', 'issue.reply', '--body-file'])
  assert.equal(noValue.code, 2)
  assert.match(noValue.stderr, /需要一个值/)
})

test('CLI：正文文件不存在 / --current 非法 都是 exit 2', () => {
  const repo = tempDir('gate-cli-repo-')
  const missing = runCli(['--trigger', 'issue.reply', '--body-file', join(repo, 'nope.md'), '--repo', repo])
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /^gate: /)

  const file = bodyFile(repo, '正文')
  const badCurrent = runCli(['--trigger', 'issue.reply', '--body-file', file, '--current', 'x', '--repo', repo])
  assert.equal(badCurrent.code, 2)
  assert.match(badCurrent.stderr, /--current 必须是数字编号/)
})

test('CLI：项目 .superagent/gates.json 覆盖默认规则', () => {
  const repo = tempDir('gate-cli-repo-')
  writeJsonFile(join(repo, '.superagent', 'gates.json'), {
    version: 1,
    name: 'project',
    rules: [
      {
        id: 'no-banana',
        label: '禁止香蕉',
        type: 'contains',
        value: 'banana',
        triggers: ['issue.reply'],
        message: '不要提香蕉',
      },
    ],
  })
  const file = bodyFile(repo, '我要 banana')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--repo', repo])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /no-banana/)
})

test('CLI：--config 直接使用一份配置', () => {
  const repo = tempDir('gate-cli-repo-')
  const configPath = join(repo, 'gate-config.json')
  writeJsonFile(configPath, {
    version: 1,
    rules: [
      {
        id: 'only-this',
        label: '只允许这个',
        type: 'contains',
        value: 'forbidden',
        triggers: ['issue.reply'],
        message: '命中',
      },
    ],
  })
  const file = bodyFile(repo, 'forbidden')
  const result = runCli(['--trigger', 'issue.reply', '--body-file', file, '--config', configPath, '--repo', repo])
  assert.equal(result.code, 1)
  assert.match(result.stdout, /only-this/)
})

test('CLI：--semantic 在语义复审关闭时安全跳过', () => {
  const repo = tempDir('gate-cli-repo-')
  const file = bodyFile(repo, '合并说明：无凭证。')
  const result = runCli(['--trigger', 'merge', '--body-file', file, '--semantic', '--json', '--repo', repo])
  assert.equal(result.code, 0)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.semantic.skipped, true)
})

test('CLI：--help exit 0 并打印用法', () => {
  const result = runCli(['--help'])
  assert.equal(result.code, 0)
  assert.match(result.stdout, /用法: dsh-gate/)
  assert.match(result.stdout, /退出码: 0 通过 \| 1 未通过 \| 2 用法或配置错误/)
})
