import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_GATE_PATH,
  LOCAL_GATE_PATH,
  PROJECT_GATE_PATH,
  USER_GATE_PATH,
  localGatePath,
  projectGatePath,
  readGateScope,
  userGatePath,
  validateConfig,
  writeGateConfig,
} from '../lib/index.js'
import { tempDir, writeJsonFile, writeTextFile } from '../test-support/helpers.mjs'

const validRule = (id = 'custom') => ({
  id,
  label: '自定义',
  type: 'contains',
  value: '禁止词',
  triggers: ['issue.reply'],
  message: '命中',
})

test('validateConfig 接受合法配置并返回整理后的形状', () => {
  const checked = validateConfig({ version: 1, name: 'x', rules: [validRule()] })
  assert.equal(checked.ok, true)
  assert.equal(checked.config.rules[0].id, 'custom')
  assert.equal(checked.config.rules[0].severity, 'error')
})

test('validateConfig 拒绝非对象 / 缺 rules / 非数组', () => {
  assert.equal(validateConfig(null).ok, false)
  assert.equal(validateConfig([]).ok, false)
  assert.equal(validateConfig('x').ok, false)
  assert.equal(validateConfig({}).ok, false)
  assert.equal(validateConfig({ rules: {} }).ok, false)
})

test('validateConfig 拒绝非法 id 与重复 id', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), id: 'Bad' }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), id: 'a' }] }).ok, false)
  assert.equal(validateConfig({ rules: [validRule('a'), validRule('a')] }).ok, false)
})

test('validateConfig 拒绝未知类型与非法 severity', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'nope' }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), severity: 'fatal' }] }).ok, false)
})

test('validateConfig 拒绝空 triggers 与未知 trigger', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), triggers: [] }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), triggers: ['push'] }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), triggers: 'issue.reply' }] }).ok, false)
})

test('validateConfig 拒绝缺失 / 非法 / 过长的正则', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'regex' }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'regex', pattern: '(' }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'regex', pattern: 'a'.repeat(401) }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'regex', pattern: 'a', flags: 'zz' }] }).ok, false)
})

test('validateConfig 拒绝缺失 value 的 contains / maxLength', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'contains', value: '' }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'contains', value: 1 }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'maxLength', value: 0 }] }).ok, false)
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'maxLength', value: 'x' }] }).ok, false)
})

test('validateConfig 拒绝非法 foreign-ref pattern', () => {
  assert.equal(validateConfig({ rules: [{ ...validRule(), type: 'foreign-ref', pattern: '(' }] }).ok, false)
})

test('validateConfig 拒绝非法 semantic 段', () => {
  assert.equal(validateConfig({ rules: [], semantic: [] }).ok, false)
  assert.equal(validateConfig({ rules: [], semantic: 'on' }).ok, false)
  assert.equal(validateConfig({ rules: [], semantic: { mode: 'nope' } }).ok, false)
  assert.equal(validateConfig({ rules: [], semantic: { timeoutMs: 0 } }).ok, false)
  assert.equal(validateConfig({ rules: [], semantic: { maxInputChars: -1 } }).ok, false)
  assert.equal(validateConfig({ rules: [], semantic: { enabled: false } }).ok, true)
})

test('writeGateConfig 写项目层：生成文件与 .bak，且没有临时文件残留', () => {
  const repo = tempDir('gate-write-')
  const home = tempDir('gate-home-')
  const path = projectGatePath(repo)
  writeTextFile(path, '{"version":1,"rules":[]}\n')
  const saved = writeGateConfig('project', { version: 1, rules: [validRule('zz')] }, { repo, home, env: {} })
  assert.equal(saved.path, path)
  assert.ok(readFileSync(path, 'utf8').includes('"zz"'))
  assert.ok(readFileSync(path + '.bak', 'utf8').includes('"rules"'))
  const leftovers = readdirSync(join(repo, '.superagent')).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).rules.length, 1)
})

test('writeGateConfig 写用户层会创建目录，并遵循 DSH_GATE_USER_CONFIG 覆盖', () => {
  const home = tempDir('gate-home-')
  const custom = join(tempDir('gate-user-'), 'nested', 'gates.json')
  const saved = writeGateConfig('user', { version: 1, rules: [validRule('user-rule')] }, {
    home,
    env: { DSH_GATE_USER_CONFIG: custom },
  })
  assert.equal(saved.path, custom)
  assert.ok(existsSync(custom))
  assert.equal(userGatePath({ home, env: { DSH_GATE_USER_CONFIG: custom } }), custom)
  assert.equal(userGatePath({ home, env: {} }), join(home, '.dsh', 'state', 'session-superagent', 'gates.json'))
})

test('writeGateConfig 写本地层', () => {
  const repo = tempDir('gate-write-')
  const home = tempDir('gate-home-')
  const saved = writeGateConfig('local', { version: 1, rules: [validRule('local')] }, { repo, home, env: {} })
  assert.ok(saved.path.endsWith(join('.superagent', 'gates.local.json')))
  assert.ok(existsSync(saved.path))
})

test('writeGateConfig 不会凭空写默认语义字段', () => {
  const repo = tempDir('gate-write-')
  const home = tempDir('gate-home-')
  const saved = writeGateConfig('project', { version: 1, rules: [], semantic: { mode: 'block' } }, { repo, home, env: {} })
  const written = JSON.parse(readFileSync(saved.path, 'utf8'))
  assert.deepEqual(written.semantic, { mode: 'block' })
})

test('writeGateConfig 拒绝 default scope 与非法配置', () => {
  const repo = tempDir('gate-write-')
  const home = tempDir('gate-home-')
  assert.throws(() => writeGateConfig('default', { rules: [] }, { repo, home, env: {} }), /scope 只能是/)
  assert.throws(() => writeGateConfig('user', { rules: [{ id: 'Bad' }] }, { repo, home, env: {} }), /规则 id 非法/)
})

test('readGateScope 读默认层与不存在的层', () => {
  const repo = tempDir('gate-repo-')
  const home = tempDir('gate-home-')
  const fallback = readGateScope('default', { repo, home, env: {} })
  assert.equal(fallback.path, DEFAULT_GATE_PATH)
  assert.equal(fallback.config.rules.length, 10)

  const missing = readGateScope('project', { repo, home, env: {} })
  assert.equal(missing.config, null)
})

test('readGateScope 读回写入的项目层', () => {
  const repo = tempDir('gate-repo-')
  const home = tempDir('gate-home-')
  writeJsonFile(projectGatePath(repo), { version: 1, name: 'project', rules: [validRule('p')] })
  const scope = readGateScope('project', { repo, home, env: {} })
  assert.equal(scope.config.name, 'project')
  assert.equal(scope.config.rules[0].id, 'p')
})

test('readGateScope 遇到坏 JSON 返回 config:null 与 error', () => {
  const repo = tempDir('gate-repo-')
  const home = tempDir('gate-home-')
  writeTextFile(projectGatePath(repo), '{ broken')
  const scope = readGateScope('project', { repo, home, env: {} })
  assert.equal(scope.config, null)
  assert.ok(/合法 JSON/.test(scope.error))
})

test('readGateScope 拒绝未知 scope', () => {
  assert.throws(() => readGateScope('nope'), /scope 只能是/)
})

test('兼容旧导出名 USER_GATE_PATH / PROJECT_GATE_PATH / LOCAL_GATE_PATH', () => {
  assert.equal(USER_GATE_PATH, userGatePath)
  assert.equal(PROJECT_GATE_PATH, projectGatePath)
  assert.equal(LOCAL_GATE_PATH, localGatePath)
})
