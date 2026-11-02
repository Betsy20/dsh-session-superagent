// 门禁的"注入式验证"：故意制造一个错误，确认对应检查真的会红，然后还原。
//
// 为什么：门禁最怕**僵尸检查** —— 永远是绿的，看着很安心，其实早就不检查任何东西。
// 这里只用"安全可还原"的注入（临时文件 / 单处字符串），全部在 finally 里还原。
//
// 用法：node scripts/verify-gates.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const coverage = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'gate-coverage.json'), 'utf8'))
const preflightSrc = readFileSync(join(root, 'scripts', 'preflight.mjs'), 'utf8')
const allChecks = [...new Set([...preflightSrc.matchAll(/record\('([^']+)'/g)].map((m) => m[1]))]
const run = (args) => {
  try {
    const out = execFileSync('node', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: String(error.stdout || '') + String(error.stderr || '') }
  }
}

const results = []
const record = (name, detected, detail) => {
  results.push({ name, detected, detail })
  console.log((detected ? 'PASS ' : 'FAIL ') + name + (detail ? '　' + detail : ''))
}

// ① README 单测数：把数字改错，preflight 的对应项必须红
{
  const path = join(root, 'README.md')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original.replace(/(\d+) 项单测/, '9999 项单测'))
    const res = run(['scripts/preflight.mjs', '--fast'])
    record('README 单测数（注入错数字）', res.code !== 0 && /README 单测数\s+README 写 9999/.test(res.out))
  } finally {
    writeFileSync(path, original)
  }
}

// ② 知识库有据：临时写一条 ✅ 到不存在的版本，检查必须红
{
  const path = join(root, 'docs', 'kb', 'zz-injected-claim.md')
  try {
    writeFileSync(path, '# 注入测试\n\n## 是否已落地\n✅ 9.9.9\n')
    const res = run(['scripts/audit-kb-claims.mjs'])
    record('知识库有据（注入假版本）', res.code !== 0 && /9\.9\.9/.test(res.out))
  } finally {
    if (existsSync(path)) unlinkSync(path)
  }
}

// ③ 文档链接：临时写一个断链，check-docs 必须红
{
  const path = join(root, 'docs', 'zz-injected-link.md')
  try {
    writeFileSync(path, '# 注入测试\n\n见 [不存在的文档](nope-not-here.md)。\n')
    const res = run(['scripts/check-docs.mjs'])
    record('文档链接（注入断链）', res.code !== 0 && /nope-not-here\.md/.test(res.out))
  } finally {
    if (existsSync(path)) unlinkSync(path)
  }
}

// ④ 面板文案快照：改一个字符串，--check 必须红
{
  const path = join(root, 'client.js')
  const original = readFileSync(path, 'utf8')
  try {
    const mutated = original.replace("'全部暂停'", "'全部暂停（注入）'")
    writeFileSync(path, mutated)
    const res = run(['scripts/render-panel-copy.mjs', '--check'])
    record('面板文案快照（注入改字）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑤ 版本一致：把 CLIENT_VERSION 改掉，preflight 的「版本一致」必须红
{
  const path = join(root, 'client.js')
  const original = readFileSync(path, 'utf8')
  try {
    const mutated = original.replace(/const CLIENT_VERSION = '[^']+'/, "const CLIENT_VERSION = '0.0.1'")
    writeFileSync(path, mutated)
    // 只跑相关用例（跑整套 preflight 太慢，注入验证要快才能常跑）
    const res = run(['--test', 'test/meta.test.mjs'])
    record('版本一致（注入错版本）', res.code !== 0 && /CLIENT_VERSION/.test(res.out))
  } finally {
    writeFileSync(path, original)
  }
}

// ⑥ 路由面：改一条路由路径，preflight 的「路由面」必须红
{
  const path = join(root, 'lib', 'index.js')
  const original = readFileSync(path, 'utf8')
  try {
    const mutated = original.replace("path: '/session-superagent/trace'", "path: '/session-superagent/zzz'")
    writeFileSync(path, mutated)
    const res = run(['--test', 'test/routes.test.mjs'])
    record('路由面（注入改路径）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// 信息密度：往「判定」页多塞四个 Section，density 脚本必须红
{
  const path = join(root, 'client.js')
  const original = readFileSync(path, 'utf8')
  try {
    const inject = [
      "h(Section, { key: 'zzz1', title: '注入块一' }, null),",
      "h(Section, { key: 'zzz2', title: '注入块二' }, null),",
      "h(Section, { key: 'zzz3', title: '注入块三' }, null),",
      "h(Section, { key: 'zzz4', title: '注入块四' }, null),",
      "h(Section, { key: 'trace', title: '追溯一条'",
    ].join(String.fromCharCode(10) + '        ')
    const injected = original.replace("h(Section, { key: 'trace', title: '追溯一条'", inject)
    writeFileSync(path, injected)
    const res = run(['scripts/audit-density.mjs'])
    record('信息密度（注入 4 个区块）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑧ JSON 契约：往清单里加一个不存在的字段，render-contract --check 必须红
{
  const path = join(root, 'test', 'fixtures', 'contract-stability.json')
  const original = readFileSync(path, 'utf8')
  try {
    const data = JSON.parse(original)
    data.watch_status.root.zzzInjected = 'stable'
    writeFileSync(path, JSON.stringify(data, null, 2) + String.fromCharCode(10))
    const res = run(['scripts/render-contract.mjs', '--check'])
    record('JSON 契约（注入假字段）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑨ 错误建议：把某条建议拉长到超限，audit-error-hints 必须红
{
  const path = join(root, 'lib', 'gh-format.js')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original.replace('（找不到 gh 命令：确认已安装且在 PATH）',
      '（找不到 gh 命令：请先确认你已经安装了 GitHub CLI，再确认可执行文件所在目录已经加入 PATH 环境变量，必要时重新打开终端）'))
    const res = run(['scripts/audit-error-hints.mjs'])
    record('错误建议（注入超长建议）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑩ 全库文档一致：临时文档里写一个不存在的工具名，audit-docs-all 必须红
{
  const path = join(root, 'docs', 'zz-injected-tool.md')
  try {
    writeFileSync(path, '# 注入测试' + String.fromCharCode(10) + String.fromCharCode(10) + '调用 `watch_nonexistent_tool` 即可。' + String.fromCharCode(10))
    const res = run(['scripts/audit-docs-all.mjs'])
    record('全库文档一致（注入假工具名）', res.code !== 0 && /watch_nonexistent_tool/.test(res.out))
  } finally {
    if (existsSync(path)) unlinkSync(path)
  }
}

// ⑪ 文案快照（唤醒消息）：改一个可见词，first-run --check 必须红
{
  const path = join(root, 'lib', 'watch.js')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original.replace('【为什么是这几条】', '【注入测试标题】'))
    const res = run(['scripts/first-run.mjs', '--check'])
    record('文案快照（注入改标题）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑫ 语法：临时把一行写成非法语法，preflight 的「语法」必须红
{
  const path = join(root, 'lib', 'redact.js')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original + String.fromCharCode(10) + 'const broken = (' + String.fromCharCode(10))
    const res = run(['scripts/preflight.mjs', '--fast'])
    record('语法（注入非法语法）', res.code !== 0 && /语法/.test(res.out))
  } finally {
    writeFileSync(path, original)
  }
}

// ⑬ profile 一致性：往 lib/index.js 加一条指向不存在文件的 import，--check 必须红
{
  const path = join(root, 'lib', 'index.js')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original + String.fromCharCode(10) + "import './zz-not-here.js'" + String.fromCharCode(10))
    const res = run(['scripts/sync-profile.mjs', '--check'])
    record('profile 一致性（注入断链 import）', res.code !== 0 && /断链/.test(res.out))
  } finally {
    writeFileSync(path, original)
  }
}

// ⑮ 单行长度：把消息里一句改成超长，audit-line-length 必须红
{
  const path = join(root, 'lib', 'watch.js')
  const original = readFileSync(path, 'utf8')
  try {
    const filler = '这是一句被故意拉长的注入文本'.repeat(20)
    writeFileSync(path, original.replace('【完成标准】', '【完成标准】' + filler))
    const res = run(['scripts/audit-line-length.mjs'])
    record('单行长度（注入超长行）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑯ UI 体检：把一处 token 改回写死颜色，ui-audit 必须红（0.9.69 修好指标后这条才成立）
{
  const path = join(root, 'client.js')
  const original = readFileSync(path, 'utf8')
  try {
    writeFileSync(path, original.replace("badgeOn: { color: 'var(--dsw-alias-state-success-primary)' }", "badgeOn: { color: '#1a7f37' }"))
    const res = run(['scripts/ui-audit.mjs'])
    record('UI 体检（注入写死颜色）', res.code !== 0)
  } finally {
    writeFileSync(path, original)
  }
}

// ⑱ 临时目录收口：临时塞一个自己建临时目录的测试文件，preflight 必须红
{
  const path = join(root, 'test', 'zz-injected-tmp.test.mjs')
  try {
    writeFileSync(path, [
      "import test from 'node:test'",
      "import { mkdtempSync } from 'node:fs'",
      "import { tmpdir } from 'node:os'",
      "import { join } from 'node:path'",
      "test('x', () => { mkdtempSync(join(tmpdir(), 'zhuli-zz-')) })",
    ].join(String.fromCharCode(10)) + String.fromCharCode(10))
    const res = run(['scripts/preflight.mjs', '--fast'])
    record('临时目录收口（注入违规测试）', res.code !== 0 && /临时目录收口/.test(res.out))
  } finally {
    if (existsSync(path)) unlinkSync(path)
  }
}

// 覆盖率报告：明确列出"还没被注入验证过"的检查，别让人以为全验过了
const covered = new Set(coverage.covered)
const exempt = coverage.exempt || {}
const notCovered = allChecks.filter((name) => !covered.has(name) && !exempt[name])
console.log('---')
console.log('注入覆盖：' + (allChecks.length - notCovered.length) + '/' + allChecks.length + ' 项检查有注入验证')
const exemptNames = allChecks.filter((name) => exempt[name])
console.log('豁免注入：' + exemptNames.length + ' 项（' + exemptNames.map((n) => n + '：' + exempt[n]).join('；') + '）')
if (notCovered.length > 0) console.log('仍可注入未做：' + notCovered.join('、'))
const suspect = Object.entries(coverage.suspect || {})
if (suspect.length > 0) {
  console.log('疑似失明（注入后指标没动，需人工查）：')
  for (const [name, why] of suspect) console.log('  ' + name + ' —— ' + why)
}

const failed = results.filter((item) => !item.detected)
console.log('---')
if (failed.length > 0) {
  console.log('FAIL ' + failed.length + '/' + results.length + ' 项注入没有被检测到 —— 这些是"僵尸检查"')
  process.exitCode = 1
} else {
  console.log('PASS ' + results.length + '/' + results.length + ' 项注入都被检测到（门禁是活的）')
}
