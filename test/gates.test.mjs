// 门禁单测（G2）：实现已经搬到独立包 `@mycf711/dsh-gate`，主插件只保留兼容层。
//
// 这个文件守两件事：
// 1. `lib/gates.js` 的旧导出面**还在**，而且指向包里的同一个函数（不是又抄了一份实现）；
// 2. 抽取后的行为不回归：默认规则、四层配置、写盘、语义复审、提示词润色、模型列表。
//
// 所有用例都用临时 home / 临时 repo：不许读到本机真实的 ~/.dsh 门禁配置。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from './fixtures/tmpdir.mjs'

// 旧调用点走兼容层；真身是独立包（npm workspaces link 的那份）。
import * as compat from '../lib/gates.js'
import * as gate from '@mycf711/dsh-gate'

const {
  loadGateConfig,
  lintText,
  semanticReview,
  optimizePrompt,
  listModels,
  readGateScope,
  writeGateConfig,
  validateConfig,
  createGate,
} = compat

/** 隔离的真机状态：临时 home + 不继承进程里的 DSH_* 覆盖。 */
const isolated = () => ({ home: tempDir('gate-home-'), env: {} })
const isolatedRepo = () => {
  const repo = tempDir('gate-repo-')
  mkdirSync(join(repo, '.superagent'), { recursive: true })
  return repo
}

test('lib/gates.js 只是 re-export：每个旧名字都指向包里的同一个函数', () => {
  const names = [
    'loadGateConfig', 'lintText', 'semanticReview', 'optimizePrompt', 'listModels',
    'readGateScope', 'writeGateConfig', 'validateConfig', 'normalizeConfig', 'mergeConfig', 'createGate',
  ]
  for (const name of names) {
    assert.equal(typeof compat[name], 'function', '兼容层缺导出：' + name)
    assert.equal(compat[name], gate[name], name + ' 不是包里的同一个函数 —— 说明又抄了一份实现')
  }
  assert.equal(compat.DEFAULT_GATE_PATH, gate.DEFAULT_GATE_PATH, '默认规则必须读包里的 gates/default.json')
  assert.equal(compat.PROJECT_GATE_PATH, gate.projectGatePath, '项目层路径函数要逐字兼容')
  assert.equal(compat.USER_GATE_PATH, gate.userGatePath, '用户层路径函数要逐字兼容')
})

