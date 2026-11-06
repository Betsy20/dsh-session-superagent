import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tempDir } from './fixtures/tmpdir.mjs'
import { join } from 'node:path'
import { loadGateConfig, lintText, semanticReview, optimizePrompt, writeGateConfig } from '../lib/gates.js'

test('默认门禁能抓到凭证、路径、无关引用', () => {
  const { config } = loadGateConfig({ repo: process.cwd() })
  assert.ok(config.rules.length >= 8)
  const bad = lintText(String.raw`见 D:\主工作区\x，token=ghp_` + 'a'.repeat(30) + '，另见 #13', config, { trigger: 'issue.reply', current: 15 })
  assert.equal(bad.ok, false)
  assert.ok(bad.hits.some((hit) => hit.id === 'secret'))
  assert.ok(bad.hits.some((hit) => hit.id === 'abs-path'))
  assert.ok(bad.hits.some((hit) => hit.id === 'foreign-ref'))
})

test('干净回复通过，且只引用当前编号', () => {
  const { config } = loadGateConfig({ repo: process.cwd() })
  assert.equal(lintText('本 issue #15 已修复，0.10.2 可验证。', config, { trigger: 'issue.reply', current: 15 }).ok, true)
})

test('项目门禁同 id 覆盖、不同 id 追加', () => {
  const repo = tempDir('gate-repo-')
  try {
    mkdirSync(join(repo, '.superagent'), { recursive: true })
    writeFileSync(join(repo, '.superagent', 'gates.json'), JSON.stringify({
      version: 1,
      rules: [{ id: 'custom', label: '自定义', type: 'contains', value: '禁止词', triggers: ['issue.reply'], message: '命中' }],
    }), 'utf8')
    const { config } = loadGateConfig({ repo })
    assert.ok(config.rules.some((rule) => rule.id === 'custom'))
    assert.equal(lintText('这里有禁止词', config, { trigger: 'issue.reply', current: 15 }).ok, false)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test('写项目门禁会备份并原子替换', () => {
  const repo = tempDir('gate-write-')
  try {
    mkdirSync(join(repo, '.superagent'), { recursive: true })
    writeFileSync(join(repo, '.superagent', 'gates.json'), '{"version":1,"rules":[]}', 'utf8')
    writeGateConfig('project', { version: 1, rules: [{ id: 'xx', label: 'x', type: 'contains', value: 'x', triggers: ['issue.reply'], message: 'x' }] }, { repo })
    assert.ok(readFileSync(join(repo, '.superagent', 'gates.json'), 'utf8').includes('"xx"'))
    assert.ok(readFileSync(join(repo, '.superagent', 'gates.json.bak'), 'utf8').includes('rules'))
  } finally { rmSync(repo, { recursive: true, force: true }) }
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
