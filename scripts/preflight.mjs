// 一条命令跑完「发版必跑」的七项检查，输出 PASS/FAIL 表并以退出码给出结论。
//
// 目的：把 HANDOFF 里那段散文式检查清单变成可执行的东西 —— 清单会过期，脚本不会。
//
// 用法：
//   node scripts/preflight.mjs            全部检查（gh 不可用时冒烟自动 SKIP）
//   node scripts/preflight.mjs --fast     跳过冒烟（不请求 GitHub、不建 worktree）
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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
  // README 里写着“N 项单测”：这个数最容易悄悄过期（本轮从 136 掉到 181 才发现）
  const claimed = (readFileSync(join(ROOT, 'README.md'), 'utf8').match(/(\d+) 项单测/) || [])[1]
  record('README 单测数', Boolean(claimed) && claimed === String(tests),
    claimed ? (claimed === String(tests) ? 'README 写 ' + claimed + '，实际 ' + tests : 'README 写 ' + claimed + '，实际 ' + tests + '（改 README）') : 'README 没写单测数')
}

// ①.45 跳过必须可见（skip 要带原因；用例体内不许静默 return）
{
  const res = tryRun('node', ['scripts/audit-test-skips.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL '))
  const warn = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('WARN '))
  record('跳过可见性', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (warn.length > 0 ? warn[0].replace(/^WARN /, '') : 'skip 都有原因，无用例体内 return'))
}

// ①.5 临时目录收口（独立脚本，注入验证也能单独跑）
{
  const res = tryRun('node', ['scripts/audit-tmp-dirs.mjs'], { timeout: 60000 })
  const line = (String(res.stdout || '').trim().split(String.fromCharCode(10))[0] || '无输出')
  record('临时目录收口', res.status === 0, line.replace(/^(PASS|FAIL) 临时目录收口\s*/, ''))
}

