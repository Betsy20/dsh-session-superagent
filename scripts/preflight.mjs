// 一条命令跑完「发版必跑」的七项检查，输出 PASS/FAIL 表并以退出码给出结论。
//
// 目的：把 HANDOFF 里那段散文式检查清单变成可执行的东西 —— 清单会过期，脚本不会。
//
// 用法：
//   node scripts/preflight.mjs            全部检查（gh 不可用时冒烟自动 SKIP）
//   node scripts/preflight.mjs --fast     跳过冒烟（不请求 GitHub、不建 worktree）
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FAST = process.argv.includes('--fast')
const rows = []
const record = (name, ok, detail = '') => {
  rows.push({ name, ok, detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name.padEnd(34) + detail)
}
const CHILD_ENV = { ...process.env }
delete CHILD_ENV.DSH_SUPERAGENT_STATE      // 本脚本自己的临时目录，不能污染子进程
delete CHILD_ENV.DSH_SUPERAGENT_NO_POLL    // 路由检查用的开关，冒烟必须真轮询
delete CHILD_ENV.DSH_SUPERAGENT_TRIGGER
const tryRun = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', env: CHILD_ENV, ...opts })

// ① 单测
{
  const res = tryRun('node', ['--test'])
  const out = String(res.stdout || '') + String(res.stderr || '')
  const tests = (out.match(/# tests (\d+)/) || out.match(/ℹ tests (\d+)/) || [])[1]
  const pass = (out.match(/# pass (\d+)/) || out.match(/ℹ pass (\d+)/) || [])[1]
  const fail = (out.match(/# fail (\d+)/) || out.match(/ℹ fail (\d+)/) || [])[1]
  record('单测 node --test', res.status === 0 && fail === '0', `${pass}/${tests} 通过，失败 ${fail}`)
}

// ② 语法
{
  const files = ['client.js', 'lib/index.js', 'lib/watch.js', 'lib/gh-format.js', 'lib/redact.js', 'lib/body.js']
  const bad = files.filter((f) => tryRun('node', ['--check', f]).status !== 0)
  record('语法 node --check', bad.length === 0, bad.length ? '失败：' + bad.join(', ') : `${files.length} 个文件`)
}

// ③ profile 一致性（CI 上没有 profile，自动 SKIP）
{
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  const profileDir = join(home, 'profiles', 'desktop', 'node_modules', 'dsh-session-superagent')
  if (!existsSync(profileDir)) {
    console.log('SKIP profile 一致性 --check        没有 profile 安装目录（CI 环境正常）')
  } else {
    const res = tryRun('node', ['scripts/sync-profile.mjs', '--check'])
    const out = String(res.stdout || '')
    const line = (out.match(/缺失 \d+ \/ 断链 \d+ \/ 陈旧 \d+/) || ['(无输出)'])[0]
    record('profile 一致性 --check', res.status === 0, line)
  }
}

// ④ 版本五处一致
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const client = readFileSync(join(ROOT, 'client.js'), 'utf8')
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const clientVersion = (client.match(/const CLIENT_VERSION = '([^']+)'/) || [])[1]
  const badge = (readme.match(/badge\/version-([0-9.]+)-green/) || [])[1]
  const top = (changelog.match(/## \[([0-9.]+)\]/) || [])[1]
  const same = clientVersion === pkg.version && badge === pkg.version && top === pkg.version
  record('版本一致（4 处）', same, `${pkg.version} / client ${clientVersion} / badge ${badge} / changelog ${top}`)
}

// ⑤ 路由面（期望 8 条）
{
  const stateDir = mkdtempSync(join(tmpdir(), 'preflight-'))
  process.env.DSH_SUPERAGENT_STATE = stateDir
  process.env.DSH_SUPERAGENT_NO_POLL = '1'
  let count = 0
  let paths = []
  try {
    const mod = await import('../lib/index.js?preflight=' + Date.now())
    mod.apply({
      tools: { register() {} },
      webServer: { register: (r) => { count += 1; paths.push(r.path); return () => {} } },
      agents: { get: () => null, currentInitiator: () => null },
      get: () => null, on() {}, effect: (fn) => fn(),
    })
  } catch (error) {
    record('路由面', false, 'apply 抛错：' + (error && error.message))
  }
  const expected = ['client-error', 'client-note', 'credentials', 'diagnose', 'goal', 'state', 'update', 'watch']
    .map((n) => '/session-superagent/' + n)
  const ok = count === 8 && expected.every((p) => paths.includes(p))
  record('路由面（8 条）', ok, `${count} 条：${paths.map((p) => p.split('/').pop()).join(' ')}`)
  rmSync(stateDir, { recursive: true, force: true })
}

// ⑥ 打包内容
{
  // Windows 上 npm 是 .cmd：用 cmd /c 调它（比 shell:true 安全，也不触发 DEP0190）
  const res = process.platform === 'win32'
    ? tryRun('cmd.exe', ['/c', 'npm', 'pack', '--dry-run'])
    : tryRun('npm', ['pack', '--dry-run'])
  const out = String(res.stdout || '') + String(res.stderr || '')
  const files = (out.match(/total files:\s+(\d+)/) || [])[1]
  const leaked = []
  for (const needle of ['npm notice test/', 'npm notice .tmp-', 'preview-panel.html', 'release/', 'node_modules/']) {
    if (out.includes(needle)) leaked.push(needle.trim())
  }
  if (/npm notice \d+(\.\d+)?[kM]?B \S+\.tgz/.test(out)) leaked.push('.tgz')
  record('npm pack 内容', res.status === 0 && leaked.length === 0, `${files} 个文件` + (leaked.length ? '（含：' + leaked.join(', ') + '）' : ''))
}

// ⑥.4 离线挂载冒烟（真机服务端一改就是几十个版本一起跳，挂不上去等于整块功能消失）
{
  const res = tryRun('node', ['scripts/smoke-mount.mjs', '--json'], { timeout: 60000 })
  let detail = '无法解析输出'
  let ok = false
  try {
    const data = JSON.parse(String(res.stdout || '{}'))
    ok = res.status === 0 && data.ok === true
    detail = ok
      ? `${data.version} / 工具 ${data.tools.length} / 路由 ${data.routes.length}`
      : (data.failure || ('缺路由：' + (data.missing || []).join(',')))
  } catch { ok = false }
  record('离线挂载冒烟', ok, detail)
}

// ⑥.45 文档链接体检（45+ 篇互相引用，写错了没人会发现）
{
  const res = tryRun('node', ['scripts/check-docs.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '').trim().split(String.fromCharCode(10))
  record('文档链接', res.status === 0, out[1] ? out[1].replace(/^PASS /, '') : '无输出')
}

// ⑥.5 双主题预览能渲染（离线验收界面用的那条命令，坏掉就等于没有验收手段）
{
  const out = join(tmpdir(), 'zhuli-preview-check-' + Date.now() + '.html')
  const res = tryRun('node', ['scripts/render-preview.mjs', out], { timeout: 120000 })
  let ok = false
  let detail = 'render-preview 执行失败'
  try {
    const html = readFileSync(out, 'utf8')
    const hasLight = html.includes('浅色主题')
    const hasDark = html.includes('深色主题')
    const scenarios = (html.match(/class="preview-title"/g) || []).length
    ok = res.status === 0 && hasLight && hasDark && scenarios >= 18
    detail = scenarios + ' 块（浅色+深色）'
  } catch (error) {
    detail = String(error && error.message || error).slice(0, 120)
  } finally {
    try { rmSync(out, { force: true }) } catch {}
  }
  record('双主题预览可渲染', ok, detail)
}

// ⑦ UI 体检（不需要宿主：量的是源码里的可访问性与 token 使用）
{
  const res = tryRun('node', ['scripts/ui-audit.mjs', '--json'])
  let score = 0
  let failed = []
  try {
    const data = JSON.parse(String(res.stdout || '{}'))
    score = data.score || 0
    failed = (data.results || []).filter((r) => !r.ok).map((r) => r.name)
  } catch { failed = ['ui-audit 输出无法解析'] }
  record('UI 体检', res.status === 0 && score === 100,
    `${score} 分` + (failed.length ? '（未过：' + failed.join('；') + '）' : ''))
}

// ⑧ 冒烟（需要 gh；不可用则 SKIP，不算失败）
if (FAST) {
  console.log('SKIP 冒烟 smoke:observe              --fast 跳过')
} else {
  const ghOk = tryRun('gh', ['auth', 'status']).status === 0
  if (!ghOk) {
    console.log('SKIP 冒烟 smoke:observe              gh 未登录')
  } else {
    const res = tryRun('node', ['scripts/smoke-observe.mjs'], { timeout: 180000 })
    const out = String(res.stdout || '')
    const okCount = (out.match(/^OK /gm) || []).length
    const badCount = (out.match(/^FAIL /gm) || []).length
    record('冒烟 smoke:observe', res.status === 0 && badCount === 0, `${okCount} 项 OK / ${badCount} 项 FAIL`)
  }
}

const failures = rows.filter((r) => !r.ok)
console.log('---')
console.log(failures.length === 0 ? `全部通过（${rows.length} 项检查）` : `${failures.length} 项失败`)
if (failures.length > 0) process.exit(1)
