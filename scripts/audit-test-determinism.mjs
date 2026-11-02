// 测试确定性体检：找出依赖网络 / 真实时间 / 真实 gh / 真实 git 的用例。
//
// 为什么：门禁偶发红的代价是"人开始怀疑门禁"（见 KB flaky-gate.md）。
// 这一层不做判定，只**列出来**，由人决定哪些需要 stub、哪些本来就是集成测试。
//
// 用法：node scripts/audit-test-determinism.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const testDir = join(root, 'test')
const files = readdirSync(testDir).filter((name) => name.endsWith('.test.mjs'))

// 风险信号：出现即可能不稳定
// 只认**真实的调用**，不认字符串里出现的 URL：
// 上一版把测试数据里的 "https://…" 也当网络请求，一口气报了十几条假警报。
const SIGNALS = [
  { key: 'network', pattern: /\bfetch\(|execFileSync\('curl'|https?\.request\(/, why: '真实网络请求' },
  { key: 'gh', pattern: /execFileSync\('gh'|spawnSync\('gh'/, why: '真实 gh 调用' },
  { key: 'git', pattern: /execFileSync\('git'|spawnSync\('git'/, why: '真实 git 调用' },
  { key: 'clock', pattern: /Date\.now\(\)|new Date\(\)/, why: '依赖当前时间（多数无害，看是否与断言比较）' },
  { key: 'temp', pattern: /mkdtempSync\(/, why: '临时目录（命名正确就不会撞，仅提示）' },
]

const findings = []
for (const name of files) {
  const text = readFileSync(join(testDir, name), 'utf8')
  const lines = text.split(String.fromCharCode(10))
  for (const signal of SIGNALS) {
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return // 注释不算
      if (signal.pattern.test(line)) findings.push({ file: name, line: index + 1, kind: signal.key, why: signal.why, text: line.trim().slice(0, 80) })
    })
  }
}

const byKind = {}
for (const item of findings) (byKind[item.kind] ||= []).push(item)

console.log('扫描 ' + files.length + ' 个测试文件，命中 ' + findings.length + ' 处不确定来源：')
console.log('---')
for (const [kind, items] of Object.entries(byKind)) {
  console.log(kind + '（' + items.length + '）—— ' + items[0].why)
  const seen = new Set()
  for (const item of items) {
    const key = item.file + ':' + item.line
    if (seen.has(key)) continue
    seen.add(key)
    if (seen.size <= 6) console.log('  ' + key + '  ' + item.text)
  }
  if (items.length > 6) console.log('  … 另有 ' + (items.length - 6) + ' 处')
}
console.log('---')
console.log('说明：命中不等于有问题 —— 集成测试本来就需要真环境；这份清单是给人判断的输入。')
