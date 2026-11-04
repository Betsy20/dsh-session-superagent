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
  assert.equal(issue.number, '7', '编号统一成字符串（Gitee issue 真机就是字符串）')
  assert.equal(issue.state, 'open', 'progressing 要当成开着')
  assert.equal(issue.user.login, 'ysl289')
  assert.deepEqual(issue.assignees, [{ login: 'MYCF711' }])
  assert.deepEqual(issue.labels.map((l) => l.name), ['bug', 'ui'], '字符串标签也要能用')

  const pr = normalizeGiteeItem({ number: 9, title: 'PR', state: 'open', head: {}, user: { login: 'x' }, updated_at: '2026-11-04T11:00:00Z' }, { kind: 'pull' })
  assert.ok(pr.pull_request, 'PR 要带 pull_request，下游靠它分类')
  assert.equal(pr.number, '9')
})

test('issue 与 PR 合并后按 updated_at 倒序', () => {
  const list = normalizeGiteeList(
    [{ number: 1, updated_at: '2026-11-01T00:00:00Z', state: 'open' }],
    [{ number: 2, updated_at: '2026-11-03T00:00:00Z', state: 'open' }],
  )
  assert.equal(list.length, 2)
  assert.equal(list[0].number, '2', '最近更新的排前面')
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

test('真机样例：issue 的 number 是字符串（IKSQJH），PR 是数字 —— 都不能被转成 0', () => {
  // 2026-11-04 真机抓的真实响应形状
  const issue = normalizeGiteeItem({ id: 34933085, number: 'IKSQJH', state: 'open', title: 't', user: { login: 'x' }, updated_at: '2026-11-04T10:00:00Z' })
  assert.equal(issue.number, 'IKSQJH', 'Gitee issue 编号是字符串，转 Number 会变 0 → 去重与 ack 全部失效')
  const pr = normalizeGiteeItem({ id: 5474824, number: 14, state: 'closed', title: 't', user: { login: 'q' }, updated_at: '2026-11-02T11:16:51+08:00' }, { kind: 'pull' })
  assert.equal(pr.number, '14')
  // 两种都要能进 URL（评论/打标签都按原样拼）
  assert.ok(pr.pull_request)
})

test('字符串编号也要能拼出评论与打标签的 URL', async () => {
  const urls = []
  const f = async (u) => { urls.push(u); return { ok: true, status: 200, text: async () => '[]' } }
  await fetchGiteeLastComment({ repo: 'o/r', item: { number: 'IKSQJH' }, fetchImpl: f })
  await addGiteeLabel({ repo: 'o/r', number: 'IKSQJH', label: 'L', fetchImpl: f })
  assert.ok(urls[0].endsWith('/issues/IKSQJH/comments?per_page=1&sort=created&direction=desc'), urls[0])
  assert.ok(urls[1].endsWith('/issues/IKSQJH/labels'), urls[1])
})

test('since 会拼进两个端点的 URL（Gitee 没有 ETag，这是唯一能省流量的手段）', async () => {
  const urls = []
  const f = async (u) => { urls.push(u); return { ok: true, status: 200, text: async () => '[]' } }
  await listGiteeItems({ repo: 'o/r', perPage: 5, since: '2026-11-04T00:00:00Z', fetchImpl: f })
  assert.equal(urls.length, 2)
  assert.ok(urls.every((u) => u.includes('since=2026-11-04T00%3A00%3A00Z')), '两个端点都要带 since：' + urls.join(' '))
  assert.ok(urls[0].includes('per_page=5'))
})
