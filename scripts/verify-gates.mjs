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

const failed = results.filter((item) => !item.detected)
console.log('---')
if (failed.length > 0) {
  console.log('FAIL ' + failed.length + '/' + results.length + ' 项注入没有被检测到 —— 这些是"僵尸检查"')
  process.exitCode = 1
} else {
  console.log('PASS ' + results.length + '/' + results.length + ' 项注入都被检测到（门禁是活的）')
}
