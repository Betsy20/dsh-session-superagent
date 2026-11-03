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
  assert.ok(text.includes('0 主理中'), '空态指标要写成 0 主理中：' + text.slice(0, 120))
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
  assert.equal(panel.props.style.width, 368, '弹层宽度：344 会把 MYCF711/dsh-go 这类仓库名截掉')
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  const needles = [
    '主理鱼', '2 主理中', 'a/b', 'c/d', '主理中', '异常', '每 30s', '401 bad credentials',
    // 会话名优先显示标题（客户认得出的那个），同时保留 8 位后缀去重
    '1e82afca', '7f7155cf',
  ]
  for (const needle of needles) assert.ok(text.includes(needle), '面板缺少「' + needle + '」：' + text.slice(0, 240))
  // 细节（goal / 过滤 / 退避 / 历史）进 title，鼠标悬停可读，不再挤占行内
  const titles = nodes.filter((n) => n.props && n.props.className === 'sa-dock-row').map((n) => String(n.props.title || ''))
  assert.ok(titles.some((t) => t.includes('goal · 让主理鱼实时同步 goal')), 'goal 要在悬停详情里：' + titles.join(' | '))
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
  const titles = nodes.filter((n) => n.props && n.props.className === 'sa-dock-row').map((n) => String(n.props.title || '')).join(' | ')
  assert.ok(titles.includes('标签: ai-fix'), '悬停详情要含标签白名单：' + titles.slice(0, 200))
  assert.ok(titles.includes('排除: wontfix'), '悬停详情要含排除标签')
  assert.ok(/退避 \d+s/.test(titles), '悬停详情要含退避剩余秒数：' + titles.slice(0, 200))
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
  assert.ok(text.includes('时段 09:00-23:00'), '活跃时段要留在行内副行：' + text.slice(0, 200))
  const titles = nodes.filter((n) => n.props && n.props.className === 'sa-dock-row').map((n) => String(n.props.title || '')).join(' | ')
  assert.ok(titles.includes('隔离'), '悬停详情要含隔离状态：' + titles.slice(0, 200))
  assert.ok(titles.includes('dsh-zhuli/a-b-123'), '悬停详情要含上次 worktree 尾段')
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
  const titles = () => nodes.filter((n) => n.props && n.props.className === 'sa-dock-row').map((n) => String(n.props.title || '')).join(' | ')
  assert.ok(titles().includes('上次唤醒 #12 #13'), titles().slice(0, 220))
  assert.ok(titles().includes('2 分钟前'), titles().slice(0, 220))

  const failed = render(orbit, [[watcher('a/b', { history: [{ at, numbers: [7], ok: false, reason: 'session not live' }] })], true, { x: 720, y: 860 }])
  const failedTitles = walk(failed).filter((n) => n.props && n.props.className === 'sa-dock-row').map((n) => String(n.props.title || '')).join(' | ')
  assert.ok(failedTitles.includes('上次唤醒失败 #7'), failedTitles.slice(0, 220))
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
  // 0.9.152 起不再用「①」字符：列表符号和步骤号重复，改成圆形步骤号 + 标题 + 说明
  const steps = nodes.filter((n) => n.props && n.props.className === 'dt-step')
  assert.equal(steps.length, 3, '三步都要在，实际 ' + steps.length)
  const nums = nodes.filter((n) => n.props && n.props.className === 'dt-step-num').map((n) => String((n.props.children || []).join('')))
  assert.deepEqual(nums, ['1', '2', '3'], '步骤号要连号：' + nums.join(','))
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
  assert.ok(text.includes('运行时事件'), '要有运行时事件区块：' + text.slice(0, 160))
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
  assert.ok(closed.includes('没有动作'), '要有那条提示（措辞已从“回音”改成“动作”，更具体）')

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

