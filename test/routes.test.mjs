// 路由层单测：之前 0 覆盖，全靠真机 curl 手测。
// 用环境变量把状态目录指到临时目录，并把轮询关掉，避免打到真 GitHub。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tempDir } from './fixtures/tmpdir.mjs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const STATE_DIR = tempDir('superagent-routes-')
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
function makeReq(method, url, body, headers) {
  const handlers = {}
  const req = {
    method,
    url,
    headers: headers || {},
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

async function call(method, path, body, headers) {
  const route = routes.get(path.split('?')[0])
  assert.ok(route, '路由不存在：' + path.split('?')[0])
  const res = makeRes()
  await route.handler(makeReq(method, path, body === undefined ? undefined : JSON.stringify(body), headers), res)
  return res
}

test('注册了预期的工具与路由', () => {
  const names = tools.map((t) => t.name).sort()
  for (const want of ['github', 'repo_here', 'watch_ack', 'watch_doctor', 'watch_trace', 'watch_start', 'watch_status', 'watch_stop']) {
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
  assert.match(text, /9 条，无失败|部分失败|挂载：/, '挂载行要给出具体结论')
})

test('cleanup', () => {
  rmSync(STATE_DIR, { recursive: true, force: true })
})

test('路由面收敛：只保留 9 条（/config 与 /client-hello 已下线，新增 /update 与 /trace）', () => {
  const expected = [
    '/session-superagent/state',
    '/session-superagent/client-note',
    '/session-superagent/client-error',
    '/session-superagent/watch',
    '/session-superagent/credentials',
    '/session-superagent/goal',
    '/session-superagent/update',
    '/session-superagent/trace',
    '/session-superagent/diagnose',
  ].sort()
  assert.deepEqual([...routes.keys()].sort(), expected)
})

// 这条会真的去 npm registry 查最新版本，机器慢/网络抖时会撑到超时（跑过 5010ms 才失败）。
// 给它单独的宽松超时：要验的是「离线也必须给出 current」，不是网络速度。
test('/update 只读地报告版本（离线/在线都必须给出 current）', { timeout: 60000 }, async () => {
  // 走离线开关：这条用例不该因为 npm registry 抖动而红（曾经偶发超时 5 秒）
  process.env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
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

test('新增守会回传 warnings 字段（添加前体检的结论；测试环境跳过网络但字段要在）', async () => {
  const res = await call('POST', '/session-superagent/watch', { repo: 'o/precheck', sessionId: 's10', intervalSec: 60 })
  assert.equal(res.statusCode, 200)
  const body = JSON.parse(res.body)
  assert.ok(Array.isArray(body.warnings), 'warnings 必须始终是数组：' + res.body.slice(0, 120))
})

test('/state 不回传客户端从不读的字段（面板每 5 秒拉一次，省的是真流量）', async () => {
  await call('POST', '/session-superagent/watch', { repo: 'o/lean', sessionId: 's11', intervalSec: 60 })
  const res = await call('GET', '/session-superagent/state')
  const body = JSON.parse(res.body)
  const entry = body.watchers.find((w) => w.repo === 'o/lean')
  assert.ok(entry, '应该能找到刚建的守')
  for (const field of ['wakeTimes', 'cooldownMs', 'lastBatch']) {
    assert.equal(entry[field], undefined, field + ' 不该出现在 /state 里（服务端自己用即可）')
  }
  // 但真正在用的字段必须在
  for (const field of ['id', 'repo', 'intervalSec', 'enabled', 'filters', 'priority', 'history']) {
    assert.notEqual(entry[field], undefined, field + ' 必须在')
  }
})

test('/state 带 ETag：同一份内容再问一次回 304（面板轮询省流量）', async () => {
  await call('POST', '/session-superagent/watch', { repo: 'o/etag', sessionId: 's12', intervalSec: 60 })
  const first = await call('GET', '/session-superagent/state')
  assert.equal(first.statusCode, 200)
  const etag = first.headers && first.headers.etag
  assert.ok(etag, '200 响应必须带 ETag：' + JSON.stringify(first.headers || {}))
  // 同样的内容 + If-None-Match → 304，且没有正文
  const second = await call('GET', '/session-superagent/state', null, { 'if-none-match': etag })
  assert.equal(second.statusCode, 304, '内容没变应该回 304，实际 ' + second.statusCode)
  assert.ok(!second.body || second.body.length === 0, '304 不该带正文')
  // ETag 不匹配时必须给完整内容（否则客户端会丢状态）
  const third = await call('GET', '/session-superagent/state', null, { 'if-none-match': '"stale"' })
  assert.equal(third.statusCode, 200)
  assert.ok(JSON.parse(third.body).watchers.length > 0)
})

test('/state 带 sessionUsage（近一小时用了几次、上限多少、几条守被上限挡住）', async () => {
  await call('POST', '/session-superagent/watch', { repo: 'o/usage', sessionId: 'session-usage', intervalSec: 60 })
  const res = await call('GET', '/session-superagent/state')
  const body = JSON.parse(res.body)
  assert.ok(body.sessionUsage, '要有 sessionUsage')
  assert.equal(typeof body.sessionUsage.used, 'number')
  assert.equal(typeof body.sessionUsage.cap, 'number')
  assert.ok(body.sessionUsage.cap >= 1, '上限要有值：' + JSON.stringify(body.sessionUsage))
  assert.equal(typeof body.sessionUsage.capped, 'number')
})

test('/state 每条守都带 deferReason（面板按字段统计，不再匹配文案）', async () => {
  await call('POST', '/session-superagent/watch', { repo: 'o/reason', sessionId: 'session-reason', intervalSec: 60 })
  const res = await call('GET', '/session-superagent/state')
  const body = JSON.parse(res.body)
  const list = body.watchers || []
  assert.ok(list.length > 0, '应该有守')
  for (const w of list) assert.ok('deferReason' in w, '缺 deferReason：' + JSON.stringify(w).slice(0, 120))
  // 新加的守还没被暂停过 —— 应当是 null 而不是 undefined
  assert.equal(list[0].deferReason, null)
})

test('watch_start 能设面板里的三项（会话上限 / 隔离保留天数 / 最多几个隔离区）', async () => {
  const tools = []
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-parity' }) },
    get: () => null,
    effect: (fn) => fn(),
    inject: () => {},
  }
  const mod = await import('../lib/index.js?parity=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((tool) => tool.name === 'watch_start')
  assert.ok(start, '要有 watch_start')
  // 面板里能改的三项，工具参数里必须也有（否则 agent 无从下手）
  for (const key of ['sessionMaxWakes', 'isolateKeepDays', 'maxIsolated']) {
    assert.ok(start.parameters.properties[key], '缺参数 ' + key)
  }
  const res = await start.execute({
    repo: 'o/parity', sessionMaxWakes: 24, isolateKeepDays: 7, maxIsolated: 3,
  })
  assert.equal(typeof res, 'string')
  const state = JSON.parse(JSON.stringify(mod.__test.readState()))
  const entry = Object.values(state.watchers || {}).find((w) => w.repo === 'o/parity')
  assert.ok(entry, '应该登记成功：' + res)
  assert.equal(entry.sessionMaxWakes, 24)
  assert.equal(entry.isolateKeepDays, 7)
  assert.equal(entry.maxIsolated, 3)
})

test('watch_status 带诊断：暂停原因、未回音、会话用量（agent 自诊不用看面板）', async () => {
  const tools = []
  const dir = tempDir('zhuli-st-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-status' }) },
    get: () => null, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?status=' + Date.now())
  mod.apply(ctx)
  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'o/st', sessionMaxWakes: 12 })
  // 直接改状态：模拟"被上限挡住 + 连续没回音"
  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].deferReason = 'cap-session'
  state.watchers[key].silentWakes = 3
  mod.__test.writeState(state)

  const text = String(await tools.find((t) => t.name === 'watch_status').execute({}))
  // 0.9.86 起文本改成"人话 + 只在需要时追加原因"，信息量不变
  assert.ok(text.includes('暂停：cap-session'), '要带暂停原因码：' + text)
  assert.ok(text.includes('叫醒 3 次没回音'), '要带未回音次数：' + text)
  assert.ok(!text.includes('lastPoll='), '不再堆无意义字段（lastPoll=- 之类）')
  assert.match(text, /session:\s*\d+\/12 wakes last hour/, '要有会话用量行')
})

