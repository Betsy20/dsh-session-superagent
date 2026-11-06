// issue #11：品牌与默认 ack 标签的配置链路（Config → lib → /state → client）。
//
// 这份用例故意只走公开面：Config / resolveBrandConfig / formatWatchText / mergeWakeTexts /
// statusView / 路由 / 工具 / 真实 client.js（假 React 渲染）。不 mock 内部函数，
// 否则「配置没接上」这种错会继续以「测试全绿」的形式存在。
import assert from 'node:assert/strict'
import test from 'node:test'

import { tempDir, assertTempStateDir } from './fixtures/tmpdir.mjs'
import { deskQueue, loadClient, walk, watcher } from './fixtures/panel-harness.mjs'

const STATE_DIR = tempDir('zhuli-brand-config-')
process.env.DSH_SUPERAGENT_STATE = STATE_DIR
process.env.DSH_SUPERAGENT_NO_POLL = '1'
process.env.DSH_SUPERAGENT_OFFLINE = '1'
process.env.DSH_SUPERAGENT_UPDATE_OFFLINE = '1'
assertTempStateDir('brand-config.test.mjs')

const mod = await import('../lib/index.js?brand-config=' + Date.now())
const {
  Config,
  resolveBrandConfig,
  apply,
  __test,
} = mod
const {
  DEFAULT_ACK_LABEL,
  DEFAULT_BRAND_NAME,
  formatWatchText,
  mergeWakeTexts,
  normalizeBrandName,
  statusView,
} = await import('../lib/watch.js')
const { DEFAULT_ACK_LABEL_GITEE } = await import('../lib/gitee.js')

const BRAND = '夜莺'
const ACK_GITHUB = '夜莺:已处理'
const ACK_GITEE = '夜莺-已处理'

const tools = []
const routes = new Map()
const ctx = {
  tools: { register: (tool) => { tools.push(tool) } },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => {}
    },
  },
  agents: { currentInitiator: () => ({ id: 'session-brand' }), get: () => null },
  get: () => null,
  on() {},
  effect: (fn) => fn(),
}
apply(ctx, { brandName: BRAND, defaultAckLabel: ACK_GITHUB, defaultAckLabelGitee: ACK_GITEE })