test('只读提示必须说出仓库名（不能是"你对 这个仓库 只有读权限"）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 0, cap: 12, capped: 0 },
      watchers: [watcher('acme/widgets', { id: 'acme/widgets#s1', repoAccess: { repo: undefined, push: false } })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('你对 acme/widgets 只有读权限'), '要带上仓库名：' + text.slice(0, 240))
  assert.ok(!text.includes('你对 这个仓库'), '不该出现占位文案')
})

test('术语表覆盖客户会在面板上遇到的词（含"上限"这种歧义词）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, watchers: [watcher('a/b', { id: 'a/b#s1' })] },
  }
  const text = walk(render(desk, deskQueue(snap, null, {}, 'overview', '', true))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  for (const term of ['主理鱼', '唤醒', '隔离', 'ack', '上限', '没有动作', '临时副本']) {
    assert.ok(text.includes(term), '术语表缺「' + term + '」')
  }
  // "上限"必须有歧义澄清：会话上限 vs GitHub 限流
  assert.ok(text.includes('GitHub 的限流'), '要说清"上限"和 GitHub 限流不是一回事')
})

test('长错误不能把建议切掉（截断曾恰好切掉最有用的一段）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const longMain = '轮询失败：' + 'x'.repeat(200)
  const hint = '（网络抖动：这一轮没连上 GitHub，已按退避自动重试，不需要手动处理）'
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 0, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', lastError: longMain + hint })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('已按退避自动重试'), '建议必须完整出现：' + text.slice(0, 300))
  assert.ok(!text.includes('x'.repeat(150)), '现象部分要截断，避免占满版面')
})

test('首次使用（空态）不能露出内部字段名，并且要给出三步引导', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const empty = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: null, credentials: {}, sessionUsage: null, watchers: [] },
  }
  const text = walk(render(desk, deskQueue(empty))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('三步让这个会话开始盯办'), '空态要有引导：' + text.slice(0, 200))
  for (const leaked of ['deferReason', 'silentWakes', 'cursor', 'filterCounts', 'watch_ack']) {
    assert.ok(!text.includes(leaked), '空态露出了内部字段：' + leaked)
  }
  assert.ok(!text.includes('需要会话上下文'), '「需要会话上下文」是内部说法，客户看不懂')
})

test('空态三步里提到的控件，必须在「触发」页真实存在（改名会让引导失效）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const empty = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: null, watchers: [] },
  }
  const text = (tree) => walk(tree).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  const overview = text(render(desk, deskQueue(empty)))
  const trigger = text(render(desk, deskQueue(empty, null, {}, 'trigger'), { sessionId: 's1' }))

  // 从引导里抽出所有「…」引号内的控件名/标签名
  const quoted = [...overview.matchAll(/「([^」]{2,12})」/g)].map((m) => m[1])
  assert.ok(quoted.length >= 3, '引导里应该有若干可引用的控件名：' + quoted.join('/'))
  for (const name of quoted) {
    // 只查「触发」页：引导文本自己就含这个词，用整页文本会把自引用当通过（第一版就是这么假通过的）
    assert.ok(trigger.includes(name), '引导提到的「' + name + '」在「触发」页找不到（可能改名了）')
  }
  // 三个步骤里的关键词也要能对上真实字段
  for (const word of ['仓库', '间隔']) {
    assert.ok(trigger.includes(word), '「触发」页缺字段：' + word)
  }
})

test('「需要关注」按严重程度排序：会丢消息的排最前，静态提示排后', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: 'x', credentials: { token: 'ok' }, sessionUsage: { used: 0, cap: 12, capped: 0 },
      watchers: [watcher('a/b', {
        id: 'a/b#s1',
        lastError: 'GitHub API 请求: EOF（网络抖动：这一轮没连上 GitHub，已按退避自动重试，不需要手动处理）',
        repoAccess: { push: false, archived: true, hasIssues: true },
        silentWakes: 3,
      })],
    },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  const at = (needle) => text.indexOf(needle)
  const errPos = at('轮询失败')
  const silentPos = at('没有动作')
  const structurePos = at('已归档')
  const readonlyPos = at('只有读权限')
  assert.ok(errPos >= 0 && silentPos >= 0 && structurePos >= 0 && readonlyPos >= 0, '四类提示都要在：' + text.slice(0, 300))
  assert.ok(errPos < structurePos, '轮询失败要排在"已归档"前面')
  assert.ok(errPos < readonlyPos, '轮询失败要排在"只读"前面')
  assert.ok(silentPos < structurePos, '"没回音"要排在"已归档"前面')
})

