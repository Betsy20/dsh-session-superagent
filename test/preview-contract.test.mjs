// 预览快照必须覆盖 client.js 真正读的字段。
//
// 为什么：0.9.140 里「诊断页看着空」，查了半天样式，结果是快照压根没写 triageSignals。
// 那种问题肉眼才能发现、且很容易误判成 UI 缺陷 —— 这里把它变成一条断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(join(root, 'client.js'), 'utf8')
const preview = readFileSync(join(root, 'scripts', 'render-preview.mjs'), 'utf8')

const readBodyFields = () => [...new Set([...client.matchAll(/\bbody\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort()

const snapshotFields = () => {
  const start = preview.indexOf('const snapshot = {')
  assert.ok(start > 0, '找不到预览的 snapshot')
  const end = preview.indexOf('const deskHooks', start)
  assert.ok(end > start, '找不到 snapshot 的结尾')
  const block = preview.slice(start, end)
  return new Set([...block.matchAll(/^\s{4}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]))
}

test('预览快照里的字段 = client.js 读的 body 字段（少一个页面就可能看着空）', () => {
  const wanted = readBodyFields()
  const have = snapshotFields()
  const missing = wanted.filter((name) => !have.has(name))
  assert.deepEqual(missing, [], '预览快照缺这些字段（页面会显示成空）：' + missing.join(', '))
})

test('嵌套字段也要对得上：隔离占用 / 会话用量 / 默认值 / 重试策略 / 权限范围', () => {
  const start = preview.indexOf('const snapshot = {')
  const end = preview.indexOf('const deskHooks', start)
  const block = preview.slice(start, end)
  // 直接按源码文本比对：这些名字在客户端读、在服务端写，快照里必须出现
  const required = [
    'isolation', 'roots', 'count', 'bytes', 'totalBytes',
    'sessionUsage', 'used', 'cap', 'capped',
    'defaults', 'sessionMaxWakes', 'maxWakesPerHour', 'isolateKeepDays',
    'retryPolicy', 'budgetAttempts', 'slowCapMinutes',
    'tokenScopes',
  ]
  const missing = required.filter((name) => !block.includes(name))
  assert.deepEqual(missing, [], '预览快照缺这些嵌套字段：' + missing.join(', '))
})
