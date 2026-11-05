// React 语义陷阱体检（客户实拍 0.9.248 的教训）。
//
// 那次 bug：`client.js` 用 `node.props.key === section` 找子节点 ——
// **真 React 会把 `key` 从 props 里剥掉**（它挂在 element.key 上），于是 find 永远落空，
// 面板上的表现是「点左栏导航，高亮动了、内容不动」。387 条用例一条都没发现，
// 因为测试桩当时把 `key` 留在了 props 里。
//
// 这个脚本守三件事，全部是「在桩里能跑、在真机上坏」的形状：
//   ① 代码里不许靠 `props.key` 做判断（React 剥掉它）
//   ② 代码里不许**改写** props（React 在开发模式下会冻结 props 对象）
//   ③ 测试桩必须和 React 一样把 key 剥掉（否则第 ① 类 bug 永远测不出来）
//
// 用法：node scripts/audit-react-semantics.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rawClient = readFileSync(join(ROOT, 'client.js'), 'utf8')
// 注释里当然可以写 `props.key`（解释这个坑的时候就要写）—— 扫之前先按行去掉注释
const stripComments = (text) => text
  .split(String.fromCharCode(10))
  .map((line) => {
    const at = line.indexOf('//')
    return at >= 0 && !/'.*\/\//.test(line.slice(0, at)) ? line.slice(0, at) : line
  })
  .join(String.fromCharCode(10))
const client = stripComments(rawClient)
const harness = readFileSync(join(ROOT, 'test', 'fixtures', 'panel-harness.mjs'), 'utf8')

const findings = []

// ① props.key / node.props.key
for (const match of client.matchAll(/\.props\s*\.\s*key\b/g)) {
  const line = client.slice(0, match.index).split('\n').length
  findings.push({ kind: 'props.key', line, text: 'client.js:' + line })
}
// 也抓 `['key']` 这种写法
for (const match of client.matchAll(/\.props\s*\[\s*['"]key['"]\s*\]/g)) {
  const line = client.slice(0, match.index).split('\n').length
  findings.push({ kind: 'props.key', line, text: 'client.js:' + line })
}

// ② 改写 props：`x.props.y = ` / `x.props = ` / `Object.assign(x.props`
for (const match of client.matchAll(/\.props\s*\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/g)) {
  const line = client.slice(0, match.index).split('\n').length
  findings.push({ kind: 'props 赋值', line, text: 'client.js:' + line })
}
for (const match of client.matchAll(/Object\.assign\(\s*[A-Za-z_$][\w$]*\.props/g)) {
  const line = client.slice(0, match.index).split('\n').length
  findings.push({ kind: 'props 赋值', line, text: 'client.js:' + line })
}

// ③ 桩必须剥 key
const stripsKey = /const\s*\{\s*key\s*,\s*\.\.\.rest\s*\}\s*=\s*props/.test(harness)

console.log('检查 client.js（' + Math.round(client.length / 1024) + ' KB）与测试桩')
console.log('---')

let bad = 0
if (findings.length === 0) {
  console.log('PASS 没有依赖 props.key / 改写 props 的地方')
} else {
  for (const item of findings) {
    console.log('FAIL ' + item.kind + ' 于 ' + item.text + '（真 React 会剥掉 key / 冻结 props，桩里却成立）')
  }
  bad += 1
}

if (stripsKey) {
  console.log('PASS 测试桩按 React 语义剥掉了 key（这类 bug 以后测得出来）')
} else {
  console.log('FAIL 测试桩把 key 留在了 props 里 —— ① 这类 bug 会被永远掩盖')
  bad += 1
}

if (bad > 0) process.exitCode = 1
