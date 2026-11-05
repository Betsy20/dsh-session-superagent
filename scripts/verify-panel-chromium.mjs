// 真实 Chromium + 安装版 DSH React/primitives + 完整 session-superagent-desk 面板验收。
// 运行：ego-browser nodejs < scripts/verify-panel-chromium.mjs
// 独立 loopback fake API；不进入真实 DSH Web GUI，不访问 GitHub/npm，不执行更新、删除或其他真实写操作。

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'

const REPO = 'D:/主工作区/projects/dsh-session-superagent-panel-browser'
const ASAR = 'D:/DeepSeek Harness/Desktop/resources/app.asar'
const ELECTRON = 'D:/DeepSeek Harness/Desktop/DeepSeek Harness.exe'
const FRONTEND = `${ASAR}/dsh/node_modules/@deepseek-ai/dsh-web-frontend`
const THEME_CLIENT = `${ASAR}/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`
const SCREENSHOTS = `${REPO}/docs/assets`
const SESSION_ID = 'session-panel-chromium-fixture'
const SPACE_NAME = 'dsh-full-panel-chromium-0.9.273'
const results = []
const observations = []
const artifacts = []
const apiLog = []
const DEBUG_LOG = 'C:/Users/Administrator/AppData/Local/Temp/panel-chromium-internal.log'
writeFileSync(DEBUG_LOG, '')
const debug = (line) => appendFileSync(DEBUG_LOG, line + '\n')
const unverified = [
  '未进入需要真实会话与凭证的 DSH Web GUI；本脚本验证独立 loopback 页面中真实 client.js 的 slot 注册与 desk Component 挂载。',
  'Orbit/Modal 不在本阶段验收范围内；只捕获 session-superagent-orbit 注册，不渲染或点击。',
  '未执行保存、安装更新、删除、暂停、恢复或真实轮询；所有 mutation 路由均固定返回只读拒绝。',
  '未验物理读屏、触摸、IME、真实 GitHub/Gitee 响应与真实 watcher 状态变化。',
]

function check(name, pass, detail) {
  const row = { name, pass: Boolean(pass), detail }
  results.push(row)
  const line = `${row.pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`
  debug(line)
  console.log(line)
  return row.pass
}

function observe(name, detail) {
  observations.push({ name, detail })
  const line = `OBSERVE ${name} ${JSON.stringify(detail)}`
  debug(line)
  console.log(line)
}

function sha256(body) {
  return createHash('sha256').update(body).digest('hex')
}