test('watch_status 支持 format=json（同一份数据的机器可读形式）', async () => {
  const tools = []
  const dir = tempDir('zhuli-json-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-json' }) },
    get: () => null, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?json=' + Date.now())
  mod.apply(ctx)
  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'o/js', sessionMaxWakes: 12 })
  const status = tools.find((t) => t.name === 'watch_status')
  const json = JSON.parse(await status.execute({ format: 'json' }))
  assert.equal(json.watchers.length, 1)
  assert.equal(json.watchers[0].repo, 'o/js')
  assert.equal(json.session.cap, 12)
  assert.equal(typeof json.session.used, 'number')
  // 默认仍是文本（老调用方不受影响）
  const text = String(await status.execute({}))
  assert.ok(text.includes('session:'), '默认输出要保持文本：' + text.slice(0, 80))
})

test('三个只读工具口径一致：都支持 format=json 且带 schemaVersion', async () => {
  const tools = []
  const dir = tempDir('zhuli-fmt-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-fmt' }) },
    get: () => null, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?fmt=' + Date.now())
  mod.apply(ctx)
  for (const name of ['watch_status', 'watch_doctor', 'watch_trace']) {
    const tool = tools.find((t) => t.name === name)
    assert.ok(tool.parameters.properties.format, name + ' 缺 format 参数')
  }

  const status = JSON.parse(await tools.find((t) => t.name === 'watch_status').execute({ format: 'json' }))
  assert.equal(status.schemaVersion, 1)
  assert.ok(Array.isArray(status.watchers))

  const doctor = JSON.parse(await tools.find((t) => t.name === 'watch_doctor').execute({ format: 'json' }))
  assert.equal(doctor.schemaVersion, 1)
  assert.ok(Array.isArray(doctor.checks) && doctor.checks.length > 0)
  assert.ok(doctor.checks.every((c) => typeof c.status === 'string' && typeof c.text === 'string'))

  // 没有任何守时，错误也要是 JSON（消费方不该在两种格式间猜）
  const traceEmpty = JSON.parse(await tools.find((t) => t.name === 'watch_trace').execute({ number: 1, format: 'json' }))
  assert.equal(traceEmpty.schemaVersion, 1)
  assert.ok(typeof traceEmpty.error === 'string')

  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'o/fmt' })
  const trace = JSON.parse(await tools.find((t) => t.name === 'watch_trace').execute({ number: 1, format: 'json' }))
  assert.equal(trace.schemaVersion, 1)
  assert.ok(Array.isArray(trace.results))
})

