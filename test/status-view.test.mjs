import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ACK_LABEL, DEFAULT_PRIORITY, statusView } from '../lib/watch.js'

const configurableFields = (watcher) => ({
  batchLimit: watcher.batchLimit,
  maxWakesPerHour: watcher.maxWakesPerHour,
  sessionMaxWakes: watcher.sessionMaxWakes,
  isolateKeepDays: watcher.isolateKeepDays,
  maxIsolated: watcher.maxIsolated,
  ackLabel: watcher.ackLabel,
  workdir: watcher.workdir,
  priority: watcher.priority,
  ignoreLabels: watcher.ignoreLabels,
  assignee: watcher.assignee,
  allowAuthors: watcher.allowAuthors,
})

test('statusView 透传全部可写配置字段及 priority 扩展项', () => {
  const entry = {
    repo: 'acme/config', sessionId: 'session-config', wakeTimes: [],
    batchLimit: 3,
    maxWakesPerHour: 4,
    sessionMaxWakes: 24,
    isolateKeepDays: 7,
    maxIsolated: 9,
    ackLabel: 'team:done',
    workdir: 'D:/repo',
    priority: { reopened: false, comments: false, labels: true, unassigned: true, stale: true },
    filters: {
      labels: ['bug'],
      ignoreLabels: ['wontfix', 'duplicate'],
      onlyAssigned: true,
      assignee: 'octocat',
      allowAuthors: ['alice', 'bob'],
    },
  }

  const watcher = statusView([entry]).watchers[0]
  assert.deepEqual(configurableFields(watcher), {
    batchLimit: 3,
    maxWakesPerHour: 4,
    sessionMaxWakes: 24,
    isolateKeepDays: 7,
    maxIsolated: 9,
    ackLabel: 'team:done',
    workdir: 'D:/repo',
    priority: { reopened: false, comments: false, labels: true, unassigned: true, stale: true },
    ignoreLabels: ['wontfix', 'duplicate'],
    assignee: 'octocat',
    allowAuthors: ['alice', 'bob'],
  })
})

test('statusView 缺省配置有明确默认值，priority 形状与 DEFAULT_PRIORITY 一致', () => {
  const watcher = statusView([{ repo: 'acme/defaults', sessionId: 'session-defaults', wakeTimes: [] }]).watchers[0]

  assert.deepEqual(configurableFields(watcher), {
    batchLimit: 5,
    maxWakesPerHour: 6,
    sessionMaxWakes: 12,
    isolateKeepDays: 3,
    maxIsolated: 5,
    ackLabel: DEFAULT_ACK_LABEL,
    workdir: null,
    priority: DEFAULT_PRIORITY,
    ignoreLabels: [],
    assignee: null,
    allowAuthors: [],
  })
  assert.deepEqual(watcher.priority, DEFAULT_PRIORITY)
  assert.notStrictEqual(watcher.priority, DEFAULT_PRIORITY, '默认 priority 不能共享可变对象')
})

test('statusView 返回的数组不与 entry 或其他视图共享修改', () => {
  const entry = {
    repo: 'acme/copies', sessionId: 'session-copies', wakeTimes: [],
    filters: {
      labels: ['bug'],
      ignoreLabels: ['wontfix'],
      allowAuthors: ['alice'],
    },
  }
  const originals = { labels: ['bug'], ignoreLabels: ['wontfix'], allowAuthors: ['alice'] }
  const first = statusView([entry]).watchers[0]
  const second = statusView([entry]).watchers[0]

  for (const key of Object.keys(originals)) {
    assert.notStrictEqual(first[key], entry.filters[key], key + ' 不能直接引用 entry 数组')
    assert.notStrictEqual(first[key], second[key], key + ' 不能在两次调用间共享数组')
    first[key].push('view-only')
    assert.deepEqual(entry.filters[key], originals[key], key + ' 修改视图不能污染 entry')
    assert.deepEqual(second[key], originals[key], key + ' 修改一次视图不能污染另一次视图')
  }

  entry.filters.labels[0] = 'source-changed'
  entry.filters.ignoreLabels[0] = 'source-changed'
  entry.filters.allowAuthors[0] = 'source-changed'
  assert.equal(second.labels[0], 'bug', '修改 entry.labels 不能反向污染已返回视图')
  assert.equal(second.ignoreLabels[0], 'wontfix', '修改 entry.ignoreLabels 不能反向污染已返回视图')
  assert.equal(second.allowAuthors[0], 'alice', '修改 entry.allowAuthors 不能反向污染已返回视图')
})

test('statusView 重复调用完全一致，JSON 序列化稳定可供 ETag 使用', () => {
  const entries = [{
    repo: 'acme/stable', sessionId: 'session-stable', wakeTimes: [],
    batchLimit: 2,
    maxWakesPerHour: 8,
    sessionMaxWakes: 16,
    isolateKeepDays: 5,
    maxIsolated: 4,
    ackLabel: 'stable:done',
    workdir: 'D:/stable',
    priority: { comments: false, stale: true },
    filters: { labels: ['bug'], ignoreLabels: ['wontfix'], assignee: 'octocat', allowAuthors: ['alice'] },
  }]

  const first = statusView(entries)
  const second = statusView(entries)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
})
