// 路由层单测：之前 0 覆盖，全靠真机 curl 手测。
// 用环境变量把状态目录指到临时目录，并把轮询关掉，避免打到真 GitHub。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = mkdtempSync(join(tmpdir(), 'superagent-routes-'))
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'

const { apply } = await import('../lib/index.js')

const tools = []
const routes = new Map()

const ctx = {
  tools: { register: (tool) => tools.push(tool) },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agents: { currentInitiator: () => ({ id: 'session-test' }), get: () => null },
  get: () => null,
  effect: (fn) => fn(),
  inject: () => {},
}

apply(ctx)

/** 造一个够用的 req：readBody 只用到 on('data') / on('end')。 */
function makeReq(method, url, body) {
  const handlers = {}
  const req = {
    method,
    url,
    on(event, cb) {
      ;(handlers[event] ||= []).push(cb)
      return req
    },
    destroy() {},
  }
  queueMicrotask(() => {
    if (body !== undefined) for (const cb of handlers.data || []) cb(Buffer.from(body))
    for (const cb of handlers.end || []) cb()
  })
  return req
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(chunk)
    },
    get body() {
      return this.chunks.join('')
    },
    json() {
      return JSON.parse(this.body)
    },
  }
}

async function call(method, path, body) {
  const route = routes.get(path.split('?')[0])
  assert.ok(route, '路由不存在：' + path.split('?')[0])
  const res = makeRes()
  await route.handler(makeReq(method, path, body === undefined ? undefined : JSON.stringify(body)), res)
  return res
}

test('注册了预期的工具与路由', () => {
  const names = tools.map((t) => t.name).sort()
  for (const want of ['github', 'repo_here', 'watch_ack', 'watch_doctor', 'watch_start', 'watch_status', 'watch_stop']) {
    assert.ok(names.includes(want), '缺工具 ' + want + '（实际：' + names.join(',') + '）')
  }
  for (const want of ['/session-superagent/state', '/session-superagent/watch', '/session-superagent/client-note']) {
    assert.ok(routes.has(want), '缺路由 ' + want)
  }
})

test('POST /watch：缺 repo 或 sessionId 都拒绝', async () => {
  const bad = await call('POST', '/session-superagent/watch', { sessionId: 's1' })
  assert.equal(bad.statusCode, 400)
  assert.match(bad.json().error, /repo/)

  const bad2 = await call('POST', '/session-superagent/watch', { repo: 'o/r' })
  assert.equal(bad2.statusCode, 400)
  assert.match(bad2.json().error, /sessionId/)
})

test('建 → 查 → 暂停 → 恢复 → 删，全链路', async () => {
  const created = await call('POST', '/session-superagent/watch', {
    repo: 'o/r',
    sessionId: 's1',
    intervalSec: 30,
    filters: { labels: ['ai-fix'] },
    batchLimit: 2,
    maxWakesPerHour: 3,
    activeHours: '09:00-23:00',
  })
  assert.equal(created.statusCode, 200)
  const id = created.json().id
  assert.equal(id, 'o/r#s1')

  const state = (await call('GET', '/session-superagent/state')).json()
  assert.equal(state.watchers.length, 1)
  const w = state.watchers[0]
  assert.equal(w.id, id)
  assert.deepEqual(w.filters.labels, ['ai-fix'])
  assert.equal(w.batchLimit, 2)
  assert.equal(w.maxWakesPerHour, 3)
  assert.equal(w.activeHours, '09:00-23:00')
  assert.equal(w.enabled, true)

  const paused = (await call('POST', '/session-superagent/watch', { action: 'pause', id })).json()
  assert.equal(paused.enabled, false)
  assert.equal((await call('GET', '/session-superagent/state')).json().watchers[0].enabled, false)

  const resumed = (await call('POST', '/session-superagent/watch', { action: 'resume', id })).json()
  assert.equal(resumed.enabled, true)

  const deleted = (await call('POST', '/session-superagent/watch', { action: 'delete', id })).json()
  assert.equal(deleted.deleted, true)
  assert.equal((await call('GET', '/session-superagent/state')).json().watchers.length, 0)
})