// ①.6 错误建议体检（每条建议要短、要能做 —— 文字会随版本漂移）
{
  const res = tryRun('node', ['scripts/audit-error-hints.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '').split(String.fromCharCode(10))
  const bad = out.filter((line) => line.startsWith('FAIL'))
  const cover = (String(res.stdout || '').match(/覆盖 (\d+) 类错误/) || [])[1]
  record('错误建议', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (cover ? cover + ' 类：都 ≤60 字符且有可执行动作' : '无输出'))
}

// ①.7 门禁自检（注入式验证：确认检查真的会红；--fast 跳过，约 10 秒）
if (!FAST) {
  const res = tryRun('node', ['scripts/verify-gates.mjs'], { timeout: 180000 })
  const out = String(res.stdout || '')
  const summary = (out.match(/PASS (\d+)\/(\d+) 项注入都被检测到/) || [])
  record('门禁自检', res.status === 0 && summary.length > 0,
    summary.length > 0 ? summary[1] + '/' + summary[2] + ' 项注入都被检测到（' + (String(res.stdout || '').match(/注入覆盖：(\d+)\/(\d+)/) || ['', '?', '?'])[1] + '/' + (String(res.stdout || '').match(/注入覆盖：(\d+)\/(\d+)/) || ['', '?', '?'])[2] + ' 项有注入）' : (out.split(String.fromCharCode(10)).filter((l) => l.startsWith('FAIL'))[0] || '无输出').replace(/^FAIL /, ''))
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

// ⑤ 路由面（独立脚本，注入验证也能单独跑）
{
  const res = tryRun('node', ['scripts/audit-routes.mjs'], { timeout: 60000 })
  const line = (String(res.stdout || '').trim().split(String.fromCharCode(10))[0] || '无输出')
  record('路由面（9 条）', res.status === 0, line.replace(/^(PASS|FAIL) 路由面（9 条）\s*/, ''))
}

// ⑥ 打包内容（脚本独立，注入验证也能单独跑它）
{
  const res = tryRun('node', ['scripts/audit-pack.mjs'], { timeout: 120000 })
  const line = (String(res.stdout || '').trim().split(String.fromCharCode(10))[0] || '无输出')
  record('npm pack 内容', res.status === 0, line.replace(/^(PASS|FAIL) npm pack 内容\s*/, ''))
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

// ⑥.49 并发隔离（两个会话守同一仓库时会不会互相踩）
{
  const res = tryRun('node', ['scripts/verify-concurrency.mjs'], { timeout: 120000 })
  const lines = String(res.stdout || '').trim().split(String.fromCharCode(10))
  const last = lines[lines.length - 1] || ''
  const failedLines = lines.filter((line) => line.startsWith('FAIL'))
  record('并发隔离', res.status === 0 && failedLines.length === 0,
    failedLines.length > 0 ? failedLines[0].trim() : last.replace(/^PASS /, ''))
}

// ⑥.48 隔离执行真机链路（唯一还停留在"读过代码"的环节）
{
  const res = tryRun('node', ['scripts/verify-isolation.mjs'], { timeout: 120000 })
  const lines = String(res.stdout || '').trim().split(String.fromCharCode(10))
  const last = lines[lines.length - 1] || ''
  const failedLines = lines.filter((line) => line.startsWith('FAIL'))
  record('隔离链路', res.status === 0 && failedLines.length === 0,
    failedLines.length > 0 ? failedLines[0].trim() : last.replace(/^PASS /, ''))
}

// ⑥.47 客户会读到的文字有没有被改动（示例文档是快照，改动必须是有意的）
{
  const res = tryRun('node', ['scripts/first-run.mjs', '--check'], { timeout: 60000 })
  const out = String(res.stdout || '').trim().split(String.fromCharCode(10))
  record('文案快照', res.status === 0, res.status === 0 ? (out[0] || '').replace(/^PASS /, '') : '文案变了：跑 node scripts/first-run.mjs --write 再看 diff')
}

// ⑥.461 面板文案快照（消息文案早有快照，面板上那几十条提示一直没有）
{
  const res = tryRun('node', ['scripts/render-panel-copy.mjs', '--check'], { timeout: 90000 })
  const out = String(res.stdout || '').trim().split(String.fromCharCode(10))
  record('面板文案快照', res.status === 0, (res.status === 0 ? out[0] : (out[0] || '无输出')).replace(/^(PASS|提示) /, ''))
}

// ⑥.46 验收清单与 preflight 一致（每项检查都要能解释"防什么"，否则门禁不可信）
{
  const res = tryRun('node', ['scripts/render-acceptance.mjs', '--check'], { timeout: 60000 })
  const out = String(res.stdout || '').trim().split(String.fromCharCode(10))
  const bad = out.filter((line) => line.startsWith('FAIL'))
  record('验收清单', res.status === 0 && bad.length === 0, (res.status === 0 ? out[0] : bad[0] || '无输出').replace(/^PASS /, ''))
}

// ⑥.459 JSON 契约文档与字段清单一致（契约要出现在客户看得见的地方）
{
  const res = tryRun('node', ['scripts/render-contract.mjs', '--check'], { timeout: 60000 })
  const out = String(res.stdout || '').trim()
  record('JSON 契约', res.status === 0, out.replace(/^PASS /, '') || '无输出')
}

// ⑥.458 全 docs/ 一致性（老文档最容易把人带到不存在的工具/路由/文件）
{
  const res = tryRun('node', ['scripts/audit-docs-all.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL'))
  const scanned = (out.match(/扫描 (\d+) 份文档/) || [])[1]
  record('全库文档一致', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (scanned || '?') + ' 份文档的工具/路由/版本/路径都对得上')
}

// ⑥.457 唤醒消息单行长度（聊天窗口里太长会挤成一团）
{
  const res = tryRun('node', ['scripts/audit-line-length.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const worst = out.match(/最长一行 (\d+) 字符/)
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL'))
  record('单行长度', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (worst ? '最长 ' + worst[1] + ' 字符（上限 120）' : '无输出'))
}

// ⑥.456 信息密度（默认展开的区块不该太多；判据写死在脚本里）
{
  const res = tryRun('node', ['scripts/audit-density.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const worst = out.match(/最密集的一页有 (\d+) 个区块/)
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL'))
  record('信息密度', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (worst ? '最密集一页 ' + worst[1] + ' 个区块（上限 6）' : '无输出'))
}

// ⑥.455 文档里提到的工具名/路由必须真实存在（重构改名后文档不会自己报错）
{
  const res = tryRun('node', ['scripts/audit-claims-consistency.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL'))
  const tools = (out.match(/工具 (\d+) 个/) || [])[1]
  const routes = (out.match(/路由 (\d+) 条/) || [])[1]
  record('文档标识符', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].replace(/^FAIL /, '') : (tools || '?') + ' 个工具 / ' + (routes || '?') + ' 条路由都对得上')
}

// ⑥.46 知识库的 ✅ 必须能在 CHANGELOG 里找到对应版本（KB 不能只靠自己声称）
{
  const res = tryRun('node', ['scripts/audit-kb-claims.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const claims = (out.match(/声明\s+(\d+) 条/) || [])[1]
  const paths = (out.match(/提到的文件路径\s+(\d+) 个/) || [])[1]
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL') || line.includes('没写落地状态：'))
  record('知识库有据', res.status === 0 && bad.length === 0,
    bad.length > 0 ? bad[0].trim() : (claims ? claims + ' 条 ✅ 都能找到发布 / ' + (paths || '?') + ' 个路径都存在' : '无输出'))
}

// ⑥.5 双主题预览能渲染（独立脚本，注入验证也能单独跑）
{
  const res = tryRun('node', ['scripts/audit-preview.mjs'], { timeout: 120000 })
  const line = (String(res.stdout || '').trim().split(String.fromCharCode(10))[0] || '无输出')
  record('双主题预览可渲染', res.status === 0, line.replace(/^(PASS|FAIL) 双主题预览可渲染\s*/, ''))
}

// ⑥.65 工具描述里的承诺要在对账表里有一行
{
  const res = tryRun('node', ['scripts/audit-promises.mjs'], { timeout: 60000 })
  const out = String(res.stdout || '')
  const miss = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('FAIL 对账表缺'))
  record('工具承诺对照', res.status === 0, miss.length > 0 ? miss[0].replace(/^FAIL /, '') : '5 条承诺都有对应行')
}

// ⑥.6 术语表双向对照（面板用了的必须解释；术语表里的不能是死词）
{
  const res = tryRun('node', ['scripts/audit-glossary.mjs'], { timeout: 90000 })
  const out = String(res.stdout || '')
  const bad = out.split(String.fromCharCode(10)).filter((line) => line.startsWith('  ') && line.trim())
  record('术语表对照', out.includes('PASS 术语表的每个词') && out.includes('PASS 面板里的技术词'),
    bad.length > 0 ? '待补：' + bad.map((l) => l.trim()).join(' / ') : '双向对齐（15 条术语）')
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
    if (out.startsWith('SKIP')) {
      console.log('SKIP 冒烟 smoke:observe              需要真机宿主（已列进攒批清单）')
    } else {
    const okCount = (out.match(/^OK /gm) || []).length
    const badCount = (out.match(/^FAIL /gm) || []).length
    record('冒烟 smoke:observe', res.status === 0 && badCount === 0, `${okCount} 项 OK / ${badCount} 项 FAIL`)
    }
  }
}

const failures = rows.filter((r) => !r.ok)
console.log('---')
console.log(failures.length === 0 ? `全部通过（${rows.length} 项检查）` : `${failures.length} 项失败`)
if (failures.length > 0) process.exit(1)
