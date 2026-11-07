import test from 'node:test'
import assert from 'node:assert/strict'
import { lintText } from '../lib/index.js'

const baseRule = (id, type, extra = {}) => ({
  id,
  label: id,
  type,
  triggers: ['issue.reply', 'pr.reply', 'pr.handle', 'merge', 'release'],
  message: id + ' 命中',
  ...extra,
})

test('干净回复通过且没有任何命中', () => {
  const result = lintText('已修复：更新 lib/gate.js 并补测试，0.10.2 可验证。', { rules: [] })
  assert.equal(result.ok, true)
  assert.deepEqual(result.hits, [])
})

test('warn 命中出现在 hits 里但不阻断', () => {
  const config = {
    rules: [baseRule('soft', 'contains', { value: '注意', severity: 'warn' })],
  }
  const result = lintText('这里需要注意事项。', config, { trigger: 'issue.reply' })
  assert.equal(result.ok, true)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].severity, 'warn')
  assert.equal(result.hits[0].message, 'soft 命中')
})

test('error 命中让 ok 为 false，并保留 id / label / message', () => {
  const config = { rules: [baseRule('hard', 'contains', { value: '禁止' })] }
  const result = lintText('这是禁止项。', config, { trigger: 'issue.reply' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.hits, [
    { id: 'hard', label: 'hard', severity: 'error', message: 'hard 命中' },
  ])
})

test('contains 规则区分大小写', () => {
  const config = { rules: [baseRule('word', 'contains', { value: 'Token' })] }
  assert.equal(lintText('token 小写', config, { trigger: 'issue.reply' }).ok, true)
  assert.equal(lintText('Token 大写', config, { trigger: 'issue.reply' }).ok, false)
})

test('maxLength 按字符数判断（中文每个算 1）', () => {
  const config = { rules: [baseRule('limit', 'maxLength', { value: 4 })] }
  assert.equal(lintText('你好世界', config, { trigger: 'issue.reply' }).ok, true)
  assert.equal(lintText('你好世界啊', config, { trigger: 'issue.reply' }).ok, false)
})

test('nonEmpty 只对配置的触发器生效', () => {
  const config = { rules: [baseRule('empty', 'nonEmpty', { triggers: ['issue.reply', 'pr.reply'] })] }
  assert.equal(lintText('   ', config, { trigger: 'issue.reply' }).ok, false)
  assert.equal(lintText('', config, { trigger: 'pr.reply' }).ok, false)
  assert.equal(lintText('', config, { trigger: 'merge' }).ok, true)
})

test('foreign-ref：引用当前编号通过，引用其它编号失败', () => {
  const config = { rules: [baseRule('foreign-ref', 'foreign-ref', { pattern: '#(\\d+)' })] }
  assert.equal(lintText('本 issue #15 已修复。', config, { trigger: 'issue.reply', current: 15 }).ok, true)
  assert.equal(lintText('本 issue #15 已修复。', config, { trigger: 'issue.reply', current: '15' }).ok, true)
  assert.equal(lintText('本 issue #015 已修复。', config, { trigger: 'issue.reply', current: 15 }).ok, true)
  assert.equal(lintText('另见 #13。', config, { trigger: 'issue.reply', current: 15 }).ok, false)
})

test('foreign-ref：多个引用里只要有一个不同就失败，重复引用不重复计数', () => {
  const config = { rules: [baseRule('foreign-ref', 'foreign-ref', { pattern: '#(\\d+)' })] }
  const result = lintText('见 #15、#15、#13。', config, { trigger: 'issue.reply', current: 15 })
  assert.equal(result.ok, false)
  assert.equal(result.hits.length, 1)
})

test('foreign-ref：没给 current 时跳过，不制造假红', () => {
  const config = { rules: [baseRule('foreign-ref', 'foreign-ref', { pattern: '#(\\d+)' })] }
  assert.equal(lintText('另见 #13。', config, { trigger: 'issue.reply' }).ok, true)
})

test('foreign-ref：pattern 没有捕获组时仍按整段编号比较', () => {
  const config = { rules: [baseRule('foreign-ref', 'foreign-ref', { pattern: '#\\d+' })] }
  assert.equal(lintText('本 issue #15。', config, { trigger: 'issue.reply', current: 15 }).ok, true)
  assert.equal(lintText('另见 #13。', config, { trigger: 'issue.reply', current: 15 }).ok, false)
})

test('规则按 triggers 过滤：merge 不跑 issue.reply 专属规则', () => {
  const config = { rules: [baseRule('reply-only', 'contains', { value: 'x', triggers: ['issue.reply'] })] }
  assert.equal(lintText('x', config, { trigger: 'merge' }).ok, true)
  assert.equal(lintText('x', config, { trigger: 'issue.reply' }).ok, false)
})

test('未知 trigger 直接抛错（调用方传错不能静默放行）', () => {
  assert.throws(
    () => lintText('x', { rules: [] }, { trigger: 'push' }),
    /trigger 必须是/,
  )
})

test('空正文默认按 issue.reply 跑门禁', () => {
  const config = { rules: [baseRule('empty', 'nonEmpty', { triggers: ['issue.reply'] })] }
  const result = lintText('', config)
  assert.equal(result.ok, false)
  assert.equal(result.hits[0].id, 'empty')
})
