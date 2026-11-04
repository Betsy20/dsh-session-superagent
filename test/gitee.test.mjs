// Gitee 适配层的单元测试：不联网，全部用假 fetch。
//
// 为什么要有：Gitee 与 GitHub 的条目形状不同（state 有 progressing/rejected、PR 走 /pulls、
// 没有 GraphQL、没有 ETag）。归一化写错的话，下游的筛选/唤醒逻辑会静默失效 ——
// 这正是「看起来有数据，但永远不叫醒」那类 bug。
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRepoSpec } from '../lib/watch.js'
import {
  normalizeGiteeItem, normalizeGiteeList, normalizeGiteeState,
  listGiteeItems, fetchGiteeLastComment, addGiteeLabel,
} from '../lib/gitee.js'

test('仓库写法：owner/name、gitee: 前缀、Gitee URL 都能认', () => {
  assert.equal(parseRepoSpec('a/b').provider, 'github')
  assert.equal(parseRepoSpec('gitee:a/b').provider, 'gitee')
  assert.equal(parseRepoSpec('gitee：a/b').repo, 'a/b', '全角冒号也要认（中文输入法太常见）')
  assert.equal(parseRepoSpec('https://gitee.com/Ghandi/workbuddy-pro').repo, 'Ghandi/workbuddy-pro')
  assert.equal(parseRepoSpec('https://gitee.com/Ghandi/workbuddy-pro.git').provider, 'gitee')
  assert.equal(parseRepoSpec('https://github.com/x/y/issues/3').repo, 'x/y', '带尾巴的 URL 只取前两段')
  assert.equal(parseRepoSpec('bad').ok, false)
  assert.equal(parseRepoSpec('').ok, false)
})

test('Gitee state 归一：rejected 算关闭，progressing 算开着', () => {
  assert.equal(normalizeGiteeState('open'), 'open')
  assert.equal(normalizeGiteeState('progressing'), 'open')
  assert.equal(normalizeGiteeState('closed'), 'closed')
  assert.equal(normalizeGiteeState('rejected'), 'closed')
  assert.equal(normalizeGiteeState(undefined), 'open')
})

test('Gitee issue/PR 归一成下游认识的形状', () => {
  const issue = normalizeGiteeItem({
    number: 7, title: '报告', state: 'progressing',
    user: { login: 'ysl289' }, assignee: { login: 'MYCF711' },
    labels: [{ name: 'bug' }, 'ui'], html_url: 'https://gitee.com/a/b/issues/7',
    updated_at: '2026-11-04T10:00:00Z',
  })
  assert.equal(issue.number, 7)
  assert.equal(issue.state, 'open', 'progressing 要当成开着')
  assert.equal(issue.user.login, 'ysl289')
  assert.deepEqual(issue.assignees, [{ login: 'MYCF711' }])
  assert.deepEqual(issue.labels.map((l) => l.name), ['bug', 'ui'], '字符串标签也要能用')

  const pr = normalizeGiteeItem({ number: 9, title: 'PR', state: 'open', head: {}, user: { login: 'x' }, updated_at: '2026-11-04T11:00:00Z' }, { kind: 'pull' })
  assert.ok(pr.pull_request, 'PR 要带 pull_request，下游靠它分类')
  assert.equal(pr.number, 9)
})

test('issue 与 PR 合并后按 updated_at 倒序', () => {
  const list = normalizeGiteeList(
    [{ number: 1, updated_at: '2026-11-01T00:00:00Z', state: 'open' }],
    [{ number: 2, updated_at: '2026-11-03T00:00:00Z', state: 'open' }],
  )
  assert.equal(list.length, 2)
  assert.equal(list[0].number, 2, '最近更新的排前面')
})

test('拉列表：issue 与 PR 两个端点都要打，一半失败要标出来', async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    if (url.includes('/pulls')) return { ok: false, status: 500, text: async () => 'boom' }
    return { ok: true, status: 200, text: async () => JSON.stringify([{ number: 3, state: 'open', updated_at: '2026-11-04T00:00:00Z' }]) }
  }
  const out = await listGiteeItems({ repo: 'a/b', token: 't', fetchImpl })
  assert.equal(seen.length, 2)
  assert.ok(seen.every((u) => u.startsWith('https://gitee.com/api/v5/repos/a/b/')), 'URL 形状要对：' + seen[0])
  assert.equal(out.ok, true)
  assert.equal(out.partial, 'pulls', '一半失败要说清楚是哪一半')
  assert.equal(out.items.length, 1)
})

test('拉列表：两个端点都失败才算失败，并把状态码带回来', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'bad token' })
  const out = await listGiteeItems({ repo: 'a/b', fetchImpl })
  assert.equal(out.ok, false)
  assert.equal(out.status, 401)
})

test('最后评论：自己留的要标 self，别人留的不标', async () => {
  const make = (login) => async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify([{ user: { login }, created_at: '2026-11-04T09:00:00Z' }]),
  })
  const mine = await fetchGiteeLastComment({ repo: 'a/b', item: { number: 1 }, selfLogin: 'me', fetchImpl: make('me') })
  assert.equal(mine.self, true)
  const other = await fetchGiteeLastComment({ repo: 'a/b', item: { number: 1 }, selfLogin: 'me', fetchImpl: make('someone') })
  assert.equal(other.self, false)
})

test('打标签：POST 到 issues/{n}/labels，body 是 labels 数组', async () => {
  let captured = null
  const fetchImpl = async (url, init) => {
    captured = { url, init }
    return { ok: true, status: 200, text: async () => '{}' }
  }
  const res = await addGiteeLabel({ repo: 'a/b', token: 't', number: 5, label: '主理鱼:已处理', fetchImpl })
  assert.equal(res.ok, true)
  assert.ok(captured.url.endsWith('/repos/a/b/issues/5/labels'))
  assert.equal(captured.init.method, 'POST')
  assert.deepEqual(JSON.parse(captured.init.body), { labels: ['主理鱼:已处理'] })
  assert.equal(captured.init.headers.authorization, 'token t')
})