function loadInstalledAssets() {
  const reader = String.raw`
const fs = require('fs');
const crypto = require('crypto');
const root = process.argv[1];
const dist = root + '/dist';
const html = fs.readFileSync(dist + '/index.html', 'utf8');
const names = [];
for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)) {
  if (/\.(?:js|css)$/.test(match[1]) && !names.includes(match[1])) names.push(match[1]);
}
const assets = {};
for (const name of names) {
  const body = fs.readFileSync(dist + '/' + name);
  assets[name] = { base64: body.toString('base64'), sha256: crypto.createHash('sha256').update(body).digest('hex') };
}
const pkg = JSON.parse(fs.readFileSync(root + '/package.json', 'utf8'));
const themeClient = fs.readFileSync(process.argv[3], 'utf8');
const themeStyles = {};
for (const match of themeClient.matchAll(/var ([A-Za-z0-9_]+_css_default) = ("(?:[^"\\]|\\.)*");/g)) {
  themeStyles[match[1]] = JSON.parse(match[2]);
}
const requiredThemeStyles = [
  'base_css_default', 'corner_shape_css_default', 'design_platform_css_default',
  'focus_css_default', 'onboarding_css_default', 'scrollbar_css_default',
  'gradient_shadow_text_css_default', 'shiki_css_default',
];
for (const name of requiredThemeStyles) {
  if (typeof themeStyles[name] !== 'string') throw new Error('missing official theme style: ' + name);
}
process.stdout.write(JSON.stringify({
  frontendVersion: pkg.version,
  primitivesRange: pkg.devDependencies?.['@deepseek-ai/dsh-client-ui-primitives'] || null,
  electron: process.versions.electron,
  electronNode: process.version,
  html,
  assets,
  themeStyles: Object.fromEntries(requiredThemeStyles.map((name) => [name, themeStyles[name]])),
}));
`
  const output = execFileSync(ELECTRON, ['-e', reader, FRONTEND, ASAR, THEME_CLIENT], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  const parsed = JSON.parse(output)
  parsed.asarSha256 = sha256(readFileSync(ASAR))
  for (const asset of Object.values(parsed.assets)) asset.body = Buffer.from(asset.base64, 'base64')
  return parsed
}

const CAPTURE_FACADE = `
window.__captureErrors = [];
window.__networkViolations = [];
window.__slotEvents = [];
window.__registrations = {};
window.__requiredModules = [];
window.__ModuleLoader__ = {
  create(options) {
    window.__capturedModules = options.staticModules;
    window.__captured = true;
    throw new Error('intentional-capture-stop: staticModules captured; DSH application boot not started');
  },
  load(options) {
    window.__clientFactory = options.factory;
    window.__clientModuleId = options.id;
    window.__clientCaptured = true;
  },
};
window.addEventListener('error', (event) => {
  window.__captureErrors.push({ kind: 'error', message: String(event.message || event.error || '') });
});
window.addEventListener('unhandledrejection', (event) => {
  window.__captureErrors.push({ kind: 'unhandledrejection', message: String(event.reason || '') });
});
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input && input.url;
  const url = new URL(raw, location.href);
  if (url.origin !== location.origin) {
    const detail = { url: url.href, method: init?.method || 'GET' };
    window.__networkViolations.push(detail);
    return Promise.reject(new Error('harness 禁止外部请求：' + url.href));
  }
  return nativeFetch(input, init);
};
`

const HARNESS_CSS = `
html, body { margin: 0; min-height: 100%; background: var(--dsw-alias-bg-base, #101114); }
body { color: var(--dsw-alias-label-primary, #f4f4f5); font-family: var(--dsw-font-family, system-ui, sans-serif); }
#root { display: none !important; }
#app { height: 100vh; min-height: 640px; }
button, input, textarea { font: inherit; }
`

const HARNESS_MODULE = `
try {
  const deadline = Date.now() + 15000;
  while (!window.__captured && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  if (!window.__captured) throw new Error('没有从安装 bundle 捕获 staticModules');
  const modules = window.__capturedModules;
  const React = modules.react;
  const ReactDOM = modules['react-dom/client'];
  const primitives = modules['@deepseek-ai/dsh-client-ui-primitives'];
  await import('/client.js');
  if (!window.__clientCaptured) throw new Error('真实 client.js 未调用 __ModuleLoader__.load');
  const localRequire = (name) => {
    window.__requiredModules.push(name);
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    if (name === 'cordis' || name === 'zod') return {};
    throw new Error('安装 bundle 未提供模块：' + name);
  };
  const plugin = window.__clientFactory(localRequire);
  const ctx = {
    effect(fn) { return fn(); },
    slots: {
      inject(name, fn) {
        window.__slotEvents.push({ type: 'inject', name });
        return fn();
      },
      register(options, Component) {
        window.__registrations[options.id] = { options, Component };
        window.__slotEvents.push({ type: 'register', name: options.name, id: options.id });
        return () => { window.__slotEvents.push({ type: 'dispose', id: options.id }); };
      },
    },
  };
  plugin.apply(ctx);
  const desk = window.__registrations['session-superagent-desk'];
  if (!desk || typeof desk.Component !== 'function') throw new Error('slots.register 未捕获 session-superagent-desk Component');
  window.__verifyMeta = {
    reactVersion: React.version,
    primitiveExportCount: Object.keys(primitives).length,
    moduleNames: Object.keys(modules),
    primitivesIdentity: primitives === modules['@deepseek-ai/dsh-client-ui-primitives'],
    clientModuleId: window.__clientModuleId,
    desk: { ...desk.options, componentType: typeof desk.Component },
    orbit: window.__registrations['session-superagent-orbit']?.options || null,
    slotEvents: window.__slotEvents,
  };
  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(desk.Component, { sessionId: ${JSON.stringify(SESSION_ID)} }));
  window.__harnessReady = true;
} catch (error) {
  window.__harnessError = String(error && error.stack || error);
  throw error;
}
`

function htmlFor(installed) {
  const styles = Object.keys(installed.assets).filter((name) => name.endsWith('.css'))
  const entry = Object.keys(installed.assets).find((name) => name.endsWith('.js') && /index-/.test(name))
  if (!entry) throw new Error('安装 dist/index.html 中没有入口 JS')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>session-superagent-desk 真实 Chromium 验收</title>
${styles.map((name) => `<link rel="stylesheet" href="/${name}">`).join('\n')}
<style>${Object.values(installed.themeStyles).join('\n')}</style>
<style>${HARNESS_CSS}</style>
<script>${CAPTURE_FACADE}</script>
</head><body data-ds-dark-theme="true"><div id="root"></div><div id="app"></div>
<script type="module" src="/${entry}"></script>
<script type="module">${HARNESS_MODULE.replaceAll('</script', '<\\/script')}</script>
</body></html>`
}

function makeFixture(version) {
  const now = Date.now()
  const iso = (ms) => new Date(now - ms).toISOString()
  const sessionId = SESSION_ID
  return {
    state: {
      routeBase: '/session-superagent', serverVersion: version,
      runningVersion: version, installedVersion: version,
      sessionTitle: '完整面板 Chromium 验收',
      sessionGoal: { objective: '固定 goal：验证完整面板', phase: 'active', revision: 1 },
      defaults: { sessionMaxWakes: 12, maxWakesPerHour: 6, isolateKeepDays: 3, batchLimit: 5 },
      retryPolicy: { budgetAttempts: 6, slowCapMinutes: 120 },
      sessionUsage: { used: 2, cap: 12, capped: 0 },
      tokenScopes: { ok: true, scopes: ['repo', 'read:org'] },
      isolation: { roots: [], totalBytes: 0 },
      gh: { ok: true, version: 'gh version 2.101.0-fixture' },
      credentials: { token: 'configured', sshKeyPath: 'none', ghConfigDir: 'none', giteeToken: 'none' },
      triageSignals: [
        { key: 'reopened', label: '被重新打开', kind: 'fact', weight: 100, default: true, why: '固定事实信号' },
        { key: 'comments', label: '有人评论', kind: 'fact', weight: 10, default: true, why: '固定评论信号' },
        { key: 'unassigned', label: '无人认领', kind: 'judgment', weight: 3, default: false, why: '固定判断信号' },
      ],
      watchers: [
        {
          id: `acme/widgets#${sessionId}`, repo: 'acme/widgets', provider: 'github', sessionId,
          title: '活动 watcher fixture', intervalSec: 60, enabled: true, observe: false,
          isolated: false, activeHours: '', note: '处理固定 issue', ackLabel: '主理鱼:已处理',
          lastPoll: iso(15000), lastWake: iso(300000), lastError: null,
          filters: { labels: ['ai-fix'], ignoreLabels: [], onlyAssigned: false, assignee: null, allowAuthors: [] },
          priority: { reopened: true, comments: true, labels: true, unassigned: false, stale: false },
          history: [
            { at: iso(300000), numbers: [42], ok: true, reason: null },
            { at: iso(600000), numbers: [41], ok: false, reason: 'observe' },
          ],
          filteredLog: [{ number: 40, title: '固定过滤条目', reason: '机器人', at: iso(120000) }],
          filterCounts: { 机器人: 1 },
          events: [{ kind: 'wake', at: iso(300000), since: iso(600000), count: 1, text: '固定唤醒事件 #42' }],
          quality: { itemsWoken: 2, itemsAcked: 1, actionRate: 0.5 },
          repoAccess: { repo: 'acme/widgets', push: true, hasIssues: true },
          daily: { days: 2, total: 2 },
        },
        {
          id: 'acme/paused#session-paused-fixture', repo: 'acme/paused', provider: 'github', sessionId: 'session-paused-fixture',
          title: '暂停 watcher fixture', intervalSec: 120, enabled: false, observe: true,
          isolated: false, activeHours: '09:00-23:00', note: '', ackLabel: '主理鱼:已处理',
          lastPoll: iso(900000), lastWake: null, lastError: null,
          deferReason: 'active-hours', lastDeferred: '不在活跃时段（09:00-23:00）：只攒条目，不唤醒',
          filters: { labels: [], ignoreLabels: [], onlyAssigned: false, assignee: null, allowAuthors: [] },
          priority: { reopened: true, comments: true, labels: true, unassigned: false, stale: false },
          history: [], filteredLog: [], filterCounts: {}, events: [],
          repoAccess: { repo: 'acme/paused', push: true, hasIssues: true },
        },
      ],
    },
    update: { current: version, latest: version, hasUpdate: false, command: 'fixture-no-command' },
    trace: {
      traces: [{
        number: '42', repo: 'acme/widgets', verdict: '已唤醒（fixture）', seen: iso(500000), reported: iso(400000),
        filtered: [{ at: iso(450000), reason: '固定过滤事件' }], absorbed: [],
        wakes: [{ at: iso(300000), ok: true }],
      }],
    },
    diagnose: { text: `session-superagent ${version}\nrouteBase=/session-superagent\nfixture=true` },
  }
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function startServer(installed, clientSource, fixture) {
  const html = htmlFor(installed)
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1')
      const method = request.method || 'GET'
      let requestBody = ''
      for await (const chunk of request) requestBody += chunk
      if (url.pathname.startsWith('/session-superagent')) {
        apiLog.push({ method, path: url.pathname + url.search, body: requestBody })
      }
      if (method === 'GET' && url.pathname === '/session-superagent/state') return json(response, 200, fixture.state)
      if (method === 'GET' && url.pathname === '/session-superagent/update') return json(response, 200, fixture.update)
      if (method === 'GET' && url.pathname === '/session-superagent/trace') return json(response, 200, fixture.trace)
      if (method === 'GET' && url.pathname === '/session-superagent/diagnose') return json(response, 200, fixture.diagnose)
      if (method === 'GET' && url.pathname === '/session-superagent/client-note') return json(response, 200, { ok: true, fixture: true })
      if (url.pathname.startsWith('/session-superagent/') && method !== 'GET') {
        return json(response, 403, { error: 'fixture-read-only：本验收禁止所有写操作' })
      }
      if (url.pathname === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return response.end(html)
      }
      if (url.pathname === '/client.js') {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
        return response.end(clientSource)
      }
      const name = url.pathname.slice(1)
      const asset = installed.assets[name]
      if (asset) {
        response.writeHead(200, {
          'content-type': name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
          'cache-control': 'no-store',
        })
        return response.end(asset.body)
      }
      return json(response, 404, { error: 'not found', path: url.pathname })
    } catch (error) {
      return json(response, 500, { error: String(error && error.message || error) })
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

const installed = loadInstalledAssets()
const repoPackage = JSON.parse(readFileSync(`${REPO}/package.json`, 'utf8'))
const clientSource = readFileSync(`${REPO}/client.js`, 'utf8')
const fixture = makeFixture(repoPackage.version)
const clientSha256 = sha256(clientSource)
const scriptSha256 = sha256(readFileSync(`${REPO}/scripts/verify-panel-chromium.mjs`))
const { server, origin } = await startServer(installed, clientSource, fixture)
const task = await taskSpace(SPACE_NAME)
const page = task.page('p1')
let completed = false
let chromium = 'unknown'
try {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page.cdp('Page.bringToFront')
  console.log(`ENV ${JSON.stringify({
    origin, repoVersion: repoPackage.version, clientSha256, scriptSha256,
    frontendVersion: installed.frontendVersion, primitivesRange: installed.primitivesRange,
    asarSha256: installed.asarSha256,
    assets: Object.fromEntries(Object.entries(installed.assets).map(([name, asset]) => [name, { bytes: asset.body.length, sha256: asset.sha256 }])),
  })}`)
  await page.goto(origin)
  await page.waitForFunction(() => window.__harnessReady === true || window.__harnessError, undefined, { timeout: 25000 })
  const harnessError = await page.evaluate(() => window.__harnessError || null)
  if (harnessError) throw new Error(harnessError)
  await page.waitForFunction(() => document.querySelector('.dt-page h1')?.textContent === '主理鱼'
    && !document.body.innerText.includes('正在读取…'), undefined, { timeout: 15000 })
  const browser = await page.evaluate(async () => ({
    userAgent: navigator.userAgent,
    highEntropy: navigator.userAgentData ? await navigator.userAgentData.getHighEntropyValues(['fullVersionList']) : null,
  }))
  chromium = browser.highEntropy?.fullVersionList?.find((item) => item.brand === 'Chromium')?.version
    || browser.userAgent.match(/Chrome\/([^ ]+)/)?.[1] || 'unknown'
  check('真实 Chromium 页面已加载', /^156\./.test(chromium), { chromium, url: await page.url() })
  const meta = await page.evaluate(() => window.__verifyMeta)
  check('真实 client.js 使用安装版 React/primitives', meta.reactVersion === '18.3.1'
    && meta.primitivesIdentity && meta.primitiveExportCount > 0, meta)
  check('slots.register 捕获 session-superagent-desk', meta.desk.name === 'conversation.view'
    && meta.desk.id === 'session-superagent-desk' && meta.desk.order === 30
    && meta.desk.label === '主理鱼' && meta.desk.componentType === 'function', meta.desk)
  const overview = await page.evaluate(() => ({
    title: document.querySelector('.dt-page h1')?.textContent,
    tabs: [...document.querySelectorAll('[role=tab]')].map((node) => ({ text: node.textContent, selected: node.getAttribute('aria-selected') })),
    watchers: document.querySelectorAll('.dt-list > li.dt-ticket').length,
    stats: document.querySelectorAll('.dt-stats .dt-stat').length,
    text: document.querySelector('.dt-page')?.innerText,
  }))
  check('overview 总览真实挂载且有完整 DOM', overview.title === '主理鱼'
    && JSON.stringify(overview.tabs.map((item) => item.text)) === JSON.stringify(['总览', '判定', '触发', '设置'])
    && overview.tabs[0]?.selected === 'true' && overview.watchers === 2 && overview.stats >= 4,
  { title: overview.title, tabs: overview.tabs, watchers: overview.watchers, stats: overview.stats })
  const shot = async (name) => {
    const path = `${SCREENSHOTS}/panel-chromium-${name}.png`
    await page.screenshot({ path, fullPage: true })
    artifacts.push(path)
    observe(`${name} 已截图`, { path: `docs/assets/panel-chromium-${name}.png` })
  }
  const openTab = async (label) => {
    await page.click(`loc=role:tab[name='${label}']`)
    await page.waitForFunction((expected) => document.querySelector('[role=tab][aria-selected=true]')?.textContent === expected, label, { timeout: 5000 })
  }
  const openSettings = async (label) => {
    await page.click(`css=.dt-settings-link:text-is("${label}")`)
    await page.waitForFunction((expected) => document.querySelector('.dt-settings-link[aria-current=page]')?.textContent === expected, label, { timeout: 5000 })
  }
  await shot('overview')

  // 第二阶段：搜索框是真实受控 input，筛选严格收敛到一个仓库，再清空恢复。
  await page.fill("input[aria-label='搜索']", 'acme/widgets')
  await page.waitForFunction(() => document.querySelectorAll('.dt-list > li.dt-ticket').length === 1, undefined, { timeout: 5000 })
  const searched = await page.evaluate(() => ({
    value: document.querySelector("input[aria-label='搜索']")?.value,
    repos: [...document.querySelectorAll('.dt-list .dt-open')].map((node) => node.textContent),
    summary: document.querySelector('.dt-row-meta')?.textContent,
  }))
  check('overview 搜索 input 可编辑且严格筛选/显示汇总', searched.value === 'acme/widgets'
    && JSON.stringify(searched.repos) === JSON.stringify(['acme/widgets']), searched)
  await page.fill("input[aria-label='搜索']", '')
  await page.waitForFunction(() => document.querySelectorAll('.dt-list > li.dt-ticket').length === 2, undefined, { timeout: 5000 })

  // 行内编辑：只修改本地 React 草稿并放弃，绝不提交 /watch。
  await page.click('.dt-list .dt-open >> nth=0')
  await page.waitForSelector("form[data-mode='edit']", { state: 'visible', timeout: 5000 })
  await page.fill("form[data-mode='edit'] input[type='number'] >> nth=0", '90')
  const edited = await page.evaluate(() => ({
    value: document.querySelector("form[data-mode='edit'] input[type='number']")?.value,
    savebar: document.querySelector("form[data-mode='edit'] .dt-savebar")?.textContent,
  }))
  check('overview 行内编辑 input 可编辑且出现未保存 SaveBar', edited.value === '90' && edited.savebar?.includes('未保存'), edited)
  await page.click("form[data-mode='edit'] .dt-savebar button >> nth=0")
  await page.waitForFunction(() => document.querySelector("form[data-mode='edit'] input[type='number']")?.value === '60', undefined, { timeout: 5000 })
  check('overview 行内编辑放弃后恢复原值且未提交', await page.evaluate(() => (
    document.querySelector("form[data-mode='edit'] input[type='number']")?.value === '60'
    && !document.querySelector("form[data-mode='edit'] .dt-savebar")
  )))
  await page.click('.dt-list .dt-open >> nth=0')

  // 判定记录 + fake trace：搜索编号后真实点击追溯按钮。
  await openTab('判定')
  await page.fill("input[aria-label='搜索']", '42')
  await page.click("text='追溯 #42'")
  await page.waitForFunction(() => [...document.querySelectorAll('.dt-event-text')].some((node) => node.textContent === '唤醒成功'), undefined, { timeout: 5000 })
  const judge = await page.evaluate(() => ({
    selected: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
    sections: [...document.querySelectorAll('.dt-section-name')].map((node) => node.textContent.trim()),
    decisionRepos: [...document.querySelectorAll('.dt-list .dt-event-actor')].map((node) => node.textContent),
    decisionNumbers: [...document.querySelectorAll('.dt-list .dt-event-nums')].map((node) => node.textContent),
    traceEvents: [...document.querySelectorAll('.dt-event-text')].map((node) => node.textContent),
  }))
  check('judge/records 判定记录与运行时事件均有真实 DOM', judge.selected === '判定'
    && judge.sections.includes('判定日志（最近 5 次唤醒）')
    && judge.sections.includes('运行时事件（最近 20 条）')
    && JSON.stringify(judge.decisionRepos) === JSON.stringify(['acme/widgets', 'acme/widgets'])
    && JSON.stringify(judge.decisionNumbers) === JSON.stringify(['#42', '#41'])
    && judge.traceEvents.includes('acme/widgets · 固定唤醒事件 #42'), judge)
  check('judge fake /trace 点击后呈现 seen/filter/reported/wake 全事件', JSON.stringify(judge.traceEvents.slice(0, 4))
    === JSON.stringify(['首次看到', '被过滤：固定过滤事件', '上次上报', '唤醒成功']), judge.traceEvents)
  await shot('judge')
  await page.fill("input[aria-label='搜索']", '')

  // 触发页：必填字段与目标字段可编辑，但不点击添加。
  await openTab('触发')
  await page.waitForSelector('#watcher-new-repo', { state: 'visible', timeout: 5000 })
  const triggerStructure = await page.evaluate(() => ({
    selected: document.querySelector('[role=tab][aria-selected=true]')?.textContent,
    mode: document.getElementById('watcher-new')?.getAttribute('data-mode'),
    repoRequired: document.getElementById('watcher-new-repo')?.required,
    intervalType: document.getElementById('watcher-new-intervalSec')?.type,
  }))
  check('trigger 新增表单结构完整', triggerStructure.selected === '触发'
    && triggerStructure.mode === 'create' && triggerStructure.repoRequired === true
    && triggerStructure.intervalType === 'number', triggerStructure)
  await page.fill('#watcher-new-repo', 'fixture/editable')
  await page.fill('#watcher-new-goal', 'Chromium 可编辑 fixture，不提交')
  const triggerEdited = await page.evaluate(() => ({
    repo: document.getElementById('watcher-new-repo')?.value,
    goal: document.getElementById('watcher-new-goal')?.value,
    savebar: document.querySelector('#watcher-new .dt-savebar')?.textContent,
  }))
  check('trigger 搜索外的新增/编辑表单 input 可编辑', triggerEdited.repo === 'fixture/editable'
    && triggerEdited.goal === 'Chromium 可编辑 fixture，不提交'
    && triggerEdited.savebar?.includes('未保存'), triggerEdited)
  await shot('trigger')

  // 设置总壳与五个分区全部真实点击。
  await openTab('设置')
  const settingsNav = await page.evaluate(() => [...document.querySelectorAll('.dt-settings-link')].map((node) => node.textContent))
  check('settings 左 nav 恰好五个既定分区', JSON.stringify(settingsNav)
    === JSON.stringify(['来源', '凭证', '版本与更新', '分诊信号', '会话 goal']), settingsNav)

  const source = await page.evaluate(() => ({
    current: document.querySelector('.dt-settings-link[aria-current=page]')?.textContent,
    title: document.querySelector('.dt-settings-body .dt-section-name')?.textContent,
    keys: [...document.querySelectorAll('.dt-settings-body dt')].map((node) => node.textContent),
    values: [...document.querySelectorAll('.dt-settings-body dd')].map((node) => node.textContent),
  }))
  check('settings/source 来源事实表完整', source.current === '来源' && source.title === '来源'
    && JSON.stringify(source.keys) === JSON.stringify(['仓库', 'gh CLI', 'GitHub 凭证', '权限范围', '隔离占用'])
    && source.values[0]?.includes('acme/widgets') && source.values[1]?.includes('gh version 2.101.0-fixture'), source)
  await shot('settings-source')

  await openSettings('凭证')
  const creds = await page.evaluate(() => ({
    current: document.querySelector('.dt-settings-link[aria-current=page]')?.textContent,
    title: document.querySelector('.dt-settings-body .dt-section-name')?.textContent,
    passwords: document.querySelectorAll(".dt-settings-body input[type='password']").length,
    saveButtons: [...document.querySelectorAll('.dt-settings-body button')].filter((node) => node.textContent === '保存凭证').length,
  }))
  check('settings/creds 凭证分区有两个 secret input 与保存入口', creds.current === '凭证'
    && creds.title === '凭证' && creds.passwords === 2 && creds.saveButtons === 1, creds)
  await page.fill(".dt-settings-body input[type='password'] >> nth=0", 'fixture-token-not-a-secret')
  await page.fill(".dt-settings-body input[type='password'] >> nth=1", 'fixture-gitee-not-a-secret')
  await page.fill(".dt-settings-body input:not([type])", 'D:/fixture/gh-config')
  const credsEdited = await page.evaluate(() => ({
    secrets: [...document.querySelectorAll(".dt-settings-body input[type='password']")].map((node) => node.value),
    ghDir: document.querySelector(".dt-settings-body input:not([type])")?.value,
  }))
  check('settings/creds 三个凭证 input 可编辑但未保存', JSON.stringify(credsEdited.secrets)
    === JSON.stringify(['fixture-token-not-a-secret', 'fixture-gitee-not-a-secret'])
    && credsEdited.ghDir === 'D:/fixture/gh-config', { ...credsEdited, secrets: ['fixture-only', 'fixture-only'] })
  await shot('settings-creds')

  await openSettings('版本与更新')
  const update = await page.evaluate(() => ({
    current: document.querySelector('.dt-settings-link[aria-current=page]')?.textContent,
    title: document.querySelector('.dt-settings-body .dt-section-name')?.textContent,
    keys: [...document.querySelectorAll('.dt-settings-body dt')].map((node) => node.textContent),
    values: [...document.querySelectorAll('.dt-settings-body dd')].map((node) => node.textContent),
    installButtons: [...document.querySelectorAll('.dt-settings-body button')].filter((node) => node.textContent === '安装更新').length,
    diagnoseButtons: [...document.querySelectorAll('.dt-settings-body button')].filter((node) => node.textContent === '复制诊断信息').length,
  }))
  check('settings/update 固定更新响应显示已是最新', update.current === '版本与更新'
    && update.title === '版本与更新'
    && JSON.stringify(update.keys) === JSON.stringify(['当前版本', 'npm 最新', '状态'])
    && update.values[0] === repoPackage.version && update.values[1] === repoPackage.version
    && update.values[2] === '已是最新' && update.installButtons === 0 && update.diagnoseButtons === 1, update)
  await shot('settings-update')

  await openSettings('分诊信号')
  const diagnose = await page.evaluate(() => ({
    current: document.querySelector('.dt-settings-link[aria-current=page]')?.textContent,
    title: document.querySelector('.dt-settings-body .dt-section-name')?.textContent,
    signals: [...document.querySelectorAll('.dt-settings-body .dt-signal-lead .dt-row-name')].map((node) => node.textContent),
    weights: [...document.querySelectorAll('.dt-settings-body .dt-signal-meta')].map((node) => node.textContent),
  }))
  check('settings/diagnose 分诊信号三分区内容完整', diagnose.current === '分诊信号'
    && diagnose.title === '分诊信号与取舍'
    && JSON.stringify(diagnose.signals) === JSON.stringify(['被重新打开', '有人评论', '无人认领'])
    && JSON.stringify(diagnose.weights) === JSON.stringify(['+100 分', '+10 分', '+3 分']), diagnose)
  await shot('settings-diagnose')

  await openSettings('会话 goal')
  const goal = await page.evaluate(() => ({
    current: document.querySelector('.dt-settings-link[aria-current=page]')?.textContent,
    title: document.querySelector('.dt-settings-body .dt-section-name')?.textContent,
    value: document.querySelector('.dt-settings-body textarea')?.value,
    saveDisabled: [...document.querySelectorAll('.dt-settings-body button')].find((node) => node.textContent === '保存 goal')?.disabled,
  }))
  check('settings/goal 固定 goal 回读且保存按钮可用', goal.current === '会话 goal'
    && goal.title === '会话 goal' && goal.value === '固定 goal：验证完整面板' && goal.saveDisabled === false, goal)
  await page.fill('.dt-settings-body textarea', '固定 goal：Chromium 已编辑但未提交')
  check('settings/goal textarea 可编辑但未保存', await page.evaluate(() => (
    document.querySelector('.dt-settings-body textarea')?.value === '固定 goal：Chromium 已编辑但未提交'
  )))
  await shot('settings-goal')

  const errors = await page.evaluate(() => ({
    capture: window.__captureErrors.filter((event) => !String(event.message).includes('intentional-capture-stop')),
    network: window.__networkViolations,
  }))
  check('完整走查无未预期页面错误或外部请求', errors.capture.length === 0 && errors.network.length === 0, errors)
  const mutations = apiLog.filter((row) => row.method !== 'GET')
  const traceCalls = apiLog.filter((row) => row.path.startsWith('/session-superagent/trace'))
  const updateCalls = apiLog.filter((row) => row.path.startsWith('/session-superagent/update'))
  check('fake state/update/trace 均实际命中 loopback', apiLog.some((row) => row.path === '/session-superagent/state')
    && traceCalls.length === 1 && traceCalls[0].path === '/session-superagent/trace?number=42'
    && updateCalls.length >= 1 && updateCalls.every((row) => row.method === 'GET'), { traceCalls, updateCalls, origin })
  check('禁止真实 GitHub、更新、删除与全部 mutation', mutations.length === 0 && errors.network.length === 0, { mutations, external: errors.network })
  check('四个主页面与五个设置分区截图共八张', artifacts.length === 8, artifacts.map((path) => path.replace(`${REPO}/`, '')))
  completed = true
  if (results.some((row) => !row.pass)) process.exitCode = 1
} catch (error) {
  debug(`VERIFY_ERROR ${String(error && error.stack || error)}`)
  console.error('VERIFY_ERROR', error)
  check('脚本执行完成', false, String(error && error.stack || error))
  try {
    console.error('LAST_SNAPSHOT', JSON.stringify(await page.evaluate(() => ({
      ready: window.__harnessReady,
      harnessError: window.__harnessError,
      captured: window.__captured,
      clientCaptured: window.__clientCaptured,
      errors: window.__captureErrors,
      body: document.body.innerText.slice(0, 4000),
    })), null, 2))
  } catch {}
  process.exitCode = 1
} finally {
  const summary = {
    passed: results.filter((row) => row.pass).length,
    failed: results.filter((row) => !row.pass).length,
    total: results.length,
    chromium,
    repoVersion: repoPackage.version,
    clientSha256,
    scriptSha256,
    frontendVersion: installed.frontendVersion,
    asarSha256: installed.asarSha256,
    screenshots: artifacts.map((path) => ({
      path: path.replace(`${REPO}/`, ''),
      bytes: readFileSync(path).length,
      sha256: sha256(readFileSync(path)),
    })),
    apiLog,
    unverified,
  }
  debug(`SUMMARY ${JSON.stringify(summary, null, 2)}`)
  console.log(`SUMMARY ${JSON.stringify(summary, null, 2)}`)
  const closing = new Promise((resolve) => server.close(resolve))
  server.closeAllConnections?.()
  await closing
  if (completed) await task.finish({ keep: [] })
  else console.log(`TASK_SPACE_KEPT ${task.spaceId}（脚本异常，保留未完成现场）`)
}