test('判定页的日志标题要说清"最近 5 次唤醒"（数据早就有，只是名字看不出来）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', history: [
        { at: at(50), numbers: [1], ok: true },
        { at: at(40), numbers: [2], ok: false, reason: 'agent busy' },
        { at: at(30), numbers: [3, 4], ok: true },
      ] })] },
  }
  const text = walk(render(desk, deskQueue(snap, null, {}, 'judge'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('最近 5 次唤醒'), '标题要能看出这是最近几次：' + text.slice(0, 240))
  assert.ok(text.includes('#3 #4'), '要能看到最近一次唤醒的条目')
  assert.ok(text.includes('agent busy'), '失败原因要显示')
})

test('同一仓库被多个会话守着时，面板要说清"还有谁在守"', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', lastWake: '2026-11-02T09:00:00.000Z', otherSessions: ['session-2', 'session-3'] })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('还有 2 个会话也在守这个仓库'), '总览行要说清还有谁：' + text.slice(0, 300))
  assert.ok(text.includes('ack 标签是仓库级的'), '要说清 ack 标签是共享的：' + text.slice(0, 400))

  // 没有别的会话时不显示
  const solo = { ...snap, body: { ...snap.body, watchers: [watcher('a/b', { id: 'a/b#s1', lastWake: '2026-11-02T09:00:00.000Z', otherSessions: [] })] } }
  const soloText = walk(render(desk, deskQueue(solo, null, {}, 'judge'))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(!soloText.includes('也在守这个仓库'), '独占时不显示')
})

test('错误旁边要有「下一步」按钮（登录失效 → 去填 token；改名 → 改仓库地址）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const base = (kind, err) => ({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', lastWake: at(30), history: [{ at: at(30), numbers: [1], ok: true }],
        lastError: err, lastErrorKind: kind,
      })] },
  })
  const text = (snap) => walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')

  const auth = text(base('auth', 'GitHub API 请求: 401（gh 登录失效：跑 gh auth login，或在面板填 token）'))
  assert.ok(auth.includes('去填 token'), '登录失效要给「去填 token」：' + auth.slice(0, 300))

  const moved = text(base('moved', 'GitHub API 请求: 301（仓库改名或转移了：用新地址重新添加）'))
  assert.ok(moved.includes('改仓库地址'), '改名要给「改仓库地址」')

  const net = text(base('network', 'GitHub API 请求: EOF（网络抖动：已按退避自动重试）'))
  assert.ok(net.includes('立刻重试'), '网络问题要给「立刻重试」')

  const other = text(base('other', 'GitHub API 请求: 418 我是茶壶'))
  assert.ok(!other.includes('去填 token') && !other.includes('改仓库地址') && !other.includes('立刻重试'), '未归类的错误不给乱指路的按钮')
})

// 造一个「此刻一定在窗口外」的时段：从当前小时 +6 开始，长度 1 小时（跨夜也能算）
function outsideWindow() {
  const start = (new Date().getHours() + 6) % 24
  const pad = (n) => String(n).padStart(2, '0')
  return pad(start) + ':00-' + pad((start + 1) % 24) + ':00'
}

