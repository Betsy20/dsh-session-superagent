/**
 * 客户端渲染冒烟测试：不用浏览器，用假 React 跑真实 client.js。
 *
 * 覆盖三件在 0.3.1 之前踩过的事：
 *   1. 组件真的被注册进槽位（不是"代码在、注册没跑"）；
 *   2. 无主理鱼时不占位（dock 行里不留死图标）；
 *   3. 卫星数 = 主理鱼数（上限 6），错误态进详情面板。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deskForm, deskQueue, loadClient, walk, watcher } from './fixtures/panel-harness.mjs'

test('client.js 注册主理鱼与 composer dock 上的轨道环', () => {
  const { id, registrations } = loadClient()
  assert.equal(id, 'dsh-session-superagent')
  const names = registrations.map((r) => r.opts.name + '#' + r.opts.id)
  assert.ok(names.includes('conversation.view#session-superagent-desk'), names.join(','))
  assert.ok(names.includes('conversation.composer.dock#session-superagent-orbit'), names.join(','))
  // 0.3.2 起不再挂会话头部
  assert.ok(!names.some((n) => n.includes('header.actions')), '头部徽章应已移除')
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  assert.ok(orbit.opts.order < 0, 'order 要是负数，才能排在 activity(0)/usage(1) 左边')
})

test('0 个主理鱼也占位：灰色空环、没有卫星、不转', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const tree = render(orbit, [[]])
  assert.ok(tree, '0 主理鱼不该整条消失，否则看着像功能坏了')
  const nodes = walk(tree)
  const circles = nodes.filter((n) => n.type === 'circle')
  assert.equal(circles.length, 1, '只有一个环，没有卫星')
  assert.equal(circles[0].props.stroke, 'currentColor', '空态用继承色（灰）')
  assert.equal(circles[0].props.opacity, 0.38, '空态压暗')
  assert.equal(nodes.filter((n) => n.type === 'animateTransform' || n.type === 'animate').length, 0, '空态不该有动画')
  assert.match(String(tree.props.title), /还没有主理鱼/)
})

test('空态点开面板显示引导文案', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const nodes = walk(render(orbit, [[], true, { x: 720, y: 860 }]))
  const panel = nodes.find((n) => n.props && n.props.role === 'dialog')
  assert.ok(panel, '空态也要能展开面板')
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('0 条'), text.slice(0, 120))
  assert.ok(text.includes('主理鱼') && text.includes('owner/name'), '空态要告诉人去哪加：' + text.slice(0, 120))
  assert.ok(!text.includes('暂停'), '没有主理鱼时不该出现暂停/删除的说明')
  assert.equal(panel.props.style.width, 252, '空态面板要比常规面板窄')
})

test('卫星数跟随主理鱼数，超过 6 个截断', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const circlesOf = (list) => walk(render(orbit, [list])).filter((n) => n.type === 'circle').length
  assert.equal(circlesOf([watcher('a/b')]), 2, '环 + 1 颗卫星')
  assert.equal(circlesOf(['a/b', 'c/d', 'e/f'].map((r) => watcher(r))), 4, '环 + 3 颗卫星')
  assert.equal(circlesOf(['a/b', 'c/d', 'e/f', 'g/h', 'i/j', 'k/l', 'm/n'].map((r) => watcher(r))), 7, '最多 6 颗')
})

test('主理中才转：靠 SVG 自带的 SMIL，不靠外部样式表', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const animsOf = (list) => {
    const group = walk(render(orbit, [list])).find((n) => n.type === 'g')
    return (group.props.children || []).filter((c) => c && c.type === 'animateTransform')
  }
  assert.equal(animsOf([watcher('a/b', { enabled: false })]).length, 0, '暂停不该转')
  assert.equal(animsOf([watcher('a/b', { lastError: 'boom' })]).length, 0, '异常不该转')
  const active = animsOf([watcher('a/b')])
  assert.equal(active.length, 1, '主理中必须有一个旋转动画')
  assert.equal(active[0].props.type, 'rotate')
  assert.equal(active[0].props.from, '0 8 8', '旋转中心必须是环心')
  assert.equal(active[0].props.repeatCount, 'indefinite')
  // 没有主理鱼时仍然渲染，只是灰环没卫星（见空态那条用例）
})

test('异常卫星呼吸、正常卫星不呼吸，环自己在呼吸', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const opacityDurs = (list) => walk(render(orbit, [list]))
    .filter((n) => n.type === 'animate' && n.props.attributeName === 'opacity')
    .map((n) => n.props.dur)
  // 异常：只有红点呼吸（1.6s），环不呼吸（没有 active）
  assert.deepEqual(opacityDurs([watcher('a/b', { lastError: 'boom' })]), ['1.6s'])
  // 正常主理鱼：只有环在呼吸（2.6s），点不呼吸
  assert.deepEqual(opacityDurs([watcher('a/b')]), ['2.6s'])
  // 暂停：全静止
  assert.deepEqual(opacityDurs([watcher('a/b', { enabled: false })]), [])
})

test('点击展开的面板逐条列出仓库 / 会话 / 间隔 / 轮询 / 状态', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [
    watcher('a/b', { sessionId: 'session-1e82afca-8be2-42f9-8186-2bd274e30342', goal: { objective: '让主理鱼实时同步 goal', phase: null, revision: 3 } }),
    watcher('c/d', { sessionId: 'session-7f7155cf-20f0-4d9a', lastError: 'HttpError: 401 bad credentials' }),
  ]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const panel = nodes.find((n) => n.props && n.props.role === 'dialog')
  assert.ok(panel, '面板没有渲染')
  assert.equal(panel.props.style.position, 'fixed')
  assert.equal(panel.props.style.width, 344)
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  const needles = [
    '主理鱼', '1/2 主理中', 'a/b', 'c/d', '主理中', '异常', '每 30s', '401 bad credentials',
    // 会话标题可能重名，所以每行必须带 8 位会话后缀
    '1e82afca', '7f7155cf',
    // 有 goal 的 superagent 要显示 goal 摘要
    'goal · 让主理鱼实时同步 goal',
  ]
  for (const needle of needles) assert.ok(text.includes(needle), '面板缺少「' + needle + '」：' + text.slice(0, 240))
  assert.ok(!text.includes('[object Object]'), 'goal 被当成对象直接拼进了文案')
})

test('状态栏面板每行都带暂停/删除，能直接关掉一个主理鱼', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b'), watcher('c/d', { enabled: false })]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const labels = nodes
    .filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.includes('暂停'), '运行中的行要有「暂停」：' + labels.join('|'))
  assert.ok(labels.includes('恢复'), '已暂停的行要有「恢复」：' + labels.join('|'))
  assert.ok(labels.includes('删除'), '每行都要能删除：' + labels.join('|'))
})

test('主理鱼面板：总览有统计与每行操作（移植官方 GUI 后）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [
        watcher('a/b', { id: 'a/b#s1', enabled: true }),
        watcher('c/d', { id: 'c/d#s2', enabled: false }),
      ],
    },
  }
  const form = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  for (const needle of ['主理鱼', '总览', '触发', '设置', '条主理鱼', '主理中', '已暂停', '全部暂停']) {
    assert.ok(text.includes(needle), '面板缺少「' + needle + '」：' + text.slice(0, 200))
  }
  const labels = nodes.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  for (const want of ['立刻', '暂停', '删除']) {
    assert.ok(labels.includes(want), '缺按钮「' + want + '」：' + labels.join('|'))
  }
})

test('主理鱼面板：退避中与隔离状态以标签形式出现', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', enabled: true, consecutiveFailures: 2,
        nextAt: new Date(Date.now() + 45000).toISOString(),
        isolated: true, workdir: 'E:/temp/iso', lastWorktree: 'E:/temp/iso/.dsh-zhuli/a-b-1',
      })],
    },
  }
  const form = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(/退避 \d+s/.test(text), '要显示退避：' + text.slice(0, 240))
  assert.ok(text.includes('隔离 · '), '要显示隔离：' + text.slice(0, 240))
})

test('面板显示过滤器与失败退避', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b', {
    filters: { labels: ['ai-fix'], ignoreLabels: ['wontfix'], onlyAssigned: false },
    nextAt: new Date(Date.now() + 45000).toISOString(),
    consecutiveFailures: 1,
  })]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('标签: ai-fix'), '要显示标签白名单：' + text.slice(0, 200))
  assert.ok(text.includes('排除: wontfix'), '要显示排除标签')
  assert.ok(/退避 \d+s/.test(text), '要显示退避剩余秒数：' + text.slice(0, 200))
})

test('面板显示隔离执行状态与活跃时段', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b', {
    isolated: true,
    lastWorktree: 'E:/temp/iso/.dsh-zhuli/a-b-123',
    workdir: 'E:/temp/iso',
    activeHours: '09:00-23:00',
  })]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('隔离 · '), '要显示隔离状态：' + text.slice(0, 200))
  assert.ok(text.includes('dsh-zhuli/a-b-123'), '要显示上次的 worktree 尾段')
  assert.ok(text.includes('时段 09:00-23:00'), '要显示活跃时段')
})

test('值守台有全部暂停/全部恢复按钮', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', enabled: true })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const labels = nodes.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.includes('全部暂停'), labels.join('|'))
  assert.ok(labels.includes('全部恢复'), labels.join('|'))
})

test('面板显示最近一次唤醒的结果', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const at = new Date(Date.now() - 120000).toISOString()
  const list = [watcher('a/b', { history: [{ at, numbers: [12, 13], ok: true, reason: null }] })]
  const nodes = walk(render(orbit, [list, true, { x: 720, y: 860 }]))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('上次唤醒 #12 #13'), text.slice(0, 220))
  assert.ok(text.includes('2 分钟前'), text.slice(0, 220))

  const failed = render(orbit, [[watcher('a/b', { history: [{ at, numbers: [7], ok: false, reason: 'session not live' }] })], true, { x: 720, y: 860 }])
  const failedText = walk(failed).filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(failedText.includes('上次唤醒失败 #7'), failedText.slice(0, 220))
})

test('主理鱼面板：失败会在「需要关注」里变成一条可读问题', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', enabled: true, lastError: 'gh: Not Found (HTTP 404)' })],
    },
  }
  const form = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('需要关注'), '要有 problems 区块：' + text.slice(0, 200))
  assert.ok(text.includes('轮询失败'), '要把 lastError 变成人话')
  assert.ok(text.includes('未配置 token'), '凭证提示也算一条问题')
})

test('主理鱼面板：每行有「编辑」按钮（点开后可改间隔/过滤/时段/隔离）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'configured', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', enabled: true })],
    },
  }
  const form = { repo: '', intervalSec: '60', goal: '', labels: '', onlyAssigned: false, activeHours: '', isolated: false, workdir: '' }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  // 对齐官方 TicketLine：点标题（dt-open 按钮）展开，而不是另设一个「编辑」按钮
  const opens = nodes.filter((n) => n.type === 'button' && String(n.props.className || '').includes('dt-open'))
  assert.equal(opens.length, 1, '每行应该有一个可点标题（dt-open）')
  assert.equal(opens[0].props['aria-expanded'], false, '未展开时 aria-expanded=false')
  assert.ok(String(opens[0].props.children).includes('a/b'), '标题就是仓库名')
  const labels = nodes.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.includes('立刻') && labels.includes('暂停'), '行内操作仍在：' + labels.join('|'))
  // 打开编辑态：editing === id 时出现保存/放弃
  const editing = walk(render(desk, deskQueue(snapshot, 'a/b#session-a/b', { intervalSec: '60', labels: '', activeHours: '', isolated: false })))
  const editingLabels = editing.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(editingLabels.includes('保存'), '编辑态要有保存：' + editingLabels.join('|'))
  assert.ok(editingLabels.includes('放弃'), '编辑态要有放弃')
})

test('主理鱼面板：仅观察标签 + 最近被过滤清单', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'configured', sshKeyPath: 'none' },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', enabled: true, observe: true,
        filteredLog: [
          { at: '2026-11-01T12:00:00Z', number: 7, title: '机器人提的依赖升级', reason: '机器人' },
          { at: '2026-11-01T12:00:00Z', number: 8, title: '草稿', reason: '草稿 PR' },
        ],
      })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('仅观察'), '要有仅观察标签：' + text.slice(0, 200))
  assert.ok(text.includes('最近被过滤'), '要有过滤清单')
  assert.ok(text.includes('机器人'), '要显示过滤原因')
  assert.ok(text.includes('#7'), '要显示被过滤的编号')
})

test('主理鱼面板：搜索能过滤，术语表能打开，设置页有来源卡片', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      gh: { ok: true, version: 'gh version 2.40.0' },
      watchers: [watcher('a/b', { id: 'a/b#s1' }), watcher('c/d', { id: 'c/d#s2' })],
    },
  }
  const filtered = walk(render(desk, deskQueue(snapshot, null, {}, 'overview', 'a/b')))
  const filteredText = filtered.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(filteredText.includes('a/b'), '命中项要留着')
  assert.ok(!filteredText.includes('c/d'), '不命中的要被过滤掉：' + filteredText.slice(0, 160))
  assert.ok(filteredText.includes('搜索结果'), '搜索时标题变成搜索结果')

  const settings = walk(render(desk, deskQueue(snapshot, null, {}, 'settings')))
  const settingsText = settings.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(settingsText.includes('来源'), '设置页要有来源卡片')
  assert.ok(settingsText.includes('gh version'), '要显示 gh CLI 版本：' + settingsText.slice(0, 200))

  const glossary = walk(render(desk, deskQueue(snapshot, null, {}, 'overview', '', true)))
  const glossaryText = glossary.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(glossaryText.includes('主理鱼术语表'), '术语表要能打开')
  assert.ok(glossaryText.includes('盯') && glossaryText.includes('办'), '术语表要有「盯」「办」两条')
})

test('主理鱼面板：「判定」页把每轮结果和原因列出来', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = new Date(Date.now() - 60000).toISOString()
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', {
        id: 'a/b#s1',
        history: [
          { at, numbers: [12], ok: true, reason: null },
          { at, numbers: [13], ok: false, reason: 'observe' },
          { at, numbers: [14], ok: false, reason: 'agent busy (running)' },
        ],
      })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot, null, {}, 'judge')))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('判定日志'), text.slice(0, 200))
  assert.ok(text.includes('已唤醒'), '成功的要显示已唤醒')
  assert.ok(text.includes('仅观察（未唤醒）'), 'observe 的要标出来')
  assert.ok(text.includes('#13'), '要显示编号')
})

test('删除按钮必须保留 dt-btn 基类（第二轮审核发现 className 被 ...rest 覆盖过）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'configured', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1' })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const buttons = nodes.filter((n) => n.type === 'button')
  const labels = buttons.map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  const deleteIndex = labels.indexOf('删除')
  assert.ok(deleteIndex >= 0, '找不到删除按钮：' + labels.join('|'))
  const deleteClass = String(buttons[deleteIndex].props.className || '')
  assert.ok(deleteClass.includes('dt-btn '), '删除按钮丢了 dt-btn 基类：' + deleteClass)
  assert.ok(deleteClass.includes('dt-btn-sm'), '删除按钮丢了尺寸类：' + deleteClass)
})

test('面板恢复显示会话标题与每行 goal', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionTitle: '主理鱼重构',
      sessionGoal: null,
      credentials: { token: 'configured', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', note: '把 widget 的 issue 都处理完' })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('会话：主理鱼重构'), '头部要显示会话标题：' + text.slice(0, 180))
  assert.ok(text.includes('目标: 把 widget 的 issue'), '每行要显示目标/规则：' + text.slice(0, 240))
})

test('删除按钮 armed 态仍然保留 dt-btn 基类（并变成危险色）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'configured', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1' })],
    },
  }
  // 第 13 个 hook 槽是 ConfirmBtn 的 armed
  const armed = walk(render(desk, [...deskQueue(snapshot), true]))
  const buttons = armed.filter((n) => n.type === 'button')
  const labels = buttons.map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  const index = labels.indexOf('确认删除')
  assert.ok(index >= 0, 'armed 态文案应变成「确认删除」：' + labels.join('|'))
  const className = String(buttons[index].props.className || '')
  assert.ok(className.includes('dt-btn '), 'armed 态丢了 dt-btn 基类：' + className)
  assert.ok(className.includes('dt-danger'), 'armed 态要标危险：' + className)
})

test('有新版本时面板顶部给一条横幅，点进去看升级命令', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: '会话', credentials: { token: 'configured', sshKeyPath: 'none' }, watchers: [] },
  }
  const update = { current: '0.8.38', latest: '0.9.0', hasUpdate: true, command: 'dsh plugin add dsh-session-superagent@0.9.0' }
  const nodes = walk(render(desk, deskQueue(snapshot, null, {}, 'overview', '', false, update)))
  const text = nodes.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('有新版本 0.9.0'), '横幅要写明新版本：' + text.slice(0, 200))
  assert.ok(text.includes('看升级命令'), '要有入口')

  // 没有新版本时不该出现横幅
  const quiet = walk(render(desk, deskQueue(snapshot, null, {}, 'overview', '', false, { current: '0.8.38', latest: '0.8.38', hasUpdate: false })))
  const quietText = quiet.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!quietText.includes('有新版本'), '没新版本就别打扰')
})

test('活跃时段之外的 watcher 不再谎报「主理中」（改显示「时段外」）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  // 造一个一定落在窗口外的时段：把「当前时间」往后推一小时当起点，跨度一小时
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const from = (now.getHours() + 2) % 24
  const to = (from + 1) % 24
  const window = pad(from) + ':00-' + pad(to) + ':00'
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/window', { activeHours: window })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('时段外'), '窗口外应显示「时段外」，实际：' + text.slice(0, 200))
  assert.ok(text.includes('时段 ' + window), '时段本身仍然要显示给人看')
})

test('设置页用官方左栏导航（dt-settings + dt-settings-nav）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: '会话', credentials: { token: 'none', sshKeyPath: 'none' }, watchers: [] },
  }
  const nodes = walk(render(desk, deskQueue(snapshot, null, {}, 'settings')))
  const grid = nodes.filter((n) => String(n.props && n.props.className || '').includes('dt-settings'))
  assert.ok(grid.length >= 1, '设置页要用 dt-settings 网格')
  const links = nodes.filter((n) => String(n.props && n.props.className || '').includes('dt-settings-link'))
  assert.equal(links.length, 5, '左栏应有 5 个分区（来源/凭证/版本与更新/诊断/goal）')
  const current = links.filter((n) => n.props['aria-current'] === 'page')
  assert.equal(current.length, 1, '当前分区要有 aria-current=page')
})

test('空态不是白屏：三步引导 + 一个能直接开始的动作', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: '会话', credentials: { token: 'none', sshKeyPath: 'none' }, watchers: [] },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('三步'), '空态要给出上手路径：' + text.slice(0, 160))
  assert.ok(text.includes('①') && text.includes('③'), '三步都要在')
  const labels = nodes.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.some((l) => l.includes('去添加第一条')), '要有一个直接开始的按钮：' + labels.join('|'))
})

test('判定页：点跳过原因标签可只看这一类（知识库里的"还没做"补上）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', {
        id: 'a/b#s1',
        filterCounts: { '不在标签白名单: ai-fix': 7, '机器人': 0 },
        filteredLog: [{ at: '2026-11-02T08:00:00.000Z', number: 42, title: '一个被刷掉的 issue', reason: '不在标签白名单: ai-fix' }],
      })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot, null, {}, 'judge')))
  const pills = nodes.filter((n) => String(n.props && n.props.className || '').includes('dt-pill'))
  assert.ok(pills.length >= 1, '原因应该渲染成可点的 Pill')
  const labels = pills.map((p) => (p.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.some((l) => l.includes('不在标签白名单') && l.includes('7')), labels.join('|'))

  // 选中某个原因后，列表里应出现该类条目
  const filtered = walk(render(desk, deskQueue(snapshot, null, {}, 'judge').map((v, i) => (i === 15 ? '不在标签白名单: ai-fix' : v))))
  const text = filtered.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('#42'), '筛选后要列出该类条目：' + text.slice(0, 200))
})

test('能力徽章可点：点「只读」只剩只读的守', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [
        watcher('ok/one', { id: 'ok/one#s1', repoAccess: { repo: 'ok/one', push: true, hasIssues: true } }),
        watcher('ro/two', { id: 'ro/two#s2', repoAccess: { repo: 'ro/two', push: false, hasIssues: true } }),
      ],
    },
  }
  // 未筛选：两条都在
  const all = walk(render(desk, deskQueue(snapshot)))
  const allText = all.filter((n) => typeof n.text === 'string').map((n) => n.text).join('|')
  assert.ok(allText.includes('ok/one') && allText.includes('ro/two'), '未筛选应显示两条')

  // 选中「只读」：只剩 ro/two
  const filtered = walk(render(desk, deskQueue(snapshot).map((v, i) => (i === 16 ? '只读' : v))))
  const filteredText = filtered.filter((n) => typeof n.text === 'string').map((n) => n.text).join('|')
  assert.ok(filteredText.includes('ro/two'), '只读筛选要留下 ro/two：' + filteredText.slice(0, 160))
  assert.ok(!filteredText.includes('ok/one'), '只读筛选不该留下 ok/one')
  assert.ok(filteredText.includes('只看 只读 的守'), '要有明确的状态提示')
})

test('中间态：有守但从未唤醒过，要给"在等"的引导而不是沉默', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snapshot = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话',
      credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', lastPoll: '2026-11-02T08:00:00Z', lastWake: null })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snapshot)))
  const text = nodes.filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('还没有唤醒过'), '要说明"在等"：' + text.slice(0, 200))
  assert.ok(text.includes('立刻'), '要给出可以马上试一下的动作')

  // 已经唤醒过的不该再显示这句
  const woken = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: '会话', credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', lastWake: '2026-11-02T08:00:00Z' })] },
  }
  const after = walk(render(desk, deskQueue(woken))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!after.includes('还没有唤醒过'), '唤醒过就不该再提示')
})

test('需要重启时面板顶部要有横幅（"功能看起来没生效"最常见的根因）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const base = {
    sessionGoal: null, sessionTitle: '会话',
    credentials: { token: 'none', sshKeyPath: 'none' }, watchers: [],
  }
  const drifted = { loading: false, error: null, body: { ...base, installedVersion: '0.9.0', runningVersion: '0.8.4' } }
  const text = walk(render(desk, deskQueue(drifted))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('需要重启宿主'), '要明确说要重启：' + text.slice(0, 160))
  assert.ok(text.includes('0.9.0') && text.includes('0.8.4'), '要写出两个版本号')

  const same = { loading: false, error: null, body: { ...base, installedVersion: '0.9.0', runningVersion: '0.9.0' } }
  const quiet = walk(render(desk, deskQueue(same))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!quiet.includes('需要重启宿主'), '一致时不该出现横幅')
})

test('面板自己的错误也要说人话（Failed to fetch 客户看不懂）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = { loading: false, error: 'Failed to fetch', body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [] } }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!text.includes('Failed to fetch'), '不该把原始英文丢给客户')
  assert.ok(text.includes('连不上宿主'), '要说明发生了什么：' + text.slice(0, 200))
  assert.ok(text.includes('诊断'), '要给出下一步动作')
})

test('判定页要能看见时间线（"为什么没叫醒我"要有据可查）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('a/b', { id: 'a/b#s1', events: [
        { at: new Date().toISOString(), kind: 'cap-session', text: '这条会话一小时内已被唤醒 12 次（上限 12），已攒 3 条待处理' },
        { at: new Date().toISOString(), kind: 'wake', text: '唤醒了 2 条：#1 #2' },
      ] }),
    ] },
  }
  // 时间线在「判定」页：切 tab 再渲染
  const text = walk(render(desk, deskQueue(snap, null, {}, 'judge'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('时间线'), '要有时间线区块：' + text.slice(0, 160))
  assert.ok(text.includes('cap-session'), '要显示事件类型')
  assert.ok(text.includes('已被唤醒 12 次'), '要显示人话内容')
})

test('"叫醒了没回音"要给出下一步动作：建议规则可以复制（不代写仓库文件）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('a/b', { id: 'a/b#s1', silentWakes: 3 }),
    ] },
  }
  // 1) 默认不渲染弹层内容（不该占版面）
  const closed = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!closed.includes('主理鱼（dsh-session-superagent）处理规则'), '没点开时不该渲染规则文本')
  assert.ok(closed.includes('没有回音'), '要有那条提示')

  // 2) 点开后能看到规则，并且明确"不代写文件"
  const opened = walk(render(desk, deskQueue(snap, null, {}, 'overview', '', 'rules:a/b'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(opened.includes('主理鱼（dsh-session-superagent）处理规则'), '要给出可复制的规则：' + opened.slice(0, 200))
  assert.ok(opened.includes('watch_ack'), '规则里要强调 ack')
  assert.ok(opened.includes('复制这段规则'), '要有复制动作')
})

test('「按仓库」汇总里的仓库名可以点（点一下只看这个仓库）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('a/b', { id: 'a/b#s1' }),
      watcher('c/d', { id: 'c/d#s2', sessionId: 'session-c/d' }),
    ] },
  }
  const nodes = walk(render(desk, deskQueue(snap)))
  const buttons = nodes.filter((n) => n.type === 'button' && n.props && typeof n.props.onClick === 'function' && n.props.title === '点一下只看这个仓库（再点取消）')
  assert.equal(buttons.length, 2, '每个仓库一个可点名字')
  // 搜索已命中某仓库时，只应看到它的明细
  const filtered = walk(render(desk, deskQueue(snap, null, {}, 'overview', 'a/b')))
    .filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(filtered.includes('a/b'), '命中的要留下')
  assert.ok(!filtered.includes('c/d'), '不命中的要过滤掉：' + filtered.slice(0, 200))
})

test('「只看有问题的」：一键筛掉健康的守，并且能一键回到全部', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('ok/healthy', { id: 'ok/healthy#s1' }),
      watcher('bad/error', { id: 'bad/error#s2', sessionId: 's2', lastError: 'boom' }),
      watcher('bad/silent', { id: 'bad/silent#s3', sessionId: 's3', silentWakes: 3 }),
    ] },
  }
  const all = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(all.includes('只看有问题的 (2)'), '要有入口并带上数量：' + all.slice(0, 200))

  // problemsOnly = true（第 18 个槽）
  const only = walk(render(desk, deskQueue(snap, null, {}, 'overview', '', '', null, false))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  const filteredQueue = deskQueue(snap)
  filteredQueue[17] = true
  const onlyBad = walk(render(desk, filteredQueue)).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(onlyBad.includes('bad/error') && onlyBad.includes('bad/silent'), '有问题的要留下')
  assert.ok(!onlyBad.includes('ok/healthy'), '健康的不该出现：' + onlyBad.slice(0, 240))
  assert.ok(onlyBad.includes('全部'), '要能一键回到全部')
})

test('只读仓库要在「需要关注」里出现（不能只靠行内一个小徽章）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('me/readonly', { id: 'me/readonly#s1', repoAccess: { repo: 'me/readonly', push: false, hasIssues: true } }),
      watcher('me/writable', { id: 'me/writable#s2', sessionId: 's2', repoAccess: { repo: 'me/writable', push: true, hasIssues: true } }),
    ] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('只有读权限'), '要有人话说明：' + text.slice(0, 240))
  assert.ok(text.includes('换有写权限的 token'), '要给出下一步')
  assert.ok(!text.includes('你对 me/writable 只有读权限'), '有写权限的仓库不该出现这条')
})

test('gh 不可用要说清后果与下一步（不能只显示原始错误）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: 'x', credentials: { token: 'none', sshKeyPath: 'none' },
      gh: { ok: false, error: 'gh: command not found' },
      watchers: [watcher('a/b', { id: 'a/b#s1' })],
    },
  }
  const text = walk(render(desk, deskQueue(snap, null, {}, 'settings', '', false, null, false, 'source')))
    .filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('gh auth login'), '要给出下一步命令：' + text.slice(0, 300))
  assert.ok(text.includes('填 token'), '要给备选方案')

  const overviewText = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(overviewText.includes('所有轮询都会失败'), '总览要说明后果：' + overviewText.slice(0, 300))
})

test('归档 / 禁用仓库也要在「需要关注」里说清（客户端之前漏了这两条）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('old/archived', { id: 'old/archived#s1', repoAccess: { repo: 'old/archived', archived: true, push: false } }),
      watcher('gone/disabled', { id: 'gone/disabled#s2', sessionId: 's2', repoAccess: { repo: 'gone/disabled', disabled: true, push: true } }),
    ] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('已归档'), '归档要说：' + text.slice(0, 240))
  assert.ok(text.includes('已被禁用'), '禁用要说')
  assert.ok(text.includes('只能看、不能回写'), '归档要说明后果')
})

test('面板显示本会话用量，到上限时给出可执行的建议', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const base = { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [watcher('a/b', { id: 'a/b#s1' })] }

  const half = walk(render(desk, deskQueue({ loading: false, error: null, body: { ...base, sessionUsage: { used: 3, cap: 12, capped: 0 } } })))
    .filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(half.includes('唤醒 3/12'), '要有用量：' + half.slice(0, 200))
  assert.ok(!half.includes('已到上限'), '没用满时不该报警')

  const full = walk(render(desk, deskQueue({ loading: false, error: null, body: { ...base, sessionUsage: { used: 12, cap: 12, capped: 2, suggest: 24 } } })))
    .filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(full.includes('已到上限'), '到上限要提示')
  assert.ok(full.includes('调到 24'), '要给出具体数字而不是只说“调大”：' + full.slice(0, 260))
  assert.ok(full.includes('2 条守正因上限暂停'), '要说清影响')
})

test('暂停原因可以按原因码筛选（点 Pill 只看那一类）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [
      watcher('a/cap', { id: 'a/cap#s1', deferReason: 'cap-session', lastDeferred: '这条会话一小时内已被唤醒 12 次' }),
      watcher('b/rate', { id: 'b/rate#s2', sessionId: 's2', deferReason: 'ratelimit', lastDeferred: '被 GitHub 限流' }),
    ] },
  }
  // 判定页要列出原因码与人话
  const judge = walk(render(desk, deskQueue(snap, null, {}, 'judge'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(judge.includes('撞会话上限'), '原因码要翻成人话：' + judge.slice(0, 240))
  assert.ok(judge.includes('被 GitHub 限流'), '另一个原因也要在')

  // 选中 defer:cap-session 后，明细只剩那一类
  const filtered = deskQueue(snap, null, {}, 'overview')
  filtered[15] = 'defer:cap-session'
  const text = walk(render(desk, filtered)).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('a/cap'), '命中原因的要留下')
  assert.ok(!text.includes('b/rate'), '别的原因不该出现：' + text.slice(0, 240))
})

test('判定页：搜索框输入编号后可追溯（点它问服务端要结论）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [watcher('a/b', { id: 'a/b#s1' })] },
  }
  const empty = walk(render(desk, deskQueue(snap, null, {}, 'judge'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(empty.includes('追溯一条'), '要有追溯区块')
  assert.ok(empty.includes('输入编号'), '没输入时要提示怎么用')

  const filled = walk(render(desk, deskQueue(snap, null, {}, 'judge', '42'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(filled.includes('追溯 #42'), '输入编号后要出现追溯按钮：' + filled.slice(0, 200))
  assert.ok(filled.includes('在 a/b 里查'), '只有一条守时应说明在哪个仓库查')
})

test('面板显示近几天的累计（来自每条守的 daily）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 2, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', daily: { days: 3, total: 9, avg: 3 } })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('过去 3 天：共 9 次'), '要显示历史累计：' + text.slice(0, 240))
})

test('"今天明显比平时忙"只有 busy=true 时才提示（阈值判断在服务端）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const mk = (busy) => ({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 2, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', daily: { days: 4, total: 12, avg: 3, today: 9 }, busy })] },
  })
  const calm = walk(render(desk, deskQueue(mk(false)))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!calm.includes('明显比平时忙'), '不该提示：' + calm.slice(0, 200))
  const hot = walk(render(desk, deskQueue(mk(true)))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(hot.includes('今天明显比平时忙'), '该提示时要提示')
  assert.ok(hot.includes('上限可能不够用'), '要说明为什么值得注意')
})

test('面板与唤醒消息说的是同一套规则（AGENTS.md → 修/回/待定 → ack）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [watcher('a/b', { id: 'a/b#s1' })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' ')
  // 三件事必须都能在面板里找到，否则客户只看到"会叫醒我"，不知道叫醒之后发生什么
  assert.ok(text.includes('AGENTS.md'), '面板要提到按仓库规则判断')
  assert.ok(text.includes('修 / 回 / 待定'), '面板要给出三种处理方式')
  assert.ok(text.includes('watch_ack'), '面板要说明最后要 ack')
  assert.ok(text.includes('不会扩大范围'), '面板要说清只处理列出的那几条')
  // 隔离执行的说明在「触发」页，单独渲染一次
  const triggerText = walk(render(desk, deskQueue(snap, null, {}, 'trigger'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' ')
  assert.ok(triggerText.includes('自动回收'), '隔离执行要说明用完会回收：' + triggerText.slice(0, 200))
})