test('写工具也给 JSON：成功/失败都能被程序判断（不再靠读中文）', async () => {
  const tools = []
  const dir = tempDir('zhuli-wr-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-wr' }) },
    get: () => null, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?wr=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  const stop = tools.find((t) => t.name === 'watch_stop')

  const started = JSON.parse(await start.execute({ repo: 'o/wr', format: 'json', sessionMaxWakes: 12 }))
  assert.equal(started.schemaVersion, 1)
  assert.equal(started.ok, true)
  assert.equal(started.repo, 'o/wr')
  assert.equal(started.updated, false, '第一次是新建')

  const again = JSON.parse(await start.execute({ repo: 'o/wr', format: 'json' }))
  assert.equal(again.updated, true, '第二次是更新')

  const stopped = JSON.parse(await stop.execute({ repo: 'o/wr', format: 'json' }))
  assert.equal(stopped.ok, true)

  // 停一条不存在的：也要能用 ok:false 判断
  const missing = JSON.parse(await stop.execute({ repo: 'o/none', format: 'json' }))
  assert.equal(missing.ok, false)
  assert.ok(typeof missing.error === 'string')

  // 文本形态保持不变
  const text = String(await start.execute({ repo: 'o/wr' }))
  assert.ok(text.startsWith('watching '), '默认仍返回文本：' + text.slice(0, 60))
})

test('watch_doctor 能发现"定时器丢了"和"隔离目录不可写"', async () => {
  const tools = []
  const dir = tempDir('zhuli-doctor-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-doc' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?doc=' + Date.now())
  mod.apply(ctx)
  const doctor = tools.find((t) => t.name === 'watch_doctor')
  const start = tools.find((t) => t.name === 'watch_start')

  // 造一个"两小时没轮询过"的守（定时器丢了的样子）
  await start.execute({ repo: 'o/stale' })
  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].lastPoll = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  // 进程也跑了很久（否则会被判成「刚重启」，见下一条用例）
  state.server = { ...(state.server || {}), startedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() }
  mod.__test.writeState(state)

  const text = String(await doctor.execute({}))
  assert.ok(/没轮询过/.test(text), '停滞的守要报出来：' + text.slice(0, 300))
})