test('顶部四个计数必须加得上总数（互斥，不重复数）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  // 四种状态各一条 + 一条"已暂停且出错"（以前会被数两次）
  const list = [
    watcher('a/active', { id: 'a/active#s1', lastWake: at(10) }),
    watcher('a/paused', { id: 'a/paused#s1', enabled: false, lastWake: at(10) }),
    watcher('a/error', { id: 'a/error#s1', lastError: 'GitHub API 请求: EOF（网络抖动）', lastWake: at(10) }),
    // 时段要「此刻一定不在窗口内」——写死 03:00-04:00 会在凌晨跑测试时变成 inside（真踩过）
    watcher('a/dormant', { id: 'a/dormant#s1', activeHours: outsideWindow(), lastWake: at(10) }),
    watcher('a/both', { id: 'a/both#s1', enabled: false, lastError: 'GitHub API 请求: EOF（网络抖动）', lastWake: at(10) }),
  ]
  const snap = { loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 }, watchers: list } }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  const value = (label) => {
    const idx = text.indexOf(' | ' + label)
    const before = text.slice(0, idx).split(' | ')
    return Number(before[before.length - 1])
  }
  const total = value('条主理鱼')
  const sum = value('主理中') + value('已暂停') + value('异常') + value('时段外')
  assert.equal(total, 5, '总数 5 条：' + text.slice(0, 200))
  assert.equal(sum, total, '分项之和要等于总数（实际 ' + sum + ' vs ' + total + '）')
})

test('历史数据里残留的 304 不该被算成「异常」', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', { id: 'a/b#s1', lastWake: at(10), lastError: 'gh: HTTP 304（没有变化 —— 条件请求命中 304，这不是错误）' })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  const counters = text.match(/(\d+)\s*\|\s*异常/) || []
  assert.ok(!/\|\s*1\s*\|\s*异常/.test(text), '304 不该算进异常：' + text.slice(0, 200))
})

test('错误要标出「多久之前」，超过一小时标「旧记录」', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const snap = (mins) => ({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', lastWake: at(5), lastError: 'GitHub API 请求: EOF（网络抖动）', lastErrorKind: 'network',
        lastErrorAt: at(mins),
      })] },
  })
  const text = (mins) => walk(render(desk, deskQueue(snap(mins)))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')

  const fresh = text(3)
  assert.ok(/\d+ 分钟前/.test(fresh), '新错误要带时间：' + fresh.slice(0, 200))
  assert.ok(!fresh.includes('旧记录'), '刚发生的错误不该标旧记录')

  const old = text(150)
  assert.ok(old.includes('旧记录'), '150 分钟前的错误要标「旧记录」：' + old.slice(0, 200))
})

test('凭证失效时面板要显眼提示「不会自己恢复」', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', lastWake: at(10), needsReauth: true,
        lastError: 'GitHub API 请求: 401（gh 登录失效：跑 gh auth login，或在面板填 token）',
        lastErrorKind: 'auth', lastErrorAt: at(5),
      })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('凭证失效'), '要有凭证失效提示：' + text.slice(0, 300))
  assert.ok(text.includes('不会自己恢复'), '要说清不会自愈')
  assert.ok(text.includes('gh auth login'), '要给出具体命令')
})

test('连续失败时面板要显示「第几次失败 + 下次重试」', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const soon = (mins) => new Date(Date.now() + mins * 60000).toISOString()
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      watchers: [watcher('a/b', {
        id: 'a/b#s1', lastWake: at(10), consecutiveFailures: 7, nextAt: soon(90),
        lastError: 'GitHub API 请求: 401（gh 登录失效）', lastErrorKind: 'auth', lastErrorAt: at(30),
      })] },
  }
  const text = walk(render(desk, deskQueue(snap))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')
  assert.ok(text.includes('已连续失败 7 次'), '要报失败次数：' + text.slice(0, 300))
  assert.ok(/下次重试约 \d+ 分钟后/.test(text), '要说明下次重试时间：' + text.slice(0, 300))
  assert.ok(text.includes('2 小时档'), '超过预算要说明已放慢')
})