/** 造一个只够 /state 用的假 req/res（与 doctor-routes 同形）。 */
async function getState() {
  const res = {
    statusCode: 200,
    headers: {},
    chunks: [],
    setHeader(key, value) { this.headers[key] = value },
    end(chunk) { if (chunk !== undefined) this.chunks.push(chunk) },
  }
  await routes.get('/session-superagent/state').handler({ method: 'GET', url: '/session-superagent/state', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  return JSON.parse(res.chunks.join(''))
}

const issue = (number) => ({
  number,
  title: '品牌配置 ' + number,
  state: 'open',
  html_url: 'https://github.com/acme/brand/issues/' + number,
  updated_at: '2026-01-01T00:00:00Z',
  user: { login: 'octocat' },
  labels: [],
})

test('Config：默认品牌与两个默认 ack 标签，自定义字段各自生效', () => {
  assert.equal(typeof Config, 'function', 'lib/index.js 必须导出 schemastery Config')
  const defaults = Config({})
  assert.equal(defaults.brandName, DEFAULT_BRAND_NAME)
  assert.equal(defaults.defaultAckLabel, DEFAULT_ACK_LABEL)
  assert.equal(defaults.defaultAckLabelGitee, DEFAULT_ACK_LABEL_GITEE)

  const custom = Config({ brandName: BRAND })
  assert.equal(custom.brandName, BRAND)
  assert.equal(custom.defaultAckLabel, DEFAULT_ACK_LABEL, '没填的字段要由 schema 补默认值')
  assert.equal(custom.defaultAckLabelGitee, DEFAULT_ACK_LABEL_GITEE)
})

test('normalize：trim、空值回落、非法 Gitee 标签回落默认', () => {
  assert.equal(normalizeBrandName('  ' + BRAND + '  '), BRAND)
  assert.equal(normalizeBrandName(''), DEFAULT_BRAND_NAME)
  assert.equal(normalizeBrandName(null), DEFAULT_BRAND_NAME)
  // 抬头是单行结构：品牌名里夹换行不能把「【品牌】…」拆成两行
  assert.equal(normalizeBrandName('夜\n莺'), '夜 莺')

  const resolved = resolveBrandConfig({
    brandName: '  ' + BRAND + '  ',
    defaultAckLabel: '  ',
    defaultAckLabelGitee: '夜莺:已处理',
  })
  assert.equal(resolved.brandName, BRAND)
  assert.equal(resolved.defaultAckLabels.github, DEFAULT_ACK_LABEL, '空值要回落默认')
  assert.equal(resolved.defaultAckLabels.gitee, DEFAULT_ACK_LABEL_GITEE, '半角冒号在 Gitee 上非法，必须回落默认')

  const valid = resolveBrandConfig({ defaultAckLabelGitee: ACK_GITEE })
  assert.equal(valid.defaultAckLabels.gitee, ACK_GITEE, '合法的 Gitee 标签要保留')
})

test('唤醒抬头与合并抬头都用配置的品牌名；默认仍是「主理鱼」', () => {
  const header = formatWatchText('acme/brand', [issue(1)], { brandName: BRAND }).split('\n')[0]
  assert.equal(header, '【' + BRAND + '】acme/brand 有 1 条新动态：')

  const firstSync = formatWatchText('acme/brand', [issue(1)], { brandName: BRAND, firstSync: true }).split('\n')[0]
  assert.equal(firstSync, '【' + BRAND + '】acme/brand 首次同步：仓库里现有 1 条待处理（接上之前就在的，不是刚刚发生）：')

  const merged = mergeWakeTexts([
    formatWatchText('acme/brand', [issue(1)], { brandName: BRAND }),
    formatWatchText('acme/other', [issue(2)], { brandName: BRAND }),
  ], { brandName: BRAND })
  assert.equal(merged.split('\n')[0], '【' + BRAND + '】这一小段时间内有 2 处变化，合并成一条：')

  // 不传 brandName 时行为与 0.10.0 完全一致
  assert.equal(formatWatchText('acme/brand', [issue(1)]).split('\n')[0], '【' + DEFAULT_BRAND_NAME + '】acme/brand 有 1 条新动态：')
  assert.equal(mergeWakeTexts(['a', 'b']).split('\n')[0], '【' + DEFAULT_BRAND_NAME + '】这一小段时间内有 2 处变化，合并成一条：')
})

test('statusView 用配置的默认 ack（按 provider），显式 ack 不动', () => {
  const options = { defaultAckLabels: { github: ACK_GITHUB, gitee: ACK_GITEE } }
  assert.equal(statusView([{ repo: 'a/b', provider: 'github', sessionId: 's' }], options).watchers[0].ackLabel, ACK_GITHUB)
  assert.equal(statusView([{ repo: 'a/b', provider: 'gitee', sessionId: 's' }], options).watchers[0].ackLabel, ACK_GITEE)
  assert.equal(
    statusView([{ repo: 'a/b', provider: 'github', sessionId: 's', ackLabel: 'team:done' }], options).watchers[0].ackLabel,
    'team:done',
  )
  // 不传时保持旧默认
  assert.equal(statusView([{ repo: 'a/b', provider: 'github', sessionId: 's' }]).watchers[0].ackLabel, DEFAULT_ACK_LABEL)
  assert.equal(statusView([{ repo: 'a/b', provider: 'gitee', sessionId: 's' }]).watchers[0].ackLabel, DEFAULT_ACK_LABEL_GITEE)
})

test('/state 顶层下发 brandName 与 defaultAckLabels；缺省 ack 按品牌派生，显式 ack 不覆盖', async () => {
  const state = __test.readState()
  state.watchers = {
    'acme/legacy#session-brand': {
      id: 'acme/legacy#session-brand', repo: 'acme/legacy', provider: 'github',
      sessionId: 'session-brand', intervalSec: 60, enabled: false,
    },
    'gitee:acme/legacy#session-brand': {
      id: 'gitee:acme/legacy#session-brand', repo: 'acme/legacy', provider: 'gitee',
      sessionId: 'session-brand', intervalSec: 60, enabled: false,
    },
    'acme/explicit#session-brand': {
      id: 'acme/explicit#session-brand', repo: 'acme/explicit', provider: 'github',
      sessionId: 'session-brand', intervalSec: 60, enabled: false, ackLabel: 'team:done',
    },
  }
  __test.writeState(state)

  const body = await getState()
  assert.equal(body.brandName, BRAND, '/state 必须下发品牌名')
  assert.deepEqual(body.defaultAckLabels, { github: ACK_GITHUB, gitee: ACK_GITEE })
  const byId = new Map(body.watchers.map((w) => [w.id, w]))
  assert.equal(byId.get('acme/legacy#session-brand').ackLabel, ACK_GITHUB)
  assert.equal(byId.get('gitee:acme/legacy#session-brand').ackLabel, ACK_GITEE)
  assert.equal(byId.get('acme/explicit#session-brand').ackLabel, 'team:done', '已有显式 ack 不能被默认覆盖')
})

test('历史 Gitee 守存的旧标签仍被迁移，但不吞掉配置默认值', () => {
  const state = __test.readState()
  state.watchers['gitee:acme/old#session-brand'] = {
    id: 'gitee:acme/old#session-brand', repo: 'acme/old', provider: 'gitee',
    sessionId: 'session-brand', intervalSec: 60, enabled: false, ackLabel: '主理鱼:已处理',
  }
  __test.writeState(state)
  const migrated = __test.readState().watchers['gitee:acme/old#session-brand']
  assert.equal(migrated.ackLabel, '主理鱼-已处理', '旧值要换成 Gitee 能建出来的写法')
  // 但没写过 ackLabel 的条目仍是空，交给 /state 按配置派生
  assert.equal(__test.readState().watchers['gitee:acme/legacy#session-brand'].ackLabel, undefined)
})

test('watch_start 新建用品牌默认 ack；显式 ackLabel 优先，重复 start 不清掉', async () => {
  const start = tools.find((tool) => tool.name === 'watch_start')
  assert.ok(start)
  await start.execute({ repo: 'acme/widget', format: 'json' })
  const created = __test.readState().watchers['acme/widget#session-brand']
  assert.ok(created, 'watch_start 应建出守')
  assert.equal(created.ackLabel, ACK_GITHUB)

  await start.execute({ repo: 'acme/widget', ackLabel: 'team:done', format: 'json' })
  assert.equal(__test.readState().watchers['acme/widget#session-brand'].ackLabel, 'team:done')

  await start.execute({ repo: 'acme/widget', format: 'json' })
  assert.equal(__test.readState().watchers['acme/widget#session-brand'].ackLabel, 'team:done', '重复 start 不能用默认值覆盖显式标签')
})

test('watch_ack 对没有 ackLabel 的历史守用品牌默认标签', async () => {
  const state = __test.readState()
  state.watchers['acme/legacy-ack#session-brand'] = {
    id: 'acme/legacy-ack#session-brand', repo: 'acme/legacy-ack', provider: 'github',
    sessionId: 'session-brand', intervalSec: 60, enabled: true,
  }
  __test.writeState(state)
  const ack = tools.find((tool) => tool.name === 'watch_ack')
  const out = JSON.parse(String(await ack.execute({ repo: 'acme/legacy-ack', number: 7, format: 'json' })))
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.label, ACK_GITHUB)
})

test('watch_doctor 的 ack 默认值也来自品牌配置', () => {
  const doctor = tools.find((tool) => tool.name === 'watch_doctor')
  const src = String(doctor.description || '')
  // 工具描述里的默认值由 apply 生成，不能再写死旧品牌
  assert.ok(!src.includes(DEFAULT_ACK_LABEL) || ACK_GITHUB === DEFAULT_ACK_LABEL)
  const tool = tools.find((t) => t.name === 'watch_ack')
  const labelParam = tool.parameters.properties.label.description
  assert.ok(labelParam.includes(ACK_GITHUB), 'watch_ack 的 label 描述要显示配置的默认值：' + labelParam)
})

test('轮询路径（pollWithItems）用品牌默认 ack 过滤，而不是旧默认', async () => {
  const makeEntry = () => ({
    id: 'acme/poll#session-brand', repo: 'acme/poll', provider: 'github', sessionId: 'session-brand',
    intervalSec: 60, enabled: false, observe: true, seen: {}, lastReported: {}, cursor: null,
    filters: { labels: [], ignoreLabels: [], skipBots: false, skipDrafts: false, skipClosed: false },
  })
  const parsed = (item) => ({ status: 200, etag: null, body: JSON.stringify([item]) })
  const branded = { brandName: BRAND, defaultAckLabels: { github: ACK_GITHUB, gitee: ACK_GITEE } }

  // 旧默认标签在新品牌下**不是** ack 标记：这条应进入「本会唤醒」而不是被跳过
  const stale = makeEntry()
  await __test.pollWithItems(ctx, stale, 60000, parsed({ ...issue(9), labels: [{ name: DEFAULT_ACK_LABEL }], updated_at: new Date().toISOString() }), branded)
  assert.equal(stale.deferReason, 'observe', '旧默认标签不该再被判成「已 ack」')
  assert.equal(stale.filterCounts['已 ack'], undefined)

  // 品牌默认标签才是 ack 标记
  const acked = makeEntry()
  await __test.pollWithItems(ctx, acked, 60000, parsed({ ...issue(9), labels: [{ name: ACK_GITHUB }], updated_at: new Date().toISOString() }), branded)
  assert.equal(acked.filterCounts['已 ack'], 1, '品牌默认 ack 应被轮询跳过')

  // 不传品牌配置时保持旧默认
  const legacy = makeEntry()
  await __test.pollWithItems(ctx, legacy, 60000, parsed({ ...issue(9), labels: [{ name: DEFAULT_ACK_LABEL }], updated_at: new Date().toISOString() }))
  assert.equal(legacy.filterCounts['已 ack'], 1)
})

// ── client.js：三处 ack 回落改读 /state.defaultAckLabels ─────────────────

const deskRegistration = (client) => client.registrations.find((r) => r.opts.id === 'session-superagent-desk')
const orbitRegistration = (client) => client.registrations.find((r) => r.opts.id === 'session-superagent-orbit')
const textOf = (nodes) => nodes.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')

const stateBody = (extra = {}) => ({
  sessionGoal: null,
  sessionTitle: '品牌会话',
  credentials: { token: 'none', sshKeyPath: 'none' },
  gh: { ok: null, skipped: '没有 GitHub 守' },
  defaults: { sessionMaxWakes: 12, maxWakesPerHour: 6, isolateKeepDays: 3, batchLimit: 5 },
  brandName: BRAND,
  defaultAckLabels: { github: ACK_GITHUB, gitee: ACK_GITEE },
  watchers: [],
  ...extra,
})

test('client 回执行读 /state.defaultAckLabels（GitHub / Gitee 各一张）', () => {
  const client = loadClient()
  const desk = deskRegistration(client)
  const snap = {
    loading: false, error: null,
    body: stateBody({
      watchers: [
        watcher('acme/gh', { provider: 'github' }),
        watcher('acme/gitee', { provider: 'gitee' }),
      ],
    }),
  }
  const text = textOf(walk(client.render(desk, deskQueue(snap))))
  assert.ok(text.includes('回执 ' + ACK_GITHUB), 'GitHub 行要读 state 默认：' + text.slice(0, 400))
  assert.ok(text.includes('回执 ' + ACK_GITEE), 'Gitee 行要读 state 默认：' + text.slice(0, 400))
  assert.ok(!text.includes('回执 ' + DEFAULT_ACK_LABEL), '不能再回落旧字面量')
})

test('client 缺省（老服务端没有 defaultAckLabels）仍回落旧字面量', () => {
  const client = loadClient()
  const desk = deskRegistration(client)
  const body = stateBody({
    watchers: [
      watcher('acme/gh', { provider: 'github' }),
      watcher('acme/gitee', { provider: 'gitee' }),
    ],
  })
  delete body.defaultAckLabels
  delete body.brandName
  const text = textOf(walk(client.render(desk, deskQueue({ loading: false, error: null, body }))))
  assert.ok(text.includes('回执 ' + DEFAULT_ACK_LABEL), text.slice(0, 400))
  assert.ok(text.includes('回执 ' + DEFAULT_ACK_LABEL_GITEE), text.slice(0, 400))
})

test('client 行内编辑的 ack 草稿也读 /state.defaultAckLabels', () => {
  const client = loadClient()
  const desk = deskRegistration(client)
  const snap = {
    loading: false, error: null,
    body: stateBody({ watchers: [watcher('acme/gh', { provider: 'github' })] }),
  }
  const nodes = walk(client.render(desk, deskQueue(snap)))
  const opener = nodes.find((n) => n.type === 'button' && String(n.props.className || '').includes('dt-open'))
  assert.ok(opener, '每行要有可点标题')
  opener.props.onClick()
  const drafts = client.stateCalls().map((call) => call.next).filter((next) => next && typeof next === 'object' && 'ackLabel' in next)
  assert.equal(drafts.length, 1, '展开编辑应写入一份草稿')
  assert.equal(drafts[0].ackLabel, ACK_GITHUB, '草稿里的 ack 要来自 /state，不是写死的')
})

test('client 主标题 / dock 标题 / 空态用 /state.brandName；默认仍是主理鱼', () => {
  const branded = loadClient()
  const desk = deskRegistration(branded)
  const deskText = textOf(walk(branded.render(desk, deskQueue({ loading: false, error: null, body: stateBody() }))))
  assert.ok(deskText.includes(BRAND), '主页面标题要显示品牌名：' + deskText.slice(0, 300))

  // dock 的 brandName 在第 5 个状态槽（末尾追加，前四项保持原契约）
  const orbit = orbitRegistration(branded)
  const orbitText = textOf(walk(branded.render(orbit, [[], null, true, { x: 720, y: 860 }, BRAND])))
  assert.ok(orbitText.includes(BRAND), 'dock 标题要显示品牌名：' + orbitText.slice(0, 400))
  assert.ok(orbitText.includes('还没有。在「' + BRAND + '」标签页填 owner/name 加一条。'))

  const plain = loadClient()
  const plainText = textOf(walk(plain.render(deskRegistration(plain), deskQueue({ loading: false, error: null, body: { ...stateBody(), brandName: undefined } }))))
  assert.ok(plainText.includes('主理鱼'), '缺省品牌仍是主理鱼')
})