test('非法 action / 未知 id / 非 POST 都有明确响应', async () => {
  const badAction = await call('POST', '/session-superagent/watch', { action: 'explode', id: 'x/y#z' })
  assert.equal(badAction.statusCode, 400)

  const unknown = await call('POST', '/session-superagent/watch', { action: 'pause', id: 'nope/nope#nope' })
  assert.equal(unknown.statusCode, 400)

  const pollUnknown = await call('POST', '/session-superagent/watch', { action: 'poll', id: 'nope/nope#nope' })
  assert.equal(pollUnknown.statusCode, 404)

  const getWatch = await call('GET', '/session-superagent/watch')
  assert.equal(getWatch.statusCode, 405)
})

test('client-note 写入探针且返回 204', async () => {
  const res = await call('GET', '/session-superagent/client-note?key=client-version&value=9.9.9')
  assert.equal(res.statusCode, 204)
  // 探针写在状态文件里，不从 /state 返回
  const raw = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  assert.equal(raw.client['note:client-version'].detail, '9.9.9')
})

test('未知路由不注册（不会误吞）', () => {
  assert.equal(routes.has('/session-superagent/nope'), false)
})


test('/state 返回 gh 健康；/config 已下线', async () => {
  const state = (await call('GET', '/session-superagent/state')).json()
  assert.ok('gh' in state, '/state 必须回传 gh 字段（设置页「来源」卡片要用）')
  assert.equal(typeof state.gh.ok, 'boolean')

  // /config 已删除（与 /state 重复、是未鉴权 GET，且曾因引用未定义变量抛 ReferenceError）
  // 路由表里不应再注册它 —— 未注册即 404（宿主不会为未知路径分发到 handler）
  assert.equal(routes.has('/session-superagent/config'), false, '/config 必须已从路由表移除')
})

test('编辑保存不会清空 goal、不会抹掉没暴露的 filters、isolated 可以关', async () => {
  const created = (await call('POST', '/session-superagent/watch', {
    repo: 'o/edit',
    sessionId: 's2',
    intervalSec: 60,
    goal: '把 widget 的 issue 都处理完',
    filters: { labels: ['ai-fix'], ignoreLabels: ['wontfix'], skipClosed: false, assignee: 'alice', onlyAssigned: true },
    isolated: true,
  })).json()
  const id = created.id

  // GUI 行内编辑发出的正是这种 body：只有 labels/onlyAssigned，没有 goal / ignoreLabels / skip*
  await call('POST', '/session-superagent/watch', {
    repo: 'o/edit',
    sessionId: 's2',
    intervalSec: 120,
    filters: { labels: ['ai-fix'], onlyAssigned: false },
    activeHours: '09:00-23:00',
    isolated: false,
    observe: true,
  })

  // entry.goal 不经过 /state 投影（那里回的是真会话 goal），直接读状态文件
  const raw = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  const watcher = raw.watchers[id]
  assert.equal(watcher.intervalSec, 120)
  assert.equal(watcher.goal, '把 widget 的 issue 都处理完', '没传 goal 不能清空')
  assert.deepEqual(watcher.filters.labels, ['ai-fix'])
  assert.deepEqual(watcher.filters.ignoreLabels, ['wontfix'], '没暴露的字段要保持原值')
  assert.equal(watcher.filters.skipClosed, false)
  assert.equal(watcher.filters.assignee, 'alice')
  assert.equal(watcher.isolated, false, 'isolated 必须能关掉')
  assert.equal(watcher.observe, true)

  await call('POST', '/session-superagent/watch', { action: 'delete', id })
})

test('watch_doctor 会报告挂载状态（面板接口死没死）', async () => {
  const tool = tools.find((t) => t.name === 'watch_doctor')
  assert.ok(tool, '没注册 watch_doctor')
  const text = String(await tool.execute({ repo: 'no-such-owner/no-such-repo-xyz' }))
  assert.match(text, /面板接口挂载/, '必须有一行讲挂载状态')
  assert.match(text, /7 条，无失败|部分失败|挂载：/, '挂载行要给出具体结论')
})