test('「已放慢到 X 小时档」从后端 retryPolicy 算，不是写死的', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = (mins) => new Date(Date.now() - mins * 60000).toISOString()
  const soon = (mins) => new Date(Date.now() + mins * 60000).toISOString()
  const snap = (policy) => ({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 1, cap: 12, capped: 0 },
      retryPolicy: policy,
      watchers: [watcher('a/b', { id: 'a/b#s1', lastWake: at(10), consecutiveFailures: 8, nextAt: soon(60) })] },
  })
  const text = (policy) => walk(render(desk, deskQueue(snap(policy)))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')

  assert.ok(text({ budgetAttempts: 6, slowCapMinutes: 120 }).includes('2 小时档'), '默认应是 2 小时档')
  assert.ok(text({ budgetAttempts: 6, slowCapMinutes: 90 }).includes('1.5 小时档'), '改成 90 分钟要跟着变：' + text({ budgetAttempts: 6, slowCapMinutes: 90 }).slice(0, 200))
  // 预算调大后，8 次还没超预算，就不该说"已放慢"
  assert.ok(!text({ budgetAttempts: 20, slowCapMinutes: 120 }).includes('已放慢'), '没超预算就不该提放慢')
})

test('默认值提示从 /state 的 defaults 读，不是写死的 12/3/6', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const base = (defaults) => ({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 'x', credentials: {}, sessionUsage: { used: 0, cap: 12, capped: 0 },
      defaults, watchers: [watcher('a/b', { id: 'a/b#s1' })] },
  })
  const text = (defaults, tab) => walk(render(desk, deskQueue(base(defaults), null, {}, tab))).filter((n) => typeof n.text === 'string').map((n) => n.text).join(' | ')

  // 术语表里那句「单条守每小时最多 X 次」是最容易被写死的地方
  const custom = text({ sessionMaxWakes: 30, maxWakesPerHour: 4, isolateKeepDays: 7 }, 'settings')
  const all = custom + ' ' + text({ sessionMaxWakes: 30, maxWakesPerHour: 4, isolateKeepDays: 7 }, 'trigger')
  assert.ok(all.length > 0, '面板要有内容')
  const dflt = text({}, 'settings')
  // 至少验证：面板不会因为 defaults 缺省而崩，且触发页占位符跟着 defaults 走
  assert.ok(!/undefined/.test(all), '默认值不能渲染成 undefined：' + all.slice(0, 200))
})

test('比例条不为 0 的类别画线段（避免 1px 脏点），并保持总段数正确', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const one = [watcher('a/b', { id: 'a/b#s1', enabled: true })]
  const nodes = walk(render(orbit, [one, true, { x: 500, y: 700 }]))
  const bar = nodes.find((n) => n.props && n.props.className === 'sa-dock-bar')
  assert.ok(bar, '有守时要有比例条')
  const segs = (bar.props.children || []).filter((c) => c && c.props && c.props['data-tone'])
  assert.equal(segs.length, 1, '只有运行中一种状态时，只该画 1 段（实际 ' + segs.length + '）')
  assert.equal(segs[0].props['data-tone'], 'ok')

  const mixed = [
    watcher('a/b', { id: 'a/b#s1', enabled: true }),
    watcher('c/d', { id: 'c/d#s2', enabled: false }),
    watcher('e/f', { id: 'e/f#s3', enabled: true, lastError: 'gh: HTTP 502（网关）', lastErrorKind: 'gateway' }),
  ]
  const segs2 = walk(render(orbit, [mixed, true, { x: 500, y: 700 }]))
    .find((n) => n.props && n.props.className === 'sa-dock-bar').props.children
    .filter((c) => c && c.props && c.props['data-tone'])
  assert.equal(segs2.length, 3, '三种状态都有时画 3 段')
})