test('lib/gates.js 里没有门禁规则实现（只有 import/export）', () => {
  const src = readFileSync(new URL('../lib/gates.js', import.meta.url), 'utf8')
  assert.ok(!/from 'node:fs'/.test(src), '兼容层不该自己读文件')
  assert.ok(!/readFileSync\(/.test(src), '兼容层不该自己读配置')
  assert.ok(!/new RegExp\(/.test(src), '兼容层不该自己编译规则')
})

test('默认门禁能抓到凭证、本机路径、无关引用', () => {
  const { config, sources } = loadGateConfig({ repo: isolatedRepo(), ...isolated() })
  assert.ok(config.rules.length >= 8, '默认规则至少 8 条，实际 ' + config.rules.length)
  assert.deepEqual(sources.map((item) => item.name), ['default'], '干净仓库只该读到默认层')
  const bad = lintText(String.raw`见 D:\主工作区\x，token=ghp_` + 'a'.repeat(30) + '，另见 #13', config, { trigger: 'issue.reply', current: 15 })
  assert.equal(bad.ok, false)
  assert.ok(bad.hits.some((hit) => hit.id === 'secret'))
  assert.ok(bad.hits.some((hit) => hit.id === 'abs-path'))
  assert.ok(bad.hits.some((hit) => hit.id === 'foreign-ref'))
})

test('干净回复通过，且只引用当前编号', () => {
  const { config } = loadGateConfig({ repo: isolatedRepo(), ...isolated() })
  assert.equal(lintText('本 issue #15 已修复，0.10.2 可验证。', config, { trigger: 'issue.reply', current: 15 }).ok, true)
})

test('项目门禁同 id 覆盖、不同 id 追加', () => {
  const repo = isolatedRepo()
  try {
    writeFileSync(join(repo, '.superagent', 'gates.json'), JSON.stringify({
      version: 1,
      rules: [
        { id: 'custom', label: '自定义', type: 'contains', value: '禁止词', triggers: ['issue.reply'], message: '命中' },
        { id: 'empty', label: '空回复改文案', type: 'nonEmpty', triggers: ['issue.reply'], message: '项目层覆盖了默认文案' },
      ],
    }), 'utf8')
    const { config, sources } = loadGateConfig({ repo, ...isolated() })
    assert.deepEqual(sources.map((item) => item.name), ['default', 'project'])
    assert.ok(config.rules.some((rule) => rule.id === 'custom'))
    assert.equal(lintText('这里有禁止词', config, { trigger: 'issue.reply', current: 15 }).ok, false)
    const emptyHit = lintText('   ', config, { trigger: 'issue.reply' }).hits.find((hit) => hit.id === 'empty')
    assert.equal(emptyHit.message, '项目层覆盖了默认文案', '同 id 必须覆盖，不是追加第二条')
    assert.equal(config.rules.filter((rule) => rule.id === 'empty').length, 1)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('写项目门禁会备份并原子替换', () => {
  const repo = isolatedRepo()
  try {
    writeFileSync(join(repo, '.superagent', 'gates.json'), '{"version":1,"rules":[]}', 'utf8')
    writeGateConfig('project', { version: 1, rules: [{ id: 'xx', label: 'x', type: 'contains', value: 'x', triggers: ['issue.reply'], message: 'x' }] }, { repo })
    const path = join(repo, '.superagent', 'gates.json')
    assert.ok(readFileSync(path, 'utf8').includes('"xx"'))
    assert.ok(readFileSync(path + '.bak', 'utf8').includes('rules'))
    const scope = readGateScope('project', { repo })
    assert.equal(scope.path, path)
    assert.equal(scope.config.rules[0].id, 'xx')
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('validateConfig 拦住非法规则与重复 id', () => {
  assert.equal(validateConfig({ version: 1, rules: [{ id: 'Bad Id', type: 'contains', value: 'x' }] }).ok, false)
  assert.equal(validateConfig({ version: 1, rules: [{ id: 'dup', type: 'nonEmpty' }, { id: 'dup', type: 'nonEmpty' }] }).ok, false)
  assert.equal(validateConfig({ version: 1, rules: [{ id: 'ok', type: 'nonEmpty' }] }).ok, true)
})

test('语义复审只允许 merge/release；issue.reply 跳过', async () => {
  const config = { version: 1, rules: [], semantic: { enabled: true, baseURL: 'http://x', model: 'm', prompt: 'p' } }
  const skipped = await semanticReview('草稿', config, { trigger: 'issue.reply' })
  assert.equal(skipped.skipped, true)
})

test('语义复审解析模型 JSON 并保留原因', async () => {
  const config = { version: 1, rules: [], semantic: { enabled: true, baseURL: 'http://x', model: 'm', prompt: 'p', mode: 'warn' } }
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"pass":false,"issues":[{"rule":"scope","reason":"答非所问"}]}' } }] }) })
  const result = await semanticReview('草稿', config, { trigger: 'merge', fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.hits[0].message, '答非所问')
})

test('优化提示词调用模型并返回文本', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '优化后的提示词' } }] }) })
  assert.equal(await optimizePrompt('旧', { baseURL: 'http://x', model: 'm', fetchImpl }), '优化后的提示词')
})

test('模型列表映射成 id / label', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ data: [{ id: 'm1', display_name: '模型一' }, { id: 'm2' }] }) })
  const models = await listModels({ baseURL: 'http://x/v1', fetchImpl })
  assert.deepEqual(models, [{ id: 'm1', label: '模型一' }, { id: 'm2', label: 'm2' }])
})

test('createGate 回退实现可直接用：不注入 ctx.get(\'gate\') 时就是它', async () => {
  const gateProvider = createGate({ repo: isolatedRepo(), ...isolated() })
  assert.equal(gateProvider.id, 'dsh-gate')
  assert.equal(typeof gateProvider.check, 'function')
  const clean = await gateProvider.check({ trigger: 'issue.reply', text: '本 issue #15 已修复。', current: 15 })
  assert.deepEqual(clean, { ok: true, hits: [], semantic: { skipped: true } })
  const dirty = await gateProvider.check({ trigger: 'issue.reply', text: '另见 #13。', current: 15 })
  assert.equal(dirty.ok, false)
  assert.ok(dirty.hits.some((hit) => hit.id === 'foreign-ref'))
})

test('兼容层读到的默认规则文件真实存在', () => {
  assert.ok(existsSync(compat.DEFAULT_GATE_PATH), '包内 gates/default.json 必须随包发布：' + compat.DEFAULT_GATE_PATH)
})