test('cleanup', () => {
  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('路由面收敛：只保留 7 条（/config 与 /client-hello 已下线，新增 /update）', () => {
  const expected = [
    '/session-superagent/state',
    '/session-superagent/client-note',
    '/session-superagent/client-error',
    '/session-superagent/watch',
    '/session-superagent/credentials',
    '/session-superagent/goal',
    '/session-superagent/update',
  ].sort()
  assert.deepEqual([...routes.keys()].sort(), expected)
})

test('/update 只读地报告版本（离线/在线都必须给出 current）', async () => {
  const res = await call('GET', '/session-superagent/update')
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.equal(typeof body.current, 'string', '必须给出当前版本')
  assert.equal(typeof body.hasUpdate, 'boolean', 'hasUpdate 必须是布尔值')
  // 命令模板里必须带包名，客户复制出去就能跑
  assert.ok(String(body.command).includes('dsh-session-superagent'), 'command 要含包名：' + body.command)
})

test('面板可设限流：batchLimit / maxWakesPerHour 会被夹紧并回传', async () => {
  const created = (await call('POST', '/session-superagent/watch', {
    repo: 'o/limits', sessionId: 's9', intervalSec: 60, batchLimit: 3, maxWakesPerHour: 99,
  })).json()
  const watcher = (await call('GET', '/session-superagent/state')).json().watchers.find((w) => w.id === created.id)
  assert.equal(watcher.batchLimit, 3)
  assert.equal(watcher.maxWakesPerHour, 60, '每小时上限要夹到 1-60')
  await call('POST', '/session-superagent/watch', { action: 'delete', id: created.id })
})

test('watch_start 工具能配过滤/观察/限流，并夹紧取值', async () => {
  const tool = tools.find((t) => t.name === 'watch_start')
  assert.ok(tool, '没注册 watch_start')

  const result = await tool.execute({
    repo: 'o/tool', intervalSec: 5,
    labels: ['ai-fix'], onlyAssigned: true, assignee: 'alice',
    observe: true, goal: '把 widget 的 issue 都处理完',
    batchLimit: 99, maxWakesPerHour: 0, activeHours: '09:00-23:00',
  })
  assert.match(String(result), /watching o\/tool/)

  const raw = JSON.parse(readFileSync(join(STATE_DIR, 'watchers.json'), 'utf8'))
  const entry = raw.watchers['o/tool#session-test']
  assert.equal(entry.intervalSec, 30, 'intervalSec 要夹到最小 30 秒')
  assert.deepEqual(entry.filters.labels, ['ai-fix'])
  assert.equal(entry.filters.onlyAssigned, true)
  assert.equal(entry.filters.assignee, 'alice')
  assert.equal(entry.observe, true)
  assert.equal(entry.goal, '把 widget 的 issue 都处理完')
  assert.equal(entry.batchLimit, 20, 'batchLimit 夹到 1-20')
  assert.equal(entry.maxWakesPerHour, 1, 'maxWakesPerHour 夹到 1-60')
  assert.equal(entry.activeHours, '09:00-23:00')
})

test('watch_start 拒绝相对路径的 workdir', async () => {
  const tool = tools.find((t) => t.name === 'watch_start')
  const result = await tool.execute({ repo: 'o/tool2', workdir: 'relative/path' })
  assert.match(String(result), /must be an absolute path/)
})

test('/state 字段契约：client.js 引用的每个字段都必须真的回传', async () => {
  // 之前是人工核对的（审核员做过一次），这里固化成守门：
  // client 用 body.X 取顶层、用 watcher.X 取每条，任何一个字段漏了，
  // 面板上就会安静地显示 undefined。
  const clientSrc = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const topLevel = new Set([...clientSrc.matchAll(/body\.([a-zA-Z]+)/g)].map((m) => m[1]))
  const perWatcher = new Set([...clientSrc.matchAll(/watcher\.([a-zA-Z]+)/g)].map((m) => m[1]))

  const created = (await call('POST', '/session-superagent/watch', {
    repo: 'o/contract', sessionId: 's7', intervalSec: 60, observe: true,
    isolated: true, workdir: process.cwd(), activeHours: '09:00-23:00', goal: 'x',
    filters: { labels: ['a'], ignoreLabels: ['b'], onlyAssigned: true, assignee: 'a' },
    batchLimit: 3, maxWakesPerHour: 2,
  })).json()
  const state = (await call('GET', '/session-superagent/state')).json()
  const watcher = state.watchers.find((w) => w.id === created.id)

  // call() 里有个通用 `body.error`（任何路由的错误响应），它不属于 /state 契约
  const allowedTop = new Set(['error'])
  const missingTop = [...topLevel].filter((key) => !allowedTop.has(key) && !(key in state))
  assert.deepEqual(missingTop, [], '顶层缺字段：' + missingTop.join(', '))
  assert.ok(state.gh !== undefined, 'gh 必须回传')

  const missingPer = [...perWatcher].filter((key) => !(key in watcher))
  assert.deepEqual(missingPer, [], '每条缺字段：' + missingPer.join(', '))

  await call('POST', '/session-superagent/watch', { action: 'delete', id: created.id })
})