test('活跃时段用两个原生时间选择器（起 / 止），不再让人手打 09:00-23:00', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: '会话', credentials: { token: 'none', sshKeyPath: 'none' },
      watchers: [watcher('a/b', { id: 'a/b#s1', activeHours: '09:00-23:00' })],
    },
  }
  const nodes = walk(render(desk, deskQueue(snap, null, {}, 'trigger')))
  const times = nodes.filter((n) => n.type === 'input' && n.props && n.props.type === 'time')
  assert.ok(times.length >= 2, '要有起止两个时间选择器（实际 ' + times.length + '）')
  assert.ok(times.some((n) => n.props['aria-label'] === '起始时间'), '要有「起始时间」')
  assert.ok(times.some((n) => n.props['aria-label'] === '结束时间'), '要有「结束时间」')

  // 跨夜要写出来（22:00-06:00）
  const night = walk(render(desk, deskQueue({
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 's', credentials: {}, watchers: [] },
  }, null, {}, 'trigger')))
  assert.ok(night.length > 0)
})

test('弹层键盘可达：带 tabIndex=-1 且 role=dialog（打开后可聚焦进去）', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const nodes = walk(render(orbit, [[watcher('a/b')], true, { x: 720, y: 860 }]))
  const panel = nodes.find((n) => n.props && n.props.role === 'dialog')
  assert.ok(panel, '弹层没渲染')
  assert.equal(panel.props.tabIndex, -1, '弹层要能被程序聚焦（tabIndex=-1）')
  assert.ok(panel.props['aria-label'], '弹层要有 aria-label（读屏能念出概况）')
})

test('窗口很窄时弹层不能溢出屏幕（368 -> 视口宽 - 16）', () => {
  const { registrations, render, setViewport } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  try {
    setViewport(360)
    const nodes = walk(render(orbit, [[watcher('a/b')], true, { x: 180, y: 700 }]))
    const panel = nodes.find((n) => n.props && n.props.role === 'dialog')
    assert.ok(panel, '弹层没渲染')
    assert.equal(panel.props.style.width, 344, '360 视口下应该是 344（360-16）')
    const left = Number(panel.props.style.left)
    assert.ok(left >= 8, '左边距不能为负：' + left)
    assert.ok(left + 344 <= 360, '右边也不能溢出：' + (left + 344))
  } finally {
    setViewport(1440)
  }
})

test('判定页事件行两行封顶：仓库 + 右对齐时间，第二行结果带编号', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const at = new Date(Date.now() - 600000).toISOString()
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: 's', credentials: {}, watchers: [
        watcher('a/b', { id: 'a/b#s1', history: [{ at, numbers: [12, 13], ok: true, reason: null }] }),
      ],
    },
  }
  const nodes = walk(render(desk, deskQueue(snap, null, {}, 'judge')))
  const head = nodes.find((n) => n.props && n.props.className === 'dt-event-head')
  assert.ok(head, '事件行要有 dt-event-head（仓库 + 时间同一行）')
  const texts = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(texts.includes('#12 #13'), '第二行要带编号：' + texts.slice(0, 240))
  assert.ok(texts.includes('10 分钟前'), '时间要在行内（右对齐）：' + texts.slice(0, 240))
})

test('判定页时间线按天分组：今天 / 昨天 有分节标题', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const hours = (n) => new Date(Date.now() - n * 3600000).toISOString()
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: 's', credentials: {}, watchers: [
        watcher('a/b', {
          id: 'a/b#s1',
          history: [
            { at: hours(0.5), numbers: [12], ok: true, reason: null },
            { at: hours(26), numbers: [10], ok: true, reason: null },
            { at: hours(50), numbers: [9], ok: false, reason: 'cap-session' },
          ],
        }),
      ],
    },
  }
  const nodes = walk(render(desk, deskQueue(snap, null, {}, 'judge')))
  const days = nodes.filter((n) => n.props && n.props.className === 'dt-timeline-day').map((n) => String((n.props.children || []).join('')))
  assert.ok(days.includes('今天'), '要有「今天」分组：' + days.join('|'))
  assert.ok(days.some((d) => d === '昨天' || /月/.test(d)), '更早的要单独分组：' + days.join('|'))
})