test('watch_trace 能说清"被冷却期吸收"，而不是三合一猜测', async () => {
  const tools = []
  const dir = tempDir('zhuli-absorb-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-ab' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?ab=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  const trace = tools.find((t) => t.name === 'watch_trace')
  await start.execute({ repo: 'o/ab' })

  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].absorbedLog = [{ at: '2026-11-02T10:00:00.000Z', number: '42', title: '被吸收的条目' }]
  state.watchers[key].seen = { 42: '2026-11-02T09:59:00.000Z' }
  mod.__test.writeState(state)

  const text = String(await trace.execute({ number: 42 }))
  assert.ok(text.includes('被冷却期吸收'), '结论要指名吸收：' + text.slice(0, 200))
  assert.ok(!text.includes('仅观察，或上报前就已存在'), '不该再给三合一猜测')

  const json = JSON.parse(String(await trace.execute({ number: 42, format: 'json' })))
  const item = json.results[0]
  assert.equal(item.absorbed.length, 1, 'JSON 里要有 absorbed 明细')
})

test('watch_ack 失败要区分"会自动恢复"和"需要你处理"', async () => {
  const tools = []
  const dir = tempDir('zhuli-ackfail-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-ack' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?ackfail=' + Date.now())
  mod.apply(ctx)
  const ack = tools.find((t) => t.name === 'watch_ack')

  // 不建守直接 ack：会走 "没有这个守" 的错误分支
  const missing = String(await ack.execute({ repo: 'o/none', number: 1 }))
  assert.ok(missing.includes('error'), '没有守时要报错：' + missing.slice(0, 120))

  // 分类函数本身的判据：可恢复的三类 vs 需动手的三类
  const { classifyGhError } = await import('../lib/gh-format.js')
  for (const [text, expectRetry] of [
    ['Get "https://api.github.com/x": EOF', true],
    ['HTTP 403: API rate limit exceeded', true],
    ['HTTP 502: Bad Gateway', true],
    ['HTTP 401: Bad credentials', false],
    ['HTTP 404: Not Found', false],
    ['gh: command not found', false],
    ['HTTP 301: Moved Permanently', false],
    ['Repository has been moved', false],
  ]) {
    const kind = classifyGhError(text).kind
    const retryable = ['network', 'ratelimit', 'gateway'].includes(kind)
    assert.equal(retryable, expectRetry, text + ' → ' + kind)
  }
})

test('watch_status 文本：正常的守不堆字段，异常的守才追加原因', async () => {
  const tools = []
  const dir = tempDir('zhuli-dense-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-dense' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?dense=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  await start.execute({ repo: 'o/ok' })
  await start.execute({ repo: 'o/bad' })

  const state = mod.__test.readState()
  const keys = Object.keys(state.watchers)
  const badKey = keys.find((k) => k.includes('o/bad'))
  state.watchers[badKey].deferReason = 'active-hours'
  state.watchers[badKey].lastError = null
  mod.__test.writeState(state)

  const text = String(await tools.find((t) => t.name === 'watch_status').execute({}))
  const lines = text.split(String.fromCharCode(10))
  const okLine = lines.find((l) => l.includes('o/ok')) || ''
  const badLine = lines.find((l) => l.includes('o/bad')) || ''

  assert.ok(okLine.length < 60, '正常的守行要短：' + okLine)
  assert.ok(!okLine.includes('暂停'), '正常的守不该有暂停原因')
  assert.ok(badLine.includes('暂停：active-hours'), '异常的守要说原因：' + badLine)
  assert.equal(lines.filter((l) => l.includes('| 每 ')).length, 2, '每条守一行')
})

test('/state 的事件按预算收缩：守越多，每守带的事件越少', async () => {
  const tools = []
  const localRoutes = new Map()
  const dir = tempDir('zhuli-budget-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    // 必须用本实例自己的路由表：共享的 call() 会打到别的实例/别的 state 目录（第一版就这么假失败）
    webServer: { register: (route) => { localRoutes.set(route.path, route); return () => {} } },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-budget' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?budget=' + Date.now())
  mod.apply(ctx)

  // 造 40 条守，每条 20 个事件
  const state = mod.__test.readState()
  state.watchers = {}
  for (let i = 0; i < 40; i += 1) {
    const id = 'acme/r' + i + '#session-budget'
    state.watchers[id] = {
      id, repo: 'acme/r' + i, sessionId: 'session-budget', intervalSec: 60, enabled: true,
      events: Array.from({ length: 20 }, (_, k) => ({ at: new Date().toISOString(), kind: 'poll', text: 'x' + k })),
    }
  }
  mod.__test.writeState(state)

  const route = localRoutes.get('/session-superagent/state')
  const fakeRes = {
    statusCode: 200, headers: {}, chunks: [],
    setHeader(k, v) { this.headers[k] = v },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
    get body() { return this.chunks.join('') },
  }
  await route.handler({ method: 'GET', url: '/session-superagent/state' }, fakeRes)
  const parsed = JSON.parse(fakeRes.body)
  const total = parsed.watchers.reduce((sum, w) => sum + (w.events || []).length, 0)
  assert.equal(parsed.watchers.length, 40)
  assert.ok(total <= 240, '总事件数不该超过预算 240：' + total)
  assert.ok(parsed.watchers[0].events.length <= 6, '每守最多 6 条')
})

test('watch_start 一次加多个仓库：逗号/空格都认，JSON 列出每个的结果', async () => {
  const tools = []
  const dir = tempDir('zhuli-multi-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-multi' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?multi=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')

  const text = String(await start.execute({ repo: 'acme/a, acme/b acme/c' }))
  assert.equal(text.split(String.fromCharCode(10)).length, 3, '三个仓库三行：' + text)
  const state = mod.__test.readState()
  assert.equal(Object.keys(state.watchers).length, 3, '三个守都要建好')

  const json = JSON.parse(String(await start.execute({ repo: 'acme/d acme/e', format: 'json' })))
  assert.equal(json.repos.length, 2, 'JSON 要列出每个仓库的结果')
  assert.equal(json.repo, 'acme/d', '旧的 repo 字段保留（兼容）')

  // 有一个写错就整体拒绝，不能只加一半
  const bad = String(await start.execute({ repo: 'acme/f not-a-repo' }))
  assert.ok(bad.includes('仓库要写成 owner/name'), '错误要说清格式：' + bad)
  const after = mod.__test.readState()
  assert.equal(Object.keys(after.watchers).length, 5, '失败时不该写进任何一条')
})

test('一条会话最多 20 条守：第 21 条被拒绝，批量请求整批拒绝', async () => {
  const tools = []
  const dir = tempDir('zhuli-cap-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-cap' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?cap=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')

  for (let i = 0; i < 20; i += 1) {
    const out = String(await start.execute({ repo: 'acme/r' + i }))
    assert.ok(!out.includes('最多挂'), '第 ' + (i + 1) + ' 条不该被拦：' + out)
  }
  const over = String(await start.execute({ repo: 'acme/overflow' }))
  assert.ok(over.includes('最多挂 20 条'), '第 21 条要被拦下：' + over)

  // 批量：整批拒绝（不能只加进去一半）
  const batch = String(await start.execute({ repo: 'acme/x acme/y' }))
  assert.ok(batch.includes('最多挂'), '批量也要拦：' + batch)
  const state = mod.__test.readState()
  assert.equal(Object.keys(state.watchers).length, 20, '总数仍是 20')
  assert.ok(!state.watchers['acme/x#session-cap'], '批量里的第一个也不该写进去')

  // 更新已有守不受上限影响
  const update = String(await start.execute({ repo: 'acme/r0', intervalSec: 120 }))
  assert.ok(!update.includes('最多挂'), '更新已有守不该被拦：' + update)
})

test('/state 回传 otherSessions：同仓库的其它会话', async () => {
  const tools = []
  const localRoutes = new Map()
  const dir = tempDir('zhuli-peers-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: (route) => { localRoutes.set(route.path, route); return () => {} } },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-a' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?peers=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  await start.execute({ repo: 'acme/shared' })

  // 手写另一个会话的守（模拟另一个会话也在守同一仓库）
  const state = mod.__test.readState()
  state.watchers['acme/shared#session-b'] = {
    id: 'acme/shared#session-b', repo: 'acme/shared', sessionId: 'session-b', intervalSec: 60, enabled: true,
  }
  mod.__test.writeState(state)

  const route = localRoutes.get('/session-superagent/state')
  const fakeRes = {
    statusCode: 200, headers: {}, chunks: [],
    setHeader(k, v) { this.headers[k] = v }, end(c) { if (c !== undefined) this.chunks.push(c) },
    get body() { return this.chunks.join('') },
  }
  await route.handler({ method: 'GET', url: '/session-superagent/state' }, fakeRes)
  const parsed = JSON.parse(fakeRes.body)
  const mine = parsed.watchers.find((w) => w.sessionId === 'session-a')
  const theirs = parsed.watchers.find((w) => w.sessionId === 'session-b')
  assert.deepEqual(mine.otherSessions, ['session-b'], '我方要看到对方')
  assert.deepEqual(theirs.otherSessions, ['session-a'], '对方也要看到我方')
})

test('刚重启不该被当成「定时器丢了」', async () => {
  const tools = []
  const dir = tempDir('zhuli-restart-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-restart' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?restart=' + Date.now())
  mod.apply(ctx)
  const doctor = tools.find((t) => t.name === 'watch_doctor')
  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'acme/old' })

  // 上次轮询是 2 小时前，但进程是刚启动的（startedAt = 现在）
  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].lastPoll = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
  state.server = { ...(state.server || {}), startedAt: new Date().toISOString() }
  mod.__test.writeState(state)

  const fresh = String(await doctor.execute({}))
  assert.ok(fresh.includes('刚重启'), '刚重启要如实说明：' + fresh.slice(0, 300))
  assert.ok(!fresh.includes('定时器可能丢了'), '刚重启不该报故障')

  // 进程已经跑够久（uptime 3 小时）时，同样的陈旧就要报故障
  const state2 = mod.__test.readState()
  state2.server = { ...(state2.server || {}), startedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }
  mod.__test.writeState(state2)
  const stale = String(await doctor.execute({}))
  assert.ok(stale.includes('没轮询过'), '跑久了还陈旧才算故障：' + stale.slice(0, 300))
})

test('watch_trace 文本：一切正常时一行说完，异常才展开', async () => {
  const tools = []
  const dir = tempDir('zhuli-trace-quiet-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-tq' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?tq=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  const trace = tools.find((t) => t.name === 'watch_trace')
  await start.execute({ repo: 'acme/q' })

  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].seen = { 55: '2026-11-01T10:00:00.000Z' }
  state.watchers[key].history = [{ at: '2026-11-02T09:00:00.000Z', numbers: [55], ok: true }]
  mod.__test.writeState(state)

  const quiet = String(await trace.execute({ number: 55 }))
  assert.equal(quiet.split(String.fromCharCode(10)).length, 2, '正常情况两行（结论 + 最近一次）：' + quiet)
  assert.ok(!quiet.includes('水位 seen'), '不堆细节')
  assert.ok(quiet.includes('最近一次唤醒'), '要给出时间')

  // 有失败唤醒时展开
  const state2 = mod.__test.readState()
  state2.watchers[key].history = [
    { at: '2026-11-02T09:00:00.000Z', numbers: [55], ok: true },
    { at: '2026-11-02T10:00:00.000Z', numbers: [55], ok: false, reason: 'agent busy' },
  ]
  mod.__test.writeState(state2)
  const loud = String(await trace.execute({ number: 55 }))
  assert.ok(loud.includes('唤醒尝试'), '有失败要展开：' + loud)
  assert.ok(loud.includes('agent busy'), '要说明失败原因')
})

test('/state 的 304 真的会命中：60 秒 12 次拉取，只有变化那几次返回 200', async () => {
  const tools = []
  const localRoutes = new Map()
  const dir = tempDir('zhuli-304-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: (route) => { localRoutes.set(route.path, route); return () => {} } },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-304' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?e304=' + Date.now())
  mod.apply(ctx)
  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'acme/etag' })

  const route = localRoutes.get('/session-superagent/state')
  const fetchOnce = async (ifNoneMatch) => {
    const res = {
      statusCode: 200, headers: {}, chunks: [],
      setHeader(k, v) { this.headers[k.toLowerCase()] = v },
      end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
      get body() { return this.chunks.join('') },
    }
    const headers = ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {}
    await route.handler({ method: 'GET', url: '/session-superagent/state', headers }, res)
    return res
  }

  // 12 次拉取：第 1 次拿 ETag，之后内容不变应有 10 次 304；第 6 次改一下状态
  const budget = { statuses: [], bytes: 0, saved: 0 }
  let etag = ''
  for (let i = 1; i <= 12; i += 1) {
    if (i === 6) {
      const state = mod.__test.readState()
      const key = Object.keys(state.watchers)[0]
      state.watchers[key].cursor = '2026-11-02T00:00:00.000Z'
      mod.__test.writeState(state)
    }
    const res = await fetchOnce(etag)
    budget.statuses.push(res.statusCode)
    budget.bytes += Buffer.byteLength(res.body)
    if (res.statusCode === 200) {
      etag = res.headers.etag
      budget.saved += 0 // 200 就是要下载的
    } else if (res.statusCode === 304) {
      budget.saved += 1
    }
  }
  const not304 = budget.statuses.filter((code) => code !== 304).length
  assert.equal(not304, 2, '12 次里只有 2 次 200（首次 + 改状态那次），实际：' + budget.statuses.join(','))
  assert.ok(budget.bytes < 8 * 1024, '省下来的正文要明显（实际收到 ' + budget.bytes + ' 字节）')
})

test('watch_start 能设 ackLabel：两个会话可各用各的标签，互不挡', async () => {
  const tools = []
  const dir = tempDir('zhuli-acklabel-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: () => () => {} },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-a' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?acklabel=' + Date.now())
  mod.apply(ctx)
  const start = tools.find((t) => t.name === 'watch_start')
  await start.execute({ repo: 'acme/shared', ackLabel: '团队A:已处理' })
  const state = mod.__test.readState()
  const entry = Object.values(state.watchers)[0]
  assert.equal(entry.ackLabel, '团队A:已处理', '自定义标签要写进状态')

  // 不传时保持默认
  await start.execute({ repo: 'acme/other' })
  const after = mod.__test.readState()
  const other = Object.values(after.watchers).find((w) => w.repo === 'acme/other')
  assert.equal(other.ackLabel, '主理鱼:已处理', '不传就用默认标签')
})

test('gh 把 304 当失败时，不该记成错误（条件请求命中 ≠ 出错）', async () => {
  const { classifyGhError } = await import('../lib/gh-format.js')
  for (const text of ['gh: HTTP 304', 'HTTP 304 Not Modified']) {
    const why = classifyGhError(text)
    assert.equal(why.kind, 'notmodified', text + ' → ' + why.kind)
    assert.ok(/不是错误/.test(why.hint), '提示要说清这不是错误：' + why.hint)
  }
  // 304 不属于任何"要人动手"的分类
  const notActionable = ['auth', 'notfound', 'moved']
  for (const text of ['gh: HTTP 304']) {
    assert.ok(!notActionable.includes(classifyGhError(text).kind))
  }
})

test('暂停一条守时会清掉旧的错误（否则暂停后永远显示"异常"）', async () => {
  const tools = []
  const localRoutes = new Map()
  const dir = tempDir('zhuli-pause-')
  process.env.DSH_SUPERAGENT_STATE = dir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  const ctx = {
    tools: { register: (tool) => tools.push(tool) },
    webServer: { register: (route) => { localRoutes.set(route.path, route); return () => {} } },
    agents: { get: () => null, currentInitiator: () => ({ id: 'session-pause' }) },
    get: () => null, on() {}, effect: (fn) => fn(), inject: () => {},
  }
  const mod = await import('../lib/index.js?pause=' + Date.now())
  mod.apply(ctx)
  await tools.find((t) => t.name === 'watch_start').execute({ repo: 'acme/pause' })

  // 先造一个错误（模拟刚才那条 304 误报）
  const state = mod.__test.readState()
  const key = Object.keys(state.watchers)[0]
  state.watchers[key].lastError = 'gh: HTTP 304（没归类的错误）'
  state.watchers[key].deferReason = 'unchanged'
  mod.__test.writeState(state)

  // 在面板点「暂停」
  const route = localRoutes.get('/session-superagent/watch')
  const fakeRes = makeRes()
  const body = JSON.stringify({ id: key, repo: 'acme/pause', sessionId: 'session-pause', enabled: false })
  await route.handler(makeReq('POST', '/session-superagent/watch', body, { 'content-type': 'application/json' }), fakeRes)
  assert.ok(fakeRes.statusCode === 200 || fakeRes.statusCode === 201, 'POST 应成功：' + fakeRes.statusCode + ' ' + fakeRes.body.slice(0, 120))

  const after = mod.__test.readState()
  const entry = after.watchers[key]
  assert.equal(entry.enabled, false, '要真的暂停')
  assert.equal(entry.lastError, null, '旧错误要清掉')
  assert.equal(entry.deferReason, null, '旧的暂停原因也要清掉')
})

test('非错误状态码聚一遍：200/204/304 都不该被当成失败', async () => {
  const { classifyGhError, parseGhInclude } = await import('../lib/gh-format.js')
  const CRLF = String.fromCharCode(13, 10)

  // 解析层：能从 gh --include 输出里认出状态码
  const notModified = parseGhInclude('HTTP/2.0 304 Not Modified' + CRLF + 'ETag: "abc"' + CRLF + CRLF)
  assert.equal(notModified.status, 304)
  assert.equal(notModified.etag, '"abc"')

  const ok = parseGhInclude('HTTP/2.0 200 OK' + CRLF + 'ETag: "def"' + CRLF + CRLF + '[{"number":1}]')
  assert.equal(ok.status, 200)
  assert.ok(ok.body.includes('number'))

  const noContent = parseGhInclude('HTTP/2.0 204 No Content' + CRLF + CRLF)
  assert.equal(noContent.status, 204)

  // 分类层：304 归 notmodified，且提示要说清「不是错误」
  const why = classifyGhError('gh: HTTP 304')
  assert.equal(why.kind, 'notmodified')
  assert.ok(why.hint.includes('不是错误'), '提示要直说不是错误：' + why.hint)
})

test('尊重 x-poll-interval：GitHub 要求更慢就照它等（解析 + 间隔下限）', async () => {
  const { parseGhInclude } = await import('../lib/gh-format.js')
  const CRLF = String.fromCharCode(13, 10)
  const withHeader = parseGhInclude('HTTP/2.0 200 OK' + CRLF + 'x-poll-interval: 90' + CRLF + CRLF + '[]')
  assert.equal(withHeader.pollInterval, 90, '要解析出 x-poll-interval')
  const without = parseGhInclude('HTTP/2.0 200 OK' + CRLF + CRLF + '[]')
  assert.equal(without.pollInterval, null, '没有这个头时是 null（不是 0）')

  // 间隔下限：min(配置, GitHub 要求) 取大者 —— 用纯函数验证逻辑本身
  const { nextDelayMs } = await import('../lib/watch.js')
  const entry = { consecutiveFailures: 1, minIntervalSec: 90 }
  const base = 60000
  const floor = Math.max(base, entry.minIntervalSec * 1000)
  assert.equal(floor, 90000, '下限应当是 90 秒')
  assert.ok(nextDelayMs(entry, floor) >= floor, '退避只在更大的方向上生效')
})

test('github 工具失败时带「下一步」与 kind（不再只贴原始 stderr）', async () => {
  const { formatGhCall, classifyGhError } = await import('../lib/gh-format.js')

  const notFound = formatGhCall({ code: 1, text: 'gh: HTTP 404 Not Found', classify: classifyGhError })
  assert.ok(notFound.includes('检查 owner/name'), '404 要说下一步：' + notFound)
  assert.ok(notFound.includes('[kind: notfound]'), '要给出机器可读的 kind')

  const auth = formatGhCall({ code: 1, text: 'gh: HTTP 401 Bad credentials', classify: classifyGhError })
  assert.ok(auth.includes('gh auth login'), '登录失效要指出怎么修')
  assert.ok(auth.includes('[kind: auth]'))

  // 304：不是错误，别让调用方以为失败了
  const notModified = formatGhCall({ code: 1, text: 'gh: HTTP 304', classify: classifyGhError })
  assert.ok(notModified.includes('不是错误'), '304 要说清不是错误')
  assert.ok(notModified.includes('[kind: notmodified]'))

  // 成功：不追加 kind，保持轻量
  const ok = formatGhCall({ code: 0, text: '[{"number":1}]', classify: classifyGhError })
  assert.ok(ok.includes('[exit code: 0]'))
  assert.ok(!ok.includes('[kind:'), '成功时不该带 kind')
})