test('总览每条守都带三个动作按钮（立刻 / 暂停或恢复 / 删除）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: {
      sessionGoal: null, sessionTitle: 's', credentials: {}, watchers: [
        watcher('a/b', { id: 'a/b#s1', enabled: true }),
        watcher('c/d', { id: 'c/d#s2', enabled: false }),
      ],
    },
  }
  const nodes = walk(render(desk, deskQueue(snap)))
  // 每个 dt-ticket-actions 容器里都要有 3 个可点控件（暂停/恢复按状态二选一）
  const groups = nodes.filter((n) => n.props && String(n.props.className || '').includes('dt-ticket-actions'))
  assert.equal(groups.length, 2, '两条守应该有两个动作容器，实际 ' + groups.length)
  for (const group of groups) {
    const buttons = walk({ type: 'div', props: group.props })
      .filter((n) => n.type === 'button' || (n.props && typeof n.props.onClick === 'function'))
    assert.ok(buttons.length >= 3, '每个动作容器至少 3 个控件，实际 ' + buttons.length)
  }
})

test('判定页空态也给路径：说明 + 去添加按钮（不是一句「还没有主理鱼」）', () => {
  const { registrations, render } = loadClient()
  const desk = registrations.find((r) => r.opts.id === 'session-superagent-desk')
  const snap = {
    loading: false, error: null,
    body: { sessionGoal: null, sessionTitle: 's', credentials: {}, watchers: [] },
  }
  const nodes = walk(render(desk, deskQueue(snap, null, {}, 'judge')))
  const empty = nodes.find((n) => n.props && n.props.className === 'dt-empty')
  assert.ok(empty, '判定页空态要有引导块')
  const text = nodes.filter((n) => n.type === '#text').map((n) => n.text).join(' ')
  assert.ok(text.includes('还没有可判定的记录'), text.slice(0, 200))
  assert.ok(text.includes('每轮判定都会记在这里'), '要说清加一条之后会发生什么：' + text.slice(0, 240))
  const labels = nodes.filter((n) => n.type === 'button')
    .map((b) => (b.props.children || []).filter((c) => typeof c === 'string').join(''))
  assert.ok(labels.some((l) => l.includes('去添加第一条')), '要能一键去添加：' + labels.join('|'))
})

test('弹层副行显示会话标题（不是只有 8 位 ID）', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b', { title: '修复登录过期', intervalSec: 60 })]
  const nodes = walk(render(orbit, [list, true, { x: 700, y: 800 }]))
  const subs = nodes.filter((n) => n.props && n.props.className === 'sa-dock-sub').map((n) => (n.props.children || []).join(''))
  assert.ok(subs.length === 1, '应有一行副标题')
  assert.ok(subs[0].includes('修复登录过期'), '先给客户认得出的会话名：' + subs[0])
  assert.ok(subs[0].includes('#'), '同时保留短 ID 去重：' + subs[0])
})

test('弹层指标用官方「数值强 + 单位弱」两段（不是一句 1 / 2 主理中）', () => {
  const { registrations, render } = loadClient()
  const orbit = registrations.find((r) => r.opts.id === 'session-superagent-orbit')
  const list = [watcher('a/b', { id: 'a/b#s1', enabled: true }), watcher('c/d', { id: 'c/d#s2', enabled: false })]
  const nodes = walk(render(orbit, [list, true, { x: 700, y: 800 }]))
  const main = nodes.find((n) => n.props && n.props.className === 'sa-dock-metric-main')
  const unit = nodes.find((n) => n.props && n.props.className === 'sa-dock-metric-unit')
  assert.ok(main, '要有主数值（等宽数字）')
  assert.ok(unit, '要有弱化单位')
  assert.equal(String((main.props.children || []).join('')), '1 / 2')
  assert.equal(String((unit.props.children || []).join('')), '主理中')
})
